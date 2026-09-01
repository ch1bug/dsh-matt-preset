/**
 * run-ticket.mts — 单票沙箱执行（sandcastle × DSH headless）。
 *
 * 用法：
 *   npx tsx .sandcastle/run-ticket.mts --issue 449 --image localhost/<repo>:dsh
 *   npx tsx .sandcastle/run-ticket.mts "任务文本" --image localhost/<repo>:dsh
 *   npx tsx .sandcastle/run-ticket.mts --issue 449 --yolo --image localhost/<repo>:dsh
 *   npx tsx .sandcastle/run-ticket.mts --issue 449 --yolo --pr --auto-merge ...   # CI 配额宽裕才用
 *
 * 前置：
 *   1. 本目录（.sandcastle/）放 Dockerfile / dsh.ts / run-ticket.mts / audit-ticket.mts
 *   2. npm i -D @ai-hero/sandcastle@0.12.0 tsx   （钉版本，0.x API 周级变动）
 *   3. podman build -f .sandcastle/Dockerfile -t localhost/<repo>:dsh .sandcastle
 *   4. 项目 workflow-gates.yml 的 external: 已含 sandcastle / run-ticket
 *   5. --yolo 前必须先跑 audit-ticket.mts（发射钥匙 = 审计记录 pass + 编排者判词）
 *
 * 宿主要求：Windows 需 podman machine 运行中；~/.dsh 内有凭据与 settings.yaml。
 */
import { run } from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { dshHeadless } from "./dsh.ts";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function sh(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
function runOk(cmd: string[], what: string): string {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${what} 失败: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const issue = arg("issue");
const image = arg("image");
if (!image) throw new Error("提供 --image localhost/<repo>:dsh（先 podman build，见文件头前置步骤 3）");
const strategy = arg("strategy");
const yolo = flag("yolo");
const pr = flag("pr");
const autoMerge = flag("auto-merge");
const base = arg("base");
const branch = arg("branch") ?? (issue ? `sandcastle/ticket-${issue}` : `sandcastle/${Date.now()}`);
// yolo 车道必须走 branch 策略（不本地自动合并；合并门 = 编排者验证 + 波次收口，ADR-0003）
const effectiveStrategy = strategy ?? (yolo ? "branch" : "merge-to-head");

// —— 发射钥匙：yolo 必须持有一份 pass 的审计记录，且编排者判词已写 ——
if (yolo) {
  if (!issue) throw new Error("--yolo 需要 --issue N（审计记录按 issue 归档）");
  const auditPath = arg("audit") ?? `.sandcastle/audits/${issue}.json`;
  let audit: any;
  try {
    audit = JSON.parse(readFileSync(auditPath, "utf8"));
  } catch {
    throw new Error(`--yolo 拒绝发射：审计记录缺失（先跑 audit-ticket.mts --issue ${issue}）`);
  }
  if (audit.verdict !== "launch")
    throw new Error(`--yolo 拒绝发射：审计 verdict=${audit.verdict}（rework/demote 的票不进沙箱）`);
  if (!audit.orchestratorNote)
    throw new Error("--yolo 拒绝发射：审计记录缺编排者判词（orchestratorNote 为空）");
}

// —— 组任务文本：worker 上下文（ponytail 阶梯摘要）→ 票据正文 → 收尾契约 ——
// 项目可放 .sandcastle/worker-context.md 覆盖默认；缺失时用内置阶梯
const DEFAULT_WORKER_CONTEXT = [
  "# Worker Context（沙箱 worker 开工前必读）",
  "",
  "## 代码阶梯（ponytail，逐级停）",
  "1. 这东西需要存在吗？投机需求 = 跳过，一行说明。（YAGNI）",
  "2. 代码库里已有？复用。先找再写。",
  "3. 标准库有？用它。",
  "4. 平台原生能力覆盖？5. 已装依赖能干？6. 能一行？7. 才写最小可用代码。",
  "",
  "## 不可懒清单",
  "- 信任边界校验、防数据丢失的错误处理、安全措施——永不简化。",
  "- 验证永不最小化：任务点名的测试/lint 全量执行；非平凡逻辑至少留一个可运行检查。",
  "- 先完整读懂，再懒。刻意简化加 `ponytail:` 注释标明天花板。",
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

const result = await run({
  name: branch,
  agent: dshHeadless(),
  sandbox: podman({
    imageName: image,
    containerUid: 1000,
    containerGid: 1000,
    mounts: [{ hostPath: "~/.dsh", sandboxPath: "/host-dsh", readonly: true }],
  }),
  prompt: `${principles}\n\n---\n\n${task}\n${closer}`,
  maxIterations: 1,
  idleTimeoutSeconds: 1800,
  branchStrategy:
    effectiveStrategy === "branch"
      ? { type: "branch", branch }
      : { type: "merge-to-head" },
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
  logging: { type: "stdout" },
});

// —— yolo 收尾：push + PR（CI 配额宽裕的仓库才用；默认就地收口，ADR-0002 分钟经济）——
let prUrl: string | undefined;
if (yolo && result.commits.length > 0) {
  runOk(["git", "push", "-u", "origin", result.branch], "push");
  const title = issue ? `fix(#${issue}): sandbox worker` : `sandbox: ${branch}`;
  const body = [
    issue ? `Closes #${issue}` : "sandbox worker run",
    "",
    "```",
    result.stdout.slice(-1500),
    "```",
  ].join("\n");
  // spawn 数组直传（不经 shell），标题/正文无需转义
  const created = spawnSync("gh", ["pr", "create", "--head", result.branch, "--title", title, "--body", body, ...(base ? ["--base", base] : [])], { encoding: "utf8" });
  if (created.status !== 0) throw new Error(`gh pr create 失败: ${created.stderr || created.stdout}`);
  prUrl = created.stdout.trim().split("\n").findLast(l => l.startsWith("http"));
  if (autoMerge) runOk(["gh", "pr", "merge", "--squash", "--auto", result.branch], "auto-merge");
}

console.log(
  "\n=== RunResult ===\n" +
    JSON.stringify(
      {
        branch: result.branch,
        commits: result.commits,
        completionSignal: result.completionSignal,
        prUrl,
        stdoutTail: result.stdout.slice(-800),
        logFilePath: result.logFilePath,
      },
      null,
      2,
    ),
);
