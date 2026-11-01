/**
 * handoff-tool — the model-facing handoff executor for the matt preset.
 *
 * Closes Matt's phase-boundary gap: `/handoff` is a session-level move the
 * agent cannot perform alone, because it cannot switch the main session. This
 * tool does everything up to the switch and then hands the baton back to the
 * human:
 *
 *   1. writes the portable handoff markdown to the OS temp dir (the artifact
 *      that travels — a new harness, a new directory, a colleague),
 *   2. spawns the child session joined to THIS preset: a FRESH session with
 *      ZERO inherited history (default, mode 'fresh') — the handoff document
 *      alone carries the context across the boundary (O6: forking a long
 *      session resurrects the whole compacted history; fresh + document is
 *      the correct handoff shape). mode 'fork' remains for the narrow case
 *      of continuing the SAME ticket mid-work when the window ran out,
 *   3. feeds the document to the child as its FIRST USER PROMPT — the child's
 *      first turn starts immediately via `agent.followup()` (the same
 *      admission path the prompt RPC uses), so the child becomes a real,
 *      sidebar-visible session on its own and starts working the handoff
 *      right away,
 *   4. returns the file path + child session id; the agent must then STOP and
 *      tell the human to switch in the sidebar.
 *
 * The child is created through the documented programmatic factory
 * `ctx.agents.create()` with the `setup(agentCtx)` hook mounting THIS preset,
 * meta carrying lineage (parentSession, seedLength) and cwd, and `seed` (when
 * forking) a balanced completed-turn prefix of the parent's log. `origin` is
 * deliberately NOT set: the child is a top-level session for the human, not a
 * subagent. The message is hand-rolled to the UserMessage shape instead of
 * importing `createUserMessage` from `@deepseek-ai/dsh-llm`, because preset
 * plugins resolve bare packages from the user home, not the deployment.
 *
 * This plugin CONSUMES host services only and publishes nothing, so it needs
 * no isolate realm.
 *
 * #168 模板防呆（合取形态）：「环境快照」节与「产物清单」节由 tool 机械保证——
 * 快照 = 生成时 git 探针实值（HEAD / 分支 / status 短读数，探针失败写响亮标记，
 * 不留空壳）；产物清单 = 有声明才生成整节，sha256 由 tool 对声明 path 现算，
 * 占位行字面从产出物绝迹。拼装面抽成可导入的 `assembleHandoffDocument`（守卫
 * tests/verify-handoff-tool.mjs 与 #172 的 tracker 回读面都落在它上面）。
 *
 * #172 item1（tracker 单源回读）：定向节凭据为票号（`凭据：#<票号>`）时，tool 在拼装前
 * 经 `gh issue view` 回读票面实值（标题/状态/标签/URL）生成「票面回读」节（#144 起触发
 * 面扩为凭据行**或**定向节第一个 #<n> 引用，见下方 #144 段）——定向节里经
 * 转抄的票面字段（标签笔误 / 计数漂移 / 哈希软化，IRIS #1539/#1546/#1532）从此有机械
 * 判据裁定：与本节不符以本节为准。回读失败写「回读失败：<原因>」响亮标记，不静默降级为
 * 转抄值；票面正文内的计数/哈希等生成后仍会漂移的字段，节内显式标「生成后漂移，子会话
 * 以实读为准」。gh 回读器的 env 经 `readerEnv` 过滤（剥 GIT_* 与 GH_REPO，#110 同族——
 * 复审①：GH_REPO 命中时是静默读到别的 tracker 的同号票并顶着机械背书，不是回读失败）。
 * 守卫：tests/verify-handoff-tool.mjs T9 族（注入 reader，不打真网；T9d 钉 readerEnv
 * 过滤面与源码消费锚——真 execFile 的 env 子进程传递不在守卫断言面，显式声明）+
 * tests/verify.mjs Track A（真挂具，成功/失败两态都响亮断言）。
 *
 * #144 调用前防呆（IRIS 2026-10-11 同票重复 handoff 的兜底，#45 AC③）：在既有 tri-state
 * （#44，只覆盖「首 turn 未起」）之上追加「调用前」判定——现有实现完全不看交接文档指向
 * 哪张票、那张票是否已关，父会话主观认为失败而首 turn 实际起过时重复 handoff 顺畅通过
 * （IRIS 22:48 事故形态）。四件：
 *   ① 票号提取：优先凭据行（TICKET_CREDENTIAL_RE 的 `凭据：#<票号>`），退而在定向节扫
 *      第一个 `#<n>` 引用；都落空 =「票号提取不到」（unverified，不阻断）。
 *   ② 已关告警：回读 state=CLOSED → 结构化字段 `ticketClosed: <n>` + 文本告警（字段给
 *      机械断言，不只靠文本）。
 *   ③ 二次判定：同一会话对同一票第二次 handoff → 独立字段 `duplicateTicket: <n>`（与
 *      ticketClosed 两个独立信号，可同时在场）；会话内记录即可（WeakMap 挂 session）。
 *   ④ 未核降级：gh 不可用 / 票号提取不到 → 字段 `ticketCheckUnverified` + 文本「未核」，
 *      不阻断也不静默（verify-all loud-skip 口径）。
 * 另落票面 2026-10-20 并入条：attachToWorkspace 失败从只进日志提升为模型可见——
 * `sidebarAttached: false` + `sidebarAttachReason`（no-workspace / attach-error）+ 文本
 * 「子会话可能不出现在侧边栏，别据此重发」（IRIS 事故的直接成因面）。
 * 判定落点 = 拼装面（buildTicketSection 已持回读结果，与 #172 回读共用一次读取，不双读），
 * 信号经 `ticketGuardSignals` 收集器带出，`ticketGuardFields`/`ticketGuardTextLines`
 * 映射为返回字段与文本（守卫断言同一映射）；守卫 tests/verify-handoff-tool.mjs
 * T10–T14（注入 reader / 记忆探针 / fake ctx，不打真网不建子会话），执行面接线由
 * T15 源码消费锚钉住（真挂具 Track A 未扩，显式声明）。
 */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'handoff-tool'

/** The tool registry, the AgentFactory registry, and the preset roster. */
export const inject = ['tools', 'agents', 'agentPresets']

const MODES = ['fork', 'fresh']

// #162/D52 定向凭据格式正典（单点定义）：凭据行判别正则 + 两种格式字面。
// 下方错误信息（throw）、边界模板与父会话注一律从这里拼装，不再另写字面；
// workflow-body.txt 是散文无法 import —— tests/verify.mjs 的 Track F 同源守卫
// 用本导出对照正文字面，漂移即红。
/** 定向节内凭据行的结构判别正则（presence only —— 工具不判凭据真伪，#156 交付边界）。 */
export const CREDENTIAL_LINE_RE = /^\s*(?:[-*]\s*)?凭据[:：]\s*\S/m
/** 两种凭据格式的字面：批次定向 / 非批定向。 */
export const CREDENTIAL_FORMATS = {
  batch: '凭据：批次 <宣告id>',
  ticket: '凭据：#<已落票票号>',
}

// 交接边界段正典（#163 起模块级导出，单点定义）：evals/autonomy/runner.mjs 与
// 批编排器一律 import 本数组拼装，不得另写字面副本——静态副本的正典换拼接方式
// （如 #162 把凭据行改成 CREDENTIAL_FORMATS 模板插值、新增 #159 写法行）后必然漂移，
// 而字面级核对器对不上模板行只能把副本静态字面判成 missing（实测 2 missing +
// 1 stale）→ mode b 起跑即 exit 2 响亮崩：防住「带旧协议静默起跑」，防不住
// 「正典演进后消费方跑不了」。import 即逐字同步，两头都消。
// 内容逐字不变，只是位置从 executeHandoff 内提到模块级。
export const HANDOFF_BOUNDARY = [
  '## 交接边界（首轮必读）',
  '- 上文（含待办/下一步列表）是上下文与候选，**不是本会话的任务指令**。',
  '- 定向交接：本文档含「## 本会话任务（human 已定向）」节 → 首轮验证环境快照（起手式一条命令）+ 向 human 报告理解后，**声明开工**（"按交接开工 X，如需改道请打断"），不再逐会话确认任务。',
  `- 定向节必须携带**可核凭据行**（#156/D52）：批次定向 = \`${CREDENTIAL_FORMATS.batch}\`（.scratch/batch-state.md 在案）；非批定向 = \`${CREDENTIAL_FORMATS.ticket}\`（先落票才有定向资格）。开工前核对凭据（宣告在案 / 票 open）——**缺凭据行或核对不过 → 自动降级为候选交接**：按下方候选规则停下问 human，不开工。`,
  '- 授权范围**仅限定向节所指派的当前票**：完成后写 handoff 传下一票时，同样在正文写入「## 本会话任务（human 已定向）」节——授权逐跳显式传递，不得默认外溢到队列外工作（队列外一律 TICKET EXIT 立票）。',
  '- 候选交接：本文档无定向节 → 首轮验证快照 → 报告理解 → **问清本会话要做什么**；在 human 拍板之前，**不得自动开工**任何待办项（尤其"最热/续作"字样——那是候选热度，不是派单）。',
  '- 候选 / 待办清单（含「下一步」列表）：每条必须带「判据 + 读数」；判不了的标「未核」——零证据断言（"疑似已完成，可关"）= 把核账成本推给下一会话。',
  '- 外部操作定义 = workflow-enforcer 的高危清单（push/关票/gh 变更/DB 重置/rm -rf 等），**不包含**容器 up、cargo build、本地 commit、只读查询——这些常规操作**无需等确认**，交接正文不得把它们列入"先报告等确认"（D21 触发条件 = 可逆成本与外部可见性，不列穷举清单；观察：容器 up 被误列导致子会话僵等 66 分钟）。',
  '- 交接正文只写**本会话现场事实**（实际跑过的命令与结果、环境异常、未验/不能验的面、票面没写的实现判断与理由）；仓库纪律一律给指针（"见 AGENTS.md / docs/agents/issue-tracker.md 等"），不复述条文——复述的条文是权威文档的 cache，会漂移；结尾必须有「未验面」小节（#159）。',
  `<!-- 父会话注：仅当 human 已明确指定本会话任务时，在正文写入 "## 本会话任务（human 已定向）" 节，且节内必带凭据行（批次 = \`${CREDENTIAL_FORMATS.batch}\`；非批 = \`${CREDENTIAL_FORMATS.ticket}\`——#156/D52）；否则视为候选交接，子会话会问 human。范围认可 ≠ 派单：human 认可候选范围/愿意处理 ≠ 授权定向 handoff；未落票的候选（如 retro 候选）一律先 TICKET EXIT 立票，不得在交接里写成 "human 已定向"。 -->`,
]

// ── #168 模板防呆（合取形态）：快照节 / 产物清单节由 tool 机械保证 ────────────────
// 旧模板的两个空壳病灶：①「环境快照」节 = header + 注释 + 空值行——注释说"作者填值"，
// 但作者正文在快照**之前**拼装，这些行结构上永远填不进去，定向子会话的快照校验退化为
// 纯 hash 对比（git 起手式证据未随交接携带）；②「产物清单」节永远渲染，正文是占位行
// （`sha256:0000…`），靠注释指令「无产物 → 删除本节」让父会话手删——指令不执行时占位行
// 与「无冻结快照」的定向声明并存，首轮双读。#168 收敛为合取：快照值 = 生成时探针实值；
// 清单 = 有声明才生成整节、哈希现算；占位行字面从产出物绝迹。守卫 =
// tests/verify-handoff-tool.mjs（handoff-tool 首个守卫；扰动真红记录 .scratch/verify168/）。

const GIT_PROBE_TIMEOUT_MS = 10_000

/**
 * git 探针（只读子命令）。**必须 `git -C <dir>` 定位仓，且 env 剥掉全部 `GIT_*`**：
 * 本机 startup 脚本族会把子进程 cwd 静默复位（spawn 的 `cwd:` 选项失效，命令打到别的
 * 目录——tests/isolated-git.mjs #110 的同族通路），而继承的 GIT_DIR / GIT_INDEX_FILE
 * 会把探针指回别的仓（pre-commit 钩子上下文就带着这一族变量）。探针失败**不抛**：
 * 返回失败原因，由快照节写成「探针失败：<原因>」响亮标记（不留空壳）。
 */
function probeGit(args, dir) {
  const env = {}
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = process.env[key]
  }
  return new Promise((resolveProbe) => {
    // `--no-optional-locks`：探针纯读——不带它时 `git status` 会 opportunistic 刷新并**写**
    // `.git/index`（一次对用户仓的写副作用，还会与父会话并发的 git 操作抢锁）。开发期另
    // 观察到一次与 `ls-files` 相悖、随后自愈的暂态 staged/unstaged 读数（机制未定，疑似
    // racy-stat 窗口；读数留档 .scratch/verify168/probe-transient.md）——探针不写 index 至少
    // 消掉写侧竞态；快照本身是「生成时刻实况，不一致以实际为准」，子会话起手式会复核。
    execFile('git', ['--no-optional-locks', '-C', dir, ...args], { timeout: GIT_PROBE_TIMEOUT_MS, windowsHide: true, env }, (error, stdout, stderr) => {
      // child_process 回调成功时 error 是 null（不是 undefined）——判据必须两个都兜住
      if (error == null) return resolveProbe({ ok: true, out: stdout.trim() })
      const firstLine = String(stderr || error.message || error).trim().split('\n')[0]
      const reason = (error.killed && firstLine === ''
        ? `git 探针超时（${GIT_PROBE_TIMEOUT_MS}ms）`
        : firstLine === '' ? String(error.code ?? 'git 探针失败') : firstLine
      ).slice(0, 200)
      resolveProbe({ ok: false, reason })
    })
  })
}

/** `git status --porcelain` 短读数：按 XY 状态分组计数（子会话起手式重跑同名命令对照）。 */
function summarizeStatus(porcelain) {
  const lines = porcelain.split('\n').filter((l) => l.length >= 3)
  if (lines.length === 0) return 'clean（git status --porcelain 0 行）'
  const KINDS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange', U: 'unmerged' }
  const counts = new Map()
  const bump = (label) => counts.set(label, (counts.get(label) ?? 0) + 1)
  for (const line of lines) {
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') { bump('untracked'); continue }
    if (x === '!' && y === '!') { bump('ignored'); continue }
    if (x !== ' ') bump(`staged-${KINDS[x] ?? x}`)
    if (y !== ' ') bump(`unstaged-${KINDS[y] ?? y}`)
  }
  return `${lines.length} 行变更（git status --porcelain：${[...counts].map(([k, n]) => `${k}×${n}`).join(' · ')}）`
}

/** 环境快照节（#168）：每个值要么是探针实值、要么是「探针失败：<原因>」——零空壳。 */
async function buildSnapshotSection(cwd) {
  const [branch, head, status] = await Promise.all([
    probeGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    probeGit(['rev-parse', '--short', 'HEAD'], cwd),
    probeGit(['status', '--porcelain'], cwd),
  ])
  const branchHead = !branch.ok
    ? `探针失败：${branch.reason}`
    : !head.ok
      ? `探针失败：${head.reason}`
      : `${branch.out} @ ${head.out}`
  const worktree = status.ok ? summarizeStatus(status.out) : `探针失败：${status.reason}`
  return [
    '## 环境快照（起手式验证）',
    '<!-- 本节由 handoff_tool 生成时自动填 git 探针实值（#168：父会话不手填）；新会话起手式：git log/status 对照以下快照，不一致以实际为准 -->',
    `- 分支/HEAD: ${branchHead}`,
    `- 工作树: ${worktree}`,
  ].join('\n')
}

/**
 * 产物清单节（#168）：有声明才生成整节，无声明返回 ''（整节不出现在产出物里）。
 * sha256 由 tool 对声明 path 现算；path 读不到 / 是目录 → **响亮拒绝**（不生成子会话
 * 核不过的清单行——与其写一个假哈希占位，不如让父会话当场修 path）。
 */
async function buildManifestSection(artifacts, cwd) {
  if (artifacts === undefined) return ''
  if (!Array.isArray(artifacts)) {
    throw new Error(`产物清单参数 artifacts 必须是 path 字符串数组（#168 结构校验）——收到 ${typeof artifacts}。`)
  }
  const declared = []
  for (const entry of artifacts) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error('产物清单参数 artifacts 的每一项必须是非空 path 字符串（#168 结构校验）。')
    }
    const p = entry.trim()
    if (declared.includes(p)) continue // 重复声明幂等：同一文件只入清单一次
    // 行解析判据与 lib/autonomy-orchestration.mjs verifyManifest 同源：`<路径> sha256:<64位十六进制>`，
    // 路径段的排除集 = 空白/反引号/星号——含这些字符的 path 会造出机械校验器解析不了的清单行。
    if (/[\s`*]/.test(p)) {
      throw new Error(
        `产物路径 '${p}' 含空白/反引号/星号（#168 结构校验，响亮拒绝）——清单行按 \`<路径> sha256:<64位十六进制>\``
        + ' 解析（lib/autonomy-orchestration verifyManifest 同判据），这些字符会造出子会话校验器解析不了的行。',
      )
    }
    declared.push(p)
  }
  if (declared.length === 0) return ''
  const lines = []
  const seen = new Set()
  for (const p of declared) {
    // 归一化（#168 复审 F3）：清单行契约 = `<相对路径> sha256:<64位十六进制>`，由子会话 /
    // verifyManifest 按基准目录解析核验（lib/autonomy-orchestration.mjs verifyManifest:
    // `join(rootDir, rel)`——绝对路径 rel 会拼出坏路径 → actual=null 假失真，2026-10-31 实测）。
    // 声明路径先归一化为基准目录内相对路径；基准目录之外（跨盘 / `..` 前缀）响亮拒绝——
    // 与空白/反引号/星号同待遇：不生成校验器核不过的行。
    const abs = resolve(cwd, p)
    const rel = relative(cwd, abs).split(sep).join('/')
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(
        `产物路径 '${p}' 无法归一化为基准目录 ${cwd} 内的相对路径（#168 响亮拒绝）——`
        + '清单行契约 = `<相对路径> sha256:<64位十六进制>`，由子会话/verifyManifest 按基准目录解析核验'
        + '（lib/autonomy-orchestration verifyManifest: join(rootDir, rel)）；基准目录之外的文件不进清单。',
      )
    }
    if (seen.has(rel)) continue // 重复声明幂等（相对/绝对声明归一后同键）：同一文件只入清单一次
    seen.add(rel)
    let sha256
    try {
      const st = await stat(abs)
      if (st.isDirectory()) throw new Error('是目录，不是文件')
      sha256 = createHash('sha256').update(await readFile(abs)).digest('hex')
    } catch (error) {
      throw new Error(
        `产物清单现算哈希失败（#168 响亮拒绝——不生成子会话核不过的清单）：'${p}'（基准目录 ${cwd}）—— ${String(error?.message ?? error)}`,
      )
    }
    lines.push(`- \`${rel}\` sha256:${sha256}`)
  }
  return [
    '## 产物清单（子会话逐条机械校验）',
    '<!-- 每行格式：`<相对路径> sha256:<64位十六进制>`，哈希由 handoff_tool 对声明 path 现算、路径归一化为基准目录内相对路径（#168：占位行不再存在）。子会话开工前逐条校验存在性+哈希（sha256sum / Get-FileHash）；任一缺失或不符 → 报告并停下，不开工。 -->',
    ...lines,
  ].join('\n')
}

// ── #172 item1：tracker 单源回读（票面回读节）──────────────────────────────────
// 定向交接里经转抄的票面字段会与 tracker 漂移（标签笔误 / 计数漂移 / 哈希软化——
// IRIS #1539/#1546/#1532 三实锤）：转抄值此前没有任何机械判据可裁定，靠自由文本豁免。
// 本节让 tool 在拼装前自己读 tracker（gh issue view 一族，只读），转抄字段从此有单源。

/** 定向节凭据行的票号提取（非批定向 = `凭据：#<票号>`，#156/D52 的票号形态）。批次凭据
 *  （`凭据：批次 <宣告id>`）与凭据行缺失都不匹配 → 无 tracker 回读对象，整节缺席。
 *  模块内单点：提取行为由 tests/verify-handoff-tool.mjs T9（reader 调用观察）钉住，
 *  暂无第二消费者——等真消费者出现再导出（#172 复审④ 裁决：不预置 API 面）。 */
const TICKET_CREDENTIAL_RE = /凭据[:：]\s*#\s*(\d+)/

/**
 * #144 调用前防呆的票号提取：优先凭据行（`凭据：#<票号>`），退而在定向节扫**第一个**
 * `#<n>` 引用（票面：「优先取『本会话任务』节内出现的那个」）；都落空 → undefined =
 * 「票号提取不到」（unverified，不阻断）。提取范围只在定向节：批次凭据无单票对象，正文
 * 其他位置的票号引用（如「复用 #172 的机器」）不是交接目标，当目标会误告警。
 * `#\s*(\d+)` 的已知边界（#144 复审①）：数字开头的 markdown 标题会命中并按第一引用处理
 * （实测：`## 2026-11-01 计划` → "2026"、`### 144 相关链接` → "144"）；非数字开头的标题
 * （`## 本会话任务…`）不命中。误命中方向保守——告警不阻断，且凭据行在场时优先级更高。
 * #172 与 #144 共用本函数的同一个提取结果（buildTicketSection 一次读取既造回读节又出
 * 防呆信号，不双读）。
 */
function extractTicketNumber(directedSection) {
  const fromCredential = TICKET_CREDENTIAL_RE.exec(directedSection)?.[1]
  if (fromCredential !== undefined) return fromCredential
  return /#\s*(\d+)/.exec(directedSection)?.[1]
}

const GH_TICKET_TIMEOUT_MS = 10_000

/**
 * gh 回读器的 env 过滤（#110 同族纪律，与上方 git 探针剥 `GIT_*` 同一动机）：继承的
 * GIT_DIR / GIT_WORK_TREE 会把 gh 内部的 git remote 解析劫持到别的仓，GH_REPO 会**静默**
 * 覆盖 gh 沿 cwd 的仓库定位（gh 优先级 -R > GH_REPO > cwd git remote）——命中时回读器
 * 不会失败，而是读到**别的 tracker 的同号票**，回读节照样顶着「tracker 实值」背书
 * 「以本节为准」：恰是 #172 要消灭的静默错值背书形态（#1532 哈希软化同类）。认证面
 * GH_TOKEN / GH_HOST 等保留（没有它们 gh 读不到私有仓）。
 * 复审①（2026-10-31）拍板：GH_REPO 一并剥——凭据票号属于父会话 cwd 所在仓，剥离即
 * 强制沿 cwd 解析，与凭据语义一致。
 */
export function readerEnv(base) {
  const env = {}
  for (const key of Object.keys(base)) {
    if (key.startsWith('GIT_')) continue
    if (key === 'GH_REPO') continue
    env[key] = base[key]
  }
  return env
}

/**
 * 缺省回读器：`gh issue view <票号> --json`（只读）。`cwd` 与 git 探针同基准
 * （父会话 header.cwd）——gh 沿它解析所在仓的 origin，无 -R 硬编。env 走 readerEnv
 * 过滤（#110 同族）。失败**不抛**：返回失败原因，由回读节写成「回读失败：<原因>」
 * 响亮标记（不留空壳、不静默降级）。
 */
function ghTicketReader(ticket, cwd) {
  return new Promise((resolveRead) => {
    execFile(
      'gh',
      ['issue', 'view', String(ticket), '--json', 'number,title,state,labels,url'],
      // `env: readerEnv(process.env)` 同时是 tests/verify-handoff-tool.mjs T9d 的源码消费锚
      { timeout: GH_TICKET_TIMEOUT_MS, windowsHide: true, cwd, env: readerEnv(process.env) },
      (error, stdout, stderr) => {
        if (error != null) {
          const firstLine = String(stderr || error.message || error).trim().split('\n')[0]
          const reason = (error.killed && firstLine === ''
            ? `gh 回读超时（${GH_TICKET_TIMEOUT_MS}ms）`
            : firstLine === '' ? String(error.code ?? 'gh 回读失败') : firstLine
          ).slice(0, 200)
          return resolveRead({ ok: false, reason })
        }
        try {
          const parsed = JSON.parse(stdout)
          const labels = Array.isArray(parsed.labels) ? parsed.labels.map((l) => String(l?.name ?? '')).filter((n) => n !== '') : []
          // 空壳值行判据（#168 同族）：字段缺失/为空要显式说，不许渲染成空值行。
          const orUnknown = (v, kind) => (v === undefined || v === null || String(v).trim() === '' ? `（tracker 未返回${kind}）` : String(v))
          resolveRead({
            ok: true,
            fields: {
              number: orUnknown(parsed.number, '票号'),
              title: orUnknown(parsed.title, '标题'),
              state: orUnknown(parsed.state, '状态'),
              labels: labels.length > 0 ? labels.join(', ') : '（无标签）',
              url: orUnknown(parsed.url, 'URL'),
            },
          })
        } catch (parseError) {
          resolveRead({ ok: false, reason: `gh 输出非 JSON：${String(parseError?.message ?? parseError).slice(0, 160)}` })
        }
      },
    )
  })
}

/**
 * 票面回读节（#172）+ 调用前防呆信号（#144）：定向节含票号时，tool 生成时经回读器取
 * tracker 实值——转抄字段与本节不符时以本节为准（产出以回读值为准并标记）；票面正文内的
 * 计数/哈希/AC 勾选态等生成后仍会漂移，节内显式标「生成后漂移，子会话以实读为准」。
 * 回读失败 = 「回读失败：<原因>」响亮行 + 实读规约，**不静默降级为转抄值**。无票号
 * （候选 / 批次定向且无引用）→ 返回 ''（整节缺席，与 #168 产物清单同构：没有 tracker
 * 对象就不造该节），**但** #144 防呆仍响亮出「未核」信号——整节缺席是文档面形状，
 * unverified 是返回值面读数，两者不互相吞。
 *
 * #144 信号（经 guard.signal 收集，executeHandoff 映射为返回字段）：
 *   - 回读 state=CLOSED → `{ kind:'ticketClosed', ticket }`
 *   - guard.handedOff(ticket) 为真（同会话同票第二次）→ `{ kind:'duplicateTicket', ticket }`
 *     ——与 closed 两个**独立**信号，可同时在场（closed 不抑制 duplicate，反之亦然）
 *   - 回读失败 / 提取不到 → `{ kind:'ticketCheckUnverified', ticket?, reason }`
 *   - 票 open 且首交 → 零信号（正常态零噪音；「未关票不告警」是扰动断言之一）
 *
 * @param {string} directedSection 定向节原文（'' = 无定向节）
 * @param {string} cwd gh 回读基准目录
 * @param {(ticket: string, cwd?: string) => Promise<object>} [reader] 回读器（守卫注入缝）
 * @param {{signal?: (event: object) => void, handedOff?: (ticket: string) => boolean}} [guard]
 *   #144 防呆缝：signal = 信号收集（executeHandoff 传收集器），handedOff = 会话内记忆探针
 */
async function buildTicketSection(directedSection, cwd, reader, guard) {
  const ticket = extractTicketNumber(directedSection)
  if (ticket === undefined) {
    guard?.signal?.({
      kind: 'ticketCheckUnverified',
      reason: directedSection === ''
        ? '无定向节（候选交接），无票号对象'
        : '定向节无票号凭据且无 #<n> 引用（批次定向？），无单票对象',
    })
    return ''
  }
  const read = await (reader ?? ghTicketReader)(ticket, cwd)
  if (guard?.handedOff?.(ticket) === true) {
    guard?.signal?.({ kind: 'duplicateTicket', ticket })
  }
  const state = String(read.fields?.state ?? '').trim().toUpperCase()
  if (!read.ok) {
    guard?.signal?.({ kind: 'ticketCheckUnverified', ticket, reason: `gh 回读失败：${read.reason}` })
  } else if (state === 'CLOSED') {
    guard?.signal?.({ kind: 'ticketClosed', ticket })
  }
  const header = [
    '## 票面回读（tracker 实读，#172）',
    '<!-- 本节由 handoff_tool 生成时经 `gh issue view` 回读 tracker 实值（转抄字段不手填）。定向节与正文里经转抄的票面字段（标题/标签/计数/哈希）若与本节不符，以本节为准。 -->',
  ]
  if (!read.ok) {
    return [
      ...header,
      `- 票号: #${ticket}`,
      `- 回读失败：${read.reason}`,
      '<!-- 回读失败面：本节无 tracker 实值，正文转抄字段不做机械背书——子会话开工前必须实读 `gh issue view <票号>`，转抄与实读不符以实读为准。 -->',
    ].join('\n')
  }
  const f = read.fields ?? {}
  return [
    ...header,
    `- 票号: #${f.number ?? ticket}`,
    `- 标题: ${f.title ?? '（tracker 未返回标题）'}`,
    `- 状态: ${f.state ?? '（tracker 未返回状态）'}`,
    `- 标签: ${f.labels ?? '（tracker 未返回标签）'}`,
    `- URL: ${f.url ?? '（tracker 未返回 URL）'}`,
    '- 回读时刻: ' + new Date().toISOString(),
    '<!-- 票面正文内的计数/哈希/AC 勾选态在生成后仍会漂移（本节不背书）——生成后漂移，子会话以实读 `gh issue view <票号>` 为准。 -->',
  ].join('\n')
}

// ── #144 调用前防呆：信号 → 返回字段 / 文本映射（导出面，守卫断言同一映射）────────────
// 与 #44 的 stalled 同构：只在异常/未核时置位——正常态（票 open 且同票首交）零字段零文本
// 噪音；「未关票不告警」本身是扰动断言（T11）。

/**
 * #144 信号 → 模型可见结构化字段（executeHandoff 返回值组装用）。字段给机械断言，
 * 文本（ticketGuardTextLines）只给人读——同一信号的两种呈现，不互相替代：
 *   - `ticketClosed: <n>`：目标票已关闭（tracker 实读）
 *   - `duplicateTicket: <n>`：同会话同票第二次 handoff（独立字段，可与 ticketClosed 并存）
 *   - `ticketCheckUnverified: '<原因>'`：gh 不可用 / 票号提取不到——未核，不阻断也不静默
 */
export function ticketGuardFields(signals) {
  const closed = (signals ?? []).find((s) => s?.kind === 'ticketClosed')
  const dup = (signals ?? []).find((s) => s?.kind === 'duplicateTicket')
  const unverified = (signals ?? []).find((s) => s?.kind === 'ticketCheckUnverified')
  return {
    ...(closed !== undefined ? { ticketClosed: Number(closed.ticket) } : {}),
    ...(dup !== undefined ? { duplicateTicket: Number(dup.ticket) } : {}),
    ...(unverified !== undefined ? { ticketCheckUnverified: String(unverified.reason) } : {}),
  }
}

/** #144 信号 → 返回文本的告警行（措辞钉住票面要求：「已关闭，重复 handoff 可能重做
 *  已完成的工作」；未核行写明不阻断也不静默——loud-skip 口径）。 */
export function ticketGuardTextLines(signals) {
  const lines = []
  for (const s of signals ?? []) {
    if (s?.kind === 'ticketClosed') {
      lines.push(`⚠ 目标票 #${s.ticket} 已关闭——重复 handoff 可能重做已完成的工作。如确需在此票上重开工作，请先与 human 确认。`)
    } else if (s?.kind === 'duplicateTicket') {
      lines.push(`⚠ 本会话已对票 #${s.ticket} handoff 过一次——本次为同票重复调用，可能重复派单（#44/#144 防呆）；请确认不是在重做已完成的工作。`)
    } else if (s?.kind === 'ticketCheckUnverified') {
      lines.push(`票号防呆未核：${s.reason}——不阻断，也不静默当成没问题（#144 loud-skip 口径）。`)
    }
  }
  return lines
}

/**
 * #144 AC⑤（2026-10-20 并入）：attachToWorkspace 结果 → 模型可见字段。
 *   - `{ attached: false, reason }` → `sidebarAttached: false` + `sidebarAttachReason`
 *     （no-workspace = cwd 无注册工作区；attach-error = 定位/挂接抛错）
 *   - `{ attached: true }` → `sidebarAttached: true`（成功也机械可断言——IRIS 事故里父会话
 *     正是无从判断可见性才重发）
 *   - undefined（机会性 skip：无 workspaceRegistry / 无 cwd 的组合）→ 零字段：无侧边栏
 *     概念的部署不告警（不是失败，是环境不支持）。
 */
export function sidebarFields(sidebar) {
  if (sidebar === undefined) return {}
  return sidebar.attached === false
    ? { sidebarAttached: false, sidebarAttachReason: String(sidebar.reason) }
    : { sidebarAttached: true }
}

/**
 * 拼装交接文档（#168 起从 executeHandoff 提出的**可导入面**）：作者正文 + （票号凭据才有的）
 * 票面回读节 + 自动快照节 + （有声明才有的）产物清单节 + 交接边界段。守卫
 * tests/verify-handoff-tool.mjs 直接测它；#172 item1（tracker 回读）在本函数面上继续扩
 * 「机械填」的清单。
 *
 * 定向/候选的门（凭据行、skill 声明）也在这里：它们管的是文档形状，且拒绝必须发生在
 * 写文件 / 建子会话之前（Track A4/A5 的执行面断言依赖这一顺序）。回读同样发生在拼装前：
 * reader 先行 await，回读结果在拼节时已在场（失败面写响亮标记，不静默降级为转抄值）。
 * #144 调用前防呆在同一次读取上出信号（closed / duplicate / unverified），经
 * `ticketGuardSignals` 收集器带出——文档面不新增告警节（回读节的「状态」行已携带
 * tracker 实值；告警呈现面 = 工具返回值，不在交接文档里复述）。
 *
 * @param {string} document 父会话写的正文（`# Handoff` 标题去重、focus 前缀在此处理）
 * @param {{focus?: string, skill?: string, artifacts?: string[], cwd?: string,
 *          trackerReader?: (ticket: string, cwd?: string) => Promise<object>,
 *          handedOff?: (ticket: string) => boolean,
 *          ticketGuardSignals?: object[]}} [opts]
 *   `cwd` = 探针/哈希/gh 回读的基准目录（生产 = 父会话 header.cwd；缺省 process.cwd()）；
 *   `trackerReader` = 回读器注入面（守卫用，注入假 reader 不打真网；缺省 = 内置 gh 实现）；
 *   `handedOff` = #144 会话内记忆探针（executeHandoff 注入）；`ticketGuardSignals` =
 *   #144 信号收集器（executeHandoff 传数组，拼装后经 ticketGuardFields/ticketGuardTextLines
 *   映射为返回字段与文本）
 * @returns {Promise<string>} 完整交接文档（节间空行分隔；页脚注释由执行面追加）
 */
export async function assembleHandoffDocument(document, opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  // Dedupe: the agent's document may already open with the same `# Handoff`
  // heading the tool would prepend — keep exactly one.
  const focusSuffix = opts.focus && opts.focus.trim() ? ` — ${opts.focus.trim()}` : ''
  const prefix = `# Handoff${focusSuffix}`
  let body = String(document ?? '').trim()
  if (body.startsWith(prefix)) body = body.slice(prefix.length).replace(/^\s*\n/, '')
  // Gate-4 父会话强约束（2026-09-02 IRIS 观察）+ #156/D52 定向凭据：与旧实现逐字同门，
  // 只是落点从 executeHandoff 挪进拼装面（拒绝仍发生在写盘 / 建子会话之前）。
  const isAssignment = body.includes('## 本会话任务（human 已定向）')
  const directedSection = (() => {
    const start = body.indexOf('## 本会话任务（human 已定向）')
    if (start < 0) return ''
    const next = body.indexOf('\n## ', start)
    return next < 0 ? body.slice(start) : body.slice(start, next)
  })()
  const hasCredentialLine = CREDENTIAL_LINE_RE.test(directedSection)
  const skill = typeof opts.skill === 'string' ? opts.skill.trim().replace(/^\//, '') : ''
  if (isAssignment && !hasCredentialLine) {
    throw new Error(
      '定向交接缺凭据行（#156/D52，结构校验）——工具拒绝转发本派单（不创建子会话）。修复两选一：'
      + `① 在「## 本会话任务（human 已定向）」节内加一行可核凭据——批次定向：\`${CREDENTIAL_FORMATS.batch}（.scratch/batch-state.md 在案）\`；非批定向：\`${CREDENTIAL_FORMATS.ticket}\`（先落票才有定向资格，未落票候选一律 TICKET EXIT 立票）；`
      + '② 去掉定向节，降级为候选交接后重调（child 会停下问 human）。范围认可 ≠ 派单。',
    )
  }
  if (isAssignment && !skill) {
    throw new Error(
      "定向交接必须声明 skill（父会话强约束，不是子会话的自觉）：传 skill: 'implement' / 'code-review' / 'grill-with-docs' 等——实现票按惯例等价于以 /implement 开工；工作区内的 grill 票用 grill-with-docs；确无适用技能传 skill: 'none' 并在定向节说明。",
    )
  }
  if (!isAssignment && skill && skill !== 'none') {
    throw new Error(
      "候选交接（无「本会话任务（human 已定向）」节）不携带技能契约——先确定任务并写定向节，或去掉 skill 参数。",
    )
  }
  const invocation = isAssignment && skill !== 'none' ? `/${skill}` : ''
  const [snapshot, manifest, ticketSection] = await Promise.all([
    buildSnapshotSection(cwd),
    buildManifestSection(opts.artifacts, cwd),
    buildTicketSection(directedSection, cwd, opts.trackerReader, {
      signal: (event) => opts.ticketGuardSignals?.push(event),
      handedOff: opts.handedOff,
    }),
  ])
  const boundary = HANDOFF_BOUNDARY.join('\n')
  // 节间空行分隔。旧实现的 '' 分隔符被 filter(Boolean) 整个吞掉，节与节之间只有单换行
  //（2026-10-31 基线实测 .scratch/verify168/baseline-assembly.mjs）——顺手修正为可读形状。
  return [invocation, prefix, body, ticketSection, snapshot, ...(manifest !== '' ? [manifest] : []), boundary]
    .filter((part) => part !== '')
    .join('\n\n')
}

/** Tool parameter schema for the model-facing call. */
const handoffSchema = {
  type: 'object',
  properties: {
    document: {
      type: 'string',
      description:
        'The handoff markdown to carry into the next session: a summary of the current conversation, a "suggested skills" section naming skills the next session should invoke, references to artifacts by path/URL (do not duplicate their content), and NO sensitive data (redact API keys, passwords, PII). Session-local content lives HERE: confirmed decisions, next steps (every candidate/pending item with 判据 + 读数, unverifiable ones marked 未核 — the appended boundary enforces this), and environment claims each as a `命令 → 输出` line (a bare environment claim once shipped a false verdict — D26). For directed handoffs the tool pins a `/<skill>` invocation line above the title — DSH\'s skill system auto-injects the contract; declare `skill` and compose the directed section. The tool machine-fills the appended sections — 环境快照 (git probe values, #168), 产物清单 (only when `artifacts` is declared; sha256 computed by the tool), 票面回读 (only when the directed credential is a ticket number `凭据：#<票号>`; the tool reads title/state/labels from the tracker via `gh issue view` at generation time and the section, not the transcribed values, is authoritative — #172), and 交接边界 — do not duplicate or hand-fill them. Transcribed ticket fields that the tool cannot know (counts, hashes inside the ticket body) are marked 生成后漂移 — the child session re-reads the tracker for those.',
    },
    artifacts: {
      type: 'array',
      description:
        'Optional: paths of files the next session must verify mechanically before starting (sources, tests, batch state, evidence). Every declared path is normalized to a cwd-relative form for the manifest (the mechanical verifier resolves entries against the session cwd); a path outside the session cwd, or with spaces/backticks/asterisks, fails the call loudly (the manifest only carries lines the verifier can parse and re-hash). Each path must exist and be readable NOW — the tool hashes it and writes the real sha256 into the 产物清单 section; a path it cannot read fails the call loudly (fix the path; placeholder hash lines are never generated). Omit entirely for a handoff with no artifacts — the section is then omitted, not left as a placeholder (#168).',
      items: { type: 'string' },
    },
    focus: {
      type: 'string',
      description:
        'Optional: what the next session will be used for. Prefixed to the document as its heading context.',
    },
    skill: {
      type: 'string',
      description:
        "定向交接（含「## 本会话任务（human 已定向）」节）必填：子会话要执行的 flow skill 名（implement / code-review / grill-with-docs / to-tickets…；实现票按惯例 = implement，工作区内 grill 票 = grill-with-docs）。工具只在 # Handoff 前单起一行 /<skill> 调用指令——内容由 DSH skill 插件自动注入，工具不做文件读取。确无适用技能传 'none'。候选交接不带此参数。定向节还须携带凭据行（批次 = 宣告 id / 非批 = 已落票票号，#156/D52）——缺凭据行工具会响亮拒绝。",
    },
    mode: {
      type: 'string',
      enum: ['fork', 'fresh'],
      description:
        "fresh (default) = empty child session, zero inherited history — the handoff document carries the context; fork = child continues this conversation's history up to the last completed turn (only for continuing the same ticket mid-work when the window ran out). The handoff document is the child's first prompt either way.",
    },
  },
  required: ['document'],
  additionalProperties: false,
}

/**
 * Account a fresh session into its cwd's workspace so the GUI sidebar lists
 * it (the GUI's `session.create`/`session.fork` paths attach; the bare
 * `ctx.agents.create()` factory does not). Opportunistic: compositions
 * without a workspace registry simply skip (→ `undefined`，无侧边栏概念的组合不告警).
 *
 * #144 AC⑤（2026-10-20 并入）：失败从「只进日志」提升为**模型可见**——返回值由
 * executeHandoff 经 sidebarFields 映射为结构化字段 + 文本。此前该路径失败时工具仍报成功，
 * 父会话无从判断可见性（human 看不到 → 父会话重发——IRIS 事故的直接成因）。三个显式面：
 *   - cwd 无注册工作区 → `{ attached: false, reason: 'no-workspace' }`
 *   - 定位 / 挂接抛错 → `{ attached: false, reason: 'attach-error' }`
 *   - 无 registry / 无 cwd → `undefined`（机会性 skip 保留：环境不支持 ≠ 失败）
 * 日志照旧（warn），返回值是新增的模型可见面——两者不互相替代。
 */
export async function attachToWorkspace(ctx, sessionId, cwd) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || cwd === undefined) return undefined
  try {
    const workspace = await registry.resolveByPath(cwd)
    if (workspace === undefined) {
      ctx.logger.warn(`handoff_tool: no workspace registered for cwd '${cwd}'; session '${sessionId}' will not show in the sidebar`)
      return { attached: false, reason: 'no-workspace' }
    }
    await workspace.attachSession(sessionId)
    return { attached: true }
  } catch (error) {
    ctx.logger.warn(`handoff_tool: could not attach session '${sessionId}' to its workspace: ${String(error?.message ?? error)}`)
    return { attached: false, reason: 'attach-error' }
  }
}

/**
 * Build the balanced completed-turn prefix of a session's log: every event up
 * to (and including) the last `turn/end`. A prefix ending at a turn boundary
 * carries no open turn/step and no dangling tool call — the seed contract of
 * `ctx.agents.create`. The live snapshot is already in ascending seq order.
 */
export function forkSeed(session) {
  const events = session?.events ?? []
  let boundary = -1
  for (const ev of events) {
    if (ev.type === 'turn/end') boundary = ev.seq
  }
  if (boundary < 0) return { seed: undefined, seedLength: undefined }
  const seed = events.filter((ev) => ev.seq <= boundary)
  return { seed, seedLength: seed.length }
}

/**
 * Verify the child's first turn ACTUALLY started (#44, 2026-10-11 IRIS
 * incident): `followup()` queues the prompt and wakes the driver, but the
 * wake can be lost — the child then sits header-only with a queued message
 * while this tool claimed "已开始处理". Poll the child's live events for a
 * `turn/start` until the deadline.
 */
export function childStarted(handle) {
  // snapshotEvents() is the host's live, documented accessor (tests/verify.mjs
  // tracks A/D read the child through it); `.events` is the raw live array
  // forkSeed already consumes. Either is ascending-seq and unbounded for a
  // just-spawned session — the early `turn/start` cannot be truncated away.
  const events = handle.agent.session?.snapshotEvents?.() ?? handle.agent.session?.events ?? []
  return events.some((ev) => ev?.type === 'turn/start')
}

// #44 bounds: turn/start is persisted BEFORE the first model call, so the wait
// covers spawn+dispatch latency (the observed high-concurrency IRIS 22:48
// scenario), not model latency.
const FIRST_TURN_TIMEOUT_MS = 15_000
const REWAKE_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 250

export async function waitForFirstTurn(handle, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (childStarted(handle)) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return childStarted(handle)
}

// #144 二次判定（AC③）的会话内记忆：本会话已 handoff 过的票号。WeakMap 挂 session 对象
// ——会话被回收记忆随之消失（票面：「会话内记录即可」）。只要拼装成功（= 工具实际走到
// 交接）就记入，**无论子会话随后是否成功**——正是「父会话主观认为失败而重发」的形态要拦。
const HANDOFF_TICKET_MEMORY = new WeakMap()

/** One atomic handoff: write the file, spawn the child, start its first turn. */
async function executeHandoff(ctx, args, exec) {
  const agent = exec?.agent
  if (!agent) throw new Error('handoff_tool requires a live agent.')
  const presetId = ctx.agentPresets.composedPreset(agent.ctx) ?? ctx.agentPresets.defaultId
  const session = agent.session
  const header = session?.header
  // Default is FRESH: the handoff document alone carries the context (O6).
  // Forking a long session resurrects its whole compacted history — the
  // opposite of a clean ticket boundary. fork is an explicit opt-in for
  // continuing the same ticket mid-work.
  const mode = typeof args.mode === 'string' && MODES.includes(args.mode) ? args.mode : 'fresh'

  // 1. The portable artifact — the OS temp dir, never the workspace.
  const stamped = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `handoff-${presetId}-${stamped}.md`
  const filePath = join(tmpdir(), fileName)
  // The document is ASSEMBLED, not templated (#168): the snapshot section is
  // machine-filled here (git probes over the session cwd — the tool runs in the
  // parent session, so this is the generation-moment truth), the artifact
  // manifest exists only when `artifacts` is declared and carries tool-computed
  // sha256 values, and the boundary is joined from the module-level canonical
  // array. The credential/skill gates run inside the assembly and throw BEFORE
  // anything is written or spawned. See assembleHandoffDocument above for the
  // D26/#133 history of these sections.
  // #144 调用前防呆：注入会话内记忆探针与信号收集器（判定在拼装面，与 #172 回读共用
  // 一次读取；信号经 ticketGuardFields/ticketGuardTextLines 映射进返回值）。
  const handedOffTickets = (() => {
    const key = agent.session ?? agent
    let set = HANDOFF_TICKET_MEMORY.get(key)
    if (set === undefined) {
      set = new Set()
      HANDOFF_TICKET_MEMORY.set(key, set)
    }
    return set
  })()
  const ticketGuardSignals = []
  const documentText = [
    await assembleHandoffDocument(args.document, {
      focus: args.focus,
      skill: args.skill,
      artifacts: args.artifacts,
      cwd: header?.cwd,
      handedOff: (ticket) => handedOffTickets.has(ticket),
      ticketGuardSignals,
    }),
    `<!-- spawned by ${presetId} preset; child session inherits the same mode -->`,
  ].join('\n\n')
  // 拼装成功 = 工具实际走到交接（凭据门拒绝 throw 时根本到不了这里，不算 handoff）→
  // 记入会话内防呆记忆；下一次同票 handoff 触发 duplicateTicket。
  for (const event of ticketGuardSignals) {
    if (typeof event?.ticket === 'string') handedOffTickets.add(event.ticket)
  }
  let writeError
  try {
    await writeFile(filePath, documentText, 'utf8')
  } catch (error) {
    writeError = String(error?.message ?? error)
  }

  // 2. The child session.
  const fork = mode === 'fork' ? forkSeed(session) : { seed: undefined, seedLength: undefined }
  const childId = `${presetId}-session-${randomUUID()}`
  // The child needs a model route for its first turn and for the `{{model}}`
  // prompt variable (agent-loop resolves it from `agent.options.model`). The
  // GUI's session.create resolves this from the deployment default selection;
  // the raw factory does not, so resolve it here (mirrors api-proxy's
  // agentOptions()). Opportunistic: deployments without the service create a
  // child without a route, exactly as before.
  const defaults = ctx.get('agentDefaultModel')
  const agentOptions = defaults === undefined
    ? undefined
    : { provider: defaults.currentSelection().provider, model: defaults.currentSelection().model }
  const handle = await ctx.agents.create({
    sessionId: childId,
    meta: {
      ...(header?.cwd ? { cwd: header.cwd } : {}),
      ...(session?.id ? { parentSession: session.id } : {}),
      ...(fork.seedLength !== undefined ? { seedLength: fork.seedLength } : {}),
      agentPreset: presetId,
    },
    ...(fork.seed ? { seed: fork.seed } : {}),
    ...(agentOptions !== undefined ? { agentOptions } : {}),
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
  // #144 AC⑤：attach 结果带出（失败面 = 模型可见字段 + 文本，不再只进日志）。
  const sidebar = await attachToWorkspace(ctx, handle.agent.session.id, header?.cwd)

  // 3. The document as the child's FIRST USER PROMPT: queue a real turn (the
  // same admission the prompt RPC uses) and wake the driver. The child starts
  // working the handoff immediately and becomes sidebar-visible (its first
  // running frame flips the client's blank flag).
  let promptError
  try {
    handle.agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: documentText }],
      source: { kind: 'user' },
    })
  } catch (error) {
    promptError = String(error?.message ?? error)
  }

  // 4. VERIFY the child's first turn actually started (#44 — never trust the
  // queue). On a lost driver wake, re-wake ONCE with a marked probe message
  // (the queued document is still first in the inbox, so the probe only ever
  // runs AFTER the document turn, never instead of it).
  let wakeRetry = false
  let stalled = false
  if (!promptError) {
    if (!(await waitForFirstTurn(handle, FIRST_TURN_TIMEOUT_MS))) {
      ctx.logger.warn(`handoff_tool: child '${handle.agent.session.id}' first turn not started within ${FIRST_TURN_TIMEOUT_MS}ms — re-waking once`)
      wakeRetry = true
      try {
        handle.agent.followup({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: '（唤醒探测：上一条 handoff 文档才是本会话任务。若尚未开工，按该文档开工；已在执行则忽略本条并继续。）' }],
          source: { kind: 'user' },
        })
      } catch (error) {
        ctx.logger.warn(`handoff_tool: re-wake failed: ${String(error?.message ?? error)}`)
      }
      stalled = !(await waitForFirstTurn(handle, REWAKE_TIMEOUT_MS))
    }
  }
  if (stalled) {
    ctx.logger.warn(`handoff_tool: child '${handle.agent.session.id}' STILL stalled after re-wake — human must open the session manually`)
  }

  // Tri-state report (#44 AC③). Attribution note: after a re-wake we know A
  // turn started, not WHICH message went first — either way the handoff
  // document sits in the child's history as the task.
  const statusLine = promptError
    ? `（注意：首条提示词投递失败 — ${promptError}；可手动打开会话后发送文档）`
    : stalled
      ? '⚠ 首条提示词已入队但补唤醒后仍未观测到子会话首 turn 启动（driver 唤醒疑似丢失，#44）。请 human 手动打开该子会话并发送任意消息续跑；【不要重复调用本工具】——会重复派单（可能重做已完成的票）。'
      : wakeRetry
        ? '首 turn 一度未启动，补唤醒一次后已观测到启动（文档与唤醒探测谁先行未区分，但 handoff 文档已在子会话历史中作为任务）。'
        : '交接文档已投递，子会话首 turn 已确认真实启动（turn/start 已观测）。'

  return {
    // stalled=true is the protocol-level anti-duplicate flag (#44 review):
    // the model-facing text above is advisory, this field is checkable.
    ...(stalled ? { stalled: true } : {}),
    // #144 调用前防呆字段（ticketClosed / duplicateTicket / ticketCheckUnverified）
    // 与侧边栏可见性字段（sidebarAttached [+ sidebarAttachReason]）——异常/未核才置位
    // 或成功也机械可断言（sidebarAttached: true），正常票号路径零新增噪音。
    ...ticketGuardFields(ticketGuardSignals),
    ...sidebarFields(sidebar),
    text: [
      `Handoff 子会话已创建：${handle.agent.session.id}`,
      writeError ? `文件写入失败：${writeError}` : `可移植交接文档：${filePath}`,
      statusLine,
      ...ticketGuardTextLines(ticketGuardSignals),
      ...(sidebar?.attached === false
        ? [`⚠ 子会话可能不出现在侧边栏（${sidebar.reason}）——别据此重发本工具；需要确认可见性时让 human 在侧边栏核对。`]
        : []),
      '请在侧边栏切换到新会话；本会话保持可恢复。',
    ].join('\n'),
  }
}

/** Register the model-facing `handoff_tool`. */
export function apply(ctx) {
  ctx.tools.register({
    name: 'handoff_tool',
    description: [
      "Execute the /handoff phase boundary: write a portable handoff markdown to the OS temp dir and spawn the child session (same mode) that continues the work; the document becomes the child's first prompt and its first turn starts immediately.",
      'Call this when the phase-boundary decision is /handoff — swapping harness, moving to a new directory, sending work to a colleague, or forking a side task mid-phase.',
      'mode "fresh" (default) = empty child session, zero inherited history (the document carries the context); mode "fork" = child continues this session\'s history up to the last completed turn (same-ticket continuation only).',
      'You compose the `document` yourself (summary + suggested skills + artifact references, redacted); the tool machine-fills the appended sections — 环境快照 (git probe values over the session cwd) and 产物清单 (declare `artifacts` paths; each sha256 is computed here, and the section exists only when artifacts are declared, #168).',
      'Before handing off, the tool runs the #144 pre-call guard: the ticket in the directed section (credential line first, else the first #<n> reference in it) is checked against the tracker — a CLOSED ticket sets `ticketClosed`, a second handoff of the SAME ticket in this session sets `duplicateTicket` (independent signals, both advisory, never blocking), and when gh is unavailable or no ticket can be extracted it sets `ticketCheckUnverified` instead of staying silent. Sidebar attachment is also surfaced: `sidebarAttached: false` (+ `sidebarAttachReason`) means the child may not appear in the sidebar — do NOT re-call this tool because of it.',
      'After it returns, STOP and tell the human to switch to the child session in the sidebar — you cannot switch the main session yourself.',
    ].join('\n'),
    parameters: handoffSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          // #44: set ONLY on the still-stalled path — protocol-level
          // anti-duplicate signal (text alone is advisory).
          stalled: { type: 'boolean' },
          // #144 调用前防呆（与 stalled 正交；正常票号路径零字段零噪音）：
          ticketClosed: { type: 'number' },          // 目标票已关闭（tracker 实读，AC①）
          duplicateTicket: { type: 'number' },       // 同会话同票第二次 handoff（独立信号，AC②）
          ticketCheckUnverified: { type: 'string' }, // gh 不可用/票号提取不到——未核原因（AC③）
          // #144 AC⑤（2026-10-20 并入）：侧边栏可见性。false 时附 sidebarAttachReason
          // （no-workspace / attach-error）；无 registry/无 cwd 的组合缺席（机会性 skip）。
          sidebarAttached: { type: 'boolean' },
          sidebarAttachReason: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      return executeHandoff(ctx, args, exec)
    },
  })
}
