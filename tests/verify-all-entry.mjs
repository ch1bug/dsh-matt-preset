/**
 * verify-all-entry.mjs — 唯一检查入口 `scripts/verify-all.mjs` **自身**的契约（E1–E14）。
 *
 * Why（邻仓 #83 的同族）：入口的汇总逻辑是纯代码——枚举 `tests/*.mjs`、按退出码与
 * `SKIP (loud)` 分档、区分"缺环境跳过"、给 `hooksPath` 出 advisory、决定进程退出码。
 * 它漂移过一次就没人知道，而**所有**其它守卫都挂在它下面。这里把它当成被测对象：
 * 在一个临时目录里放合成 `tests/` 夹具 + 入口的副本，跑两次。
 *
 *   E1 分档：失败 → FAIL 且整套非零退出；`SKIP (loud)` → PASS*；门禁未开的档 → SKIP
 *      且**真没被执行**（夹具写了标记文件才算跑过）；`preset-harness.mjs` 不是用例
 *   E2 汇总行与退出码：`FAILED — 2/4`（含 loud skip / 缺环境跳过两个计数）→ 修好后
 *      `OK — 3/4` 且退出码 0
 *   E3 `hooks=未设置` 分支：汇总行带该段，且 actionable advisory 仍打印（#69 的修复面）
 *   E4 门禁反向：`DSH_MATT_INSTALLER=1` 时该档**真被执行**（SKIP → PASS）
 *   E5/E6 `hooks=on` / `hooks=off` 两个分支：在**夹具仓**里改 `core.hooksPath`；off 时
 *     汇总行带 off、advisory 指名实际值
 *   E7 运行时依赖缺失时给指路（`ERR_MODULE_NOT_FOUND` → `scripts/link-runtime-deps.mjs`），
 *      且只在那种失败上出现
 *   E8 git **不可用**时静默不猜：汇总行不带 `hooks=`、也不打 advisory（`PATH` 指向不存在的目录，
 *      把 git 藏掉——确定性，不依赖机器上 git 装在哪）
 *   E9 **非 git 仓库**（`git config` 退出 128）同样不猜 —— 别把"没仓库"说成"钩子未设置"
 *   ── 分层（#129，E10–E14 起；夹具另起一个根，免得挪动 E1 的 4 行计数）──────────────
 *   E10 默认层 = 快集：头部块注释里标了 ` * @slow …` 的用例逐行 `SLOW`、**真没被执行**
 *      （留痕文件为证）、汇总带 `N 项 slow 未跑（--all 补全）`、头部写明层
 *   E11 `--all` **真跑**它（留痕在 + 该行 PASS）—— 同一条用例在两个层里给出相反行为，
 *      这条就是票面 AC「把快集用例临时挪进 slow 组 → 两层行为相反」的机械形态
 *   E12 `status === null`（被信号杀掉 / watchdog 超时）单列 `NORUN`，汇总 `INCOMPLETE` + exit 2，
 *      **不混进 FAILED** —— `exit=null` 是"没跑完"，不是"断言不过"
 *   E13 反向自检：正文里出现 `@slow` 这个词 **≠** 标记（该用例默认跑仍被执行），
 *      否则判据会随"谁引用了这个词"而漂
 *   E14 未知开关 / 坏值 → exit 2 + 用法行，且**一个用例都没跑**（拼错的 `--al` 不能被静默
 *      当成默认快集：那会让读数变成"快集全绿"而你以为跑了全量）
 *
 * **环境隔离**：子进程清掉全部 `DSH_MATT_*`（门禁变量会把夹具那档从 SKIP 变成执行，计数随之
 * 漂移；2026-10-17 在 msys 全流程口径下实测红）**与全部 `GIT_*`**（本仓上一个版本在
 * `GIT_DIR=<repo>/.git` 下跑时，夹具的 `git init` 带着外层 `GIT_DIR` 落在了**本仓**上——把
 * `.git/config` 的 `core.bare` 改成了 true，需手工 `git config core.bare false` 修复；同时夹具的
 * "未设置"假设被外层配置污染 → E3 红）。门禁方向由 E4 显式钉住。
 *
 * 非空洞：把入口的 `loud` 判定改成 `false`（PASS* 退化成 PASS）→ E1/E2 红（已实测）。
 */
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fixtureEnv } from './isolated-git.mjs'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const REPO = fileURLToPath(new URL('..', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'dsh-verify-all-entry-'))
const ran = join(root, 'fixture-ran.txt')

try {
  await mkdir(join(root, 'scripts'), { recursive: true })
  await mkdir(join(root, 'tests'), { recursive: true })
  await writeFile(join(root, 'scripts', 'verify-all.mjs'), await readFile(join(REPO, 'scripts', 'verify-all.mjs')))
  // 夹具：ok / loud / fail / 门禁未开的档 / 非用例
  await writeFile(join(root, 'tests', 'ok.mjs'), 'console.log("✓ ok fixture")\n')
  await writeFile(join(root, 'tests', 'loud.mjs'), 'console.log("  !! SKIP (loud) - fixture 环境侧未验证")\n')
  // 夹具失败带上"运行时依赖缺失"的特征串（新 clone 没跑 link-runtime-deps 时用例只能报裸
  // ERR_MODULE_NOT_FOUND）—— E7 据此钉住入口的指路。
  await writeFile(join(root, 'tests', 'fail.mjs'),
    'console.log("Error [ERR_MODULE_NOT_FOUND]: Cannot find package \'yaml\'")\nprocess.exit(1)\n')
  await writeFile(join(root, 'tests', 'verify-installer.mjs'),
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(ran)}, 'ran')\n`)
  await writeFile(join(root, 'tests', 'preset-harness.mjs'),
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(ran + '.harness')}, 'ran')\n`)
  /** 夹具仓的 git 调用**不继承 `GIT_*`**：`GIT_DIR` 一类变量会把夹具的 `git init` / `git config`
   *  指到**外层仓**上（实测：带着 `GIT_DIR=<repo>/.git` 跑旧版本用例，本仓 `.git/config` 的
   *  `core.bare` 被改成 true，且夹具的"未设置"假设失效）。
   *  ⚠ 这段清理**已收敛进共享挂具** `tests/isolated-git.mjs`（#110）：此前 4 个夹具各手写一份、
   *  且没有守卫在看 —— 漏写一处全程静默，直到有人 `git status` 报错。挂具本身由
   *  `tests/verify-isolated-git.mjs` 的 I1（机制实测）/ I2（结构断言）守住。 */
  const cleanGitEnv = (extra = {}) => fixtureEnv(extra)
  const gitIn = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: cleanGitEnv() })
  // advisory / hooks= 的可复现面：git 仓库在位、core.hooksPath 未设置
  gitIn(['init', '-q'])

  /** 入口自测必须**自己隔离环境**：`DSH_MATT_INSTALLER=1` 一类门禁变量会把夹具里那档
   *  从 SKIP 变成真的执行，计数与分档随之漂移（2026-10-17 在 msys 全流程口径下实测红）。
   *  清掉 `DSH_MATT_*` 与 `GIT_*` 让 E1–E3/E5–E6 确定；门禁打开的行为由 E4 显式钉住。 */
  const envFor = (extra = {}) => {
    const env = cleanGitEnv()
    for (const key of Object.keys(env)) if (key.startsWith('DSH_MATT_')) delete env[key]
    return { ...env, ...extra }   // 先清、再合：否则刚给的门禁变量会被同一条清理删掉
  }
  const run = (extra) => {
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'verify-all.mjs')], { cwd: root, encoding: 'utf8', env: envFor(extra) })
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }
  /** 汇总行（末行）：E5/E6 的失败详情只看这一段，别把整个夹具输出倒进报告。 */
  const summaryLine = (out) => out.split('\n').map(l => l.trim()).filter(l => /通过|hooks=/.test(l)).pop() ?? '(无汇总行)'

  const first = run()
  const rows = first.out.split('\n').filter(l => /^\s+(PASS\*?|FAIL|SKIP)\s/.test(l))
  const has = (re) => re.test(first.out)

  // E1
  const classified = rows.length === 4
    && rows.some(l => /^\s+PASS\*\s+.*loud\.mjs/.test(l))
    && rows.some(l => /^\s+FAIL\s+.*fail\.mjs/.test(l))
    && rows.some(l => /^\s+SKIP\s+.*verify-installer\.mjs/.test(l))
    && rows.some(l => /^\s+PASS\s+.*ok\.mjs/.test(l))
    && !existsSync(ran)                       // 门禁未开的档没被执行
    && !existsSync(ran + '.harness')          // 非用例（preset-harness）没被执行
  if (classified) ok('E1. 分档正确（PASS / PASS* / FAIL / SKIP）且跳过的档真没跑', `${rows.length} 行`)
  else bad('E1. 分档或跳过语义不对', rows.join(' | ') || first.out.slice(0, 300))

  // E2
  if (first.status !== 0 && has(/FAILED — 2\/4/) && has(/1 项含 loud skip/) && has(/1 项因缺环境跳过/)) {
    ok('E2a. 失败汇总行 + 非零退出码（2/4、loud skip、缺环境跳过三个计数都对）')
  } else {
    bad('E2a. 汇总行/退出码不对', `status=${first.status} | ${(first.out.split('\n').at(-2) ?? '').trim()}`)
  }
  await writeFile(join(root, 'tests', 'fail.mjs'), 'console.log("✓ fail fixture fixed")\n')
  const second = run()
  if (second.status === 0 && /OK — 3\/4/.test(second.out)) {
    ok('E2b. 修好后 OK — 3/4 且退出码 0')
  } else {
    bad('E2b. 修好后的汇总不对', `status=${second.status} | ${(second.out.split('\n').at(-2) ?? '').trim()}`)
  }

  // E3（#69）：hooks= 的"未设置"分支 —— 汇总行带 hooks=未设置，且 actionable advisory 仍打印
  if (has(/hooks=未设置/) && has(/pre-commit 钩子未启用/)) {
    ok('E3. hooks=未设置：汇总行带该段 + advisory 仍打印（未设置 → 响亮提示）')
  } else {
    bad('E3. hooks=未设置 分支不对',
      `hooks=${/hooks=\S+/.exec(first.out)?.[0] ?? '(缺)'} advisory=${has(/pre-commit 钩子未启用/)}`)
  }

  // E4：门禁打开的反向 —— `DSH_MATT_INSTALLER=1` 时那一档**真的被执行**（PASS 而非 SKIP）。
  // 这条同时是 E1 里"清 DSH_MATT_*"的理由：入口的分档随环境变量而变，自测必须控制它。
  await writeFile(join(root, 'tests', 'fail.mjs'), 'console.log("✓ fail fixture fixed")\n')
  await rm(ran, { force: true })
  const gated = run({ DSH_MATT_INSTALLER: '1' })
  if (gated.status === 0 && existsSync(ran) && /PASS\s+verify-installer\.mjs/.test(gated.out) && !/SKIP\s+verify-installer\.mjs/.test(gated.out)) {
    ok('E4. 门禁打开时该档真被执行（SKIP → PASS，夹具标记为证）')
  } else {
    bad('E4. 门禁方向不对', `status=${gated.status} fixtureRan=${existsSync(ran)} | ${(gated.out.split('\n').filter(l => l.includes('verify-installer'))[0] ?? '').trim()}`)
  }

  // E5/E6（#69）：hooks= 的另两个分支 —— 只改**夹具仓**的 core.hooksPath（子进程 env 已清
  // GIT_*，否则在真 pre-commit 钩子下这个探针会读到外层仓，分支就不受夹具控制了）。
  gitIn(['config', 'core.hooksPath', '.githooks'])
  const onRun = run()
  if (/hooks=on/.test(onRun.out) && !/pre-commit 钩子未启用/.test(onRun.out)) {
    ok('E5. hooks=on：汇总行带 on，advisory 不再打印（已启用 → 静默）')
  } else {
    bad('E5. hooks=on 分支不对', `status=${onRun.status} | ${summaryLine(onRun.out)}`)
  }
  gitIn(['config', 'core.hooksPath', '/tmp/other-hooks'])
  const offRun = run()
  if (/hooks=off/.test(offRun.out) && /pre-commit 钩子未启用/.test(offRun.out) && offRun.out.includes('/tmp/other-hooks')) {
    ok('E6. hooks=off：汇总行带 off，advisory 指名实际值')
  } else {
    bad('E6. hooks=off 分支不对', `status=${offRun.status} | ${summaryLine(offRun.out)}`)
  }

  // E7（#69 高危①）：运行时依赖缺失（`ERR_MODULE_NOT_FOUND`）时入口给一行指路；
  // 修好后的那次运行（`second`）不得再出现 —— 否则就是无条件噪音，不是"指路"。
  if (has(/node scripts\/link-runtime-deps\.mjs/) && !/link-runtime-deps/.test(second.out)) {
    ok('E7. ERR_MODULE_NOT_FOUND 时指路 link-runtime-deps，且只在这种失败上出现')
  } else {
    bad('E7. 运行时依赖指路不对',
      `first=${has(/link-runtime-deps/)} second=${/link-runtime-deps/.test(second.out)}`)
  }

  // E8（#69 口径：git 不可用时**静默不猜**）：PATH 指向不存在的目录 → spawn `git` ENOENT →
  // 汇总行不带 `hooks=`、也不打 advisory。夹具测试走绝对 `process.execPath`，不受 PATH 影响。
  const noGit = run({ PATH: join(root, 'no-such-bin') })
  if (!/hooks=/.test(noGit.out) && !/pre-commit 钩子未启用/.test(noGit.out)) {
    ok('E8. git 不可用 → 汇总行不带 hooks=、也不猜（不改 exit code）')
  } else {
    bad('E8. git 不可用时猜了门禁状态', `status=${noGit.status} | ${summaryLine(noGit.out)}`)
  }

  // E9：**git 可用但不在仓里**（退出 128）也不能当成"键未设置"——那会把"没仓库"说成"钩子未设置"。
  // 夹具放在 `root` 之外：仓内任何子目录都会被 `git config` 向上找到 `root/.git`。
  const outside = await mkdtemp(join(tmpdir(), 'dsh-verify-all-nogit-'))
  try {
    await mkdir(join(outside, 'scripts'), { recursive: true })
    await mkdir(join(outside, 'tests'), { recursive: true })
    await writeFile(join(outside, 'scripts', 'verify-all.mjs'), await readFile(join(REPO, 'scripts', 'verify-all.mjs')))
    await writeFile(join(outside, 'tests', 'ok.mjs'), 'console.log("✓ ok fixture")\n')
    const nonRepo = spawnSync(process.execPath, [join(outside, 'scripts', 'verify-all.mjs')],
      { cwd: outside, encoding: 'utf8', env: envFor() })
    const nonRepoOut = `${nonRepo.stdout ?? ''}${nonRepo.stderr ?? ''}`
    if (!/hooks=/.test(nonRepoOut) && !/pre-commit 钩子未启用/.test(nonRepoOut)) {
      ok('E9. 非 git 仓库 → 同样不猜门禁状态（128 ≠ 未设置）')
    } else {
      bad('E9. 非 git 仓库时猜了门禁状态', `status=${nonRepo.status} | ${summaryLine(nonRepoOut)}`)
    }
  } finally {
    await rm(outside, { recursive: true, force: true })
  }

  // ══ 分层（#129）：E10–E14 —— 在**第二个**夹具根里跑 ═══════════════════════════════
  // 为什么不复用上面的 `root`：E1 钉的是"4 行、四档各一"的形态，往那套夹具里塞 @slow 用例会
  // 把那条计数挪掉 —— 两套夹具各管一件事，判据互不牵连。
  const layerRoot = await mkdtemp(join(tmpdir(), 'dsh-verify-all-layers-'))
  try {
    await mkdir(join(layerRoot, 'scripts'), { recursive: true })
    await mkdir(join(layerRoot, 'tests'), { recursive: true })
    await writeFile(join(layerRoot, 'scripts', 'verify-all.mjs'), await readFile(join(REPO, 'scripts', 'verify-all.mjs')))
    const mark = (name) => join(layerRoot, name)
    // 快集用例：一跑就留痕（"真没执行"只能靠留痕判，不能靠行文）
    await writeFile(join(layerRoot, 'tests', 'fast.mjs'),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(mark('ran-fast.txt'))}, 'ran')\nconsole.log('✓ fast fixture')\n`)
    // 标了 @slow 的用例：头部块注释里单起一行 `* @slow …`（这就是标记的全部语法）
    await writeFile(join(layerRoot, 'tests', 'slow.mjs'),
      '/**\n * slow.mjs — fixture（#129 分层用）\n * @slow fixture：标记本身才是判据，读数无所谓\n */\n' +
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(mark('ran-slow.txt'))}, 'ran')\nconsole.log('✓ slow fixture')\n`)
    // 标了 @slow 且**会挂住**：只用来验 watchdog 的 NORUN 读数（快集里它被跳过，不会真挂）
    await writeFile(join(layerRoot, 'tests', 'hang.mjs'),
      '/**\n * hang.mjs — fixture（#129 watchdog 用）\n * @slow fixture：挂住 60s，只有 --timeout 能让它结束\n */\n' +
      'setTimeout(() => {}, 60000)\n')
    // 反向自检（E13）：正文里有 '@slow' 这个词，但头部**不是**标记 —— 它必须照常执行
    await writeFile(join(layerRoot, 'tests', 'mentions.mjs'),
      `import { writeFileSync } from 'node:fs'\nconst word = '@slow'\nwriteFileSync(${JSON.stringify(mark('ran-mentions.txt'))}, word)\nconsole.log('✓ mentions fixture')\n`)

    const runL = (args, extra = {}) => {
      const r = spawnSync(process.execPath, [join(layerRoot, 'scripts', 'verify-all.mjs'), ...args],
        { cwd: layerRoot, encoding: 'utf8', env: envFor(extra) })
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    }
    const ROW_RE = /^\s+(PASS\*?|FAIL|NORUN|SKIP|SLOW)\s/

    // E10：默认层 = 快集 —— @slow 用例逐行 SLOW，且**真没被执行**（留痕为证）+ 汇总计数 + 头部写明层
    const fastRun = runL([])
    const fastSkipped = /^\s+SLOW\s+slow\.mjs/m.test(fastRun.out) && /^\s+SLOW\s+hang\.mjs/m.test(fastRun.out)
    if (fastRun.status === 0 && /^\s+PASS\s+fast\.mjs/m.test(fastRun.out) && fastSkipped
      && existsSync(mark('ran-fast.txt')) && !existsSync(mark('ran-slow.txt'))
      && /快集（默认）/.test(fastRun.out) && /2 项 slow 未跑（--all 补全）/.test(fastRun.out)) {
      ok('E10. 默认快集：`@slow` 用例逐行 SLOW 且**真没执行**（留痕为证）+ 汇总计数 + 头部标层')
    } else {
      bad('E10. 默认层的 slow 判定/跳过后读数不对',
        `status=${fastRun.status} fastRan=${existsSync(mark('ran-fast.txt'))} slowRan=${existsSync(mark('ran-slow.txt'))} | ` +
        fastRun.out.split('\n').filter(l => /fast\.mjs|slow\.mjs|hang\.mjs|slow 未跑/.test(l)).join(' ｜ ').slice(0, 400))
    }

    // E11/E12：`--all` 真跑 slow（同一条用例在两个层里行为相反）；watchdog 杀掉的那项单列 NORUN
    const allRun = runL(['--all', '--timeout=2500'])
    if (existsSync(mark('ran-slow.txt')) && /^\s+PASS\s+slow\.mjs/m.test(allRun.out) && /全量（--all）/.test(allRun.out)) {
      ok('E11. `--all` **真跑**它（留痕文件在 + 该行 PASS）—— 同一条用例在两层里给出相反行为')
    } else {
      bad('E11. `--all` 没有真跑 slow 用例',
        `slowRan=${existsSync(mark('ran-slow.txt'))} | ${allRun.out.split('\n').filter(l => /slow\.mjs|全量/.test(l)).join(' ｜ ').slice(0, 300)}`)
    }
    const norunRow = allRun.out.split('\n').find(l => /^\s+NORUN\s+hang\.mjs/.test(l)) ?? '(无 NORUN 行)'
    if (allRun.status === 2 && norunRow !== '(无 NORUN 行)'
      && /未跑完/.test(norunRow) && /signal=/.test(norunRow) && /不是「用例失败」/.test(norunRow)
      && /^INCOMPLETE —/m.test(allRun.out) && !/^FAILED —/m.test(allRun.out)) {
      ok('E12. `status === null` 单列 NORUN + 汇总 INCOMPLETE（exit 2），**不混进 FAILED**',
        norunRow.trim().slice(0, 120))
    } else {
      bad('E12. 没有退出码的那项读法与"失败"不可区分（或判据没生效）',
        `status=${allRun.status} | ${norunRow.trim()} | 汇总: ${(allRun.out.split('\n').filter(l => /INCOMPLETE|FAILED/.test(l))[0] ?? '(无)').trim()}`)
    }

    // E13：反向自检 —— 判据只认头部块注释里的标记行；正文出现这个词**不**降级成 slow
    if (/^\s+PASS\s+mentions\.mjs/m.test(fastRun.out) && existsSync(mark('ran-mentions.txt'))
      && !/^\s+SLOW\s+mentions\.mjs/m.test(fastRun.out)) {
      ok('E13. 反向自检：正文里的 `@slow` 字样 ≠ 标记（该用例默认跑**仍被执行**）')
    } else {
      bad('E13. 正文提到 `@slow` 就被跳过了（判据过宽：会随"谁引用这个词"而漂）',
        `ran=${existsSync(mark('ran-mentions.txt'))} | ${(fastRun.out.split('\n').find(l => l.includes('mentions.mjs')) ?? '(无该行)').trim()}`)
    }

    // E14：拼错的开关不能被静默忽略（否则读数是"快集全绿"而你以为跑了全量）；坏值同理
    await rm(mark('ran-fast.txt'), { force: true })
    const badFlag = runL(['--al'])
    const badValue = runL(['--timeout=abc'])
    if (badFlag.status === 2 && badValue.status === 2
      && /不认识的参数/.test(badFlag.out) && /用法: node scripts\/verify-all\.mjs/.test(badFlag.out)
      && /不认识的参数/.test(badValue.out) && !existsSync(mark('ran-fast.txt'))) {
      ok('E14. 未知开关 / 坏值 → exit 2 + 用法行，且**一个用例都没跑**（拼错不被静默当成默认层）')
    } else {
      bad('E14. 未知开关被静默放过（或没跑用例判不出来）',
        `--al:${badFlag.status} --timeout=abc:${badValue.status} ranFast=${existsSync(mark('ran-fast.txt'))} | ${(badFlag.out.split('\n')[0] ?? '').slice(0, 160)}`)
    }
  } finally {
    await rm(layerRoot, { recursive: true, force: true })
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('\n=== VERIFY-ALL ENTRY VERIFY (E1–E14) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)