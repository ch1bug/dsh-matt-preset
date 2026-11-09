/**
 * verify-lang-enforcer — lang-enforcer 冒烟（V1–V9），零 LLM 成本。
 *
 * V1 基线：Cargo.toml 项目 + matt 会话 → 注入 lang:packs 基线（session 一次）   [假 ctx]
 * V2 触发：.rs 工具调用 → 下一次 assemble 注入触发提醒                          [假 ctx]
 * V3 消费：同一次调用不重复注入（consume-once）                                 [假 ctx]
 * V4 覆盖：lang-gates.yml disable: [rust] → 不注入                              [假 ctx]
 * V5 作用域：无 ask-matt 标记的会话 → 不注入                                    [假 ctx]
 *
 * ── #57 preset 级挂载面（V6–V9）─────────────────────────────────────────────
 * V1–V5 全部走 `import { apply }` + 手搓假 ctx——组件逻辑有覆盖，但**没有任何一条
 * preset 级断言**（#57 票面实测）。V6–V9 补上，且组件行走**真实的 package subpath
 * 解析**（`dsh-matt-preset/lang-enforcer.mjs`，经 node 对本包 package.json `exports`
 * 的 self-reference 解析——`resolvePackageSubpath`，preset-harness.mjs）：
 * `resolveLocalNames()` 的字符串前缀重写测不到 exports 缺键 / 发布面缺件（#84 类），
 * 真解析能——exports 键缺失 = ERR_PACKAGE_PATH_NOT_EXPORTED、文件缺席 =
 * ERR_MODULE_NOT_FOUND，模块加载即响亮红。
 *   V6 (AC1+AC4)：matt preset 的挂载面（agent.cordis.yml 源 + cordis.patch.yml 生成
 *     载体）写的就是 specifier；解析落在本检出文件上；locale/icon 导出子路径可解析。
 *   V7 (AC2)：非 matt preset 单行挂载（scope: 'all'）→ 真生效（rust 项目注入基线）。
 *   V8 (AC3)：真挂载场景双向 scope——marker 会话注入（基线+触发+消费）、
 *     非 marker 会话零注入。
 *   V9 (AC4)：组件文件 + lang-packs 全部 pack 文件都在 payloadOf(`files`) 白名单内
 *     ——lang-pack 是**独立文件族**（lang-enforcer 按模块同目录 `lang-packs/` 读取，
 *     目录缺席 = 静默零注入，S1 类），缺席 payload 时 V9 红（#84 类守卫；扰动
 *     证红证据见 .scratch/verify57/probe57.mjs，提交树永不被扰动）。
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { apply } from '../lang-enforcer.mjs'
import { bootHarness, resolvePackageSubpath, emitSessionEvent } from './preset-harness.mjs'
import { payloadOf } from '../lib/payload.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))

const results = []
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${id}${detail ? ' — ' + detail : ''}`)
}

function makeCtx() {
  const handlers = {}
  return {
    handlers,
    on: (ev, fn) => { (handlers[ev] ??= []).push(fn) },
    logger: () => ({ warn() {} }),
  }
}

function makeHarness(ctx, sections, cwd) {
  const session = { meta: { cwd } }
  const agent = { session }
  const call = (event) => {
    for (const fn of ctx.handlers['session/event'] ?? []) fn(session, event)
  }
  const assemble = async () => {
    let out
    for (const fn of ctx.handlers['system-prompt/assemble'] ?? []) {
      const base = { sections } // 真实 next() 由下游组装并返回 assembly
      out = await fn(base, { agent }, async () => base)
    }
    return out
  }
  return { session, agent, call, assemble }
}

const rustSurface = (dir) => JSON.stringify({ name: 'str_replace_editor', arguments: { path: join(dir, 'src', 'main.rs') } })
const mattSections = [{ name: 'persona', text: 'ask-matt workflow map — MAIN FLOW, gates…' }]
const sectionText = (assembled, name = 'lang:packs') =>
  (assembled?.sections ?? []).filter(s => s?.name === name).map(s => s.text).join('\n')

const root = await mkdtemp(join(tmpdir(), 'lang-enforcer-verify-'))
try {
  const rustDir = join(root, 'rust-proj')
  const plainDir = join(root, 'plain-proj')
  await mkdir(rustDir, { recursive: true })
  await mkdir(plainDir, { recursive: true })
  await writeFile(join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n')
  const gatesDir = join(root, 'gated-proj')
  await mkdir(gatesDir, { recursive: true })
  await writeFile(join(gatesDir, 'Cargo.toml'), '[package]\nname = "demo"\n')
  await writeFile(join(gatesDir, 'lang-gates.yml'), 'disable: [rust]\n')

  // V1 + V2 + V3 share one session
  {
    const ctx = makeCtx()
    apply(ctx, {})
    const h = makeHarness(ctx, mattSections, rustDir)

    const a1 = await h.assemble()
    const t1 = sectionText(a1)
    check('V1 baseline', t1.includes('LANG rust') && t1.includes('rust-router'), 'baseline injected once')

    h.call({ type: 'tool/call', data: { name: 'str_replace_editor', arguments: JSON.stringify({ path: join(rustDir, 'src', 'main.rs') }) } })
    const a2 = await h.assemble()
    const t2 = sectionText(a2)
    check('V2 trigger', t2.includes('⚠ lang:rust') && t2.includes('coding-guidelines') && !t2.includes('LANG rust'), 'trigger note, no baseline repeat')

    const a3 = await h.assemble()
    check('V3 consume-once', sectionText(a3) === '', 'no re-injection without a new call')
  }

  // V4 project disable
  {
    const ctx = makeCtx()
    apply(ctx, {})
    const h = makeHarness(ctx, mattSections, gatesDir)
    const a = await h.assemble()
    check('V4 lang-gates disable', sectionText(a) === '', 'disabled via lang-gates.yml')
  }

  // V5 scope guard
  {
    const ctx = makeCtx()
    apply(ctx, {})
    const h = makeHarness(ctx, [{ name: 'persona', text: 'minimal agent — no marker' }], rustDir)
    h.call({ type: 'tool/call', data: { name: 'str_replace_editor', arguments: JSON.stringify({ path: join(rustDir, 'lib.rs') }) } })
    const a = await h.assemble()
    check('V5 scope guard', sectionText(a) === '', 'non-matt session untouched')
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

// ═══ #57 preset 级挂载面（V6–V9）═══════════════════════════════════════════
// specifier 在模块加载期解析（下一行）：exports 缺键 / 文件缺席 → 本文件加载即
// ERR_PACKAGE_PATH_NOT_EXPORTED / ERR_MODULE_NOT_FOUND，响亮红于任何断言之先。
const SPECIFIER = 'dsh-matt-preset/lang-enforcer.mjs'
const SPEC_LANG = resolvePackageSubpath(SPECIFIER)

// V6 (AC1+AC4)：挂载面拼写 + 解析落点 + locale/icon 导出子路径。
{
  // 非 `#` 注释行里，两份载体都必须逐字写 specifier（agent.cordis.yml 是源，
  // cordis.patch.yml 是 `dsh plugin add` 真正挂载的生成载体）。
  const rowSpelled = (text) => text.split(/\r?\n/)
    .some((l) => l.trimStart().startsWith('name:') && l.includes(`name: ${SPECIFIER}`))
  const yml = readFileSync(join(REPO, 'agent.cordis.yml'), 'utf8')
  const patch = readFileSync(join(REPO, 'cordis.patch.yml'), 'utf8')
  // 解析落点 = 本检出的文件（防止解析顺着 node_modules 落到别的 dsh-matt-preset 副本）。
  const sameFile = realpathSync(fileURLToPath(SPEC_LANG)) === realpathSync(join(REPO, 'lang-enforcer.mjs'))
  // exports 的专用键（locale/*.json、icon）也必须可解析——plugin-meta 文件缺席或键被摘即红。
  const localeDir = join(REPO, 'plugin-meta', 'lang-enforcer', 'locale')
  const localeFiles = readdirSync(localeDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  const subpaths = ['lang-enforcer.mjs/icon', ...localeFiles.map((f) => `lang-enforcer.mjs/locale/${f}`)]
  const failedSub = []
  for (const sub of subpaths) {
    try { resolvePackageSubpath(`dsh-matt-preset/${sub}`) }
    catch (error) { failedSub.push(`${sub}: ${error?.code ?? String(error?.message ?? error)}`) }
  }
  check('V6 matt preset rows spell the specifier; resolution lands here; locale/icon exports resolve (AC1)',
    rowSpelled(yml) && rowSpelled(patch) && sameFile && failedSub.length === 0,
    `agent.cordis.yml: ${rowSpelled(yml)} | cordis.patch.yml: ${rowSpelled(patch)} | realpath: ${sameFile ? 'match' : 'MISMATCH'} | failed: ${failedSub.join(', ') || '—'}`)
}

// V7–V8：真挂载（bootHarness + agent + system-prompt/assemble 全链路）。
// 三份 preset 共用同一 ctx：scope:'all'（AC2 非 matt opt-in 形）、默认 marker scope
// 带 marker（AC3 注入向）、默认 marker scope 无 marker（AC3 零注入向）。
const presetRoot = await mkdtemp(join(tmpdir(), 'lang-enforcer-preset-'))
try {
  const rustDir2 = join(presetRoot, 'rust-proj')
  await mkdir(rustDir2, { recursive: true })
  await writeFile(join(rustDir2, 'Cargo.toml'), '[package]\nname = "demo"\n')

  const ctx = await bootHarness([
    { id: 'langspec', plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a plain agent without the workflow.' } },
      { id: 'lang-enforcer', name: SPEC_LANG, config: { scope: 'all' } },
    ] },
    { id: 'langspec-marker', plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'probe persona running the ask-matt workflow' } },
      { id: 'lang-enforcer', name: SPEC_LANG },
    ] },
    { id: 'langspec-plain', plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a plain agent without the workflow.' } },
      { id: 'lang-enforcer', name: SPEC_LANG },
    ] },
  ])
  const signal = new AbortController().signal
  const renderOne = async (presetId, sessionId) => {
    const handle = await ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: rustDir2 },
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, presetId),
    })
    const text = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, signal)))
    return { handle, text }
  }

  // V7 (AC2)：非 matt preset 经 specifier 单行挂载（scope:'all'）→ 真生效。
  {
    const { handle, text } = await renderOne('langspec', 'lang-spec-all')
    await handle.dispose()
    check('V7 non-matt preset mounts lang-enforcer through the package specifier (scope: \'all\') and it takes effect (AC2)',
      text.includes('LANG rust') && text.includes('rust-router'), text.slice(0, 200))
  }

  // V8 (AC3)：真挂载场景双向 scope。
  {
    const { handle, text } = await renderOne('langspec-marker', 'lang-spec-marker')
    const injected = text.includes('LANG rust') && text.includes('rust-router')
    // 触发面在真挂载上复验：.rs 调用 → 下一次 assemble 注入触发提醒、基线不重复。
    await emitSessionEvent(ctx, handle.agent.session, {
      type: 'tool/call',
      data: { turn: 1, step: 1, name: 'str_replace_editor', arguments: JSON.stringify({ path: join(rustDir2, 'src', 'main.rs') }) },
    })
    const triggerText = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, signal)))
    const triggered = triggerText.includes('⚠ lang:rust') && triggerText.includes('coding-guidelines') && !triggerText.includes('LANG rust')
    // 消费面：再 assemble 一次 → 干净（consume-once 在真挂载同样成立）。
    const consumedText = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, signal)))
    const consumed = !consumedText.includes('lang:rust') && !consumedText.includes('LANG rust')
    await handle.dispose()
    check('V8a marker session on the specifier mount → baseline injected (AC3 injection side)',
      injected, injected ? 'baseline once' : text.slice(0, 200))
    check('V8b .rs tool call → trigger note, no baseline repeat (real-mount trigger face)',
      triggered, triggered ? '⚠ lang:rust fired once' : triggerText.slice(0, 200))
    check('V8c trigger consumed after firing (real-mount consume-once)',
      consumed, consumed ? 'clean' : consumedText.slice(0, 200))
  }
  {
    const { handle, text } = await renderOne('langspec-plain', 'lang-spec-plain')
    await handle.dispose()
    check('V8d marker-less session on the specifier mount → zero injection (AC3 zero side)',
      !text.includes('LANG rust') && !text.includes('lang:rust'), text.slice(0, 200))
  }
} finally {
  await rm(presetRoot, { recursive: true, force: true })
}

// V9 (AC4，#84 类守卫)：组件文件 + lang-packs 全部 pack 文件都在 payload 白名单内。
// lang-pack 是独立文件族：lang-enforcer 按模块同目录 `lang-packs/` 读取，目录缺席 =
// 静默零注入——只有这条判据看它。files 摘 `lang-packs` / 摘 `*.mjs` → V9 红
// （扰动证红：.scratch/verify57/probe57.mjs）。
{
  let entries = []
  let payloadError = ''
  try { entries = (await payloadOf(REPO)).entries }
  catch (error) { payloadError = String(error?.message ?? error) }
  // payloadOf 对显式目录条目（`lang-packs`）不展开——覆盖判据按前缀走
  // （与 verify-packaged-payload 的 coveredBy 同方向）。
  const covered = (file) => entries.includes(file) || entries.some((e) => file.startsWith(e + '/'))
  const packFiles = readdirSync(join(REPO, 'lang-packs'), { withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => `lang-packs/${e.name}`)
  const need = ['lang-enforcer.mjs', ...packFiles]
  const missing = payloadError === '' ? need.filter((f) => !covered(f)) : need
  check('V9 component file + every lang-pack file inside the payload whitelist (AC4, #84 guard)',
    payloadError === '' && missing.length === 0,
    payloadError !== '' ? `payloadOf: ${payloadError}` : `${need.length} files · missing: ${missing.join(', ') || '—'}`)
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length > 0 ? 1 : 0
