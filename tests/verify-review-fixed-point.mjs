/**
 * verify-review-fixed-point.mjs —— `scripts/review-fixed-point.mjs` 的验收（F1–F5）。
 *
 * 为什么存在：该脚本是「先提交再复核」这条**主防线**的机械闸（`docs/code-review-brief.md` §1）。
 * 而本仓对"闸"类东西的既有教训（D47 / D2）：**闸自己坏了会静默放行**，而放行的表现是
 * "复核照常进行、两轴照常出报告"——**没有任何一处会因此变红**。故必须有自己的守卫。
 *
 * 判据（每条都要说得出红场景）：
 *   F1 正向：固定点可解析 + 工作树干净 + diff 非空 → **exit 0**，且打印固定点/HEAD/笔数。
 *   F2 坏 ref → **exit 1** 且指名"不可解析"（不静默当 0 笔）。
 *   F3 **主判据**：工作树有未提交改动 → **exit 1** 且**列出是哪些文件**（这条治 A 批 4 次复发）。
 *   F4 固定点 == HEAD（空 diff）→ **exit 1**（空 diff 会在两轴里炸成假发现）。
 *   F5 缺参数 → **exit 1** + 用法（不静默按 HEAD 跑）。
 *
 * **非空洞**：F2–F5 各自构造**真实的反例输入**（真坏 ref / 真改一个文件 / 真取 HEAD / 真空 argv），
 * 逐条断言真红。扰动落在 `os.tmpdir()` 的**镜像仓**上（真树零改动）；
 * 还原一律**副本回写**（#108 纪律：禁用 `git checkout --` / `git restore` 作还原手段）。
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { fixtureEnv, gitIn } from './isolated-git.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const loud = (name, why) => results.push('  ⤼ SKIP (loud) ' + name + ' — ' + why)

const SCRIPT_REL = join('scripts', 'review-fixed-point.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'dsh-matt-review-fp-'))

/** 跑脚本（在给定仓根下），返回 {status, out}。 */
const run = (repoDir, args = []) => {
  const r = spawnSync(process.execPath, [join(repoDir, SCRIPT_REL), ...args], { encoding: 'utf8', windowsHide: true })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * 造一个**独立的小仓**当夹具（不复用真仓 —— 真仓的状态是开发态的，别拿它当判据输入）。
 * 三个提交：c1 / c2 / c3，便于构造"固定点 → HEAD 有 diff"。
 */
function buildFixtureRepo() {
  const dir = mkdtempSync(join(ROOT, 'repo-'))
  cpSync(join(REPO, SCRIPT_REL), join(dir, SCRIPT_REL))
  // ⚠ git 调用走**共享挂具** `tests/isolated-git.mjs`（#110）：本函数**自建仓**，
  //   与原样继承钩子导出的 `GIT_DIR` 会让 `git init` 打到**调用方仓**上
  //   （实测：共享 `.git/config` 的 `core.bare` 被写成 `true`）。
  //   本文件初版是**手写**清理的 —— 被 `tests/verify-isolated-git.mjs` 的 I2 结构断言当场抓红
  //   （"病灶复发"），那正是该断言存在的理由。此处改走挂具。
  const g = (...a) => gitIn(dir, fixtureEnv())(...a)
  g('init', '-q', '-b', 'main')
  const seed = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid']
  for (const n of ['c1', 'c2', 'c3']) {
    writeFileSync(join(dir, `${n}.txt`), `${n}\n`)
    g('add', '-A')
    g(...seed, 'commit', '-q', '-m', n)
  }
  g('symbolic-ref', 'HEAD', 'refs/heads/main')
  const first = g('rev-list', '--max-parents=0', 'HEAD').stdout.trim()
  return { dir, g, first, seed }
}

try {
  const fx = buildFixtureRepo()
  const { dir, first } = fx

  // ── F1 正向：第一个提交当固定点 → HEAD 领先 2 笔、工作树干净 → exit 0 ──────────
  {
    const r = run(dir, [first])
    const hasAll = /可派两轴复核/.test(r.out) && /固定点/.test(r.out) && /HEAD/.test(r.out) && /diff/.test(r.out)
    if (r.status === 0 && hasAll) {
      ok('F1. 固定点可解析 + 工作树干净 + diff 非空 → exit 0，且打印固定点/HEAD/diff', r.out.trim().split('\n')[1]?.trim() ?? '')
    } else {
      bad('F1. 正向场景未放行（闸坏了 → 会静默挡住正常复核）', `exit ${r.status}｜${r.out.trim().split('\n')[0] ?? ''}`)
    }
  }

  // ── F2 坏 ref → exit 1 且指名"不可解析" ────────────────────────────────────────
  {
    const r = run(dir, ['deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'])
    if (r.status === 1 && /不可解析/.test(r.out)) {
      ok('F2. 坏 ref → exit 1 且指名"固定点不可解析"（不静默当 0 笔）', 'exit 1')
    } else {
      bad('F2. 坏 ref 未被拦（或措辞不符）', `exit ${r.status}｜${r.out.trim().split('\n')[0] ?? ''}`)
    }
  }

  // ── F3 **主判据**：工作树有未提交改动 → exit 1 且**列出文件** ────────────────────
  // 这条就是 A 批复发 4 次的那个场景：改动没提交就派了两轴。
  {
    const TARGET = join(dir, 'c1.txt')
    const BACKUP = readFileSync(TARGET)                       // 副本（#108：还原用副本回写）
    writeFileSync(TARGET, 'UNCOMMITTED EDIT\n')
    const r = run(dir, [first])
    writeFileSync(TARGET, BACKUP)                             // 副本回写还原（禁用 git checkout --）
    const listed = /c1\.txt/.test(r.out)
    if (r.status === 1 && /工作树不干净/.test(r.out) && listed) {
      ok('F3. **主判据**：工作树有未提交改动 → exit 1，且**列出是哪些文件**（治 A 批 4 次复发）',
        '未提交改动被拦住并指名')
    } else {
      bad('F3. 工作树脏时未拦（或未列出文件）—— 这条闸失效则"先提交再复核"重新变成自觉',
        `exit ${r.status}｜列出 c1.txt = ${listed}`)
    }
  }

  // ── F4 固定点 == HEAD（空 diff）→ exit 1 ──────────────────────────────────────
  // ⚠ 判据的**非空洞修正**（本守卫第 1 轮自己的扰动取证抓到的**真缺陷**，记下）：
  //   初版断言 `/没有可复核的 diff|为空/` —— 而脚本里有**两条**分支都会说"空"：
  //   ① `FP_SHA === head`（固定点就是 HEAD）② `diffLines === 0`（diff 为空）。
  //   扰动把 ① 关掉之后，②**照样**拦下并打出含"为空"的消息 ⇒ **F4 依旧绿** ——
  //   即 F4 的判据被它**相邻的另一条**分支满足了，是"锁是空的"形态（D2）。
  //   修法：判据**钉住该分支独有的措辞**（`固定点 == HEAD`），两分支各判各的。
  {
    const r = run(dir, ['HEAD'])
    const ownMsg = /固定点 == HEAD/.test(r.out)
    if (r.status === 1 && ownMsg) {
      ok('F4. 固定点 == HEAD → exit 1，且打的是**该分支独有**的消息（不被相邻分支代偿）', 'exit 1')
    } else {
      bad('F4. 空 diff 未拦，或判据被相邻分支代偿（D2：锁是空的）',
        `exit ${r.status}｜自有消息在场 = ${ownMsg}`)
    }
  }

  // ── F5 缺参数 → exit 1 + 用法 ────────────────────────────────────────────────
  {
    const r = run(dir, [])
    if (r.status === 1 && /用法/.test(r.out)) {
      ok('F5. 缺参数 → exit 1 + 打印用法（不静默按 HEAD 跑）', 'exit 1')
    } else {
      bad('F5. 缺参数未响亮', `exit ${r.status}｜${r.out.trim().split('\n')[0] ?? ''}`)
    }
  }
} catch (error) {
  bad('F0. 夹具可建立（三个提交的小仓）', String(error?.message ?? error))
} finally {
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 3 })
}

if (results.length === 0) loud('F1–F5', '未产生任何读数 —— 不报假绿')

console.log('\n=== REVIEW-FIXED-POINT VERIFY (F1–F5) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)