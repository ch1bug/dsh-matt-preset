/**
 * verify-all.mjs —— 本仓**唯一**检查入口（retro 2026-10-16 第 1 条）。
 *
 * 为什么存在：本仓不用 GitHub Actions，本地套件即唯一验收通道（CONTEXT 明文），
 * 但此前没有任何一条命令能跑它 —— README 手列 14 条 `node tests/*.mjs`，每个会话
 * 都要重新挑选、并靠记性排除环境依赖项。本脚本固化那份挑选。
 *
 * 用法：node scripts/verify-all.mjs   （等价：pnpm test / npm test）
 * 环境变量（未设置时对应项响亮跳过，不阻塞常规套件）：
 *   DSH_MATT_INSTALLER=1   跑 verify-installer.mjs（需要本机有 dsh profile 布局）
 *   DSH_MATT_E2E=1         跑 sandcastle-e2e.mjs（需要 podman）
 *   DSH_MATT_LIVE_CLI      live 用例的门禁（见 README「环境侧用例的门禁」）
 *   DSH_MATT_LIVE_HOME     同上（安装/配置/会话环）
 *   DEEPSEEK_API_KEY       真实 LLM 层（或 DSH_MATT_REAL_CREDENTIALS_SOURCE）
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 非用例文件（共享挂具）与需要外部环境、默认跳过的用例。 */
const NOT_A_TEST = new Set(['preset-harness.mjs'])
const OPT_IN = new Map([
  ['verify-installer.mjs', { flag: 'DSH_MATT_INSTALLER', why: '需要本机存在 dsh profile 布局' }],
  ['sandcastle-e2e.mjs', { flag: 'DSH_MATT_E2E', why: '需要 podman' }],
])

const files = readdirSync(join(REPO, 'tests'))
  .filter(f => f.endsWith('.mjs') && !NOT_A_TEST.has(f))
  .sort()

const rows = []
for (const file of files) {
  const optIn = OPT_IN.get(file)
  if (optIn !== undefined && process.env[optIn.flag] !== '1') {
    rows.push({ file, status: 'SKIP', detail: `${optIn.why} —— 设 ${optIn.flag}=1 开启` })
    continue
  }
  const started = Date.now()
  const run = spawnSync(process.execPath, [join(REPO, 'tests', file)], {
    cwd: REPO,
    encoding: 'utf8',
    env: process.env,
  })
  const ms = Date.now() - started
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  // 用例自己用 SKIP (loud) 声明未验证的部分——如实照搬，不粉饰成通过
  const loud = /SKIP \(loud\)/.test(output)
  rows.push({
    file,
    status: run.status === 0 ? (loud ? 'PASS*' : 'PASS') : 'FAIL',
    detail: run.status === 0 ? `${ms}ms` : `exit ${run.status}`,
    output: run.status === 0 ? undefined : output,
  })
}

const label = { PASS: 'PASS', 'PASS*': 'PASS*', FAIL: 'FAIL', SKIP: 'SKIP' }
console.log('\n=== verify-all ===')
for (const r of rows) console.log(`  ${label[r.status].padEnd(6)} ${r.file.padEnd(38)} ${r.detail}`)

const failures = rows.filter(r => r.status === 'FAIL')
for (const f of failures) {
  console.log(`\n--- ${f.file} (${f.detail}) ---`)
  console.log((f.output ?? '').split('\n').slice(-25).join('\n'))
}

const passed = rows.filter(r => r.status === 'PASS' || r.status === 'PASS*').length
const skipped = rows.filter(r => r.status === 'SKIP').length
const partial = rows.filter(r => r.status === 'PASS*').length
console.log(
  `\n${failures.length === 0 ? 'OK' : 'FAILED'} — ${passed}/${rows.length} 通过` +
    (partial > 0 ? `（其中 ${partial} 项含 loud skip：其环境侧断言未验证）` : '') +
    (skipped > 0 ? `，${skipped} 项因缺环境跳过（见上）` : ''),
)
process.exit(failures.length > 0 ? 1 : 0)