import type { AgentProvider } from "@ai-hero/sandcastle";
import type { PodmanOptions } from "@ai-hero/sandcastle/sandboxes/podman";
import { patchAgentDefaultModelCmd } from "./dsh-config.ts";

export { patchAgentDefaultModelCmd } from "./dsh-config.ts";

/** POSIX 单引号转义（PrintCommand.command 是完整 shell 命令串，在容器内执行） */
export function sh(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * DSH headless adapter：把容器内的 `dsh --profile headless "<task>"`
 * 包装成 sandcastle 的 AgentProvider。
 *
 * - DSH headless：单任务进出（任务=argv 位置参数，不读 stdin），最终回复
 *   打 stdout，exit 0（turn/end）/ 1（error）。
 * - 超大任务不要内联 prompt（Linux 128KB argv 上限）：编排者先把票据文件
 *   commit 进分支，task 只写"执行 .sandcastle/tickets/<N>.md"。
 * - 凭据不在 provider env 注入：沙箱钩子把宿主 ~/.dsh 的凭据与 settings
 *   拷入容器 DSH_HOME（见 run-ticket.mts 的 onSandboxReady）。
 * - parseStreamLine 返回 []：headless 不产生 JSON 行流，走 stdout 兜底。
 */
export function dshHeadless(): AgentProvider {
  return {
    name: "dsh-headless",
    env: {},
    captureSessions: false,
    buildPrintCommand({ prompt }) {
      return { command: `dsh --profile headless ${sh(prompt)}` };
    },
    parseStreamLine() {
      return [];
    },
  };
}

/** run-ticket 的现有 podman 选项；宿主 DSH home 始终只读挂载。 */
export function dshSandboxOptions(imageName: string): PodmanOptions {
  return {
    imageName,
    containerUid: 1000,
    containerGid: 1000,
    mounts: [{ hostPath: "~/.dsh", sandboxPath: "/host-dsh", readonly: true }],
  };
}

/** 与原 onSandboxReady 内联命令逐字节等价；只在容器内执行。 */
export function dshHomeReadyCommand(model?: string): string {
  return "mkdir -p ~/.dsh && cp /host-dsh/.credentials.yaml /host-dsh/settings.yaml ~/.dsh/ && chmod 600 ~/.dsh/.credentials.yaml"
    + (model ? ` && ${patchAgentDefaultModelCmd(model)}` : "")
    + " && echo dsh-home-ready";
}
