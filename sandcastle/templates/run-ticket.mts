/**
 * run-ticket.mts — 单票沙箱执行（sandcastle × DSH headless），完整生命周期：
 *
 *   审计钥匙校验 → createSandbox(branch) → worker 运行 → 验证门（编排者亲自 exec）
 *   → 本地合并（绿）/ park（红）→ 检查点落盘（.sandcastle/state/）→ 可选 PR
 *
 * 用法：
 *   npx tsx .sandcastle/run-ticket.mts --issue 449 --image localhost/<repo>:dsh \
 *     --verify "cargo test -p iris-api --lib" --max-minutes 60 [--yolo] [--pr]
 *
 * 退出码：0=merged/pr  3=验证未过(parked)  4=合并冲突(parked)  5=超时(parked)
 *         6=worker 无产出(parked)  7=大 diff 待简化(needs-simplify)  1=其他失败
 * 检查点：.sandcastle/state/<id>.json —— night-run 据此幂等续跑，崩溃不丢进度。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
// 沙箱依赖（@ai-hero/sandcastle、./dsh.ts）在 main() 内动态导入：
// 本模块的纯函数（judgeSimplify）可在未安装 sandcastle 依赖的环境里被冒烟测试导入。

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

/** 统计票分支相对当前 HEAD 的 diff 总行数（merge-base…branch）。 */
function countDiffLines(branch: string): number {
  const r = spawnSync("git", ["diff", `HEAD...${branch}`], { encoding: "utf8" });
  if (r.status !== 0) return 0; // 统计失败不阻断主流程（缺 merge-base 等场景）
  return r.stdout.split("\n").length;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

// —— 发射钥匙：yolo 必须持有 pass 审计记录 + 编排者判词 ——
if (yolo) {
  if (!issue) throw new Error("--yolo 需要 --issue N");
  const auditPath = arg("audit") ?? `.sandcastle/audits/${issue}.json`;
  let audit: any;
  try {
    audit = JSON.parse(readFileSync(auditPath, "utf8"));
  } catch {
    throw new Error(`--yolo 拒绝发射：审计记录缺失（先跑 audit-ticket.mts --issue ${issue}）`);
  }
  if (audit.verdict !== "launch")
    throw new Error(`--yolo 拒绝发射：审计 verdict=${audit.verdict}`);
  if (!audit.orchestratorNote)
    throw new Error("--yolo 拒绝发射：审计记录缺编排者判词（orchestratorNote 为空）");
}

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
          command:
            "mkdir -p ~/.dsh && cp /host-dsh/.credentials.yaml /host-dsh/settings.yaml ~/.dsh/ && chmod 600 ~/.dsh/.credentials.yaml && echo dsh-home-ready",
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
  process.exit(timedOut ? 5 : 1);
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
  process.exit(6);
}
if (verify && verify.exitCode !== 0) {
  checkpoint("parked-verify");
  console.error(`\nPARKED-VERIFY: 验证门未过。分支 ${branch} 已保留，返工或人工处理。`);
  process.exit(3);
}

// —— 大 diff simplify 门（合并门前）：超阈值 → 提醒 + needs-simplify 检查点 ——
const simplifyDecision = judgeSimplify(countDiffLines(branch), {
  threshold: Number(arg("simplify-threshold") ?? 800),
  noSimplify: flag("no-simplify"),
});
console.log(`\n${simplifyDecision.message}`);
if (simplifyDecision.needsSimplify) {
  checkpoint("needs-simplify", { simplify: simplifyDecision });
  console.error(`\nNEEDS-SIMPLIFY: 分支 ${branch} 已保留，先做 simplify pass 再重跑（或 --no-simplify 豁免）。`);
  process.exit(7);
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
    process.exit(4);
  }
}

const rec = checkpoint(pr ? "pr" : "merged", { prUrl });
console.log(
  "\n=== RunResult ===\n" +
    JSON.stringify({ status: rec.status, branch, commits: rec.commits, prUrl, logFilePath: rec.logFilePath }, null, 2),
);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
