/**
 * run-ticket.mts — 单票沙箱执行（sandcastle × DSH headless）。
 *
 * 用法：
 *   npx tsx .sandcastle/run-ticket.mts --issue 449                 # 从 gh 拉票据正文当任务
 *   npx tsx .sandcastle/run-ticket.mts "把 README 标题改成 X"      # 直接给任务
 *   npx tsx .sandcastle/run-ticket.mts --issue 449 --branch ticket/449 --strategy branch
 *
 * 前置：
 *   1. 本目录（.sandcastle/）放入本模板三件套（Dockerfile / dsh.ts / run-ticket.mts）
 *   2. npm i -D @ai-hero/sandcastle@0.12.0 tsx   （钉版本，0.x API 周级变动）
 *   3. podman build -f .sandcastle/Dockerfile -t localhost/<repo>:dsh .sandcastle
 *   4. 项目 workflow-gates.yml 的 external: 已含 sandcastle / run-ticket
 *
 * 宿主要求：Windows 需 podman machine 运行中；~/.dsh 内有凭据与 settings.yaml。
 */
import { run } from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { dshHeadless } from "./dsh.ts";
import { spawnSync } from "node:child_process";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const issue = arg("issue");
const image = arg("image");
if (!image) throw new Error("提供 --image localhost/<repo>:dsh（先 podman build，见文件头前置步骤 3）");
const strategy = arg("strategy") ?? "merge-to-head"; // merge-to-head | branch（并行批跑用 branch + 批末串行合并）
const branch = arg("branch");

let task: string;
if (issue) {
  const gh = spawnSync("gh", ["issue", "view", issue, "--json", "title,body"], {
    encoding: "utf8",
  });
  if (gh.status !== 0) throw new Error(gh.stderr || "gh issue view 失败");
  const { title, body } = JSON.parse(gh.stdout);
  task = [
    `完成 issue #${issue}：${title}`,
    "",
    String(body ?? "").slice(0, 60_000), // 防超长；更大的票据改成先 commit 票据文件再引用路径
    "",
    "完成标准：实现 + 本地验证（测试/lint）+ git commit。最终回复包含 <promise>COMPLETE</promise>。",
  ].join("\n");
} else {
  task =
    process.argv[2] && !process.argv[2].startsWith("--")
      ? process.argv[2]
      : (() => {
          throw new Error("提供 --issue N 或直接给任务文本");
        })();
}

const result = await run({
  name: branch ?? (issue ? `ticket-${issue}` : "dsh-ticket"),
  agent: dshHeadless(),
  sandbox: podman({
    imageName: image,
    containerUid: 1000,
    containerGid: 1000,
    mounts: [
      // 只读借用宿主 ~/.dsh：钩子把凭据与 settings 拷进容器自己的 DSH_HOME
      { hostPath: "~/.dsh", sandboxPath: "/host-dsh", readonly: true },
    ],
  }),
  prompt: task,
  maxIterations: 1,
  idleTimeoutSeconds: 1800, // 票据级任务给足空闲预算（容器首启 + 模型调用）
  branchStrategy:
    strategy === "branch"
      ? { type: "branch", branch: branch ?? `sandcastle/ticket-${issue ?? Date.now()}` }
      : { type: "merge-to-head" },
  hooks: {
    sandbox: {
      onSandboxReady: [
        {
          // chmod 600：DSH 凭据安全不变量（Windows 挂载拷出即 755 会被拒载）
          command:
            "mkdir -p ~/.dsh && cp /host-dsh/.credentials.yaml /host-dsh/settings.yaml ~/.dsh/ && chmod 600 ~/.dsh/.credentials.yaml && echo dsh-home-ready",
          timeoutMs: 15_000,
        },
      ],
    },
  },
  logging: { type: "stdout" },
});

console.log(
  "\n=== RunResult ===\n" +
    JSON.stringify(
      {
        branch: result.branch,
        commits: result.commits,
        completionSignal: result.completionSignal,
        stdoutTail: result.stdout.slice(-800),
        logFilePath: result.logFilePath,
      },
      null,
      2,
    ),
);
