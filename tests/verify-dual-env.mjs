/**
 * verify-dual-env.mjs — #21 双环境活体验证（验证硬约束：源码环境 + npm 环境
 * 各自的「安装→启动→使用」完整链路）。
 *
 * 每个环境：
 *   1. 安装：installer 把 preset 装进临时 root（源码目录 / npm pack tarball）
 *   2. 启动：harness 真实 boot preset registry，注册安装副本的 agent.cordis.yml
 *      （插件名 `dsh-matt-preset/x.mjs` 重写为安装副本的绝对 file:// URL，
 *       与生产 profile link 解析同构）
 *   3. 使用：ensurePresetMountable + 建 agent（mock 模型）+ mount + 渲染
 *      system prompt，断言 ask-matt persona 与 WORKFLOW GATES 基线在场。
 *
 * 用法：node tests/verify-dual-env.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir, rm, mkdtemp } from 'node:fs/promises'
import { testExecutable } from './lib-exec.mjs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { AgentPreset, bootHarness, parsePlugins, emitSessionEvent } from './preset-harness.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url))) // tests/ 的父目录 = 仓根
const BIN = join(REPO, 'bin', 'install.mjs')
const tmp = await mkdtemp(join(tmpdir(), 'dsh-dual-env-'))

/** Rewrite preset-local plugin names (`dsh-matt-preset/x.mjs`) to the installed copy. */
function resolveInstalled(nodes, installDir) {
  const base = pathToFileURL(installDir).href + '/'
  const walk = (rows) => rows?.map((row) => {
    if (typeof row?.name !== 'string' || row.name.startsWith('@') || row.name.startsWith('cordis:') || row.name.includes('://')) return row
    return { ...row, name: new URL(row.name.replace(/^dsh-matt-preset\//, './'), base).href }
  })
  const rec = (rows) => walk(rows)?.map((row) =>
    Array.isArray(row.config) ? { ...row, config: rec(row.config) } : row)
  return rec(nodes)
}

async function runEnv(label, installArgs) {
  console.log(`\n=== 环境：${label} ===`)
  const root = join(tmp, label)
  const r = spawnSync(process.execPath, [BIN, 'install', '--root', root, ...installArgs], { encoding: 'utf8' })
  assert.equal(r.status, 0, `installer failed: ${r.stderr}`)

  // 1. 安装层：版本戳
  const stamp = JSON.parse(await readFile(join(root, 'matt', 'VERSION.json'), 'utf8'))
  const pkgVersion = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8')).version
  assert.equal(stamp.version, pkgVersion)
  console.log(`  ✓ 安装：${stamp.version} @ ${join(root, 'matt')} (source=${stamp.source})`)

  // 2. 启动层：真实 boot + 注册安装副本
  const yamlText = await readFile(join(root, 'matt', 'agent.cordis.yml'), 'utf8')
  const plugins = resolveInstalled(parsePlugins(yamlText, pathToFileURL(REPO).href + '/'), join(root, 'matt'))
  const ctx = await bootHarness([{ id: 'matt-installed', plugins }])

  // 3a. 全量声明注册：broken 只允许 harness 缺的 host 服务（waiting for …），
  //     不允许 payload 错误（never started / 加载失败 = 安装副本坏了）。
  const { broken: broken0 } = await ctx.agentPresets.resolve('matt-installed')
  // loader 异步启动插件：轮询 settle，直到 broken 消失或只剩 waiting-for 行
  let broken = broken0
  for (let i = 0; i < 20 && broken?.split('\n').filter(Boolean).some((l) => !/: waiting for /.test(l)); i++) {
    await new Promise((r) => setTimeout(r, 100))
    broken = (await ctx.agentPresets.resolve('matt-installed')).broken
  }
  if (broken !== undefined) {
    const lines = broken.split('\n').filter(Boolean)
    assert.ok(lines.length > 0 && lines.every((l) => /: waiting for /.test(l)),
      `installed payload has real mount errors (not harness-missing services):\n${broken}`)
    console.log(`  ✓ 启动：全量声明注册干净（仅 harness 缺 host 服务 ×${lines.length}，无 payload 错误）`)
  } else {
    console.log('  ✓ 启动：全量声明注册干净（完整激活）')
  }

  // 3b. 使用层：安装副本的真 persona + 安装副本的 workflow-enforcer 实跑。
  const personaRow = plugins.find((row) => row.id === 'persona')
  assert.ok(personaRow?.config?.prefix?.includes('ask-matt'), 'installed persona missing ask-matt')
  const enforcerUrl = pathToFileURL(join(root, 'matt', 'workflow-enforcer.mjs')).href
  const smokeId = 'smoke-' + label
  await ctx.plugin(AgentPreset, { id: smokeId, plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: personaRow.config.prefix } },
    { id: 'workflow-enforcer', name: enforcerUrl },
  ] })
  const handle = await ctx.agents.create({
    sessionId: SessionId('dual-' + label),
    meta: { cwd: tmp },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, smokeId),
  })
  const rendered = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal)))
  assert.ok(rendered.includes('ask-matt'), 'ask-matt persona missing from system prompt')
  assert.ok(rendered.includes('WORKFLOW GATES'), 'workflow gates baseline missing')
  // 高危提醒实弹：git push 调用 → 一次性 ⚠
  await emitSessionEvent(ctx, handle.agent.session, {
    type: 'tool/call',
    data: { turn: 1, step: 1, name: 'bash', arguments: JSON.stringify({ command: 'git push origin main' }) },
  })
  const rendered2 = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal)))
  assert.ok(rendered2.includes('High-risk action detected') && rendered2.includes('git push origin main'),
    'installed enforcer did not fire the high-risk reminder')
  console.log('  ✓ 使用：persona(ask-matt) + WORKFLOW GATES 注入；git push 触发一次性 ⚠（安装副本 enforcer 实弹）✓')
  await handle.dispose()
  return true
}

try {
  await runEnv('source', [])
  // npm 环境：真 npm pack 出 tarball 再装。
  const npm = testExecutable('npm', { args: ['pack', '--pack-destination', tmp] })
  const packed = spawnSync(npm.command, npm.args, {
    cwd: REPO, encoding: 'utf8', shell: npm.shell,
  })
  assert.equal(packed.status, 0, `npm pack failed: ${packed.stderr}`)
  const [tarball] = (await readdir(tmp)).filter((f) => f.endsWith('.tgz'))
  assert.ok(tarball, 'no tarball produced')
  await runEnv('npm', ['--from', join(tmp, tarball)])
  console.log('\n双环境活体验证：全部通过 ✅')
} finally {
  await rm(tmp, { recursive: true, force: true })
}
