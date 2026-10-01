/**
 * run-ticket.mts — 单票沙箱执行（sandcastle × DSH headless），完整生命周期：
 *
 *   审计钥匙校验 → createSandbox(branch) → worker 运行 → 验证门（编排者亲自 exec）
 *   → 本地合并（绿）/ park（红）→ 检查点落盘（.sandcastle/state/）→ 可选 PR
 *
 * 用法：
 *   npx tsx .sandcastle/run-ticket.mts --issue 449 --image localhost/<repo>:dsh \
 *     --verify "cargo test -p iris-api --lib" --max-minutes 60 [--yolo] [--pr] \
 *     [--model provider/model]   # #16 显式路由；缺省按审计 modelLane ×
 *     .sandcastle/model-lanes.json（{"A":"p/top","B":"p/mid","C":"p/mini"}）路由
 *
 * 退出码（EXIT_STATUS 单一事实源——night-run statusForExit 消费本导出，勿另立映射）：
 *   0=merged/pr  3=验证未过(parked)  4=合并冲突(parked)  5=超时(parked)
 *   6=worker 无产出(parked)  7=大 diff 待简化(needs-simplify)  1=其他失败
 * 检查点：.sandcastle/state/<id>.json —— night-run 据此幂等续跑，崩溃不丢进度。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { arg, flag, isMain } from "./lib.ts";
// 沙箱依赖（@ai-hero/sandcastle、./dsh.ts）在 main() 内动态导入：
// 本模块的纯函数（judgeSimplify）可在未安装 sandcastle 依赖的环境里被冒烟测试导入。

// ============================================================
// 退出码语义（单一事实源，night-run.mts statusForExit 消费）
// ============================================================

/** run-ticket.mts 退出码。新增/改码只动这里 + 头注释，night-run 自动跟随。 */
export const EXIT_STATUS = {
  MERGED: 0,
  OTHER: 1,
  VERIFY_FAILED: 3,
  CONFLICT: 4,
  TIMEOUT: 5,
  EMPTY: 6,
  NEEDS_SIMPLIFY: 7,
} as const;

// ============================================================
// 大 diff simplify 门（纯函数，供冒烟测试直接导入）
// ============================================================

/** simplify 门判定结果。 */
export interface SimplifyDecision {
  needsSimplify: boolean;
  skipped: boolean;
  threshold: number;
  diffLines: number;
  message: string;
}

/**
 * 合并门前判定：diff 行数【严格大于】阈值 → 输出 simplify 提醒并把该票
 * checkpoint 为 needs-simplify；`--no-simplify` 显式跳过（记录 skipped）。
 */
export function judgeSimplify(
  diffLines: number,
  opts: { threshold?: number; noSimplify?: boolean } = {},
): SimplifyDecision {
  const threshold = opts.threshold ?? 800;
  const base = { threshold, diffLines, skipped: false };
  if (opts.noSimplify) {
    return {
      ...base,
      skipped: true,
      needsSimplify: false,
      message: `simplify 门跳过（--no-simplify）：diff ${diffLines} 行 / 阈值 ${threshold}，显式豁免。`,
    };
  }
  if (diffLines > threshold) {
    return {
      ...base,
      needsSimplify: true,
      message:
        `NEEDS-SIMPLIFY: diff ${diffLines} 行超过阈值 ${threshold}。` +
        `大 diff 先过一遍 simplify pass（去重复/收敛样板/拆死代码）再进入合并门；` +
        `本票已 checkpoint 为 needs-simplify，分支保留。确信无需简化可用 --no-simplify 重跑。`,
    };
  }
  return { ...base, needsSimplify: false, message: `simplify 门通过：diff ${diffLines} 行 ≤ 阈值 ${threshold}。` };
}

/** diff 统计结果：statFailed=true 表示 git diff 统计失败（#12：告警+记录，不阻断）。 */
export interface DiffStat {
  diffLines: number;
  statFailed: boolean;
}

// ============================================================
// 模型路由（#16 model-lane）：CLI --model > 审计 lane 映射 > 宿主默认
// ============================================================

/** 模型路由决策结果（checkpoint 记录 + 启动日志）。 */
export interface ModelRouteDecision {
  route: "cli" | "lane" | "default";
  model?: string;
  lane?: string;
  note: string;
}

/**
 * 决策顺序：`--model provider/model` 显式指定优先；否则审计记录的
 * `modelLane.lane` 查 `.sandcastle/model-lanes.json` 映射（如
 * `{"A":"x/max","B":"x/pro","C":"x/mini"}`）；都缺 → default（worker
 * 继承宿主 settings.yaml 的 agent-default-model，即拷入容器的默认）。
 */
export function modelRouteDecision(
  audit: { modelLane?: { lane?: string } } | undefined,
  cliModel: string | undefined,
  laneConfig: Record<string, string> | undefined,
): ModelRouteDecision {
  if (cliModel) return { route: "cli", model: cliModel, note: `--model 显式指定：${cliModel}` };
  const lane = audit?.modelLane?.lane;
  if (lane) {
    const model = laneConfig?.[lane];
    if (model) return { route: "lane", model, lane, note: `审计 lane ${lane} → ${model}（.sandcastle/model-lanes.json）` };
    return { route: "default", lane, note: `审计 lane ${lane} 未在 .sandcastle/model-lanes.json 映射 → worker 继承宿主默认` };
  }
  return { route: "default", note: "无 lane 信息（无审计记录或旧版记录）→ worker 继承宿主默认" };
}

/**
 * 生成把容器内 ~/.dsh/settings.yaml 的 `agent-default-model:` 块（键 + 两行
 * provider/model）替换为指定模型的 sed 命令（GNU sed `addr,+2c`，容器内
 * Linux 可用；宿主 msys 无 GNU sed——该命令只在 onSandboxReady 里跑）。
 */
export function patchAgentDefaultModelCmd(model: string): string {
  // 守卫：provider/model 各限 [A-Za-z0-9._-]——sed 串拼接不接受引号/换行/空白
  const MODEL_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
  if (!MODEL_RE.test(model))
    throw new Error(`model 需为 provider/model 形式（各段字符集 [A-Za-z0-9._-]）：${model}`);
  const slash = model.indexOf("/");
  const provider = model.slice(0, slash);
  const modelName = model.slice(slash + 1);
  // sed 替换 + grep 回执：settings 无该块或形状漂移 → 钩子非 0 退出（响亮失败，
  // 不让 checkpoint 的 route:"lane" 记录夸大实际发生的事）
  return (
    `sed -i '/^agent-default-model:/,+2c\\agent-default-model:\\n` +
    `  provider: ${provider}\\n  model: ${modelName}' ~/.dsh/settings.yaml ` +
    `&& grep -qx '  model: ${modelName}' ~/.dsh/settings.yaml`
  );
}

/**
 * 统计票分支相对当前 HEAD 的 diff 总行数（merge-base…branch）。
 * 统计失败（非 0 退出，如缺 merge-base）→ statFailed=true + diffLines=0：
 * 调用方负责 console.error 告警并在 checkpoint 记 simplifyStatFailed，不阻断合并门。
 * `git` 参数可注入 mock 命令（冒烟测试用失败的 node 自身模拟）。
 */
export function countDiffLines(branch: string, git: string = "git"): DiffStat {
  const r = spawnSync(git, ["diff", `HEAD...${branch}`], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return { diffLines: 0, statFailed: true };
  return { diffLines: r.stdout.split("\n").length, statFailed: false };
}

function runOk(cmd: string[], what: string, cwd?: string): string {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd });
  if (r.status !== 0) throw new Error(`${what} 失败: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  return r.stdout.trim();
}

// CLI 主体整体包在 main()：冒烟测试 import 纯函数时不读参数、不建沙箱。
async function main(): Promise<void> {
const issue = arg("issue");
const image = arg("image");
if (!image) throw new Error("提供 --image localhost/<repo>:dsh（先 podman build）");
const yolo = flag("yolo");
const pr = flag("pr");
const autoMerge = flag("auto-merge");
const base = arg("base");
const branch = arg("branch") ?? (issue ? `sandcastle/ticket-${issue}` : `sandcastle/${Date.now()}`);
const verifyCmd = arg("verify"); // 客观合并门：审计点名的验证命令，编排者亲自执行
const maxMinutes = Number(arg("max-minutes") ?? 60);
const id = issue ?? branch.replace(/\W+/g, "-");

// —— 审计记录（单次读取共用：yolo 发射钥匙 + 模型路由都吃它）——
let auditRec: { verdict?: string; orchestratorNote?: string; modelLane?: { lane?: string } } | undefined;
if (issue) {
  try {
    auditRec = JSON.parse(readFileSync(arg("audit") ?? `.sandcastle/audits/${issue}.json`, "utf8"));
  } catch {
    auditRec = undefined;
  }
}

// —— 发射钥匙：yolo 必须持有 pass 审计记录 + 编排者判词 ——
if (yolo) {
  if (!issue) throw new Error("--yolo 需要 --issue N");
  if (auditRec === undefined)
    throw new Error(`--yolo 拒绝发射：审计记录缺失（先跑 audit-ticket.mts --issue ${issue}）`);
  if (auditRec.verdict !== "launch")
    throw new Error(`--yolo 拒绝发射：审计 verdict=${auditRec.verdict}`);
  if (!auditRec.orchestratorNote)
    throw new Error("--yolo 拒绝发射：审计记录缺编排者判词（orchestratorNote 为空）");
}

// —— 模型路由（#16）：--model > 审计 modelLane × model-lanes.json > 宿主默认 ——
const cliModel = arg("model"); // provider/model，如 zai-coding-cn/glm-5.3-flash
let laneConfig: Record<string, string> | undefined;
try {
  laneConfig = JSON.parse(readFileSync(".sandcastle/model-lanes.json", "utf8"));
} catch {
  laneConfig = undefined;
}
const modelRoute = modelRouteDecision(auditRec, cliModel, laneConfig);
console.log(`model-route: ${modelRoute.route} — ${modelRoute.note}`);

// —— 组任务：worker 上下文（ponytail 阶梯）→ 票据正文 → 收尾契约 ——
const DEFAULT_WORKER_CONTEXT = [
  "# Worker Context（沙箱 worker 开工前必读）",
  "## 代码阶梯（ponytail，逐级停）",
  "1. 需要存在吗？投机需求=跳过，一行说明。 2. 库里已有？复用。 3. 标准库？ 4. 平台原生？",
  "5. 已装依赖？ 6. 能一行？ 7. 才写最小可用代码。爬梯前先读懂问题。",
  "## 不可懒清单",
  "- 信任边界校验、防数据丢失错误处理、安全措施永不简化。",
  "- 验证永不最小化：任务点名的测试/lint 全量执行；非平凡逻辑至少留一个可运行检查。",
  "- 刻意简化加 `ponytail:` 注释标明天花板。先完整读懂，再懒。",
].join("\n");
const principles = (() => {
  try {
    return readFileSync(".sandcastle/worker-context.md", "utf8").trim();
  } catch {
    return DEFAULT_WORKER_CONTEXT;
  }
})();
let task: string;
if (issue) {
  const gh = spawnSync("gh", ["issue", "view", issue, "--json", "title,body"], { encoding: "utf8" });
  if (gh.status !== 0) throw new Error(gh.stderr || "gh issue view 失败");
  const { title, body } = JSON.parse(gh.stdout);
  task = [`完成 issue #${issue}：${title}`, "", String(body ?? "").slice(0, 60_000)].join("\n");
} else {
  task =
    process.argv[2] && !process.argv[2].startsWith("--")
      ? process.argv[2]
      : (() => {
          throw new Error("提供 --issue N 或直接给任务文本");
        })();
}
const closer = [
  "",
  "完成标准：实现 + 本地验证（测试/lint）+ git commit。大 diff 先做一遍简化再进入最终验证。",
  "最终回复包含 <promise>COMPLETE</promise>。",
].join("\n");

const { createSandbox } = await import("@ai-hero/sandcastle");
const { podman } = await import("@ai-hero/sandcastle/sandboxes/podman");
const { dshHeadless } = await import("./dsh.ts");
const sandbox = await createSandbox({
  branch,
  sandbox: podman({
    imageName: image,
    containerUid: 1000,
    containerGid: 1000,
    mounts: [{ hostPath: "~/.dsh", sandboxPath: "/host-dsh", readonly: true }],
  }),
  hooks: {
    sandbox: {
      onSandboxReady: [
        {
          // 基础：宿主凭据/settings 拷入容器 DSH_HOME；lane 路由命中时追加
          // sed 替换 agent-default-model 块（worker 的 agentDefaultModel 即改）
          command:
            "mkdir -p ~/.dsh && cp /host-dsh/.credentials.yaml /host-dsh/settings.yaml ~/.dsh/ && chmod 600 ~/.dsh/.credentials.yaml"
            + (modelRoute.model ? ` && ${patchAgentDefaultModelCmd(modelRoute.model)}` : "")
            + " && echo dsh-home-ready",
          timeoutMs: 15_000,
        },
      ],
    },
  },
});

// 看门狗：墙钟上限（超时 = parked-timeout，夜间不烧整晚）
const signal = AbortSignal.timeout(maxMinutes * 60_000);
let worker;
try {
  worker = await sandbox.run({
    agent: dshHeadless(),
    prompt: `${principles}\n\n---\n\n${task}\n${closer}`,
    maxIterations: 1,
    idleTimeoutSeconds: 900,
    logging: { type: "stdout" },
    signal,
  });
} catch (e: any) {
  const timedOut = /timeout|abort/i.test(String(e?.message ?? e));
  console.error(timedOut ? `PARKED-TIMEOUT (${maxMinutes}min)` : String(e));
  process.exit(timedOut ? EXIT_STATUS.TIMEOUT : EXIT_STATUS.OTHER);
}

// —— 验证门：编排者亲自在同一个沙箱里 exec 审计点名的命令（不信 worker 自述）——
let verify: { cmd: string; exitCode: number | null } | null = null;
if (verifyCmd) {
  const v = await sandbox.exec(verifyCmd);
  verify = { cmd: verifyCmd, exitCode: v.exitCode };
  console.log(`\n验证门 exit=${v.exitCode}: ${verifyCmd}`);
}

const closeRes = await sandbox.close();
const dirty = Boolean(closeRes.preservedWorktreePath);

function checkpoint(status: string, extra: Record<string, unknown> = {}) {
  mkdirSync(".sandcastle/state", { recursive: true });
  const rec = {
    id,
    issue: issue ? Number(issue) : undefined,
    branch,
    status,
    verify,
    modelRoute, // #16：本票 worker 实际走的模型路由决策（cli/lane/default）
    dirty,
    commits: worker.commits,
    completionSignal: worker.completionSignal,
    logFilePath: worker.logFilePath,
    stdoutTail: worker.stdout.slice(-600),
    finishedAt: new Date().toISOString(),
    ...extra,
  };
  writeFileSync(`.sandcastle/state/${id}.json`, JSON.stringify(rec, null, 2), "utf8");
  return rec;
}

if (worker.commits.length === 0) {
  checkpoint("parked-empty");
  console.error(`\nPARKED-EMPTY: worker 无 commit（dirty=${dirty}）。worktree: ${closeRes.preservedWorktreePath ?? "已清理"}`);
  process.exit(EXIT_STATUS.EMPTY);
}
if (verify && verify.exitCode !== 0) {
  checkpoint("parked-verify");
  console.error(`\nPARKED-VERIFY: 验证门未过。分支 ${branch} 已保留，返工或人工处理。`);
  process.exit(EXIT_STATUS.VERIFY_FAILED);
}

// —— 大 diff simplify 门（合并门前）：超阈值 → 提醒 + needs-simplify 检查点 ——
// 统计失败（#12 拍板选 a）：显式告警 + checkpoint 记 simplifyStatFailed:true，放行不阻断。
const diffStat = countDiffLines(branch);
const simplifyDecision = judgeSimplify(diffStat.diffLines, {
  threshold: Number(arg("simplify-threshold") ?? 800),
  noSimplify: flag("no-simplify"),
});
if (diffStat.statFailed) {
  console.error(
    `\nWARNING: countDiffLines 统计失败（git diff HEAD...${branch} 非 0）。` +
      `simplify 门放行，本票将记录 simplifyStatFailed:true（见 checkpoint），人工可复核。`,
  );
}
console.log(`\n${simplifyDecision.message}`);
if (simplifyDecision.needsSimplify) {
  checkpoint("needs-simplify", { simplify: simplifyDecision });
  console.error(`\nNEEDS-SIMPLIFY: 分支 ${branch} 已保留，先做 simplify pass 再重跑（或 --no-simplify 豁免）。`);
  process.exit(EXIT_STATUS.NEEDS_SIMPLIFY);
}

// —— 收口：PR-per-unit（CI 配额宽裕）或本地合并（默认，ADR-0002 分钟经济）——
let prUrl: string | undefined;
if (pr) {
  const title = issue ? `fix(#${issue}): sandbox worker` : `sandbox: ${branch}`;
  const body = [issue ? `Closes #${issue}` : "sandbox worker run", "", "```", worker.stdout.slice(-1500), "```"].join("\n");
  const created = spawnSync(
    "gh",
    ["pr", "create", "--head", branch, "--title", title, "--body", body, ...(base ? ["--base", base] : [])],
    { encoding: "utf8" },
  );
  if (created.status !== 0) throw new Error(`gh pr create 失败: ${created.stderr || created.stdout}`);
  prUrl = created.stdout.trim().split("\n").findLast((l) => l.startsWith("http"));
  if (autoMerge) runOk(["gh", "pr", "merge", "--squash", "--auto", branch], "auto-merge");
} else {
  const m = spawnSync("git", ["merge", "--no-ff", branch], { encoding: "utf8" });
  if (m.status !== 0) {
    spawnSync("git", ["merge", "--abort"]);
    checkpoint("parked-conflict");
    console.error(`\nPARKED-CONFLICT: 合并冲突，分支 ${branch} 已保留。返工或手工合并。`);
    process.exit(EXIT_STATUS.CONFLICT);
  }
}

const rec = checkpoint(pr ? "pr" : "merged", { prUrl, ...(diffStat.statFailed ? { simplifyStatFailed: true } : {}) });
console.log(
  "\n=== RunResult ===\n" +
    JSON.stringify({ status: rec.status, branch, commits: rec.commits, prUrl, logFilePath: rec.logFilePath }, null, 2),
);
}

const isEntryPoint = isMain(import.meta.url);
if (isEntryPoint) await main();
