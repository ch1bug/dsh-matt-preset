/**
 * verify-lang-enforcer — lang-enforcer 冒烟（V1–V5），零 LLM 成本。
 *
 * V1 基线：Cargo.toml 项目 + matt 会话 → 注入 lang:packs 基线（session 一次）
 * V2 触发：.rs 工具调用 → 下一次 assemble 注入触发提醒
 * V3 消费：同一次调用不重复注入（consume-once）
 * V4 覆盖：lang-gates.yml disable: [rust] → 不注入
 * V5 作用域：无 ask-matt 标记的会话 → 不注入
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lang-enforcer.mjs'

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

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length > 0 ? 1 : 0
