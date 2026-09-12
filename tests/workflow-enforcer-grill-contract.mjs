// Wiring test for the grill-question-contract injection in workflow-enforcer.mjs.
// Simulates the Cordis hook surface: session/event arming + system-prompt/assemble.
import { apply } from 'file:///C:/Users/lihao/.dsh/.agent-presets/dsh-matt-preset/workflow-enforcer.mjs'

const failures = []
const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures.push(label) }

function makeCtx() {
  const handlers = {}
  return {
    handlers,
    on(type, fn) { (handlers[type] ??= []).push(fn) },
    tools: { register() {} },
    logger() { return { warn() {} } },
  }
}
const fire = (ctx, type, ...args) => (ctx.handlers[type] ?? []).forEach(fn => fn(...args))

function makeAgent() {
  const session = { header: { cwd: undefined } }
  return { session }
}
const assembleNext = async () => ({ sections: [{ name: 'persona', text: 'ask-matt workflow map …' }] })
const runAssemble = async (ctx, agent) => {
  let out
  await ctx.handlers['system-prompt/assemble'][0]({ sections: [] }, { agent }, async () => assembleNext())
    .then(r => { out = r })
  return out?.sections?.find(s => s.name === 'workflow:gates')?.text ?? ''
}

// 1. skill call arms grill mode → contract injected alongside baseline
{
  const ctx = makeCtx(); apply(ctx, {})
  const agent = makeAgent()
  fire(ctx, 'session/event', agent.session, { type: 'tool/call', data: { name: 'skill', arguments: '{"name":"grill-with-docs"}' } })
  const text = await runAssemble(ctx, agent)
  check('skill(grill-with-docs) arms contract', text.includes('GRILL QUESTION CONTRACT'))
  check('baseline still present with contract', text.includes('WORKFLOW GATES'))
  check('status-line anchor present', text.includes('现问'))
  check('answer-format anchor present', text.includes('可答：A / 按推荐 / 例外说明'))
  check('time-estimate anchor present', text.includes('≈10 秒'))
  // sticky: second assemble still carries it
  const text2 = await runAssemble(ctx, agent)
  check('sticky across assembles', text2.includes('GRILL QUESTION CONTRACT'))
}
// 2. handoff prompt prefix arms grill mode (user/message)
{
  const ctx = makeCtx(); apply(ctx, {})
  const agent = makeAgent()
  fire(ctx, 'session/event', agent.session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '/triage\n# Handoff — 清扫会话' }] } } })
  const text = await runAssemble(ctx, agent)
  check('user/message /triage arms contract', text.includes('GRILL QUESTION CONTRACT'))
}
// 3. inbox/spliced handoff arms grill mode
{
  const ctx = makeCtx(); apply(ctx, {})
  const agent = makeAgent()
  fire(ctx, 'session/event', agent.session, { type: 'agent/inbox/spliced', data: { inserted: [{ role: 'user', content: [{ type: 'text', text: '/grill-with-docs\n# Handoff — 待拍板访谈' }] }] } })
  const text = await runAssemble(ctx, agent)
  check('inbox/spliced /grill-with-docs arms contract', text.includes('GRILL QUESTION CONTRACT'))
}
// 4. negatives: unrelated skill call, unrelated session, grillContract:false
{
  const ctx = makeCtx(); apply(ctx, {})
  const agent = makeAgent()
  fire(ctx, 'session/event', agent.session, { type: 'tool/call', data: { name: 'skill', arguments: '{"name":"tdd"}' } })
  const text = await runAssemble(ctx, agent)
  check('unrelated skill call does NOT arm', !text.includes('GRILL QUESTION CONTRACT') && text.includes('WORKFLOW GATES'))
}
{
  const ctx = makeCtx(); apply(ctx, {})
  const agent = makeAgent()
  const text = await runAssemble(ctx, agent)
  check('no arming → baseline only', text.includes('WORKFLOW GATES') && !text.includes('GRILL QUESTION CONTRACT'))
}
{
  const ctx = makeCtx(); apply(ctx, { grillContract: false })
  const agent = makeAgent()
  fire(ctx, 'session/event', agent.session, { type: 'tool/call', data: { name: 'skill', arguments: '{"name":"grilling"}' } })
  const text = await runAssemble(ctx, agent)
  check('grillContract:false disables injection', text.includes('WORKFLOW GATES') && !text.includes('GRILL QUESTION CONTRACT'))
}
// 5. non-ask-matt session untouched (scope guard)
{
  const ctx = makeCtx(); apply(ctx, {})
  const agent = makeAgent()
  fire(ctx, 'session/event', agent.session, { type: 'tool/call', data: { name: 'skill', arguments: '{"name":"grilling"}' } })
  const noMarker = await (async () => { let out; await ctx.handlers['system-prompt/assemble'][0]({ sections: [] }, { agent }, async () => ({ sections: [{ name: 'p', text: 'minimal persona' }] })).then(r => { out = r }); return out?.sections ?? [] })()
  check('scope guard: non-ask-matt session gets nothing', !noMarker.some(s => s.name === 'workflow:gates'))
}

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILURES`)
process.exit(failures.length === 0 ? 0 : 1)
