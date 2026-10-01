/**
 * night-run.mts — 夜间队列编排器（检查点续跑 + 配额熔断 + 清晨 digest）。
 *
 * 用法：
 *   npx tsx .sandcastle/night-run.mts --image localhost/<repo>:dsh \
 *     --verify "cargo test -p iris-api --lib" --max-minutes 60 \
 *     --queue .sandcastle/night-queue.json
 *
 * 队列格式（.sandcastle/night-queue.json，由编排会话或人工维护）：
 *   { "tickets": [449, 452, { "issue": 455, "verify": "cargo test -p iris-agent --lib" }] }
 *
 * 行为：
 *   - 逐票 spawn run-ticket.mts（进程级崩溃隔离，单票崩不伤队列）
 *   - 幂等续跑：检查点已 merged/pr 的票自动跳过——崩溃/中断后重跑同一命令即从断点继续
 *   - 配额熔断：provider 配额/认证错误是【停止信号】不是重试信号——持久化进度并退出
 *   - 结束写 digest（.sandcastle/digest/<stamp>.md）：逐票状态 + 收口提醒
 *     （ticket-audit 抽查 + 批末 push 走 summary gate）
 *   - digest 附波次合并提示：merged 票按 3–5 票一波分组，波内 rebase onto master
 *     串行（本模板只给分组与提示文本；真执行归编排会话）
 *
 * 退出码：0=全部处理完  2=配额熔断提前停止（队列可重跑续命）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ============================================================
// 波次合并提示（纯函数，供冒烟测试直接导入）
// ============================================================

/** 一波的形状：票号列表 + 落在本波内的 serial 组（写域重叠，须串行）。 */
export interface Wave {
  wave: number;
  tickets: string[];
  serialGroups: string[][];
}

/**
 * 消费 T1 audit-ticket.mts --touch-overlap 写出的 .sandcastle/audits/*.json，
 * 提取 `serial: true` 分组（写域重叠 → 必须串行或合并）。
 * 目录缺失 / 无 serial 标记 / 单文件解析失败 → 宽容跳过，返回已收集的组。
 */
export function loadSerialGroups(auditsDir: string): string[][] {
  if (!existsSync(auditsDir)) return [];
  const groups: string[][] = [];
  for (const f of readdirSync(auditsDir)) {
    if (!f.endsWith(".json")) continue;
    let obj: any;
    try {
      obj = JSON.parse(readFileSync(`${auditsDir}/${f}`, "utf8"));
    } catch {
      continue; // 单个坏文件不拖垮整轮
    }
    // 形态一：单票审计带 serial 标记，group/tickets 列出同组成员
    if (obj?.serial === true) {
      const members = (Array.isArray(obj.group) ? obj.group : Array.isArray(obj.tickets) ? obj.tickets : [obj.issue])
        .filter((m: unknown) => m !== undefined && m !== null).map(String);
      if (members.length > 1) groups.push(members);
    }
    // 形态二：一份扫描报告含 groups 数组
    if (Array.isArray(obj?.groups)) {
      for (const g of obj.groups) {
        if (g?.serial === true && Array.isArray(g.tickets) && g.tickets.length > 1) {
          groups.push(g.tickets.map(String));
        }
      }
    }
  }
  return groups;
}

/**
 * merged 票按 3–5 票一波贪心分组；serial 组成员强制拉进同一波
 * （波内 rebase onto master 本就串行，重叠票靠同波内顺序解决；组大小可溢出 5）。
 */
export function planWaves(merged: string[], serialGroups: string[][]): Wave[] {
  const inMerged = new Set(merged);
  // issue → 所属 serial 组（取第一个命中的组即可：重叠即同波，组间不重复分配）
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
// CLI 主体（被直接执行时才跑；导入做冒烟测试时不触发）
// ============================================================
// CLI 主体整体包在 main()：冒烟测试 import 纯函数时不读队列、不 spawn、不退出。
function main(): void {
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const queueFile = arg("queue") ?? ".sandcastle/night-queue.json";
const image = arg("image");
if (!image) throw new Error("提供 --image localhost/<repo>:dsh");
const verify = arg("verify");
const maxMinutes = arg("max-minutes") ?? "60";

const queue = JSON.parse(readFileSync(queueFile, "utf8"));
const tickets: (number | { issue: number; verify?: string; branch?: string })[] = queue.tickets;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const digestPath = `.sandcastle/digest/night-${stamp}.md`;

const QUOTA = /quota|429|401|403|unauthorized|insufficient|invalid api key/i;
const results: { id: string; status: string; note: string }[] = [];
let stopped = false;

for (const t of tickets) {
  const issue = typeof t === "number" ? t : t.issue;
  const tVerify = (typeof t === "object" && t.verify) || verify;
  const tBranch = typeof t === "object" ? t.branch : undefined;
  const stateFile = `.sandcastle/state/${issue}.json`;

  // 幂等：检查点显示已收口 → 跳过（崩溃/中断后重跑即续命）
  if (existsSync(stateFile)) {
    const prev = JSON.parse(readFileSync(stateFile, "utf8"));
    if (prev.status === "merged" || prev.status === "pr") {
      results.push({ id: String(issue), status: prev.status, note: "checkpoint 已收口，跳过" });
      continue;
    }
    if (prev.status === "parked-verify" || prev.status === "parked-conflict") {
      results.push({ id: String(issue), status: prev.status, note: "上次已 park（未返工），跳过" });
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
  const child = spawnSync("npx", args, { encoding: "utf8", shell: true });
  const output = (child.stdout || "") + "\n" + (child.stderr || "");

  if (QUOTA.test(output)) {
    results.push({ id: String(issue), status: "quota-stop", note: "配额/认证错误——整批停止，队列保留续跑" });
    stopped = true;
    break;
  }
  const map: Record<number, string> = { 0: "merged", 3: "parked-verify", 4: "parked-conflict", 5: "parked-timeout", 6: "parked-empty" };
  const status = map[child.status ?? 1] ?? `failed(${child.status})`;
  results.push({ id: String(issue), status, note: output.slice(-300) });
}

// —— 波次合并提示（merged 票 3–5 一波；serial 组来自 audits touch-overlap，软依赖，缺省按默认分组）——
const mergedIds = results.filter((r) => r.status === "merged").map((r) => r.id);
const waveHints = renderWaveHints(planWaves(mergedIds, loadSerialGroups(".sandcastle/audits")));

// —— 清晨 digest ——
mkdirSync(".sandcastle/digest", { recursive: true });
const count: Record<string, number> = {};
for (const r of results) count[r.status] = (count[r.status] ?? 0) + 1;
const digest = [
  `# 夜间批跑 digest ${new Date().toISOString()}`,
  "",
  `| 票 | 状态 | 说明 |`,
  `| --- | --- | --- |`,
  ...results.map((r) => `| #${r.id} | ${r.status} | ${r.note.replace(/\|/g, "/").slice(0, 120)} |`),
  "",
  `统计：${JSON.stringify(count)}`,
  "",
  waveHints,
  "",
  "收口提醒：",
  "1. 对 merged 票按比例跑 `ticket-audit` 抽查（AC 覆盖/测试真实性/验证重放）",
  "2. 抽查通过 → 批末 push 走 summary gate（一次 push，远程 CI 全绿为完成）",
  "3. parked 票：verify/conflict → 同沙箱返工一次或降级白天 batch",
].join("\n");
writeFileSync(digestPath, digest, "utf8");
console.log(`\n${digest}\n\ndigest → ${digestPath}`);
process.exit(stopped ? 2 : 0);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
