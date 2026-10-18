/**
 * verify-restore-discipline.mjs —— 「扰动还原纪律」的机械守卫（R1–R7）。**#108**。
 *
 * 为什么存在（#108 票面）：本仓修复类票的标准取证手法是「**取副本 → 最小扰动 → 跑真用例 →
 * 断言真红 → 还原并逐字节核对**」。**还原**这一步有两种写法，语义完全不同，而当时**没有
 * 任何守卫**区分它们：
 *
 *   · `git checkout -- <path>` / `git restore <path>` —— 从 **index** 回填工作树。
 *     对 **tracked 且改动未 staged** 的文件，这会把工作树**静默**打回 **HEAD**，
 *     **未提交的那份改写版没有任何 git 级副本 → 永久丢失**。
 *   · **副本回写**（`cp <path> <backup>` → 扰动 → `cp <backup> <path>`）—— 回到**我的版本**。
 *
 * **已发生的真实事故**（本票来源）：teammate 扰动取证后用 `git checkout --` 还原，把已验证的
 * **436 行改写版打回 274 行 HEAD 旧版**；该改写版从未 `git add` / `commit`，**工作树副本是其
 * 唯一载体**；它事前算了 SHA256 但**没留副本**，故无法恢复。**同族事故在本仓已多次**
 * （跨会话 retro 聚合记为 3/3 复发）。
 *
 * ── 判据（关键）：**不**检查"头注里写没写禁令"（那是文档措辞，改字就红/就绿，属同义反复——
 *    配方自己的 P6 已因这个性质被显式降级为"措辞检查"）。本用例**把机制真的跑一遍**：
 *    自建 Impure 夹具仓（真 git，落 `os.tmpdir()`），对**三种文件状态**各做一次扰动、
 *    各用 `git checkout --` 还原一次，断言**哪一个真的丢、哪两个没有**。
 *    于是「`git checkout --` 会吃掉什么」变成**可跑的事实**，而不是文档里的一句话。
 *
 * ── 本守卫的一处**口径修正**（实测优先于票面，brief §2.5「先实测再判 AC」）─────────────
 *    票面把它写成「**untracked 或 unstaged** 时响亮提醒'该文件没有 git 副本'」，
 *    即把 untracked 也算进危险支。**2026-10-18 实测不成立**（先跑 `.scratch/p108-probe.mjs`）：
 *
 *       | 被扰动文件的状态        | `git checkout -- <path>` | 未提交工作 |
 *       |------------------------|--------------------------|-----------|
 *       | tracked + **unstaged** | exit 0，内容**静默**变回 HEAD | **丢失** ← 唯一的危险支 |
 *       | tracked + **staged**   | exit 0，工作树**不变**（回到**我的暂存版**） | 保住 |
 *       | **untracked**          | exit **1**（`pathspec … did not match`） | 保住 |
 *
 *     ⇒ 危险窗口 = **tracked 且改动仅在 unstaged 面**。R3 把这条边界**逐态钉住**：
 *       只断言"unstaged 丢"会让守卫**过度声称**（把安全支也说成丢，§3.1 的"空转"反面）；
 *       三态都断言才说得清边界，这正是本票 AC「必须说得出什么输入能让它红」的要求。
 *
 * ── 本票的写域纪律（自证）：本用例自己就是"扰动取证"，故**必须**遵守它所守的纪律——
 *    扰动全程只发生在 `os.tmpdir()` 的自建夹具仓内，**真树只读、零改动**（R6 断言）；
 *    还原一律用**副本回写**，**本文件内不出现 `git checkout --` 作为还原手段**（R7 断言）。
 *
 * ── 非空洞自查（红→绿，读数见 `.scratch/p108-nonempty.log`）：扰动本用例的**被测实现**，
 *    每条断言都必须真红——
 *      ① 把 R3 的还原命令换成 `git stash drop` 一类（或让夹具不造 unstaged 态）
 *         → R3a 红（"丢了"这个事实取不到）；
 *      ② 把 R4 的副本回写换成 `git checkout --` → R4 红（对照组不再保住，且被 R7 判违规）；
 *      ③ 夹具**不 init** / `git` 缺席 → R1 红（夹具不成立，演示无效，**不静默绿**）；
 *      ④ 真树被碰 → R6 红。
 *
 * 成本：一次 `mkdtemp` + 约 10 次 `git` 调用（纯本地，无网络、无 node_modules 依赖）——可忽略。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

// ── R0: 被测纪律的**载体**在场（配方头注必须写下禁令与前提 —— AC1）──────────────
// 这是"在场"断言，性质同配方的 P6（措辞可骗）；**非空洞性由 R3/R4 承担**（机制实测）。
// 之所以仍要有它：口径只写进注释是不够的（本仓 §3.1：注释里的规则没有守卫时会被静默改回），
// 故必须有一条断言证明它**在场**（AC1 / AC2 的"不是只有注释"）。
const RECIPE = join(REPO, 'tests', 'verify-perturbation-recipe.mjs')
const recipeSrc = readFileSync(RECIPE, 'utf8')
const HEADER = recipeSrc.split('\n').slice(0, 80).join('\n')
const HEADER_POINTS = [
  ['禁令：`git checkout --` 不得作还原手段（短语在场 + 有禁令动词）',
    /`git checkout --`[\s\S]{0,40}(不得|禁用|禁)\s*作|(禁用|不得|禁)\s*[^\n]{0,20}`git checkout --/],
  // ⚠ Spec 轴复核发现（本轮修）：初版这条是**裸词** `/git restore/`，而头注里"提到" restore
  // 的地方不止禁令（叙述里也会提），故"裸词在场"**不承载禁令语义** —— 与 P7 同一条教训
  // （判据要钉语义、别追出现）。收窄为**同段内**共现：命令 + 还原语境 + 禁令动词。
  // 窗口取 120 字符（实测：头注写法是「禁用 `git checkout -- <path>` / `git restore <path>`
  // 作为还原手段」——命令与"还原手段"之间隔着 ` <path>` / ` 与斜杠，40 字符不够）。
  // ⚠ 别为迁就正则去改正文：判据要读**人写的口径**，不是让口径迁就判据（本仓 D13 的教训）。
  ['禁令：`git restore` 不得作还原手段（命令 + 禁令动词同段共现，非裸词在场）',
    /禁用[\s\S]{0,120}`git restore|`git restore[\s\S]{0,120}(作为还原手段|不得作还原|禁用作还原)/],
  ['前提：未提交工作**没有 git 级副本**', /没有\s*git\s*级副本/],
  ['前提：**哈希不能替代副本**（只证"变了"，不能恢复）', /哈希不能替代副本|哈希.{0,20}不能.{0,10}恢复/],
  ['口径：还原一律用**副本回写**', /副本回写/],
]
const missingHeader = HEADER_POINTS.filter(([, re]) => !re.test(HEADER)).map(([n]) => n)
if (missingHeader.length === 0)
  ok('R0. 配方头注含还原纪律口径（禁令 + 前提）', `${HEADER_POINTS.length} 条判据（措辞面；非空洞性由 R3/R4 承担）`)
else bad('R0. 配方头注口径缺失（AC1：口径落地）', `缺: ${missingHeader.join(' / ')}`)

// ── R1: Impure 夹具仓可建立（**夹具不成立则不猜、不报假绿** —— 响亮失败）────────────
// 手法照 `tests/verify-batch-state.mjs` C9b 的既有先例（#115，同族的 Impure 夹具）：
//   ① 落 `os.tmpdir()`（仓内临时件会进 git 状态、踩 pre-commit 的"工作树有未 staged 改动"闸门）；
//   ② **显式脱离父 git 环境**（`GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` / `GIT_COMMON_DIR`）
//      —— 否则夹具里的 `git init` 会写进**调用方仓库**（#110 同族教训：夹具污染调用方仓）；
//   ③ 一律 `git -C <dir>`，**不用 `cwd:`**（本机 startup 脚本族会把子进程 cwd 复位到用户目录，
//      #115 实测踩过：夹具命令全打在调用方仓库上）；
//   ④ 身份**显式给**（`-c user.name/-c user.email`），因为 GIT_CONFIG_GLOBAL 被指向空文件。
const TMP = mkdtempSync(join(tmpdir(), 'dsh-matt-restore-'))
/** 夹具命令：`git -C <TMP> …`（绝不 cwd:）。 */
const env = { ...process.env, GIT_CONFIG_GLOBAL: join(TMP, '.gitconfig'), GIT_CONFIG_SYSTEM: join(TMP, '.gitconfig') }
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k]
const G = (...args) => spawnSync('git', ['-C', TMP, ...args], { encoding: 'utf8', env, windowsHide: true })
const commit = (...args) => G('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args)

/** 「HEAD 旧版」与「我的未提交改写版」—— 用**可辨认的哨兵串**（不是行数，行数会骗人）。 */
const HEAD_VERSION = 'HEAD OLD VERSION (274 lines)\n'
const MY_VERSION = 'MY UNCOMMITTED REWRITE (436 lines)\n'
const read = (f) => { try { return readFileSync(join(TMP, f), 'utf8') } catch { return null } }
/** 还原纪律的**合规**手法：副本回写（本用例自己必须遵守 —— 见 R7）。 */
const restoreFromCopy = (f) => writeFileSync(join(TMP, f), read(f + '.backup'))

let fixtureOk = false
try {
  const init = G('init', '-q', '-b', 'main')
  if (init.status !== 0) bad('R1. 夹具仓可 init', `exit ${init.status} / ${(init.stderr || '').trim()}`)
  else {
    writeFileSync(join(TMP, 'tracked.txt'), HEAD_VERSION)
    G('add', 'tracked.txt')
    commit('commit', '-q', '-m', 'base: HEAD 旧版')
    G('symbolic-ref', 'HEAD', 'refs/heads/main')
    const rev = G('rev-parse', 'HEAD')
    if (rev.status === 0 && read('tracked.txt') === HEAD_VERSION) {
      fixtureOk = true
      ok('R1. Impure 夹具仓成立（真 git，落 os.tmpdir()，工作树 = HEAD 旧版）', `HEAD=${rev.stdout.trim().slice(0, 7)}`)
    } else bad('R1. 夹具仓不可用（演示无效，不猜不报假绿）', `rev-parse exit ${rev.status}`)
  }
} catch (error) {
  bad('R1. 夹具仓可建立', String(error?.message ?? error))
}

if (fixtureOk) {
  // ══ R3: **三态边界** —— `git checkout --` 到底吃掉什么（本票的核心事实）══════════════
  // 三态各造一次扰动，各用被测的 git 级还原跑一次，断言**实际**结果；再与**预期边界**比对。
  // 判据不只是"unstaged 丢"——**三支都要对**，否则守卫在含混地过度声称（或漏掉真危险支）。
  //
  // ⚠ **两种被禁机制都要跑**（Spec 轴复核发现，本轮补）：票面口径禁的是
  //   「`git checkout --` / `git restore`」**两个**命令，而初版 R3 只跑 checkout ——
  //   实测把还原换成 **`git restore -- <path>`**（或 `git restore --worktree -- <path>`）
  //   时守卫**全绿**（`.scratch/p108-restore-gap.mjs` 的读数：两种形态 exit=0、零红）。
  //   即"另一半 AC 无人守"。修法 = 把机制**参数化**，逐机制跑同一张三态表：
  //   `git restore` 与 `git checkout --` 对**同一文件状态**的语义相同（都从 index 回填），
  //   故三态的期望值对两者一致——但**必须各自实测**，不能靠"语义相同"的推理代替取证。
  const MECHANISMS = [
    {
      id: 'R3',    name: '`git checkout -- <path>`',
      cmd: (file) => ['checkout', '--', file],   // R7-EXEMPT: 被测对象（机制定义本身，非本用例的还原动作）
    },
    {
      id: 'R3-alt', name: '`git restore -- <path>`（等价形态，票面同禁）',
      cmd: (file) => ['restore', '--', file],    // R7-EXEMPT: 被测对象（机制定义本身，非本用例的还原动作）
    },
  ]
  const STATES = [
    {
      id: 'a', label: 'tracked + **unstaged** 改动',
      setup: () => { writeFileSync(join(TMP, 'tracked.txt'), MY_VERSION) },          // 只改工作树，不 add
      expectLost: true, why: '工作树副本是唯一载体 → **永久丢失**（本票的真实事故形态）',
    },
    {
      id: 'b', label: 'tracked + **staged** 改动',
      setup: () => { writeFileSync(join(TMP, 'tracked.txt'), MY_VERSION); G('add', 'tracked.txt') },
      expectLost: false, why: 'index 里有副本 → 回填的是**我的暂存版**，不是 HEAD',
    },
    {
      id: 'c', label: '**untracked** 新文件',
      setup: () => { writeFileSync(join(TMP, 'untracked.txt'), MY_VERSION) },
      expectLost: false, why: 'git 根本不认它 → 命令**失败**（pathspec），文件原样',
    },
  ]
  for (const m of MECHANISMS) {
    for (const s of STATES) {
      const id = `${m.id}${s.id}`
      // 每支从干净的 HEAD 态起步（前一支可能把 tracked.txt 改成 MY_VERSION）。
      G('reset', '-q', '--hard', 'HEAD')
      rmSync(join(TMP, 'untracked.txt'), { force: true })
      const file = s.id === 'c' ? 'untracked.txt' : 'tracked.txt'
      s.setup()
      const before = read(file)
      // ── 被测的**还原手段**：本文件**唯一**许可出现这两个命令的**代码**位置（R7 的机器可判形式：
      //    其余位置一律用副本回写）。用 R7 的豁免标记标出，免得 R7 靠行内巧合过滤。
      const r = G(...m.cmd(file))   // R7-EXEMPT: 被测对象本身（演示 git 级还原的语义）
      const after = read(file)
      const lost = before === MY_VERSION && after !== MY_VERSION
      s.observed = { exit: r.status, lost, after }
      if (lost === s.expectLost) {
        ok(`${id}. ${s.label} → ${lost ? '**丢失**' : '保住'}（与实测边界一致）`,
          `${m.name} exit ${r.status}；内容 ${lost ? `打回 ${JSON.stringify(after)}` : `仍是我的版本（sha ${sha(after)}）`} —— ${s.why}`)
      } else {
        bad(`${id}. ${s.label} 的边界与实测不符`,
          `期望 ${s.expectLost ? '丢' : '保住'}、实测 ${lost ? '丢' : '保住'}；${m.name} exit ${r.status} —— ` +
          '夹具坏了或该命令的语义变了，下方纪律的立足事实已不成立')
      }
    }
  }

  // ══ R4: **对照组** —— 副本回写保得住同一份未提交工作（"该用什么还原"的正脸）════════
  // 与 R3a 同形输入（tracked + unstaged），只把还原手段换成副本回写 → 断言**逐字节保住**。
  // 这一条是 R3a 的**对照**：两条放在一起，"手段的选择"才是可归因的变量（同 P2 对照组的道理）。
  //
  // ⚠ 本节用了 `reset --hard`（也是 git 级丢弃）——**不是**违反本纪律，边界要说清：
  //   纪律管的是「**取证产出的那一份未提交工作**」的还原（那份没有副本 → 丢了就没了）。
  //   夹具仓里被 `reset --hard` 丢掉的，是**本条断言自己刚写下去、正等着被丢**的构造物
  //   （第 ② 步就是"制造丢失"，随后立刻用副本救回）——它是**被测对象**，不是证据。
  //   判据仍成立：R4 断言"同一份内容，副本回写救得回来"，而 R3a 断言"checkout 救不回来"。
  G('reset', '-q', '--hard', 'HEAD')
  writeFileSync(join(TMP, 'tracked.txt'), MY_VERSION)
  writeFileSync(join(TMP, 'tracked.txt.backup'), MY_VERSION)   // ① 取副本（唯一可恢复载体）
  G('reset', '-q', '--hard', 'HEAD')                            // ② 最小扰动（此处即"还原"前的工作态变化）
  const perturbedSha = sha(read('tracked.txt'))
  restoreFromCopy('tracked.txt')                                // ③ 副本回写（合规还原）
  const restoredText = read('tracked.txt')
  if (restoredText === MY_VERSION && sha(restoredText) === sha(MY_VERSION)) {
    ok('R4. 对照：**副本回写**保住同一份未提交工作（逐字节一致）',
      `回写前工作树 sha ${perturbedSha} → 回写后 sha ${sha(restoredText)} == 我的版本 ${sha(MY_VERSION)}`)
  } else bad('R4. 副本回写未还原（纪律的正脸不成立）', `回写后 sha ${sha(restoredText)} ≠ ${sha(MY_VERSION)}`)

  // ══ R5: **哈希反模式** —— SHA256 证明"变了"，但**不能用来恢复**（票面第 2 条）══════
  // 事故的**准确形态**（复刻，不是比喻）：先算好"我的版本"的 SHA256，**不留副本**，
  // 然后 `git checkout --` 把工作树打回 HEAD。此后手上只剩一个哈希 —— 而**没有任何操作**
  // 能把它变回内容。判据（可红）：`recoveredFromHash !== MY_VERSION` 且副本**确实缺席**。
  //
  // ⚠ 初版这里写错过（本轮实测抓到，记下）：曾拿 `sha(丢失版)` 与 `sha(恢复出的内容)` 比大小，
  // 但两者同源（恢复走的正是副本），该断言**恒真** = 空转（§3.1 的"守卫空转"形态）。
  // 修法是**换判据的输入事实本身**：不复用副本那一路的产物，而是显式断言"没副本就恢复不出"。
  G('reset', '-q', '--hard', 'HEAD')
  rmSync(join(TMP, 'tracked.txt.backup'), { force: true })     // 复刻事故：**只留哈希、不留副本**
  writeFileSync(join(TMP, 'tracked.txt'), MY_VERSION)
  const hashArchive = sha(read('tracked.txt'))                 // ① 事前算哈希（事故里的动作）
  G('checkout', '--', 'tracked.txt')                           // ② 用 git 级还原 → 打回 HEAD   R7-EXEMPT: 被测对象（复刻事故的丢失动作）
  const afterWipe = read('tracked.txt')
  // ③ **哈希给不出内容**这个事实要**正面建立**，不能靠一条恒真的装饰性子句。
  // ⚠ Standards 轴复核报出（本轮修）：初版写 `const recoveredFromHash = backupGone ? null : read(...)`
  // 并在判据里加 `recoveredFromHash !== MY_VERSION` —— 但前一行刚 `rmSync` 删了副本，
  // `backupGone` **恒 true**，于是 `recoveredFromHash` **恒 null**、那条子句**恒真** = 装饰。
  // 这正是本票自己在 R5 注里批评的"恒真空转"形态，被复核原样抓回（D1 的现成实例）。
  // 修法：把判据换成**可证伪的两条**——
  //   ① 打回后内容 == HEAD（丢失确实发生）；
  //   ② **穷举所有可得的恢复载体**：副本目录里除 tracked.txt 外**没有任何备份**，
  //      且哈希本身不是载体（类型/长度都不是内容）→ 于是"从哈希恢复"这件事**在输入侧就不可能**。
  const backups = readdirSync(TMP).filter(f => f.includes('.backup'))
  const backupGone = backups.length === 0
  // "哈希不是内容"要**实测**，不是断言：拿哈希去和实际内容比 —— 它既不等长也不相等。
  const hashIsNotContent = hashArchive.length !== MY_VERSION.length && hashArchive !== MY_VERSION
  const lost = afterWipe === HEAD_VERSION
  if (lost && backupGone && hashIsNotContent) {
    ok('R5. 哈希 ≠ 副本：只留 SHA256 时**不可恢复**，唯一可恢复载体是**副本**',
      `丢失版 sha ${hashArchive}；打回后 ${JSON.stringify(afterWipe.trim())}；` +
      `夹具内备份文件 ${backups.length} 个（唯一载体缺席）；哈希长 ${hashArchive.length} ≠ 内容长 ${MY_VERSION.length} → 哈希给不出内容`)
  } else {
    bad('R5. 哈希反模式的演示不成立（判据未被建立）',
      `打回后 ${JSON.stringify((afterWipe ?? '').trim())}（期望 HEAD 版）/ 备份文件 ${backups.length} 个 / ` +
      `哈希长 ${hashArchive.length} vs 内容长 ${MY_VERSION.length} —— 三者须同时成立`)
  }

  // ④ 对照：**留了副本**的同一场景可以逐字节恢复（R4 已证）——两条并置，"哈希 vs 副本"才是可归因的变量。
  writeFileSync(join(TMP, 'tracked.txt'), MY_VERSION)
  writeFileSync(join(TMP, 'tracked.txt.backup'), MY_VERSION)
  G('checkout', '--', 'tracked.txt')   // R7-EXEMPT: 被测对象（对照组里同样先制造丢失，再靠副本救回）
  restoreFromCopy('tracked.txt')
  if (read('tracked.txt') === MY_VERSION && sha(read('tracked.txt')) === hashArchive) {
    ok('R5b. 对照：**同样的事前哈希 + 留了副本** → 逐字节恢复（哈希相同，可恢复性却相反）',
      `恢复后 sha ${hashArchive} == 丢失版 sha；差别只在**有没有副本**`)
  } else bad('R5b. 留副本的对照组未恢复', `sha ${sha(read('tracked.txt'))} ≠ ${hashArchive}`)
} else {
  // 夹具不成立时**响亮**：不把 R3–R5 静默当成通过（§3.1「守卫空转」）。
  console.log('  ⚠ R3–R5 SKIP (loud). 夹具仓未成立 —— 三态边界 / 对照组 / 哈希反模式**未验证**；不猜、不报假绿')
}
rmSync(TMP, { recursive: true, force: true, maxRetries: 3 })

// ── R6: **夹具没污染调用方仓库**（真树只读 —— 本用例自己遵守它所守的纪律）──────────
// 判据 = **夹具仓与调用方仓库是两个不同的仓**，且夹具的提交**没有一条落进调用方仓库**。
// 这是 #110 同族的真实风险（夹具命令打到调用方仓库上）：本用例用 `git -C <TMP>` + 显式清
// `GIT_DIR` 一族来防它，R6 把这条防线的**效果**钉住——而不是去断言"调用方仓库工作树干净"
// （那会把**开发中正常的未提交改动**判成违规，是本仓 §3.1 里"断言自己写错了预期"的形态；
// 初版正是这么写的，实测在本票自己的编辑过程中就假红了一次，记下）。
let fixtureIsSeparate = false
try {
  const callerTop = spawnSync('git', ['-C', REPO, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true })
  const callerHead = spawnSync('git', ['-C', REPO, 'log', '--oneline', '-1'], { encoding: 'utf8', windowsHide: true })
  // ⚠ 判据形态的一处**实测修正**（本轮非空洞探针 P108-5 抓到的**真缺陷**，记下）：
  // 初版把两个"污染信号"**并列**成一条 `A && B`，探针把 B 常量化为 `true` 后**守卫照样绿**
  // —— 因为 A（toplevel 不含夹具名）在正常仓里本就成立，"判据被架空"根本读不出来。
  // 这是本仓 §3.1「断言自己写错了预期」的形态：合取里一条永远为真时，另一条失效**无人察觉**。
  // 修法：把每个信号**各自**断言（下面 CALLER_SIGNALS 逐条判），架空前件必须真红。
  const CALLER_SIGNALS = [
    ['调用方仓库不是那个临时夹具仓（toplevel 不含 dsh-matt-restore-）',
      !(callerTop.stdout ?? '').includes('dsh-matt-restore-'), (callerTop.stdout ?? '').trim()],
    ['夹具的提交没落进调用方历史（HEAD 里无 "base: HEAD 旧版"）',
      !(callerHead.stdout ?? '').includes('base: HEAD 旧版'), (callerHead.stdout ?? '').trim()],
    ['调用方仓库可达（rev-parse 成功 —— 前两条的**前提**，缺了它两条都无意义）',
      callerTop.status === 0 && callerHead.status === 0, `exit ${callerTop.status}/${callerHead.status}`],
  ]
  const failed = CALLER_SIGNALS.filter(([, holds]) => !holds)
  fixtureIsSeparate = failed.length === 0
  if (fixtureIsSeparate) {
    ok('R6. 夹具未污染调用方仓库（逐信号断言：仓不同 + 夹具提交不在调用方历史 + 判据前提成立）',
      `调用方 toplevel=${(callerTop.stdout || '').trim() || '（不可得）'}（${CALLER_SIGNALS.length} 条信号各自成立）`)
  } else {
    bad('R6. 夹具污染了调用方仓库（#110 同族）',
      failed.map(([n, , v]) => `${n} → 实测 ${v}`).join(' ｜ '))
  }
} catch (error) {
  console.log(`  ⚠ R6 SKIP (loud). 无法核验夹具隔离 —— ${String(error?.message ?? error)}；不猜、不报假绿`)
}

// ── R7: **本用例自身不用 `git checkout --` 还原**（自打脸防线）────────────────────
// 一个守"禁 checkout 还原"的用例，若自己用 checkout 还原，就是最坏的那种文档说谎。
// 判据收窄到**还原意图**并**收窄匹配域**（#115 的 C9c 先例：切出节再匹配，不是把正则写紧）：
//   ① 剥注释行（本文件必然要**提到**这两个词才能演示它们）；
//   ② 只认**代码行**里把 checkout/restore 当**还原手段**调用的位置；
//   ③ 豁免必须**显式标记** `R7-EXEMPT:` 且写明它是被测对象 —— 不靠行内巧合过滤
//      （初版曾用 `/expectLost|STATES/` 这类巧合条件放行，实测把演示行判成违规：判据错了，
//       不是那一行错了。修法是**改判据的形态**，见 D13 的教训）。
// ⚠ 声明边界（D13/D15 先例）：这是**写法面**的锁，换体裁（拼接命令串、走 shell 变量）可绕。
//    真正的防线是 R3/R4 的**机制断言**（把手段换成 checkout → R4 直接红）；本条只是廉价的反向
//    自检，**显式声明不覆盖开放集**，不声称已经守住。
const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8')
const codeLines = selfSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))   // 拨掉注释行
const invokesGitRestore = codeLines.filter(l => /['"](checkout|restore)['"]/.test(l))
const unexempted = invokesGitRestore.filter(l => !l.includes('R7-EXEMPT:'))
if (unexempted.length === 0) {
  ok(`R7. 本用例自身**不用** \`git checkout --\` / \`git restore\` 还原（反向自检；边界显式声明）`,
    `${invokesGitRestore.length} 处调用，全部带 R7-EXEMPT 且注明是被测对象；还原一律走副本回写 —— ` +
    '换体裁可绕（声明不覆盖），机制面由 R3/R4 承担')
} else bad('R7. 本用例自己就用 checkout/restore 还原（自打脸）',
  `未豁免的调用: ${unexempted.map(l => l.trim()).join(' | ')}`)

console.log('\n=== RESTORE-DISCIPLINE VERIFY (R0–R7) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)