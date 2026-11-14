/**
 * lane-sandbox.mts — lane 级沙箱实现面（#138，2026-10-20 grill Q1–Q9 拍定口径）。
 *
 * 职责边界（票面拍板）：
 *   - 运行时探测：`--runtime` > `DSH_CONTAINER_RUNTIME` > PATH 上 podman > docker > nerdctl，
 *     首个命中即用（与 lib/runtime-probe.mjs 的 probeDsh/probePnpm 同形）；失败**响亮**
 *     且给出按运行时分支的安装/启动提示。
 *   - lane 卷：容器运行时 named volume（活在 VM/引擎里，仓内零文件——Q8 第 1 层），
 *     按 lane 归属建/清；归属文件落 `.scratch/sessions/`（每 lane 一个 JSON——
 *     grill 原文；`.scratch/` 在 .gitignore 里，满足 Q8 第 2 层「git 忽略区」）。
 *   - 资源公式：每 lane 下限 1.5 GiB；`并行 = floor(VM RAM ÷ 1.5 GiB)`；请求超限
 *     ⇒ **响亮失败**（报错 + 按运行时分支的扩容指令），**不静默降级**（Q5=C）。
 *     首次进沙箱**现场探测**（VM 内存、宿主空闲磁盘）再算并行与配额；磁盘口径 =
 *     宿主空闲**比例**（不写死 GiB，Q7=C）。
 *   - Q8 验收判据：沙箱跑完 `git status --porcelain` 为空（worktreePollutionReport）；
 *     容器内无凭据文件断言**复用 #145 形态**（dsh.ts dshHomeReadyCommand，run-ticket
 *     onSandboxReady 已挂，本模块零重复）。
 *
 * 命令面纪律（Q9=A）：容器操作只用跨运行时公共子集（run / image inspect / volume /
 * exec / cp / rm）；运行时特有**动作**（podman machine set/start）只作分支提示，
 * 不作为唯一路径，也**不自动执行**。读数命令（`<rt> info` / `podman machine list`）
 * 属探测/算配额面，逐处按运行时分支实现并在 README 声明口径。
 *
 * 上游契约实测（2026-11-14，npm pack @ai-hero/sandcastle@0.12.0 / 0.14.0 / v1-next
 * 三版 .d.ts + dist 源码）：PodmanOptions **无 volumes 字段**、mounts.hostPath 必经
 * existsSync 宿主检查、provider 写死字面 podman——**named volume 挂载必须自实现
 * provider**。本文件用包根导出的公共工厂 createBindMountSandboxProvider（官方
 * podman provider 即由它实现），create 内自拼 `-v <volume>:<target>`（named volume
 * 直通形态，podman/docker/nerdctl CLI 同构）。worktree 创建 / git mount 解析 /
 * commit 采集仍归 sandcastle 主库（不重写 worker 面）。
 *
 * 实测边界（如实）：本机仅 podman 6.1.4 在位（docker/nerdctl 不在 PATH）——
 * podman 分支的读数 fixture 来自本机实测（machine list --format json 的 Memory =
 * 字符串字节数）；docker/nerdctl 分支 = fixture 驱动的单元断言，真机读数未验证。
 * lane provider 全链端到端读数留 #147（2026-11-14 拍板：验证面处置 = 先行开工、
 * 验证面延后——run-ticket 全链端到端读数等 #147 收口后补）。
 *
 * 纯函数（探测/解析/公式/卷名/归属/Q8 判定）可离线导入：不 import 包、副作用全部
 * 可注入（exec/exists/readdir/writeFile/alive）——tests/verify-lane-sandbox.mjs 直接驱动。
 */
import { existsSync as fsExistsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// ============================================================
// A. 运行时探测（Q9=A：顺序本身是契约）
// ============================================================

/** 已知容器运行时（探测与分支提示的覆盖面；顺序即 PATH 探测顺序）。 */
export const CONTAINER_RUNTIMES = ["podman", "docker", "nerdctl"] as const;
export type ContainerRuntimeName = (typeof CONTAINER_RUNTIMES)[number];

/** 探测结果。未命中时 detail 逐条说明每个来源为何落空（D47：缺席必须响亮）。 */
export interface RuntimeProbeHit {
  found: true;
  runtime: ContainerRuntimeName;
  path: string;
  source: "explicit" | "env" | "path";
  detail: string[];
}
export interface RuntimeProbeMiss {
  found: false;
  runtime: null;
  path: null;
  source: null;
  /** 显式参数给错（--runtime/DSH_CONTAINER_RUNTIME 不是已知运行时名）≠ 环境缺席，文案分开。 */
  explicitProblem: string | null;
  detail: string[];
}
export type RuntimeProbe = RuntimeProbeHit | RuntimeProbeMiss;

/** win32 上 CLI 的候选名（.exe 优先，再裸名）；POSIX 只有裸名。 */
function cliCandidateNames(runtime: string, platform: string): string[] {
  return platform === "win32" ? [`${runtime}.exe`, `${runtime}.cmd`, `${runtime}.bat`, runtime] : [runtime];
}

/** `env.PATH` 拆分（win 用 `;`、POSIX 用 `:`；容忍两边，便于跨平台注入测试）。 */
export function runtimePathEntries(env: Record<string, string | undefined>, platform: string): string[] {
  const raw = env?.PATH ?? env?.Path ?? "";
  const sep = platform === "win32" ? ";" : ":";
  return String(raw).split(sep).map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * 容器运行时探测。冻结顺序（Q9=A）：
 *   1. `--runtime <name>`（explicit）——给了就必须是已知运行时名，且其 CLI 必须在 PATH 上；
 *   2. `DSH_CONTAINER_RUNTIME=<name>`（env）——同 explicit 的语义（**名字**，不是路径）；
 *   3. PATH 上 podman > docker > nerdctl，首个命中即用。
 * 与 lib/runtime-probe.mjs 的 probeTool 同形：命中记来源链，未命中 detail 逐条落空原因；
 * 「操作者给错」与「环境缺席」分开（explicitProblem ≠ null 时调用侧不得说 missing）。
 */
export function probeContainerRuntime(options: {
  explicit?: string | undefined;
  env: Record<string, string | undefined>;
  platform?: string;
  pathEntries?: string[];
  exists?: (p: string) => boolean;
}): RuntimeProbe {
  const platform = options.platform ?? process.platform;
  const pathEntries = options.pathEntries ?? runtimePathEntries(options.env, platform);
  const exists = options.exists ?? fsExistsSync;
  const detail: string[] = [];
  const knownRuntimes = CONTAINER_RUNTIMES.join("/");

  /** 按名在 PATH 找 CLI；命中返回路径。 */
  const findOnPath = (runtime: string): string | null => {
    for (const dir of pathEntries) {
      for (const name of cliCandidateNames(runtime, platform)) {
        const candidate = join(dir, name);
        if (exists(candidate)) return candidate;
      }
    }
    return null;
  };

  // ── 1. explicit：给了就必须命中（响亮，不静默回落）──────────────────────────
  if (options.explicit !== undefined && options.explicit !== "") {
    const name = options.explicit.trim().toLowerCase();
    if (!(CONTAINER_RUNTIMES as readonly string[]).includes(name)) {
      const problem = `--runtime 给出的运行时名不在已知集合（${knownRuntimes}）: ${options.explicit}`;
      detail.push(problem);
      return { found: false, runtime: null, path: null, source: null, explicitProblem: problem, detail };
    }
    const p = findOnPath(name);
    if (p !== null) {
      detail.push(`命中 explicit(--runtime): ${name} @ ${p}`);
      return { found: true, runtime: name as ContainerRuntimeName, path: p, source: "explicit", detail };
    }
    const problem = `--runtime ${name} 指定的 CLI 不在 PATH 上（按 ${cliCandidateNames(name, platform).join("/")} 找遍 PATH 的 ${pathEntries.length} 个目录）`;
    detail.push(problem);
    return { found: false, runtime: null, path: null, source: null, explicitProblem: problem, detail };
  }

  // ── 2. env：DSH_CONTAINER_RUNTIME=<名字>（语义 = 选哪个运行时）──────────────
  const envName = options.env?.DSH_CONTAINER_RUNTIME;
  if (envName !== undefined && envName !== "") {
    const name = envName.trim().toLowerCase();
    if (!(CONTAINER_RUNTIMES as readonly string[]).includes(name)) {
      const problem = `DSH_CONTAINER_RUNTIME 的值不在已知集合（${knownRuntimes}）: ${envName}`;
      detail.push(problem);
      return { found: false, runtime: null, path: null, source: null, explicitProblem: problem, detail };
    }
    const p = findOnPath(name);
    if (p !== null) {
      detail.push(`命中 env(DSH_CONTAINER_RUNTIME): ${name} @ ${p}`);
      return { found: true, runtime: name as ContainerRuntimeName, path: p, source: "env", detail };
    }
    const problem = `DSH_CONTAINER_RUNTIME=${name} 指定的 CLI 不在 PATH 上（按 ${cliCandidateNames(name, platform).join("/")} 找遍 PATH 的 ${pathEntries.length} 个目录）`;
    detail.push(problem);
    return { found: false, runtime: null, path: null, source: null, explicitProblem: problem, detail };
  }
  detail.push("--runtime 未给、DSH_CONTAINER_RUNTIME 未设置");

  // ── 3. PATH：podman > docker > nerdctl，首个命中即用 ──────────────────────
  for (const runtime of CONTAINER_RUNTIMES) {
    const p = findOnPath(runtime);
    if (p !== null) {
      detail.push(`命中 path: ${runtime} @ ${p}`);
      return { found: true, runtime, path: p, source: "path", detail };
    }
    detail.push(`PATH 的 ${pathEntries.length} 个目录里没有 ${cliCandidateNames(runtime, platform).join("/")}`);
  }

  return { found: false, runtime: null, path: null, source: null, explicitProblem: null, detail };
}

/** 未命中的一行可执行指路（D47：要给「下一步打什么」）。 */
export function containerRuntimeInstallHint(): string {
  return (
    "missing container runtime — lane 模式需要 podman / docker / nerdctl 之一。" +
    "给一条即可: `--runtime podman`（或 docker/nerdctl）| `set DSH_CONTAINER_RUNTIME=podman`" +
    " | `export DSH_CONTAINER_RUNTIME=podman` | 装一个并让 `<rt> --version` 在当前 shell 可跑" +
    "（podman: https://podman.io —— Windows 上装 Podman Desktop 或 choco install podman）"
  );
}

/** 按运行时分支的启动提示（runtime alive 失败时给；特有动作只提示、不自动执行）。 */
export function runtimeStartHint(runtime: ContainerRuntimeName): string {
  if (runtime === "podman") {
    return "podman machine 未运行 —— 先 `podman machine start`（本工具不代跑；machine 是共享 VM，生命周期归你）";
  }
  if (runtime === "docker") {
    return "docker daemon 未运行 —— 启动 Docker Desktop（或系统服务 docker.service）后重跑";
  }
  return "nerdctl 不可用 —— 启动 containerd 服务（并确认 CNI 插件在位）后重跑";
}

/**
 * 运行时 alive 真跑验证：存在性命中 ≠ 可用（machine 没起/daemon 没跑时 `volume create`
 * 才炸，报错含糊）。`<cli> info` 是 podman/docker/nerdctl 三家共有的诊断子命令。
 * `exec` 可注入（默认 spawnSync，测试传假执行器不真跑）。返回调用方决定 die。
 */
export function verifyRuntimeAlive(options: {
  runtime: ContainerRuntimeName;
  path: string;
  exec?: (cmd: string, args: string[]) => { status: number | null; stderr?: string; stdout?: string };
  timeoutMs?: number;
}): { ok: true } | { ok: false; problem: string; hint: string } {
  const exec = options.exec ?? ((cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: options.timeoutMs ?? 20_000, windowsHide: true });
    return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
  });
  const r = exec(options.path, ["info"]);
  if (r.status === 0) return { ok: true };
  const tail = String(r.stderr || r.stdout || "").trim().split("\n").slice(-2).join(" | ").slice(0, 300);
  return {
    ok: false,
    problem: `${options.runtime} info 真跑失败 (exit ${r.status})${tail === "" ? "" : `: ${tail}`}`,
    hint: runtimeStartHint(options.runtime),
  };
}

// ============================================================
// B. 资源公式（Q4=A 动态 / Q5=C 下限 1.5 GiB + 超限响亮 / Q7=C 现场探测）
// ============================================================

/** 每 lane 内存下限（GiB）——Q5=C 兜底：OOM 的物理事实，不是性能调优值。 */
export const MIN_LANE_MEM_GIB = 1.5;
const GIB = 1024 ** 3;

/** 并行公式（Q5=C）：并行 = floor(VM RAM ÷ 1.5 GiB)。 */
export function laneCapacity(vmRamBytes: number): number {
  return Math.floor(vmRamBytes / (MIN_LANE_MEM_GIB * GIB));
}

/** 扩容指令（按运行时分支；**只提示，不自动执行**——不自动拉起/修改 VM 配置）。 */
export function capacityExpandHint(runtime: ContainerRuntimeName, requestedLanes: number): string {
  const needGib = Math.ceil(requestedLanes * MIN_LANE_MEM_GIB);
  if (runtime === "podman") {
    return (
      `扩容指令（不自动执行）：\`podman machine set --memory=${needGib * 1024}\`（MiB）` +
      ` 然后 \`podman machine stop && podman machine start\`；machine 是共享 VM，扩容前确认同机其他负载`
    );
  }
  if (runtime === "docker") {
    return `扩容指令（不自动执行）：Docker Desktop → Settings → Resources → Memory 调到 ≥ ${needGib} GiB`;
  }
  return `扩容指令：nerdctl 的内存上限 = containerd 所在宿主/VM 的物理内存——在宿主上扩内存，或换更大 VM`;
}

/**
 * 请求超限判定（Q5=C 响亮失败，不静默降级）。requestedLanes > capacity → 给出
 * 公式读数 + 按运行时分支的扩容指令。undefined = 通过。
 */
export function laneCapacityProblem(options: {
  requestedLanes: number;
  vmRamBytes: number;
  runtime: ContainerRuntimeName;
}): { problem: string; hint: string } | undefined {
  const capacity = laneCapacity(options.vmRamBytes);
  if (options.requestedLanes <= capacity) return undefined;
  return {
    problem:
      `lane 资源公式超限（Q5=C 响亮失败）：请求并行 ${options.requestedLanes} lanes > ` +
      `floor(VM RAM ${options.vmRamBytes} bytes ÷ ${MIN_LANE_MEM_GIB} GiB) = ${capacity}。` +
      `不静默降级——要么减少并行 lane，要么扩容 VM 内存`,
    hint: capacityExpandHint(options.runtime, options.requestedLanes),
  };
}

/**
 * podman `machine list --format json` 的 Memory 解析。
 * 实测（2026-11-14 podman 6.1.4）：条目形如 { Name, Running, Memory: "2147483648", ... }
 * —— Memory 是**字符串形态的字节数**；兼容数字形态与老版人类可读形态（"2 GiB"）。
 * 取 Running 条目的最大 Memory（跑的 machine 是并行度上限——ADR-0003 结论）。
 */
export function parsePodmanMachineMemory(stdout: string): number {
  let entries: Array<{ Running?: boolean; Memory?: string | number }> = [];
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) entries = parsed;
  } catch {
    // fallthrough：非 JSON（老版本人类可读表）→ 0，调用侧按 0 响亮
  }
  const bytesOf = (m: string | number | undefined): number => {
    if (typeof m === "number") return m;
    const s = String(m ?? "").trim();
    if (/^\d+$/.test(s)) return Number(s);
    const m2 = /([\d.]+)\s*([KMG])i?B/i.exec(s);
    if (m2 === null) return 0;
    const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m2[2].toUpperCase()]!;
    return Math.round(Number(m2[1]) * unit);
  };
  return entries
    .filter((e) => e.Running === true)
    .map((e) => bytesOf(e.Memory))
    .reduce((a, b) => Math.max(a, b), 0);
}

/**
 * docker `info --format '{{.MemTotal}}'` 解析：输出 = 字节数字符串。
 * 真机读数未验证（本机无 docker）——fixture 驱动，端到端读数留 #147。
 */
export function parseDockerMemTotal(stdout: string): number {
  const m = /^\s*(\d+)\s*$/m.exec(stdout);
  return m === null ? 0 : Number(m[1]);
}

/**
 * nerdctl `info` 人类可读输出的 Total Memory 行解析（形态同 docker info：
 * `Total Memory: 1.562 GiB`——fixture 按该形态，真机读数未验证）。
 */
export function parseNerdctlInfoMemory(stdout: string): number {
  const m = /Total Memory:\s*([\d.]+)\s*([KMGT])i?B/i.exec(stdout);
  if (m === null) return 0;
  const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2].toUpperCase()]!;
  return Math.round(Number(m[1]) * unit);
}

/**
 * 首次进沙箱的现场探测（Q7=C）：按运行时分支读 VM 内存。
 * podman → `machine list --format json`（读数命令，非动作）；docker → `info --format`；
 * nerdctl → `info`。0 bytes = 读数失败（解析为空/machine 未跑）→ 调用侧响亮，不猜默认值。
 */
export function probeVmMemoryBytes(options: {
  runtime: ContainerRuntimeName;
  path: string;
  exec?: (cmd: string, args: string[]) => { status: number | null; stderr?: string; stdout?: string };
}): { ok: true; bytes: number; how: string } | { ok: false; problem: string; hint: string } {
  const exec = options.exec ?? ((cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20_000, windowsHide: true });
    return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
  });
  if (options.runtime === "podman") {
    const r = exec(options.path, ["machine", "list", "--format", "json"]);
    if (r.status !== 0) {
      return { ok: false, problem: `podman machine list 读数失败 (exit ${r.status})`, hint: runtimeStartHint("podman") };
    }
    const bytes = parsePodmanMachineMemory(r.stdout ?? "");
    if (bytes <= 0) return { ok: false, problem: "podman machine list 无 Running 条目或 Memory 读数为 0", hint: runtimeStartHint("podman") };
    return { ok: true, bytes, how: "podman machine list --format json" };
  }
  if (options.runtime === "docker") {
    const r = exec(options.path, ["info", "--format", "{{.MemTotal}}"]);
    if (r.status !== 0) {
      return { ok: false, problem: `docker info 读数失败 (exit ${r.status})`, hint: runtimeStartHint("docker") };
    }
    const bytes = parseDockerMemTotal(r.stdout ?? "");
    if (bytes <= 0) return { ok: false, problem: "docker MemTotal 读数为 0", hint: runtimeStartHint("docker") };
    return { ok: true, bytes, how: "docker info --format {{.MemTotal}}" };
  }
  const r = exec(options.path, ["info"]);
  if (r.status !== 0) {
    return { ok: false, problem: `nerdctl info 读数失败 (exit ${r.status})`, hint: runtimeStartHint("nerdctl") };
  }
  const bytes = parseNerdctlInfoMemory(r.stdout ?? "");
  if (bytes <= 0) return { ok: false, problem: "nerdctl info 的 Total Memory 解析为 0", hint: runtimeStartHint("nerdctl") };
  return { ok: true, bytes, how: "nerdctl info (Total Memory)" };
}

// ============================================================
// 磁盘口径（Q7=C：宿主空闲**比例**，不写死 GiB——512 GB 与 2 TB 不共用一个数）
// ============================================================

/** 宿主空闲比例下限（默认 10%：512 GB 机器 = 51 GB、2 TB 机器 = 204 GB，都够沙箱构建）。 */
export const DEFAULT_MIN_DISK_FREE_RATIO = 0.1;

export function diskFreeRatio(freeBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return freeBytes / totalBytes;
}

export function diskSpaceProblem(freeBytes: number, totalBytes: number, minRatio: number): string | undefined {
  const ratio = diskFreeRatio(freeBytes, totalBytes);
  if (ratio >= minRatio) return undefined;
  return (
    `宿主磁盘空闲比例不足（Q7=C 比例口径）：空闲 ${freeBytes} / ${totalBytes} bytes = ` +
    `${(ratio * 100).toFixed(1)}% < 下限 ${(minRatio * 100).toFixed(0)}%。沙箱构建（镜像层 + 卷）需要宿主盘余量——清理宿主盘或换盘后重跑`
  );
}

// ============================================================
// C. lane 卷（Q2=C named volume / Q8=A 两层存储）
// ============================================================

/** lane 名 / 卷名规范化：小写、非法段转 `-`、去首尾 `-`。空结果 = 响亮拒绝。 */
export function normalizeLaneName(lane: string): string {
  const norm = String(lane ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (norm === "") {
    throw new Error(`lane 名规范化后为空（原值: ${JSON.stringify(lane)}）——lane 名需要至少一个 [a-z0-9_.-] 字符`);
  }
  return norm;
}

/** lane 的 named volume 名（容器运行时命名约束：[a-zA-Z0-9][a-zA-Z0-9_.-]*）。 */
export function laneVolumeName(lane: string): string {
  return `dsh-lane-${normalizeLaneName(lane)}`;
}

// （--lane 参数读取由 run-ticket 直接用 lib.ts arg("lane")，此处不重复包装。）

// —— 卷操作 = 跨运行时公共子集（Q9=A：volume 在 run/build/volume 面内）─────────
export function volumeInspectArgs(volume: string): string[] {
  return ["volume", "inspect", volume];
}
export function volumeCreateArgs(volume: string): string[] {
  return ["volume", "create", volume];
}
export function volumeRemoveArgs(volume: string): string[] {
  return ["volume", "rm", "-f", volume];
}

/**
 * 幂等建卷：inspect 非 0 才 create（volume 已存在不是错误——lane 重跑同票应续用）。
 * create 失败 = 响亮（machine 未跑 / 权限 / 存储池满）。
 * `exec` 可注入；返回 undefined = 在场，problem 串 = 失败。
 */
export function ensureLaneVolume(options: {
  path: string;
  volume: string;
  exec?: (cmd: string, args: string[]) => { status: number | null; stderr?: string; stdout?: string };
}): string | undefined {
  const exec = options.exec ?? ((cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 30_000, windowsHide: true });
    return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
  });
  const inspect = exec(options.path, volumeInspectArgs(options.volume));
  if (inspect.status === 0) return undefined; // 已在场（幂等：lane 重跑续用同一卷）
  const create = exec(options.path, volumeCreateArgs(options.volume));
  if (create.status !== 0) {
    const tail = String(create.stderr || create.stdout || "").trim().slice(0, 300);
    return `${options.volume} 建卷失败 (exit ${create.status})${tail === "" ? "" : `: ${tail}`}`;
  }
  return undefined;
}

/**
 * named volume 的容器内挂载参数（named volume 直通形态：`-v <name>:<path>`——
 * 首段非绝对路径 = volume 名，podman/docker/nerdctl CLI 同构）。
 * 挂载点 = 容器内 git 忽略路径（Q8 第 2 层；run-ticket lane 模式用 worktree 下 node_modules）。
 */
export function laneVolumeMountArgs(volume: string, containerTarget: string): string[] {
  return ["-v", `${volume}:${containerTarget}`];
}

// ============================================================
// D. 归属面（grill 原文：卷归属规则复用 .scratch/sessions/，每 lane 一个归属文件）
// ============================================================

/** 归属目录（相对仓库根/运行 cwd；`.scratch/` 已在 .gitignore —— Q8 第 2 层）。 */
export const SESSIONS_REL_DIR = ".scratch/sessions";

/** 归属记录形态。state=running 时带 pid（崩溃残留经 alive 探测自愈，见 effectiveLaneState）。 */
export interface LaneOwnership {
  lane: string;
  volume: string;
  runtime: ContainerRuntimeName;
  state: "running" | "idle";
  pid?: number;
  ticket?: string;
  vmRamBytes?: number;
  capacity?: number;
  createdAt: string;
  updatedAt: string;
}

/** 归属文件路径：`.scratch/sessions/<lane>.json`（lane 用规范名）。 */
export function ownershipPath(dir: string, lane: string): string {
  return join(dir, `${normalizeLaneName(lane)}.json`);
}

/**
 * 读归属记录。文件缺席 = undefined（正常）；**JSON 损坏 = 响亮 throw**（D47：
 * 状态面损坏要人处理，静默当"无归属"会重复建卷/算错并行）——报错带可行动指引。
 */
export function readOwnership(dir: string, lane: string, io: {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string) => string;
}): LaneOwnership | undefined {
  const p = ownershipPath(dir, lane);
  if (!io.existsSync(p)) return undefined;
  try {
    return JSON.parse(io.readFileSync(p)) as LaneOwnership;
  } catch (e) {
    throw new Error(
      `归属文件损坏（${p}）: ${(e as Error).message} —— 这是状态面不是缓存；` +
        `确认该 lane 未在跑后删除该文件（或修复 JSON）再重跑`,
    );
  }
}

/** 列在场 lane（归属文件名去 .json）。损坏文件**响亮 throw**（同 readOwnership）。 */
export function listLanes(dir: string, io: {
  existsSync: (p: string) => boolean;
  readdirSync: (p: string) => string[];
  readFileSync: (p: string) => string;
}): string[] {
  if (!io.existsSync(dir)) return [];
  const lanes: string[] = [];
  for (const f of io.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const lane = f.slice(0, -".json".length);
    // 响亮校验：能读 + 形态像归属记录（有 lane/volume 字段），坏件直接红
    readOwnership(dir, lane, io);
    lanes.push(lane);
  }
  return lanes;
}

/**
 * 写归属记录（发射时 state=running + pid；收口 exit hook 改 idle）。
 * `mkdirSync/writeFileSync` 注入（测试不落盘）；updatedAt 自动补当前时刻。
 */
export function writeOwnership(dir: string, lane: string, rec: Omit<LaneOwnership, "updatedAt">, io: {
  mkdirSync: (dir: string, opts?: { recursive?: boolean }) => unknown;
  writeFileSync: (p: string, data: string) => void;
}): LaneOwnership {
  io.mkdirSync(dir, { recursive: true });
  const full: LaneOwnership = { ...rec, lane: normalizeLaneName(lane), updatedAt: new Date().toISOString() };
  io.writeFileSync(ownershipPath(dir, lane), JSON.stringify(full, null, 2), "utf8");
  return full;
}

/**
 * 有效状态判定：running 声明若其 pid 已死 = 崩溃残留，自愈读作 idle（同机假设——
 * 沙箱批跑就在本机）。alive 可注入（测试免真进程；默认 process.kill(pid,0)）。
 */
export function effectiveLaneState(rec: LaneOwnership, alive?: (pid: number) => boolean): "running" | "idle" {
  const probe = alive ?? ((pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  });
  if (rec.state === "running" && typeof rec.pid === "number" && Number.isFinite(rec.pid) && rec.pid > 0) {
    return probe(rec.pid) ? "running" : "idle";
  }
  return rec.state;
}

/** 在跑的 lane 集合（排除本进程——同 lane 重跑/续跑不算新增并行）。 */
export function runningLaneSet(dir: string, io: {
  existsSync: (p: string) => boolean;
  readdirSync: (p: string) => string[];
  readFileSync: (p: string) => string;
}, alive?: (pid: number) => boolean, ownPid: number = process.pid): Set<string> {
  const running = new Set<string>();
  for (const lane of listLanes(dir, io)) {
    const rec = readOwnership(dir, lane, io)!;
    if (effectiveLaneState(rec, alive) === "running" && rec.pid !== ownPid) running.add(lane);
  }
  return running;
}

// ============================================================
// E. Q8 验收判据：沙箱跑完 git status --porcelain 为空
// ============================================================

/** porcelain 输出判定：非空行 = 污染明细（一条命令可核——Q8 拍板原文）。 */
export function worktreePollutionReport(porcelainOutput: string): { clean: true } | { clean: false; lines: string[] } {
  const lines = porcelainOutput.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  return lines.length === 0 ? { clean: true } : { clean: false, lines };
}

export function pollutionMessage(lines: string[]): string {
  return (
    "Q8 验收判据红：沙箱跑完 git status --porcelain 非空（容器内允许写路径必须在 git 忽略区——" +
    "node_modules/.scratch 等；构建输出落到未忽略路径 = 污染）。污染明细:\n" +
    lines.map((l) => `  ${l}`).join("\n") +
    "\n处置：worker 面补 .gitignore 或改输出路径；本票 checkpoint 为 parked-pollution"
  );
}

// ============================================================
// F. lane provider（执行面：named volume 挂载）
// ============================================================
// 上游契约（2026-11-14 实测 0.12.0/0.14.0/v1-next 三版 dist）：PodmanOptions 无
// volumes、mounts.hostPath 必经宿主 existsSync、provider 写死 podman——所以 lane 卷
// 挂载自实现：包根公共工厂 createBindMountSandboxProvider + create 内自拼
// `-v <volume>:<target>`。exec/copy/close 形态照官方 podman provider（handle 契约：
// exec MUST 支持 onLine 流式——idle timeout 依赖它）。

/** exec 结果（SandboxProvider 契约的最小面）。 */
export interface LaneExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** spawn 形态：win32 的 .cmd/.bat 不能直接 spawn（EINVAL），包 cmd.exe /c 参数数组。 */
export function cliSpawnSpec(cliPath: string): { cmd: string; prefix: string[] } {
  if (process.platform === "win32" && /\.(cmd|bat)$/iu.test(cliPath)) {
    return {
      cmd: process.env.ComSpec ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
      prefix: ["/c", cliPath],
    };
  }
  return { cmd: cliPath, prefix: [] };
}

/** 环境数组 → `-e KEY=VALUE` 参数（凭据/配置统一走 launch 期注入，#145 同形态）。 */
export function envArgsOf(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

/** 目录挂载的宿主侧解析 + 校验（简版 resolveUserMounts：只支持目录，文件挂载响亮拒绝）。 */
export function resolveLaneMount(mount: { hostPath: string; sandboxPath: string; readonly?: boolean }, io: {
  existsSync: (p: string) => boolean;
  isDirectory: (p: string) => boolean;
}): { hostPath: string; sandboxPath: string; readonly?: boolean } {
  const hostPath = mount.hostPath.replace(/^~(?=$|[\\/])/, process.env.HOME ?? process.env.USERPROFILE ?? "~");
  if (!io.existsSync(hostPath)) {
    throw new Error(`lane 挂载 hostPath 不存在: ${mount.hostPath}（解析为 ${hostPath}）`);
  }
  if (!io.isDirectory(hostPath)) {
    throw new Error(`lane 挂载只支持目录（named volume 走 laneVolumeMountArgs，不走 mounts）: ${mount.hostPath}`);
  }
  return { hostPath, sandboxPath: mount.sandboxPath, ...(mount.readonly ? { readonly: true } : {}) };
}

/** 单条 bind-mount → `-v host:container[:ro]`（与官方 formatVolumeMount 同构）。 */
export function formatLaneBindMount(m: { hostPath: string; sandboxPath: string; readonly?: boolean }): string {
  return m.readonly ? `${m.hostPath}:${m.sandboxPath}:ro` : `${m.hostPath}:${m.sandboxPath}`;
}

/** 简单定长 tail（ExecResult 契约：onLine 流式之外保留尾部，防 V8 字符串爆炸）。 */
class BoundedTail {
  private parts: string[] = [];
  private readonly maxChars: number;
  private readonly sep: string;
  constructor(maxChars: number, sep: string) {
    this.maxChars = maxChars;
    this.sep = sep;
  }
  push(line: string): void {
    this.parts.push(line);
    let total = this.parts.reduce((n, s) => n + s.length + this.sep.length, 0);
    while (total > this.maxChars && this.parts.length > 1) {
      total -= this.parts[0]!.length + this.sep.length;
      this.parts.shift();
    }
  }
  toString(): string {
    return this.parts.join(this.sep);
  }
}

/**
 * lane 容器 provider：票级容器（生命周期同 ADR-0003 语态，每票重建）+ lane 卷挂载。
 * 与官方 podman provider 的差异只在卷挂载一行；docker/nerdctl 同构面由 cli 参数承载
 * （podman 额外 --userns=keep-id；docker/nerdctl 不加）。
 *
 * 实测边界（如实）：本机仅 podman 可真跑；docker/nerdctl 参数拼装由单元断言钉形态，
 * 真机挂载行为未验证；全链端到端读数留 #147。
 *
 * 依赖（@ai-hero/sandcastle）由调用方（run-ticket main）动态导入后传入工厂函数，
 * 本模块导入面保持零包依赖（纯函数离线可测——#146 自包含层同口径）。
 */
export interface LaneProviderDeps {
  createBindMountSandboxProvider: (config: unknown) => unknown;
  spawn: typeof import("node:child_process").spawn;
  execFile: typeof import("node:child_process").execFile;
  execFileSync: typeof import("node:child_process").execFileSync;
  createInterface: (options: { input: NodeJS.ReadableStream }) => { on(ev: string, fn: (line: string) => void): void };
  randomUUID: () => string;
  /** fs.statSync（宿主目录挂载校验；userMounts 非空时必须提供，否则响亮拒绝）。 */
  statSync?: (p: string) => { isFile(): boolean };
  onShutdown?: (fn: () => void) => () => void;
}

export interface LaneCliProviderOptions {
  cliPath: string;
  runtime: ContainerRuntimeName;
  imageName: string;
  lane: string;
  volumeName: string;
  /**
   * 卷挂载点相对 worktree 容器内路径的**段**（如 "node_modules"——git 忽略路径，Q8 第 2 层）。
   * 绝对挂载点在 create 内由现算的 worktreeContainerPath 派生（laneContainerTarget）——
   * 不吃调用方硬编码绝对路径，防框架 worktree 布局变化时卷挂到野路径（复审 F3）。
   */
  containerTargetSegment: string;
  /** 宿主目录挂载（dshSandboxOptions 形态：~/.dsh 只读挂 /host-dsh）。 */
  userMounts?: Array<{ hostPath: string; sandboxPath: string; readonly?: boolean }>;
  credentialEnv?: Record<string, string>;
  containerUid?: number;
  containerGid?: number;
  maxOutputTailChars?: number;
}

/** 容器内 POSIX 路径拼接（不是宿主 join——win32 的 \\ 语义不适用容器内）。 */
export function laneContainerTarget(worktreeContainerPath: string, segment: string): string {
  const seg = segment.replace(/^\/+|\/+$/g, "");
  if (seg === "") throw new Error("lane 卷挂载段为空（containerTargetSegment）——响亮拒绝，不静默挂卷根");
  return `${worktreeContainerPath.replace(/\/+$/u, "")}/${seg}`;
}

/** 供测试断言的容器 run 参数拼装（provider create 的第一段，纯函数）。 */
export function laneRunArgs(options: LaneCliProviderOptions, frameworkMounts: Array<{ hostPath: string; sandboxPath: string; readonly?: boolean }>, containerName: string, worktreeContainerPath: string, containerTarget: string): string[] {
  const uid = options.containerUid ?? 1000;
  const gid = options.containerGid ?? 1000;
  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "--user",
    `${uid}:${gid}`,
  ];
  if (options.runtime === "podman") {
    args.push(`--userns=keep-id:uid=${uid},gid=${gid}`);
  }
  args.push("-w", worktreeContainerPath);
  args.push(...envArgsOf(options.credentialEnv ?? {}));
  for (const m of frameworkMounts) args.push("-v", formatLaneBindMount(m));
  for (const m of options.userMounts ?? []) args.push("-v", formatLaneBindMount(m));
  args.push(...laneVolumeMountArgs(options.volumeName, containerTarget));
  args.push("--entrypoint", "sleep", options.imageName, "infinity");
  return args;
}

/** 卷根权限初始化参数（容器起来后以容器内 root chown 一次；失败不阻断——容器内写权限错误会在 worker 首次写卷时以真实报错暴露，真机行为留 #147）。 */
export function laneVolumeChownArgs(containerName: string, containerTarget: string, uid: number, gid: number): string[] {
  return ["exec", "--user", "0:0", containerName, "sh", "-c", `chown ${uid}:${gid} "$1" 2>/dev/null || true`, "sh", containerTarget];
}

/**
 * 组装 lane provider（依赖注入：createBindMountSandboxProvider 等由 run-ticket main
 * 动态导入传入——本模块不静态 import 包，导入面零包依赖）。
 */
export function makeLaneCliProvider(deps: LaneProviderDeps, options: LaneCliProviderOptions): unknown {
  const uid = options.containerUid ?? 1000;
  const gid = options.containerGid ?? 1000;
  const maxTail = options.maxOutputTailChars ?? 64 * 1024;
  // 宿主目录挂载的存在性校验走 statSync（目录 = 非 file）。statSync 未注入且
  // 有 userMounts 时**响亮**拒绝（D47：不能静默跳过挂载校验）。
  const statOf = (p: string): { isFile(): boolean } => {
    if (deps.statSync === undefined) {
      throw new Error("lane provider: statSync 未注入（makeLaneCliProvider 的 deps 需提供 fs.statSync）");
    }
    return deps.statSync(p);
  };
  return deps.createBindMountSandboxProvider({
    name: `${options.runtime}-lane`,
    env: options.credentialEnv,
    sandboxHomedir: "/home/agent",
    create: async (createOptions: {
      worktreePath: string;
      hostRepoPath: string;
      mounts: Array<{ hostPath: string; sandboxPath: string; readonly?: boolean }>;
      env: Record<string, string>;
    }) => {
      const containerName = `sandcastle-lane-${normalizeLaneName(options.lane)}-${deps.randomUUID().slice(0, 8)}`;
      const worktreeContainerPath =
        createOptions.mounts.find((m) => m.hostPath === createOptions.worktreePath)?.sandboxPath ?? "/home/agent/workspace";
      // 卷挂载点由**现算的** worktree 容器内路径派生（复审 F3）：不吃调用方硬编码绝对路径，
      // 框架 worktree 布局变化时卷跟着走，冷启动收益不会静默落到野路径。
      const containerTarget = laneContainerTarget(worktreeContainerPath, options.containerTargetSegment);
      // 宿主目录挂载（~/.dsh 形态）在此层校验存在性；框架 mounts（worktree/git）信任框架。
      // existsSync = 真实存在性（复审 F6）：文件形态留给 isDirectory 分支报「只支持目录」，
      // 缺席才报「不存在」——两种失败两种文案，不互相冒名。
      for (const m of options.userMounts ?? []) {
        resolveLaneMount(m, {
          existsSync: (p: string) => {
            try { statOf(p); return true; } catch { return false; }
          },
          isDirectory: (p: string) => {
            try { return !statOf(p).isFile(); } catch { return false; }
          },
        });
      }
      const runArgs = laneRunArgs(options, createOptions.mounts, containerName, worktreeContainerPath, containerTarget);
      await new Promise<void>((resolveP, rejectP) => {
        const spec = cliSpawnSpec(options.cliPath);
        deps.execFile(spec.cmd, [...spec.prefix, ...runArgs], (error) => {
          if (error) rejectP(new Error(`${options.runtime} run (lane) failed: ${error.message}`));
          else resolveP();
        });
      });
      // 卷根权限初始化（容器内 root chown 一次；失败不阻断——容器内写权限错误会在 worker
      // 首次写卷时以真实报错暴露；真机权限行为留 #147 实证）。
      await new Promise<void>((resolveP) => {
        const spec = cliSpawnSpec(options.cliPath);
        deps.execFile(spec.cmd, [...spec.prefix, ...laneVolumeChownArgs(containerName, containerTarget, uid, gid)], () => resolveP());
      });
      const unregisterShutdown = deps.onShutdown?.(() => {
        try {
          deps.execFileSync(options.cliPath, ["rm", "-f", containerName], { stdio: "ignore", timeout: 5_000 });
        } catch {
          // 收尾尽力而为；close() 会再试
        }
      });
      const spawnCli = (args: string[], opts?: { stdin?: string }) => {
        const spec = cliSpawnSpec(options.cliPath);
        return deps.spawn(spec.cmd, [...spec.prefix, ...args], {
          stdio: [opts?.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        });
      };
      const handle = {
        worktreePath: worktreeContainerPath,
        exec: (command: string, opts?: { onLine?: (line: string) => void; cwd?: string; sudo?: boolean; stdin?: string }): Promise<LaneExecResult> => {
          const effectiveCommand = opts?.sudo ? `sudo ${command}` : command;
          const args = ["exec"];
          if (opts?.stdin !== undefined) args.push("-i");
          if (opts?.cwd) args.push("-w", opts.cwd);
          args.push(containerName, "sh", "-c", effectiveCommand);
          return new Promise<LaneExecResult>((resolveP, rejectP) => {
            const proc = spawnCli(args, opts);
            proc.on("error", (error: Error) => rejectP(new Error(`${options.runtime} exec failed: ${error.message}`)));
            if (opts?.stdin !== undefined) {
              proc.stdin!.write(opts.stdin);
              proc.stdin!.end();
            }
            if (opts?.onLine) {
              const stdoutTail = new BoundedTail(maxTail, "\n");
              const stderrTail = new BoundedTail(maxTail, "");
              const rl = deps.createInterface({ input: proc.stdout });
              rl.on("line", (line: string) => {
                stdoutTail.push(line);
                opts.onLine!(line);
              });
              proc.stderr!.on("data", (chunk: Buffer) => stderrTail.push(chunk.toString()));
              proc.on("close", (code: number | null) => {
                // null = 被信号杀/没跑完 ≠ 成功（fail-closed，复审 F1）。官方 0.12.0 podman
                // provider 此处为 `code ?? 0`——本实现**有意偏离**：exec 是验证门/Q8 判据的
                // 承载面，null→0 会把「没跑完」读成「通过」传导 fail-open；真机语义留 #147 实证。
                resolveP({ stdout: stdoutTail.toString(), stderr: stderrTail.toString(), exitCode: code ?? 1 });
              });
            } else {
              const out: Buffer[] = [];
              const err: Buffer[] = [];
              proc.stdout!.on("data", (chunk: Buffer) => out.push(chunk));
              proc.stderr!.on("data", (chunk: Buffer) => err.push(chunk));
              proc.on("close", (code: number | null) => {
                // 同上：null ≠ 成功（复审 F1 fail-closed；有意偏离官方 ?? 0，#147 实证）
                resolveP({ stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString(), exitCode: code ?? 1 });
              });
            }
          });
        },
        copyFileIn: (hostPath: string, sandboxPath: string): Promise<void> =>
          new Promise<void>((resolveP, rejectP) => {
            const spec = cliSpawnSpec(options.cliPath);
            deps.execFile(spec.cmd, [...spec.prefix, "cp", hostPath, `${containerName}:${sandboxPath}`], (error) => {
              if (error) rejectP(new Error(`${options.runtime} cp (in) failed: ${error.message}`));
              else resolveP();
            });
          }),
        copyFileOut: (sandboxPath: string, hostPath: string): Promise<void> =>
          new Promise<void>((resolveP, rejectP) => {
            const spec = cliSpawnSpec(options.cliPath);
            deps.execFile(spec.cmd, [...spec.prefix, "cp", `${containerName}:${sandboxPath}`, hostPath], (error) => {
              if (error) rejectP(new Error(`${options.runtime} cp (out) failed: ${error.message}`));
              else resolveP();
            });
          }),
        close: async (): Promise<void> => {
          unregisterShutdown?.();
          await new Promise<void>((resolveP, rejectP) => {
            const spec = cliSpawnSpec(options.cliPath);
            deps.execFile(spec.cmd, [...spec.prefix, "rm", "-f", containerName], (error) => {
              if (error) rejectP(new Error(`${options.runtime} rm failed: ${error.message}`));
              else resolveP();
            });
          });
        },
      };
      return handle;
    },
  });
}

// ============================================================
// G. 退出码（run-ticket EXIT_STATUS 的 lane 档；单一事实源在 run-ticket.mts）
// ============================================================
// LANE_GATE = 8（lane 门拒绝：运行时缺席/资源超限/磁盘不足——环境前置，非 parked）
// POLLUTION  = 9（Q8 判据红：worktree 污染 → parked-pollution）
// 数值定义在 run-ticket.mts EXIT_STATUS；本模块只承载语义文档，防两处漂移。
