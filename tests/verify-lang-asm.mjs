/**
 * verify-lang-asm — 最小真机复现：真 cordis + SystemPrompt 组装链，
 * 验证 lang-enforcer 的 sections 注入（不依赖 agents.create/factory）。
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply as langApply } from '../lang-enforcer.mjs'
import { apply as wfApply } from '../workflow-enforcer.mjs'

const PRESET_DIR = fileURLToPath(new URL('..', import.meta.url))
const SHIPPED = process.env.DSH_SHIPPED_PRESETS ?? 'C:/Users/lihao/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/config/agent-presets'

// 用真实 matt persona
const personaText = async () => {
  const lines = (await readFile(join(PRESET_DIR, 'agent.cordis.yml'), 'utf8')).split('\n')
  const start = lines.findIndex(l => l.includes('text:'))
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}

const root = await mkdtemp(join(tmpdir(), 'lang-asm-'))
const rustDir = join(root, 'rust-proj')
await mkdir(rustDir, { recursive: true })
await writeFile(join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n')

const ctx = new Context()
ctx.baseUrl = pathToFileURL(SHIPPED).href + '/'
await ctx.plugin(Loader)
ctx.loader.builtins.include = Include
ctx.loader.builtins.group = Group
await ctx.plugin(SystemPrompt, { persona: await personaText() })
await ctx.plugin({ name: 'workflow-enforcer', inject: ['systemPrompt','tools'], apply: (c, cfg) => wfApply(c, cfg) }, { baseline: true })
await ctx.plugin({ name: 'lang-enforcer', inject: ['systemPrompt'], apply: (c, cfg) => langApply(c, cfg) }, { baselineMode: 'session' })
await new Promise(r => setTimeout(r, 200))

const session = { meta: { cwd: 'C:\\Work\\IRIS' }, events: [] }
const agent = { session }
const signal = new AbortController().signal
const count = (t, n) => t.split(n).length - 1

const asm = async () => {
  const a = await ctx.systemPrompt.assemble({ agent, session, signal })
  return a
}

for (let round = 1; round <= 3; round++) {
  const a = await asm()
  const texts = (a?.sections ?? []).map(s => ({ name: s.name, len: (s.text ?? '').length }))
  const joined = (a?.sections ?? []).map(s => s.text ?? '').join('\n')
  console.log(`轮${round}: sections=${JSON.stringify(texts)}`)
  console.log(`   GATES=${count(joined, 'WORKFLOW GATES')} LANG=${count(joined, 'LANG rust')}`)
  if (round === 1) {
    await ctx.emit('session/event', session, {
      type: 'tool/call',
      data: { name: 'str_replace_editor', arguments: JSON.stringify({ path: 'C:\\Work\\IRIS\\src\\main.rs' }) },
    })
  }
}
process.exit(0)
