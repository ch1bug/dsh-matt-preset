/**
 * verify-all-entry.mjs — 唯一检查入口 `scripts/verify-all.mjs` **自身**的契约（E1–E3）。
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
 *   E3 老守卫不被吞掉：`core.hooksPath` advisory 仍打印（#69 的修复面）
 *   E4 门禁反向：`DSH_MATT_INSTALLER=1` 时该档**真被执行**（SKIP → PASS）
 *
 * **环境隔离**：E1–E3 的子进程清掉全部 `DSH_MATT_*` —— 门禁变量会把夹具那档从 SKIP 变成
 * 执行，计数随之漂移（2026-10-17 在 msys 全流程口径下实测红）；门禁方向由 E4 显式钉住。
 *
 * 非空洞：把入口的 `loud` 判定改成 `false`（PASS* 退化成 PASS）→ E1/E2 红（已实测）。
 */
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
  await writeFile(join(root, 'tests', 'fail.mjs'), 'console.log("✗ fail fixture"); process.exit(1)\n')
  await writeFile(join(root, 'tests', 'verify-installer.mjs'),
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(ran)}, 'ran')\n`)
  await writeFile(join(root, 'tests', 'preset-harness.mjs'),
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(ran + '.harness')}, 'ran')\n`)
  // advisory 的可复现面：git 仓库在位、core.hooksPath 未设置
  spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' })

  /** 入口自测必须**自己隔离环境**：`DSH_MATT_INSTALLER=1` 一类门禁变量会把夹具里那档
   *  从 SKIP 变成真的执行，计数与分档随之漂移（2026-10-17 在 msys 全流程口径下实测红）。
   *  清掉 `DSH_MATT_*` 让 E1–E3 确定；门禁打开的行为由 E4 显式钉住。 */
  const envFor = (extra = {}) => {
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (key.startsWith('DSH_MATT_')) delete env[key]
    return { ...env, ...extra }   // 先清、再合：否则刚给的门禁变量会被同一条清理删掉
  }
  const run = (extra) => {
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'verify-all.mjs')], { cwd: root, encoding: 'utf8', env: envFor(extra) })
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

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

  // E3：core.hooksPath 未设置时应出 advisory（#69 的修复面，别被后续改动吞掉）
  if (has(/pre-commit 钩子未启用/)) ok('E3. core.hooksPath advisory 仍打印（未设置 → 响亮提示）')
  else bad('E3. hooksPath advisory 丢了', first.out.slice(0, 200))

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
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('\n=== VERIFY-ALL ENTRY VERIFY (E1–E4) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)