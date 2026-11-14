import type { AgentProvider } from "@ai-hero/sandcastle";
import type { PodmanOptions } from "@ai-hero/sandcastle/sandboxes/podman";
import { patchAgentDefaultModelCmd } from "./dsh-config.ts";

export { patchAgentDefaultModelCmd } from "./dsh-config.ts";

/** POSIX 单引号转义（PrintCommand.command 是完整 shell 命令串，在容器内执行） */
export function sh(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * launch 期 env 注入的凭据名单（#145 路线 1′）。#34/#147 实测背书：
 * 容器内 headless 对「只拷 .credentials.yaml」报 MISSING_CREDENTIAL，
 * 对 `-e DEEPSEEK_API_KEY` 可用 —— 名单只收**有容器实测背书**的键；
 * 扩键必须先在容器里真跑过一轮，不凭键名猜测。
 */
export const CREDENTIAL_ENV_KEYS = ["DEEPSEEK_API_KEY"] as const;

/**
 * 从宿主启动环境收集凭据 env（#145：launch 期 `-e KEY=…` 注入容器，
 * 凭据**不落**任何容器内文件——含 `.env`；`.credentials.yaml` 不再读取或拷贝）。
 * 名单键全缺 → missing 全量返回，调用方（run-ticket main）响亮失败；
 * 部分缺 → 收集在场的 + missing 告警（未来名单多键时不因一个缺键卡死全部）。
 * 值只进容器进程环境，返回值只喂给 PodmanOptions.env，绝不写盘。
 */
export function collectCredentialEnv(
  source: Record<string, string | undefined>,
  keys: readonly string[] = CREDENTIAL_ENV_KEYS,
): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value !== "") env[key] = value;
    else missing.push(key);
  }
  return { env, missing };
}

/**
 * DSH headless adapter：把容器内的 `dsh --profile headless "<task>"`
 * 包装成 sandcastle 的 AgentProvider。
 *
 * - DSH headless：单任务进出（任务=argv 位置参数，不读 stdin），最终回复
 *   打 stdout，exit 0（turn/end）/ 1（error）。
 * - 超大任务不要内联 prompt（Linux 128KB argv 上限）：编排者先把票据文件
 *   commit 进分支，task 只写"执行 .sandcastle/tickets/<N>.md"。
 * - 凭据不在 provider env 注入（#145）：走 `dshSandboxOptions` 的 PodmanOptions.env
 *   launch 期注入（`podman run -e KEY=…`）；容器内不落凭据文件，
 *   onSandboxReady 钩子断言 `~/.dsh` 下无 `.credentials.yaml`（见 dshHomeReadyCommand）。
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

/**
 * run-ticket 的 podman 选项；宿主 DSH home 始终只读挂载。
 * `credentialEnv`（#145）：launch 期注入容器的凭据 env，podman provider
 * 把它组装成 `podman run -e KEY=VALUE`（收集见 collectCredentialEnv）。
 */
export function dshSandboxOptions(imageName: string, credentialEnv: Record<string, string> = {}): PodmanOptions {
  return {
    imageName,
    containerUid: 1000,
    containerGid: 1000,
    mounts: [{ hostPath: "~/.dsh", sandboxPath: "/host-dsh", readonly: true }],
    env: { ...credentialEnv },
  };
}

/**
 * onSandboxReady 钩子命令（只在容器内执行）：拷 settings.yaml（#145 AC：
 * settings 拷贝保留——凭据/授权/账号面从 settings 剥离后它仍是干净的配置面）
 * + 断言 `~/.dsh` 下无凭据文件（存在即 exit 1 响亮失败——凭据只走 launch 期
 * env 注入，任何凭据文件副本都是事故）+ 可选 model patch。
 */
export function dshHomeReadyCommand(model?: string): string {
  return "mkdir -p ~/.dsh && cp /host-dsh/settings.yaml ~/.dsh/"
    + " && if [ -e ~/.dsh/.credentials.yaml ]; then echo 'credential-file-present: ~/.dsh/.credentials.yaml —— #145 后凭据只走 launch 期 env 注入，容器内不得落凭据文件' >&2; exit 1; fi"
    + (model ? ` && ${patchAgentDefaultModelCmd(model)}` : "")
    + " && echo dsh-home-ready";
}
