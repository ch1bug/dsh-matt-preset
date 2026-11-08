/**
 * verify-ps7-reminder.mjs — PS7 hook 组件判据面守卫（#60）。
 *
 * 为什么存在：ps7-reminder 是「Windows-only + pwsh 7+ 缺席 → 每会话一次注入
 * MS Store 安装提醒」的 hook 组件（同族 workflow-enforcer / lang-enforcer，
 * reminder only）。四条 AC 里三条是环境态（只有 5.x / pwsh 在位 / 非
 * Windows），真机只能实测其中一种组合——守卫把**全部三态 + once-per-session
 * + scope 守卫**做成注入式机械断言（config.env 缝），任何主机上都可复跑；
 * 真机实况读数单独落证据（本机 pwsh 7 在位 → remind:false），缺席面在本机
 * 无法物理移除 pwsh，由注入式断言覆盖并如实声明。
 *
 * 另外钉两处登记面（W6/W7 先例）：
 *   - 载体面：四份生成载体各有 ps7-reminder 行（in-repo name 前半由
 *     verify-row-deps 的 IN_REPO 判据断，#60 归档：该行 name =
 *     dsh-matt-preset/ps7-reminder.mjs → in-repo，非 opt-in，不进 tierRegistry）；
 *   - exports/plugin-meta 面：package.json 子路径导出 + plugin-meta 三文件。
 *
 * 断言（P = PS7）：
 *   P1  模块契约：inject == ['systemPrompt']；apply 注册恰好一个
 *       system-prompt/assemble listener。
 *   P2  检测三态（detectPowerShellState 注入 env）：win32+pwsh 缺席 →
 *       remind:true/pwsh-absent；win32+pwsh 在 PATH → remind:false/
 *       pwsh-present 且 pwshPath 指向该目录；非 win32 → remind:false/
 *       not-windows 且惰性（exists 探针一次都不被调）。
 *   P3  AC1 注入面（win32 + pwsh 缺席，注入 env）：matt 会话首次 assemble
 *       注入 env:ps7 节（Microsoft Store 锚），同会话第二次零注入（once per
 *       session）；新 session 首次再注入一次。
 *   P4  AC2 pwsh 在位（win32 + pwsh 在 PATH，注入 env）：两次 assemble 零注入。
 *   P5  AC3 非 Windows（注入 env platform linux）：两次 assemble 零注入。
 *   P6  scope 守卫：marker 缺失的组装不注入且**不消费** once——同一会话随后
 *       带 marker 的组装仍注入（静默缺失的反面）。
 *   P7  载体面：四份生成载体各有 `- id: ps7-reminder` + in-repo name。
 *   P8  exports/plugin-meta 面：package.json 两条子路径导出精确值；
 *       plugin-meta/ps7-reminder/{icon.svg,locale/en.json,locale/zh.json} 在盘。
 *   P9  提醒文本契约：[env:ps7] 头 + Microsoft Store 锚 + reminder-only 措辞
 *       （do not block / do not install）；SECTION_ORDER 97（在 gates 95 /
 *       lang 96 之后）。
 *
 * 判定层：静态声明面 + 模块级动态验证（插件文件零依赖，mock ctx 直接调
 * apply）。运行时挂载激活属环境侧事实，由挂具面（preset-harness）覆盖。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

const lf = (text) => String(text).replace(/\r\n/g, '\n')

let mod = null
try {
  mod = await import(pathToFileURL(join(repo, 'ps7-reminder.mjs')).href)
} catch (error) {
  bad('P1. plugin module imports', String(error?.stack ?? error))
  report('PS7 REMINDER VERIFY (#60)')
}

// mock ctx（verify-lang-enforcer 同形态）：捕获 listener，assemble 手动驱动。
function makeCtx() {
  const handlers = {}
  return {
    handlers,
    on: (ev, fn) => { (handlers[ev] ??= []).push(fn) },
    logger: () => ({ warn() {} }),
  }
}

const mattSections = [{ name: 'persona', text: 'ask-matt workflow map — MAIN FLOW, gates…' }]
const plainSections = [{ name: 'persona', text: 'a non-workflow persona — no marker here' }]
const ps7Text = (assembled) =>
  (assembled?.sections ?? []).filter(s => s?.name === 'env:ps7').map(s => s.text).join('\n')

/** Drive one assemble through the captured listener. `next()` returns the
 * base assembly, exactly like the real downstream composer. */
async function assemble(ctx, agent, baseSections) {
  let out
  for (const fn of ctx.handlers['system-prompt/assemble'] ?? []) {
    const base = { sections: baseSections }
    out = await fn(base, { agent }, async () => base)
  }
  return out
}

// ── P1: module contract ──────────────────────────────────────────────────────
{
  const problems = []
  if (JSON.stringify(mod.inject) !== JSON.stringify(['systemPrompt'])) {
    problems.push(`inject=${JSON.stringify(mod.inject)} — 须为 ['systemPrompt']`)
  }
  const ctx = makeCtx()
  mod.apply(ctx, {})
  const listeners = (ctx.handlers['system-prompt/assemble'] ?? []).length
  if (listeners !== 1) problems.push(`assemble listeners=${listeners} — 须恰一个`)
  if (problems.length === 0) ok('P1. module contract (inject + one assemble listener)', mod.name)
  else bad('P1. module contract', problems.join(' | '))
}

// ── P2: detection three-state (injected env, host-independent) ───────────────
{
  const absent = mod.detectPowerShellState({ platform: 'win32', path: 'C:\\Windows;C:\\bin', exists: () => false })
  const present = mod.detectPowerShellState({ platform: 'win32', path: 'C:\\Windows;C:\\pwsh7;C:\\bin', exists: (p) => p === join('C:\\pwsh7', 'pwsh.exe') })
  let probed = 0
  const linux = mod.detectPowerShellState({ platform: 'linux', path: '/usr/bin', exists: () => { probed += 1; return false } })
  const p2 = []
  if (absent.remind !== true || absent.why !== 'pwsh-absent') p2.push(`win32 absent → ${JSON.stringify(absent)}`)
  if (present.remind !== false || present.why !== 'pwsh-present' || present.pwshPath !== join('C:\\pwsh7', 'pwsh.exe')) {
    p2.push(`win32 present → ${JSON.stringify(present)}`)
  }
  if (linux.remind !== false || linux.why !== 'not-windows') p2.push(`linux → ${JSON.stringify(linux)}`)
  if (probed !== 0) p2.push(`非 win32 仍调了 exists 探针 ${probed} 次——平台惰性破洞`)
  if (p2.length === 0) ok('P2. detection three-state (absent/present/not-windows; not-windows probes nothing)', 'injected env')
  else bad('P2. detection three-state', p2.join(' | '))
}

// ── P3: AC1 — win32 + pwsh absent → injected once per session ────────────────
{
  const env = { platform: 'win32', path: 'C:\\Windows', exists: () => false }
  const ctx = makeCtx()
  mod.apply(ctx, { env })
  const session = {}
  const agent = { session }
  const a1 = await assemble(ctx, agent, mattSections)
  const a2 = await assemble(ctx, agent, mattSections)
  const fresh = await assemble(ctx, { session: {} }, mattSections)
  const p3 = []
  if (!ps7Text(a1).includes('Microsoft Store') || !ps7Text(a1).startsWith('[env:ps7]')) {
    p3.push('first assemble did not carry the [env:ps7] reminder')
  }
  if (ps7Text(a2) !== '') p3.push('same-session second assemble re-injected — once-per-session broken')
  if (!ps7Text(fresh).includes('Microsoft Store')) p3.push('new session first assemble did not re-arm')
  if (p3.length === 0) ok('P3. AC1 reminder injected once per session, new session re-arms', 'injected env: win32 + pwsh absent')
  else bad('P3. AC1 once-per-session injection', p3.join(' | '))
}

// ── P4: AC2 — win32 + pwsh present → silent ──────────────────────────────────
{
  const env = { platform: 'win32', path: 'C:\\pwsh7', exists: () => true }
  const ctx = makeCtx()
  mod.apply(ctx, { env })
  const agent = { session: {} }
  const a1 = await assemble(ctx, agent, mattSections)
  const a2 = await assemble(ctx, agent, mattSections)
  if (ps7Text(a1) === '' && ps7Text(a2) === '') ok('P4. AC2 pwsh 7 present → no reminder', 'injected env: win32 + pwsh on PATH')
  else bad('P4. AC2 reminder fired with pwsh present', `a1=${ps7Text(a1).length} a2=${ps7Text(a2).length} chars`)
}

// ── P5: AC3 — non-Windows → silent ───────────────────────────────────────────
{
  const env = { platform: 'linux', path: '/usr/bin', exists: () => false }
  const ctx = makeCtx()
  mod.apply(ctx, { env })
  const agent = { session: {} }
  const a1 = await assemble(ctx, agent, mattSections)
  const a2 = await assemble(ctx, agent, mattSections)
  if (ps7Text(a1) === '' && ps7Text(a2) === '') ok('P5. AC3 non-Windows → nothing (inert)', 'injected env: linux')
  else bad('P5. AC3 reminder fired on non-Windows', `a1=${ps7Text(a1).length} a2=${ps7Text(a2).length} chars`)
}

// ── P6: scope guard — marker-less assembly neither injects NOR consumes ──────
{
  const env = { platform: 'win32', path: 'C:\\Windows', exists: () => false }
  const ctx = makeCtx()
  mod.apply(ctx, { env })
  const agent = { session: {} }
  const a1 = await assemble(ctx, agent, plainSections)
  const a2 = await assemble(ctx, agent, mattSections)
  if (ps7Text(a1) === '' && ps7Text(a2).includes('Microsoft Store')) {
    ok('P6. scope guard: marker-less assembly injects nothing and does not consume the once', 'later markered assemble still re-arms')
  } else {
    bad('P6. scope guard', `markerless injected=${ps7Text(a1) !== ''}; later markered injected=${ps7Text(a2) !== ''}`)
  }
}

// ── P7: roster row in all four generated carriers ────────────────────────────
const CARRIERS = ['cordis.patch.yml', 'presets/matt-ptc.patch.yml', 'presets/matt-minimal.patch.yml', 'presets/matt-cordis.patch.yml']
{
  const missing = []
  for (const carrier of CARRIERS) {
    const text = lf(readFileSync(join(repo, carrier), 'utf8'))
    const rowOk = /- id: ps7-reminder\s*\n\s*name: dsh-matt-preset\/ps7-reminder\.mjs\s*$/m.test(text)
    if (!rowOk) missing.push(carrier)
  }
  if (missing.length === 0) ok('P7. roster row present in all four carriers with the in-repo name', CARRIERS.join(', '))
  else bad('P7. roster row missing', missing.join(', '))
}

// ── P8: exports + plugin-meta face ───────────────────────────────────────────
{
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const exportsMissing = [
    ['./ps7-reminder.mjs/locale/*.json', './plugin-meta/ps7-reminder/locale/*.json'],
    ['./ps7-reminder.mjs/icon', './plugin-meta/ps7-reminder/icon.svg'],
  ].filter(([key, want]) => pkg.exports?.[key] !== want)
  const metaMissing = [
    'plugin-meta/ps7-reminder/icon.svg',
    'plugin-meta/ps7-reminder/locale/en.json',
    'plugin-meta/ps7-reminder/locale/zh.json',
  ].filter((rel) => !existsSync(join(repo, rel)))
  if (exportsMissing.length === 0 && metaMissing.length === 0) {
    ok('P8. package.json exports + plugin-meta files in place', 'locale + icon')
  } else {
    bad('P8. exports/plugin-meta face incomplete',
      [...exportsMissing.map(([key]) => `exports:${key}`), ...metaMissing].join(', '))
  }
}

// ── P9: reminder text contract ───────────────────────────────────────────────
{
  const text = mod.REMINDER
  const anchors = ['[env:ps7]', 'Microsoft Store', 'pwsh', 'do not block', 'do not install']
  const missing = anchors.filter((a) => !text.includes(a))
  if (missing.length === 0 && mod.SECTION_ORDER === 97 && mod.SECTION_NAME === 'env:ps7') {
    ok('P9. reminder text contract + section order 97', anchors.join(' / '))
  } else {
    bad('P9. reminder text contract', missing.length > 0 ? `缺锚: ${missing.join('/')}` : `order=${mod.SECTION_ORDER} name=${mod.SECTION_NAME}`)
  }
}

report('PS7 REMINDER VERIFY (#60)')
