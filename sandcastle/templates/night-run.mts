/**
 * night-run.mts — 夜间队列编排器（检查点续跑 + 配额熔断 + 清晨 digest）。
 *
 * 用法：
 *   npx tsx .sandcastle/night-run.mts --image localhost/<repo>:dsh \
 *     --verify "cargo test -p iris-api --lib" --max-minutes 60 \
 *     --queue .sandcastle/night-queue.json
 *
 * 队列格式（.sandcastle/night-queue.json，由编排会话或人工维护）：
 *   { "tickets": [449, 452, { "issue": 455, "verify": "cargo test -p iris-agent --lib", "model": "p/mini" }] }
 *   （ticket 对象的 model 可选：透传 run-ticket --model；缺省按审计 modelLane 路由）
 *
 * 行为：
 *   - 逐票 spawn run-ticket.mts（进程级崩溃隔离，单票崩不伤队列）
 *   - 幂等续跑：检查点已 merged/pr 的票自动跳过——崩溃/中断后重跑同一命令即从断点继续
 *   - 配额熔断：provider 配额/认证错误是【停止信号】不是重试信号——持久化进度并退出
 *   - 结束写 digest（.sandcastle/digest/<stamp>.md）：逐票状态 + 收口提醒
 *     （ticket-audit 抽查 + 批末 push 走 summary gate）
 *   - digest 附波次合并提示：merged 票按 3–5 票一波分组，波内 rebase onto master
 *     串行（本模板只给分组与提示文本；真执行归编排会话）
 *   - digest 附「retro 素材」段：返工 / 踩踏 / 降级 / 波次合并的**摘要素材**，喂给
 *     清晨主会话的批末 retro（#71 规则）。**容器内不跑 retro**（Q73-1）：这里只喂料。
 *
 * 退出码：0=全部处理完  2=配额熔断提前停止（队列可重跑续命）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { arg, isMain } from "./lib.ts";
import { EXIT_STATUS } from "./run-ticket.mts";

// ============================================================
// 波次合并提示（纯函数，供冒烟测试直接导入）
// ============================================================

/** 一波的形状：票号列表 + 落在本波内的 serial 组（写域重叠，须串行）。 */
export interface Wave {
  wave: number;
  tickets: string[];
  serialGroups: string[][];
}

/** T1 扫描报告的固定文件名：显式消费，不混入通用扫描。 */
const TOUCH_OVERLAP_FILE = "touch-overlap.json";

/**
 * 跨报告按票号合并 serial 组（union-find）：同一票出现在多份报告的多个组时，
 * 这些组传递合并为一个——否则 planWaves 的 groupOf 取首命中会漏掉其余组的
 * 串行约束。返回合并后的组（每组 >1 成员，保持首次出现顺序）。
 */
export function mergeSerialGroups(groups: string[][]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // 路径压缩
    let c = x;
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => {
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x);
    parent.set(find(a), find(b));
  };
  for (const g of groups) for (let i = 1; i < g.length; i++) union(g[0], g[i]);
  const byRoot = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(id);
  }
  return [...byRoot.values()].filter((g) => g.length > 1);
}

/**
 * 消费 T1 audit-ticket.mts --touch-overlap 写出的 .sandcastle/audits/*.json，
 * 提取 `serial: true` 分组（写域重叠 → 必须串行或合并）。
 * 目录缺失 / 无 serial 标记 / 单文件解析失败 → 宽容跳过，返回已收集的组。
 * touch-overlap.json 被显式排除在通用扫描外并专门消费（不依赖文件遍历顺序
 * 的巧合）；跨报告的重叠组经 mergeSerialGroups 合并去重。
 */
export function loadSerialGroups(auditsDir: string): string[][] {
  if (!existsSync(auditsDir)) return [];
  const groups: string[][] = [];
  const collect = (obj: any): void => {
    // 一份扫描报告含 groups 数组（audit-ticket --touch-overlap 的形态；
    // 单票审计记录自带的 serial 标记是已删的死分支——无生产者）
    if (Array.isArray(obj?.groups)) {
      for (const g of obj.groups) {
        if (g?.serial === true && Array.isArray(g.tickets) && g.tickets.length > 1) {
          groups.push(g.tickets.map(String));
        }
      }
    }
  };
  for (const f of readdirSync(auditsDir)) {
    if (!f.endsWith(".json") || f === TOUCH_OVERLAP_FILE) continue;
    try {
      collect(JSON.parse(readFileSync(`${auditsDir}/${f}`, "utf8")));
    } catch {
      continue; // 单个坏文件不拖垮整轮
    }
  }
  // 显式专门消费 T1 扫描报告（语义同通用扫描，但身份明确、只读一次）
  const scanPath = `${auditsDir}/${TOUCH_OVERLAP_FILE}`;
  if (existsSync(scanPath)) {
    try {
      collect(JSON.parse(readFileSync(scanPath, "utf8")));
    } catch {
      // 坏报告同样宽容跳过
    }
  }
  return mergeSerialGroups(groups);
}

/**
 * merged 票按 3–5 票一波贪心分组；serial 组成员强制拉进同一波
 * （波内 rebase onto master 本就串行，重叠票靠同波内顺序解决；组大小可溢出 5）。
 */
export function planWaves(merged: string[], serialGroups: string[][]): Wave[] {
  const inMerged = new Set(merged);
  // issue → 所属 serial 组（loadSerialGroups 已跨报告 union-find 合并去重，
  // 同一票只会命中一个组——首命中即全部约束）
  const groupOf = new Map<string, string[]>();
  for (const g of serialGroups) {
    for (const m of g) if (inMerged.has(m) && !groupOf.has(m)) groupOf.set(m, g);
  }

  const waves: Wave[] = [];
  const done = new Set<string>();
  const pushWave = (tickets: string[], serials: string[][]) => {
    if (tickets.length === 0) return;
    waves.push({ wave: waves.length + 1, tickets, serialGroups: serials });
  };

  let cur: string[] = [];
  let curSerials: string[][] = [];
  for (const id of merged) {
    if (done.has(id)) continue;
    const g = groupOf.get(id);
    if (g) {
      // serial 组：把组内所有 merged 成员一次性拉进当前波
      const members = g.filter((m) => inMerged.has(m) && !done.has(m));
      for (const m of members) { done.add(m); cur.push(m); }
      curSerials.push(members);
      if (cur.length >= 5) { pushWave(cur, curSerials); cur = []; curSerials = []; }
      continue;
    }
    done.add(id);
    cur.push(id);
    if (cur.length >= 5) { pushWave(cur, curSerials); cur = []; curSerials = []; }
  }
  pushWave(cur, curSerials);
  return waves;
}

/** 波次提示文本（digest 附加段；真执行归编排者）。 */
export function renderWaveHints(waves: Wave[]): string {
  if (waves.length === 0) return "波次合并提示：本轮无 merged 票，无需分组。";
  const lines = [
    "波次合并提示（3–5 票一波）：",
    ...waves.map((w) => {
      const serialNote = w.serialGroups.length > 0
        ? `（serial 组：${w.serialGroups.map((g) => g.map((t) => `#${t}`).join("/")).join("、")} 写域重叠，本波内必须串行）`
        : "";
      return `- 第 ${w.wave} 波${serialNote}：${w.tickets.map((t) => `#${t}`).join(" → ")}`;
    }),
    "- 波内 rebase onto master 串行（一票一 rebase，逐票合并）；波与波之间亦串行推进。",
    "- 本提示仅为分组建议：真执行归编排会话。",
  ];
  return lines.join("\n");
}

// ============================================================
// digest —— 素材与收口（纯函数，供冒烟测试直接导入）
//
// ⚠ 容器内不跑 retro（#73 Q73-1）。retro 的**决策路径**（候选交 human 拍板）只在
// 清晨主会话：批末 push 后的 CI 全绿信号正好落在那一刻，候选也只有在那里才能呈现
// 给人类。故**本文件是"喂料"而非"判定"** —— 它只把夜间跑出来的素材摘出来写进
// digest，**不包含任何 retro 触发/判定逻辑**（没有 push 关键词匹配、没有文本面
// 扫描、不读 `.scratch/batch-state.md`）。判定面恒为 `(toolName, argv)` + 标记，
// 那份判据的唯一实现在 enforcer（`workflow-enforcer.mjs` 的 #71 触发面，
// 判定面逐字口径见 `docs/workflow-enforcer.md`）；形状见 `docs/batch-state.md`。
// ============================================================

/** run-ticket 状态 → retro 素材类别（#71 批末 retro 的候选来源）。 */
export const RETRO_STATUS_CLASSES: { status: string; label: string }[] = [
  { status: "parked-verify", label: "降级/验证失败" },
  { status: "parked-conflict", label: "降级/冲突" },
  { status: "parked-timeout", label: "降级/超时" },
  { status: "parked-empty", label: "降级/空改" },
  { status: "needs-simplify", label: "降级/待简化" },
  { status: "quota-stop", label: "熔断/配额" },
];

/** digest 行里出现这几类**关键词**同样计入"返工"素材（状态字符串之外的信号）。 */
export const RETRO_NOTE_HINTS: { hint: string; label: string }[] = [
  { hint: "返工", label: "返工" },
  { hint: "rework", label: "返工" },
];

/** 逐票结果（night-run 主循环的产物；`note` 为 run-ticket 输出尾部）。 */
export interface RunResult {
  id: string;
  status: string;
  note: string;
}

/**
 * `RETRO STATUS / NOTE` 单元格：` | ` → ` / `（防表格串列）、折叠换行 → 空格、超长截断。
 * **主流程的说明列也走这里**（`digest` 表格那行），所以全文件只有一份转义口径 ——
 * 早先注释这么声称、却没让主流程复用（主流程是内联的 `replace/ slice`），
 * 复核实测抓到该不一致；现在两处真的同源。
 */
export function digestCell(text: string, max: number): string {
  return text.replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * 「retro 素材」段 —— **喂料，不是判定输入**。
 *
 * 这是什么：给清晨主会话的**批末 retro**（#71：聚合同批 `.scratch/retro/*.md` →
 * 去重合并记次数 → 按严重度排序 → 一次呈现）准备**摘要素材**，四类：
 *   1. **返工**：note 里出现返工/rework 的票（真返工由收口审计确认）；
 *   2. **踩踏**：serial 组（写域重叠）——**波次合并摘要**与它同源，重叠票靠
 *      同波内串行解决，踩踏是否真发生由收口审计确认；
 *   3. **降级**：parked + needs-simplify + 配额熔断的票（含 note 片段，必须
 *      带证据路径/命令才能进候选——材料对着 note 复核）；
 *   4. **波次合并摘要**：`planWaves`/`loadSerialGroups` 的产物（几波、serial
 *      组、超 5 票的波），与波次提示段共用同一个 `waves`，不另算一遍。
 *
 * ⚠ **本段不参与任何判定**：它不触发 retro、不写 `.scratch/`、不判断"该不该聚合"。
 * 发现 → 候选 → human 拍板的链条只在清晨主会话（Q73-1）；
 * 这里输出的是**给那条链的输入文本**，仅此而已。
 */
export function renderRetroMaterial(
  results: RunResult[],
  waves: Wave[],
  serialGroups: string[][],
): string {
  const classLabel = new Map(RETRO_STATUS_CLASSES.map((c) => [c.status, c.label]));
  // 返工只有**一种**判据：note 里出现返工信号（真返工由收口审计确认）。
  // 早先还判过 `r.status === "rework"` —— 那是**永假分支**：`statusForExit`（见下）只映出
  // merged / parked-* / needs-simplify / failed，主循环从不产出 `"rework"`。死码会误导读者
  // 以为存在这个状态，故删（复核实测抓到）。
  const rework = results.filter((r) =>
    RETRO_NOTE_HINTS.some((h) => r.note.toLowerCase().includes(h.hint.toLowerCase())),
  );
  const degraded = results.filter((r) => classLabel.has(r.status));
  const overlaps = serialGroups.filter((group) => group.some((id) => results.some((r) => r.id === id)));

  const lines: string[] = [
    "retro 素材（喂清晨主会话的批末 retro；**本段不参与判定**）：",
    `- 返工：${rework.length === 0 ? "无信号" : rework.map((r) => `#${r.id}（${r.status}）`).join("、")}`,
    `- 踩踏：serial 组 ${overlaps.length} 组${overlaps.length === 0 ? "（写域无重叠）" : ""} —— ${overlaps.map((g) => g.map((t) => `#${t}`).join("/")).join("、") || "—"}；真踩踏与否由收口审计确认`,
    `- 降级：${degraded.length === 0 ? "无" : degraded.map((r) => `${classLabel.get(r.status)} #${r.id}`).join("、")}`,
    // 空态与其余三类同形：明确写出"无"，而不是只留一个 `0 波` 的数字（复核实测：
    // 空批时四类里只有这一类没有空态文案）。
    `- 波次合并摘要：${waves.length === 0 ? "无（本轮无 merged 票，未成波）" : `${waves.length} 波（${waves.map((w) => `第 ${w.wave} 波 ${w.tickets.length} 票`).join("、")}；波内 rebase onto master 串行）`}`,
  ];
  for (const r of degraded) {
    lines.push(`  - #${r.id} note：${digestCell(r.note, 120) || "(空)"}`);
  }
  lines.push(
    "- 编辑入口（人在环）：这些是**候选素材**——只有「发现 → 候选 → human 拍板」这一条路；",
    "  想补/改素材**直接编辑本 digest**（它是本次夜跑的记录，不是机器状态），不必去动任何标记文件。",
  );
  return lines.join("\n");
}

/**
 * digest 的「收口提醒」。retro 步骤**逐条点名**——但**动作仍在主会话**：
 * 容器里没有任何一步会写 `.scratch/retro/` 或标记（Q73-1，本文件不跑 retro）。
 * 标记文件名与语义的单一事实源是 `docs/batch-state.md`。
 */
export function renderWrapUpHints(): string[] {
  return [
    "1. 对 merged 票按比例跑 `ticket-audit` 抽查（AC 覆盖/测试真实性/验证重放）",
    "2. 抽查通过 → 批末 push 走 summary gate（一次 push，远程 CI 全绿为完成）",
    "3. **批末 retro（在清晨主会话跑，不在容器内）**：CI 全绿后跑本会话 retro → 读齐同批 `.scratch/retro/*.md` → **去重合并（同一问题记次数）** → 按严重度排序 → **一次呈现**给 human（每条标来源票号/会话）",
    "4. 呈现之后写 `.scratch/retro/.aggregated`（跨会话的「聚合已呈现」抑制者——批末聚合**每批至多一次**），再把 `retro: done @ <commit>` 写进 `.scratch/batch-state.md`",
    "5. parked 票：verify/conflict → 同沙箱返工一次或降级白天 batch",
  ];
}

/** run-ticket.mts 退出码 → 状态（消费 run-ticket 导出的 EXIT_STATUS，单一事实源）。 */
export function statusForExit(code: number | null): string {
  const map: Record<number, string> = {
    [EXIT_STATUS.MERGED]: "merged",
    [EXIT_STATUS.VERIFY_FAILED]: "parked-verify",
    [EXIT_STATUS.CONFLICT]: "parked-conflict",
    [EXIT_STATUS.TIMEOUT]: "parked-timeout",
    [EXIT_STATUS.EMPTY]: "parked-empty",
    [EXIT_STATUS.NEEDS_SIMPLIFY]: "needs-simplify",
  };
  return map[code ?? 1] ?? `failed(${code})`;
}

/**
 * 幂等跳过判定：上次状态已是终态或待人工处理态 → 返回跳过说明；否则
 * undefined（重发射）。needs-simplify 与 parked 同等对待（待简化/返工后
 * 由人工或编排者清检查点重跑，夜间队列不盲目重发射）。
 */
export function skipReason(prevStatus: string): string | undefined {
  if (prevStatus === "merged" || prevStatus === "pr") return "checkpoint 已收口，跳过";
  if (prevStatus === "parked-verify" || prevStatus === "parked-conflict") return "上次已 park（未返工），跳过";
  if (prevStatus === "needs-simplify") return "上次已 needs-simplify（待简化），跳过";
  return undefined;
}

// ============================================================
// CLI 主体（被直接执行时才跑；导入做冒烟测试时不触发）
// ============================================================
// CLI 主体整体包在 main()：冒烟测试 import 纯函数时不读队列、不 spawn、不退出。
function main(): void {
const queueFile = arg("queue") ?? ".sandcastle/night-queue.json";
const image = arg("image");
if (!image) throw new Error("提供 --image localhost/<repo>:dsh");
const verify = arg("verify");
const maxMinutes = arg("max-minutes") ?? "60";

const queue = JSON.parse(readFileSync(queueFile, "utf8"));
const tickets: (number | { issue: number; verify?: string; branch?: string; model?: string })[] = queue.tickets;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const digestPath = `.sandcastle/digest/night-${stamp}.md`;

const QUOTA = /quota|429|401|403|unauthorized|insufficient|invalid api key/i;
const results: { id: string; status: string; note: string }[] = [];
let stopped = false;

for (const t of tickets) {
  const issue = typeof t === "number" ? t : t.issue;
  const tVerify = (typeof t === "object" && t.verify) || verify;
  const tBranch = typeof t === "object" ? t.branch : undefined;
  const tModel = typeof t === "object" ? t.model : undefined; // #16：显式模型透传
  const stateFile = `.sandcastle/state/${issue}.json`;

  // 幂等：检查点显示已收口 → 跳过（崩溃/中断后重跑即续命）
  if (existsSync(stateFile)) {
    const prev = JSON.parse(readFileSync(stateFile, "utf8"));
    const reason = skipReason(prev.status);
    if (reason) {
      results.push({ id: String(issue), status: prev.status, note: reason });
      continue;
    }
  }

  console.log(`\n======== 票 #${issue} 发射 ========`);
  const args = [
    "tsx",
    ".sandcastle/run-ticket.mts",
    "--issue",
    String(issue),
    "--yolo",
    "--image",
    image,
    "--max-minutes",
    maxMinutes,
  ];
  if (tVerify) args.push("--verify", tVerify);
  if (tBranch) args.push("--branch", tBranch);
  if (tModel) args.push("--model", tModel);
  const child = spawnSync("npx", args, { encoding: "utf8", shell: true });
  const output = (child.stdout || "") + "\n" + (child.stderr || "");

  if (QUOTA.test(output)) {
    results.push({ id: String(issue), status: "quota-stop", note: "配额/认证错误——整批停止，队列保留续跑" });
    stopped = true;
    break;
  }
  const status = statusForExit(child.status ?? 1);
  results.push({ id: String(issue), status, note: output.slice(-300) });
}

// —— 波次合并提示（merged 票 3–5 一波；serial 组来自 audits touch-overlap，软依赖，缺省按默认分组）——
const mergedIds = results.filter((r) => r.status === "merged").map((r) => r.id);
const serialGroups = loadSerialGroups(".sandcastle/audits");
const waves = planWaves(mergedIds, serialGroups);
const waveHints = renderWaveHints(waves);
// retro 素材段与波次提示共用同一份 `waves`/`serialGroups`（不重复计算）——
// 它是**喂料**，收口提醒里的 retro 步骤仍是主会话的动作（容器内不跑 retro，Q73-1）。
const retroMaterial = renderRetroMaterial(results, waves, serialGroups);

// —— 清晨 digest ——
mkdirSync(".sandcastle/digest", { recursive: true });
const count: Record<string, number> = {};
for (const r of results) count[r.status] = (count[r.status] ?? 0) + 1;
const digest = [
  `# 夜间批跑 digest ${new Date().toISOString()}`,
  "",
  `| 票 | 状态 | 说明 |`,
  `| --- | --- | --- |`,
  ...results.map((r) => `| #${r.id} | ${r.status} | ${digestCell(r.note, 120)} |`),
  "",
  `统计：${JSON.stringify(count)}`,
  "",
  waveHints,
  "",
  retroMaterial,
  "",
  "收口提醒：",
  ...renderWrapUpHints(),
].join("\n");
writeFileSync(digestPath, digest, "utf8");
console.log(`\n${digest}\n\ndigest → ${digestPath}`);
process.exit(stopped ? 2 : 0);
}

const isEntryPoint = isMain(import.meta.url);
if (isEntryPoint) main();
