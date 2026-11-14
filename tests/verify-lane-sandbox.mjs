/**
 * verify-lane-sandbox.mjs — lane 沙箱实现面的离线单测（sandcastle/templates/lane-sandbox.mts，#138）。
 *
 * 拍板口径（2026-10-20 grill Q1–Q9 + 2026-11-14 拍板留痕）：实现面全部**可静态验证**
 * （单元守卫/公式断言/探测函数）；run-ticket 全链端到端读数等 #147 收口后补——
 * 本文件就是那个"静态验证面"：探测顺序契约 / 资源公式 / 卷归属 / Q8 判定 / lane
 * provider 参数拼装，全部纯函数 + 注入 IO，不 spawn 真容器。
 *
 * 实测边界（如实，loud skip 口径）：
 *   - podman 分支的读数 fixture 来自本机实测（podman 6.1.4，machine list --format json
 *     的 Memory = 字符串字节数）；
 *   - docker/nerdctl 分支 = fixture 驱动（本机无 docker/nerdctl，真机读数未验证）；
 *   - lane provider 的容器 run 参数形态由 R13 钉住，真机挂载行为未验证。
 *
 * **非空洞扰动契约**：探测顺序（R1）、显式问题区分（R2）、公式（R4）、解析（R5）、
 * 归属自愈（R11）、Q8 判定（R12）、卷挂载/userns 参数（R13）若被摘掉/写死，对应断言必红。
 */
import {
  CONTAINER_RUNTIMES,
  DEFAULT_MIN_DISK_FREE_RATIO,
  SESSIONS_REL_DIR,
  capacityExpandHint,
  cliSpawnSpec,
  diskFreeRatio,
  diskSpaceProblem,
  effectiveLaneState,
  ensureLaneVolume,
  envArgsOf,
  formatLaneBindMount,
  laneCapacity,
  laneCapacityProblem,
  laneContainerTarget,
  laneVolumeMountArgs,
  laneVolumeName,
  laneVolumeChownArgs,
  laneRunArgs,
  listLanes,
  normalizeLaneName,
  ownershipPath,
  parseDockerMemTotal,
  parseNerdctlInfoMemory,
  parsePodmanMachineMemory,
  pollutionMessage,
  probeContainerRuntime,
  probeVmMemoryBytes,
  readOwnership,
  resolveLaneMount,
  runningLaneSet,
  runtimeStartHint,
  verifyRuntimeAlive,
  volumeCreateArgs,
  volumeInspectArgs,
  volumeRemoveArgs,
  worktreePollutionReport,
  writeOwnership,
} from '../sandcastle/templates/lane-sandbox.mts'
import { EXIT_STATUS } from '../sandcastle/templates/run-ticket.mts'
import { RETRO_STATUS_CLASSES, skipReason, statusForExit } from '../sandcastle/templates/night-run.mts'
import { join } from 'node:path'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const eq = (name, got, want) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a === b) ok(name, a)
  else bad(name, `got ${a} want ${b}`)
}
const truthy = (name, cond, detail = '') => (cond ? ok(name, detail) : bad(name, detail))

// 内存 IO 挂具（归属面用；不落盘）。键与入参统一斜杠归一（node:path join 在 win32
// 产反斜杠，与手写正斜杠键混用会假红——挂具内归一，测试语义不受平台影响）。
function memIo(files = {}) {
  const norm = (p) => String(p).replace(/[\\/]+/g, '/')
  const store = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  const io = {
    existsSync: (p) => {
      const k = norm(p).replace(/\/+$/, '')
      if (store.has(k)) return true
      return [...store.keys()].some((key) => key.startsWith(k + '/')) // 目录键（含子件的前缀）
    },
    readFileSync: (p) => {
      const k = norm(p)
      if (!store.has(k)) throw new Error('ENOENT ' + p)
      return store.get(k)
    },
    readdirSync: (p) => {
      const dir = norm(p).replace(/\/+$/, '') + '/'
      return [...store.keys()].filter((k) => k.startsWith(dir)).map((k) => k.slice(dir.length))
    },
    mkdirSync: () => {},
    writeFileSync: (p, data) => { store.set(norm(p), data) },
  }
  return { io, files: store }
}

// podman 6.1.4 本机实测 fixture（2026-11-14，`podman machine list --format json` 的
// 最小形态：Memory 是**字符串形态的字节数**，Default:false / Running:true）
const PODMAN_MACHINE_JSON = JSON.stringify([
  { Name: 'podman-machine-default', Default: false, Running: true, VMType: 'wsl', CPUs: 8, Memory: '2147483648', DiskSize: '107374182400' },
])

// ── R1：探测顺序契约（Q9=A 冻结：--runtime > DSH_CONTAINER_RUNTIME > PATH podman>docker>nerdctl）──
const PATH_BOTH = ['/opt/podman', '/opt/docker', '/opt/nerdctl']
// exists 判据 = basename 的 CLI 主名必须出现在**所在目录名**里（模拟「/opt/docker 目录
// 只装 docker 系 CLI」的真实 fs——否则 '/opt/docker/podman.exe' 之类拼装候选假命中，
// R1d/R1e 的运行时优先序断言会失真）。
const winExists = (p) => {
  const m = /(?:^|[/\\])([^/\\]+?)(\.exe|\.cmd|\.bat)?$/i.exec(p)
  if (m === null) return false
  const base = m[1]
  const dir = p.slice(0, p.length - m[0].length)
  return dir.toLowerCase().includes(base.toLowerCase())
}
{
  const r = probeContainerRuntime({ explicit: 'docker', env: { DSH_CONTAINER_RUNTIME: 'podman' }, platform: 'win32', pathEntries: PATH_BOTH, exists: winExists })
  eq('R1a. explicit 命中即用（--runtime docker > env）', [r.found, r.runtime, r.source], [true, 'docker', 'explicit'])
  const r2 = probeContainerRuntime({ explicit: undefined, env: { DSH_CONTAINER_RUNTIME: 'podman' }, platform: 'win32', pathEntries: ['/opt/podman', '/opt/docker'], exists: winExists })
  eq('R1b. env > PATH（env 指定 podman，PATH 上同时有 docker——优先序钉住）', [r2.found, r2.runtime, r2.source], [true, 'podman', 'env'])
  const r2b = probeContainerRuntime({ explicit: undefined, env: { DSH_CONTAINER_RUNTIME: 'podman' }, platform: 'win32', pathEntries: ['/opt/docker'], exists: winExists })
  truthy('R1b2. env 指定但 CLI 缺席 → 响亮 explicitProblem（**不静默回落** PATH 上的 docker）',
    r2b.found === false && r2b.explicitProblem !== null && r2b.explicitProblem.includes('DSH_CONTAINER_RUNTIME'))
  const r3 = probeContainerRuntime({ explicit: undefined, env: {}, platform: 'win32', pathEntries: PATH_BOTH, exists: winExists })
  eq('R1c. PATH 内 podman > docker（首个命中即用）', [r3.found, r3.runtime, r3.source], [true, 'podman', 'path'])
  const r4 = probeContainerRuntime({ explicit: undefined, env: {}, platform: 'win32', pathEntries: ['/opt/docker', '/opt/nerdctl'], exists: winExists })
  eq('R1d. PATH 内 docker > nerdctl', [r4.found, r4.runtime, r4.source], [true, 'docker', 'path'])
  const r5 = probeContainerRuntime({ explicit: undefined, env: {}, platform: 'win32', pathEntries: ['/opt/nerdctl'], exists: winExists })
  eq('R1e. 只剩 nerdctl → nerdctl', [r5.found, r5.runtime, r5.source], [true, 'nerdctl', 'path'])
  const r6 = probeContainerRuntime({ explicit: undefined, env: {}, platform: 'win32', pathEntries: ['/empty'], exists: () => false })
  truthy('R1f. 全缺席 → found=false', r6.found === false && r6.explicitProblem === null)
  truthy('R1g. 全缺席的 detail 逐条说明三个 runtime 的落空', r6.detail.filter((d) => d.includes('没有 ')).length === CONTAINER_RUNTIMES.length, r6.detail.join(' | '))
}

// ── R2：显式给错（操作者错误）≠ 环境缺席——文案必须分开（runtime-probe 同口径）──
{
  const r1 = probeContainerRuntime({ explicit: 'qemu', env: {}, platform: 'linux', pathEntries: [], exists: () => false })
  truthy('R2a. --runtime 未知名 → explicitProblem 响亮（不是 missing）', r1.found === false && r1.explicitProblem !== null && r1.explicitProblem.includes('--runtime'))
  const r2 = probeContainerRuntime({ explicit: 'podman', env: {}, platform: 'win32', pathEntries: ['/empty'], exists: () => false })
  truthy('R2b. --runtime podman 但 PATH 无 podman → explicitProblem（按候选名找遍 PATH）', r2.explicitProblem !== null && r2.explicitProblem.includes('podman.exe'))
  const r3 = probeContainerRuntime({ explicit: undefined, env: {}, platform: 'win32', pathEntries: ['/empty'], exists: () => false })
  truthy('R2c. 环境缺席 → explicitProblem=null（调用侧给 install hint）', r3.explicitProblem === null)
  const r4 = probeContainerRuntime({ explicit: undefined, env: { DSH_CONTAINER_RUNTIME: 'qemu' }, platform: 'linux', pathEntries: [], exists: () => false })
  truthy('R2d. env 未知名 → 同样 explicitProblem', r4.explicitProblem !== null && r4.explicitProblem.includes('DSH_CONTAINER_RUNTIME'))
}

// ── R3：alive 真跑验证 + 按运行时分支的启动提示（特有动作只提示、不自动执行）──
{
  const okRun = verifyRuntimeAlive({ runtime: 'podman', path: '/x/podman', exec: () => ({ status: 0, stdout: '', stderr: '' }) })
  eq('R3a. info exit 0 → ok', okRun.ok, true)
  const badRun = verifyRuntimeAlive({ runtime: 'podman', path: '/x/podman', exec: () => ({ status: 125, stdout: '', stderr: 'machine not running' }) })
  truthy('R3b. podman 失败 → hint 提 machine start（不自动执行）', badRun.ok === false && badRun.hint.includes('podman machine start') && badRun.hint.includes('不代跑'))
  const d = verifyRuntimeAlive({ runtime: 'docker', path: '/x/docker', exec: () => ({ status: 1, stdout: '', stderr: '' }) })
  truthy('R3c. docker 分支 hint 提 Docker Desktop', d.ok === false && d.hint.includes('Docker Desktop'))
  const n = verifyRuntimeAlive({ runtime: 'nerdctl', path: '/x/nerdctl', exec: () => ({ status: 1, stdout: '', stderr: '' }) })
  truthy('R3d. nerdctl 分支 hint 提 containerd', n.ok === false && n.hint.includes('containerd'))
  truthy('R3e. 三分支 hint 互不相同（分支文案真分支了）',
    runtimeStartHint('podman') !== runtimeStartHint('docker') && runtimeStartHint('docker') !== runtimeStartHint('nerdctl'))
  // 读数命令断言：info 真跑传的是 [cli, info]（探测用诊断命令，非动作）
  let called = null
  verifyRuntimeAlive({ runtime: 'podman', path: '/x/podman.exe', exec: (cmd, args) => { called = [cmd, ...args]; return { status: 0, stdout: '', stderr: '' } } })
  eq('R3f. alive 探针 = <cli> info', called, ['/x/podman.exe', 'info'])
}

// ── R4：资源公式（Q4=A / Q5=C：下限 1.5 GiB、floor、超限响亮）──────────────────
{
  eq('R4a. 2 GiB machine → 1 lane（本机实测形态）', laneCapacity(2147483648), 1)
  eq('R4b. 4 GiB → 2', laneCapacity(4 * 1024 ** 3), 2)
  eq('R4c. 1.5 GiB → 1（下限本身够一个 lane）', laneCapacity(Math.round(1.5 * 1024 ** 3)), 1)
  eq('R4d. 1.49 GiB → 0（不足下限）', laneCapacity(Math.round(1.49 * 1024 ** 3)), 0)
  const hit = laneCapacityProblem({ requestedLanes: 3, vmRamBytes: 2147483648, runtime: 'podman' })
  truthy('R4e. 请求 3 > capacity 1 → 响亮 problem（含公式读数）', hit !== undefined && hit.problem.includes('3') && hit.problem.includes('1.5 GiB'))
  truthy('R4f. podman 扩容指令 = machine set --memory（不自动执行）', hit.hint.includes('podman machine set --memory') && hit.hint.includes('不自动执行'))
  truthy('R4g. docker 扩容指令走 Desktop 设置面', capacityExpandHint('docker', 3).includes('Docker Desktop'))
  truthy('R4h. nerdctl 扩容指令指向 containerd 宿主', capacityExpandHint('nerdctl', 3).includes('containerd'))
  eq('R4i. 请求 ≤ capacity → undefined（放行）', laneCapacityProblem({ requestedLanes: 1, vmRamBytes: 2147483648, runtime: 'podman' }), undefined)
}

// ── R5：VM 内存解析（podman fixture 本机实测；docker/nerdctl fixture 驱动）──────
{
  eq('R5a. podman json Memory 字符串字节数（实测形态）', parsePodmanMachineMemory(PODMAN_MACHINE_JSON), 2147483648)
  eq('R5b. Running:false 不计入', parsePodmanMachineMemory(JSON.stringify([{ Running: false, Memory: '9999999999' }])), 0)
  eq('R5c. 多 Running 取最大', parsePodmanMachineMemory(JSON.stringify([{ Running: true, Memory: '2147483648' }, { Running: true, Memory: '4294967296' }])), 4294967296)
  eq('R5d. 人类可读 "2 GiB" 形态兼容', parsePodmanMachineMemory(JSON.stringify([{ Running: true, Memory: '2 GiB' }])), 2147483648)
  eq('R5e. 坏 JSON → 0（调用侧按 0 响亮，不猜默认值）', parsePodmanMachineMemory('not json'), 0)
  eq('R5f. docker MemTotal 字节串', parseDockerMemTotal('2147483648\n'), 2147483648)
  truthy('R5g. nerdctl Total Memory 人类可读（fixture 形态）', Math.abs(parseNerdctlInfoMemory('Total Memory: 1.562 GiB') - Math.round(1.562 * 1024 ** 3)) < 1024)
}

// ── R6：probeVmMemoryBytes 分支（假 exec；读数命令形态断言）─────────────────────
{
  let seen = null
  const r1 = probeVmMemoryBytes({ runtime: 'podman', path: '/x/podman.exe', exec: (c, a) => { seen = [c, ...a]; return { status: 0, stdout: PODMAN_MACHINE_JSON, stderr: '' } } })
  eq('R6a. podman 分支调 machine list --format json（读数非动作）', seen, ['/x/podman.exe', 'machine', 'list', '--format', 'json'])
  eq('R6b. 读数返回 bytes + how', [r1.ok, r1.bytes], [true, 2147483648])
  const r2 = probeVmMemoryBytes({ runtime: 'docker', path: '/x/docker', exec: (c, a) => { seen = [c, ...a]; return { status: 0, stdout: '8589934592', stderr: '' } } })
  eq('R6c. docker 分支调 info --format MemTotal', seen, ['/x/docker', 'info', '--format', '{{.MemTotal}}'])
  eq('R6d. docker 读数', [r2.ok, r2.bytes], [true, 8589934592])
  const r3 = probeVmMemoryBytes({ runtime: 'podman', path: '/x/podman', exec: () => ({ status: 1, stdout: '', stderr: '' }) })
  truthy('R6e. 读数失败 → ok:false + 分支 hint（不猜默认值）', r3.ok === false && r3.hint.includes('podman machine start'))
  const r4 = probeVmMemoryBytes({ runtime: 'podman', path: '/x/podman', exec: () => ({ status: 0, stdout: '[]', stderr: '' }) })
  truthy('R6f. 读数为 0（无 Running machine）→ ok:false', r4.ok === false)
}

// ── R7：磁盘口径（Q7=C：宿主空闲**比例**，不写死 GiB）──────────────────────────
{
  eq('R7a. ratio 0.5', diskFreeRatio(50, 100), 0.5)
  eq('R7b. 阈值默认 0.1', DEFAULT_MIN_DISK_FREE_RATIO, 0.1)
  const gb = 1024 ** 3
  truthy('R7c. 比例口径：200 GB / 2 TB = 9.77% < 10% → 红（同样 200 GB / 512 GB = 39% → 过——比例不是绝对值）',
    diskSpaceProblem(200 * gb, 2 * 1024 * gb, 0.1) !== undefined && diskSpaceProblem(200 * gb, 512 * gb, 0.1) === undefined)
  truthy('R7d. 不足时报比例读数', diskSpaceProblem(10 * gb, 512 * gb, 0.1).includes('%'))
  eq('R7e. total 0 → ratio 0（防御）', diskFreeRatio(10, 0), 0)
}

// ── R8：lane 名 / 卷名 / 卷操作（Q9=A：volume 在 run/build/volume 公共子集内）────
{
  eq('R8a. lane 名规范化（空格/大写）', normalizeLaneName('Lane A'), 'lane-a')
  eq('R8b. 非法段转 -（连续非法段合一）', normalizeLaneName('Ticket/138 (impl)'), 'ticket-138-impl')
  eq('R8c. 卷名 = dsh-lane-<norm>', laneVolumeName('lane-a'), 'dsh-lane-lane-a')
  let threw = false
  try { normalizeLaneName('---') } catch (e) { threw = String(e.message).includes('lane 名规范化后为空') }
  truthy('R8d. 全规范化后为空 → 响亮 throw', threw)
  eq('R8e. volume inspect args（公共子集）', volumeInspectArgs('dsh-lane-x'), ['volume', 'inspect', 'dsh-lane-x'])
  eq('R8f. volume create args', volumeCreateArgs('dsh-lane-x'), ['volume', 'create', 'dsh-lane-x'])
  eq('R8g. volume rm args', volumeRemoveArgs('dsh-lane-x'), ['volume', 'rm', '-f', 'dsh-lane-x'])
  eq('R8h. named volume 直通挂载形态（首段非绝对路径 = 卷名）', laneVolumeMountArgs('dsh-lane-x', '/home/agent/workspace/node_modules'), ['-v', 'dsh-lane-x:/home/agent/workspace/node_modules'])
}

// ── R9：ensureLaneVolume 幂等（假 exec；inspect 非 0 才 create）─────────────────
{
  const log = []
  const exec = (c, a) => { log.push([c, ...a]); return { status: 0, stdout: '', stderr: '' } }
  eq('R9a. 卷已在场 → 不 create（幂等：lane 重跑续用）', ensureLaneVolume({ path: '/x/podman', volume: 'v', exec }), undefined)
  eq('R9b. 只走了 inspect', log.length, 1)
  const log2 = []
  let phase = 0
  const exec2 = (c, a) => {
    log2.push([c, ...a])
    phase += 1
    return { status: phase === 1 ? 1 : 0, stdout: '', stderr: '' } // inspect 失败 → create 成功
  }
  eq('R9c. inspect 失败 → create', ensureLaneVolume({ path: '/x/podman', volume: 'v', exec: exec2 }), undefined)
  eq('R9d. 先 inspect 后 create', log2.map((a) => a[1]), ['volume', 'volume'])
  const fail = ensureLaneVolume({ path: '/x/podman', volume: 'v', exec: () => ({ status: 125, stdout: '', stderr: 'storage full' }) })
  truthy('R9e. create 失败 → 响亮 problem 串', typeof fail === 'string' && fail.includes('建卷失败') && fail.includes('storage full'))
}

// ── R10：归属面（grill 原文：.scratch/sessions/ 每 lane 一个归属文件）────────────
{
  eq('R10a. 归属目录（git 忽略区）', SESSIONS_REL_DIR, '.scratch/sessions')
  eq('R10b. 归属路径（node:path join 形态，win32 反斜杠）', ownershipPath('.scratch/sessions', 'lane-a'), join('.scratch/sessions', 'lane-a.json'))
  const { io, files } = memIo()
  const rec = writeOwnership('.scratch/sessions', 'lane-a', {
    lane: 'lane-a', volume: 'dsh-lane-lane-a', runtime: 'podman', state: 'running',
    pid: 4242, ticket: 449, vmRamBytes: 2147483648, capacity: 1, createdAt: '2026-11-14T00:00:00.000Z',
  }, io)
  truthy('R10c. write→read roundtrip（updatedAt 自动补）', readOwnership('.scratch/sessions', 'lane-a', io).pid === 4242 && typeof rec.updatedAt === 'string')
  files.set('.scratch/sessions/broken.json', '{oops')
  let threw = false
  try { listLanes('.scratch/sessions', io) } catch (e) { threw = String(e.message).includes('归属文件损坏') && String(e.message).includes('删除') }
  truthy('R10d. 坏归属文件 → 响亮 throw（D47：状态面损坏要人处理，不静默当无归属）', threw)
  files.delete('.scratch/sessions/broken.json')
  files.set('.scratch/sessions/lane-b.json', JSON.stringify({ lane: 'lane-b', volume: 'dsh-lane-lane-b', state: 'idle', createdAt: '2026-11-14T00:00:00.000Z' }))
  eq('R10e. listLanes 列在场 lane', listLanes('.scratch/sessions', io).slice().sort(), ['lane-a', 'lane-b'])
}

// ── R11：running 判定与 pid 自愈（崩溃残留不占并行坑）───────────────────────────
{
  const rec = (pid, state) => ({ lane: 'l', volume: 'v', runtime: 'podman', state, pid, createdAt: 'x' })
  eq('R11a. running + 活 pid → running', effectiveLaneState(rec(4242, 'running'), () => true), 'running')
  eq('R11b. running + 死 pid → idle（自愈）', effectiveLaneState(rec(4242, 'running'), () => false), 'idle')
  eq('R11c. running 无 pid → 原样（声明可信任面收窄）', effectiveLaneState({ ...rec(4242, 'running'), pid: undefined }, () => false), 'running')
  eq('R11d. idle + 死 pid → idle', effectiveLaneState(rec(4242, 'idle'), () => false), 'idle')
  const { io, files } = memIo()
  files.set('.scratch/sessions/other.json', JSON.stringify({ ...rec(9999, 'running'), lane: 'other' }))
  files.set('.scratch/sessions/self.json', JSON.stringify({ ...rec(process.pid, 'running'), lane: 'self' }))
  files.set('.scratch/sessions/dead.json', JSON.stringify({ ...rec(1, 'running'), lane: 'dead' })) // pid 1 非 node 进程 → alive=false
  eq('R11e. runningLaneSet：排除自身 pid；死 pid 自愈不计；活 pid 的他人计入',
    [...runningLaneSet('.scratch/sessions', io, (pid) => pid === 9999, process.pid)].sort(), ['other'])
}

// ── R12：Q8 验收判据（沙箱跑完 git status --porcelain 为空）────────────────────
{
  eq('R12a. 空输出 → clean', worktreePollutionReport(''), { clean: true })
  eq('R12b. 纯空白 → clean', worktreePollutionReport('\n\n'), { clean: true })
  const dirty = worktreePollutionReport('?? build/out.txt\n M src/a.js\n')
  truthy('R12c. 非空 → 污染明细逐行', dirty.clean === false && dirty.lines.join('|') === '?? build/out.txt| M src/a.js')
  truthy('R12d. message 含判据语义与明细', pollutionMessage(['?? build/out.txt']).includes('Q8') && pollutionMessage(['?? build/out.txt']).includes('build/out.txt'))
}

// ── R13：lane provider 参数拼装（named volume 直通 + podman userns；形态钉死）───
{
  const base = {
    cliPath: '/x/podman.exe', runtime: 'podman', imageName: 'localhost/repo:dsh', lane: 'lane-a',
    volumeName: 'dsh-lane-lane-a', containerTargetSegment: 'node_modules',
    userMounts: [{ hostPath: 'C:/h/.dsh', sandboxPath: '/host-dsh', readonly: true }],
    credentialEnv: { DEEPSEEK_API_KEY: 'sk-x' },
  }
  const mounts = [{ hostPath: 'C:/w', sandboxPath: '/home/agent/workspace' }]
  // 复审 F3：绝对挂载点由**现算的** worktree 容器内路径派生（不吃调用方硬编码绝对路径）
  eq('R13k. 卷挂载点派生（worktree 段拼接）', laneContainerTarget('/home/agent/workspace', 'node_modules'), '/home/agent/workspace/node_modules')
  eq('R13l. 派生剥离 worktree 尾斜杠、段尾斜杠', laneContainerTarget('/home/agent/workspace/', '/node_modules/'), '/home/agent/workspace/node_modules')
  let threw = false
  try { laneContainerTarget('/w', '///') } catch (e) { threw = String(e.message).includes('挂载段为空') }
  truthy('R13m. 挂载段剥斜杠后为空 → 响亮 throw（不静默挂卷根）', threw)
  const runArgs = laneRunArgs(base, mounts, 'sandcastle-lane-lane-a-ab12', '/home/agent/workspace', laneContainerTarget('/home/agent/workspace', base.containerTargetSegment))
  eq('R13a. run 头（-d --name --user）', runArgs.slice(0, 6), ['run', '-d', '--name', 'sandcastle-lane-lane-a-ab12', '--user', '1000:1000'])
  truthy('R13b. podman 独有 --userns=keep-id:uid=1000,gid=1000', runArgs.includes('--userns=keep-id:uid=1000,gid=1000'))
  truthy('R13c. -w worktree', runArgs.includes('-w') && runArgs[runArgs.indexOf('-w') + 1] === '/home/agent/workspace')
  truthy('R13d. 凭据 launch 期 -e 注入（#145 同形态）', runArgs.includes('-e') && runArgs[runArgs.indexOf('-e') + 1] === 'DEEPSEEK_API_KEY=sk-x')
  truthy('R13e. 框架 worktree bind-mount 照传', runArgs.includes('-v') && runArgs.includes('C:/w:/home/agent/workspace'))
  truthy('R13f. 宿主 ~/.dsh 只读挂载（ro 后缀）', runArgs.includes('C:/h/.dsh:/host-dsh:ro'))
  truthy('R13g. lane 卷直通挂载（named volume 形态）', runArgs.includes('dsh-lane-lane-a:/home/agent/workspace/node_modules'))
  eq('R13h. 尾（--entrypoint sleep <image> infinity）', runArgs.slice(-4), ['--entrypoint', 'sleep', 'localhost/repo:dsh', 'infinity'])
  const dockerArgs = laneRunArgs({ ...base, runtime: 'docker' }, mounts, 'c1', '/home/agent/workspace', '/home/agent/workspace/node_modules')
  truthy('R13i. docker 无 --userns（podman 特有形态不越运行时）', !dockerArgs.includes('--userns=keep-id:uid=1000,gid=1000'))
  eq('R13j. 卷根权限初始化（容器内 root chown；失败不阻断）',
    laneVolumeChownArgs('c1', '/t', 1000, 1000), ['exec', '--user', '0:0', 'c1', 'sh', '-c', 'chown 1000:1000 "$1" 2>/dev/null || true', 'sh', '/t'])
}

// ── R14：spawn 形态（win32 .cmd 包 cmd.exe /c；.exe/POSIX 直通）─────────────────
{
  const spec = cliSpawnSpec('C:/x/podman.cmd')
  truthy('R14a. win32 .cmd → ComSpec /c 包装', spec.prefix[0] === '/c' && spec.prefix[1] === 'C:/x/podman.cmd' && /cmd\.exe$/i.test(spec.cmd))
  eq('R14b. .exe 直通', cliSpawnSpec('C:/x/podman.exe'), { cmd: 'C:/x/podman.exe', prefix: [] })
  eq('R14c. POSIX 裸名直通', cliSpawnSpec('/usr/bin/podman'), { cmd: '/usr/bin/podman', prefix: [] })
}

// ── R15：env/bind-mount/挂载校验小件 ────────────────────────────────────────────
{
  eq('R15a. envArgsOf', envArgsOf({ A: '1' }), ['-e', 'A=1'])
  eq('R15b. formatLaneBindMount 默认 rw', formatLaneBindMount({ hostPath: 'h', sandboxPath: 'c' }), 'h:c')
  eq('R15c. formatLaneBindMount ro', formatLaneBindMount({ hostPath: 'h', sandboxPath: 'c', readonly: true }), 'h:c:ro')
  const resolved = resolveLaneMount({ hostPath: '~/x', sandboxPath: '/s' }, { existsSync: (p) => !p.startsWith('~'), isDirectory: () => true })
  truthy('R15d. 目录挂载解析：~ 展开 + sandboxPath 保留', resolved.sandboxPath === '/s' && !resolved.hostPath.startsWith('~'))
  let threw = false
  try { resolveLaneMount({ hostPath: '/nope', sandboxPath: '/s' }, { existsSync: () => false, isDirectory: () => false }) } catch (e) { threw = String(e.message).includes('不存在') }
  truthy('R15e. hostPath 缺席 → 响亮 throw', threw)
}

// ── R16：EXIT_STATUS / night-run 消费同步（单一事实源跨文件）────────────────────
{
  eq('R16a. LANE_GATE=8 / POLLUTION=9（run-ticket 单一事实源）', [EXIT_STATUS.LANE_GATE, EXIT_STATUS.POLLUTION], [8, 9])
  eq('R16b. statusForExit 映射', [statusForExit(8), statusForExit(9)], ['lane-gate', 'parked-pollution'])
  truthy('R16c. RETRO 素材含 parked-pollution（降级）', RETRO_STATUS_CLASSES.some((c) => c.status === 'parked-pollution'))
  truthy('R16d. lane-gate 不进 RETRO 素材（环境拒绝非降级）', !RETRO_STATUS_CLASSES.some((c) => c.status === 'lane-gate'))
  truthy('R16e. parked-empty 等既有档零改动（非 lane 行为回归面）', statusForExit(6) === 'parked-empty' && statusForExit(7) === 'needs-simplify' && statusForExit(3) === 'parked-verify')
  // 复审 F4：parked-pollution 与其他 parked 同族——未返工重跑只会再污染，幂等跳过
  truthy('R16f. skipReason 对 parked-pollution 给跳过说明（未返工不重发）', typeof skipReason('parked-pollution') === 'string' && skipReason('parked-pollution').includes('污染'))
  truthy('R16g. skipReason 既有档零改动', skipReason('merged') !== undefined && skipReason('parked-verify') !== undefined && skipReason('running') === undefined)
}

// ── R17：handle.exec fail-closed（复审 F1）——close(null)（信号杀/没跑完）≠ exit 0 ──
// 官方 0.12.0 podman provider 为 `code ?? 0`；本实现有意改 `code ?? 1`（exec 是验证门/
// Q8 判据承载面，null→0 会把「没跑完」读成「通过」传导 fail-open）。mock spawn 直驱。
{
  const { EventEmitter } = await import('node:events')
  const { makeLaneCliProvider } = await import('../sandcastle/templates/lane-sandbox.mts')
  const baseOpts = {
    cliPath: '/x/podman.exe', runtime: 'podman', imageName: 'img', lane: 'lane-a',
    volumeName: 'v', containerTargetSegment: 'node_modules', credentialEnv: {},
  }
  function makeHandle(closeCode, useOnLine = false) {
    let factory = null // makeLaneCliProvider 的返回（bind-mount provider 工厂面）
    let handle = null
    factory = makeLaneCliProvider({
      createBindMountSandboxProvider: (config) => config, // 捕获 config：create 由测试直驱
      spawn: () => {
        const p = new EventEmitter()
        p.stdout = new EventEmitter()
        p.stderr = new EventEmitter()
        p.stdin = { write: () => {}, end: () => {} }
        queueMicrotask(() => p.emit('close', closeCode))
        return p
      },
      execFile: (cmd, args, cb) => queueMicrotask(() => cb(null)),
      execFileSync: () => {},
      createInterface: () => ({ on: () => {} }),
      randomUUID: () => 'ab12cd34',
      statSync: () => ({ isFile: () => false }),
    }, baseOpts)
    factory.create({ worktreePath: 'w', hostRepoPath: 'h', mounts: [{ hostPath: 'w', sandboxPath: '/home/agent/workspace' }], env: {} })
      .then((h) => { handle = h })
    // create 的内部 promise 都在微任务里 resolve——轮询等 handle 就绪
    return new Promise((resolve) => {
      const tick = () => (handle ? resolve(handle) : setTimeout(tick, 0))
      tick()
    })
  }
  const h1 = await makeHandle(null)
  const r1 = await h1.exec('true')
  eq('R17a. exec close(null) → exitCode 1（fail-closed，有意偏离官方 ?? 0）', r1.exitCode, 1)
  const h2 = await makeHandle(0)
  const r2 = await h2.exec('true')
  eq('R17b. exec close(0) → exitCode 0', r2.exitCode, 0)
  const h3 = await makeHandle(null, true)
  const r3 = await h3.exec('true', { onLine: () => {} })
  eq('R17c. onLine 流式分支 close(null) → exitCode 1（同 fail-closed）', r3.exitCode, 1)
}

// ── R18：userMounts 校验语义（复审 F6）——文件挂载报「只支持目录」，缺席报「不存在」──
{
  const { makeLaneCliProvider } = await import('../sandcastle/templates/lane-sandbox.mts')
  const opts = { cliPath: '/x/podman.exe', runtime: 'podman', imageName: 'img', lane: 'lane-a', volumeName: 'v', containerTargetSegment: 'node_modules' }
  const depsBase = {
    createBindMountSandboxProvider: (config) => config,
    spawn: () => { throw new Error('should not spawn') },
    execFile: (cmd, args, cb) => queueMicrotask(() => cb(null)),
    execFileSync: () => {},
    createInterface: () => ({ on: () => {} }),
    randomUUID: () => 'ab12cd34',
  }
  const createWith = (statSyncImpl, userMounts) => makeLaneCliProvider({ ...depsBase, statSync: statSyncImpl }, { ...opts, userMounts })
    .create({ worktreePath: 'w', hostRepoPath: 'h', mounts: [{ hostPath: 'w', sandboxPath: '/home/agent/workspace' }], env: {} })
  const fileErr = await createWith(() => ({ isFile: () => true }), [{ hostPath: '/some/file', sandboxPath: '/s' }]).then(() => null, (e) => String(e.message))
  truthy('R18a. 文件挂载 → 「只支持目录」（不是「不存在」冒名）', fileErr !== null && fileErr.includes('只支持目录'))
  const missErr = await createWith(() => { throw new Error('ENOENT') }, [{ hostPath: '/nope', sandboxPath: '/s' }]).then(() => null, (e) => String(e.message))
  truthy('R18b. 缺席挂载 → 「hostPath 不存在」', missErr !== null && missErr.includes('不存在'))
  const dirOk = await createWith(() => ({ isFile: () => false }), [{ hostPath: '/some/dir', sandboxPath: '/s' }])
  eq('R18c. 目录挂载通过（handle 就绪）', typeof dirOk.exec, 'function')
}

console.log('\n=== LANE SANDBOX VERIFY (offline, pure) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)
