/** #134：测试工具解析的行为与有限源码契约，不是通用 JS 语义分析器。 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { testExecutable } from './lib-exec.mjs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))

const emptyPath = { ...process.env, PATH: '', Path: '' }
function run(tool, argv, options = {}) {
  const resolved = testExecutable(tool, { ...options, args: argv })
  return spawnSync(resolved.command, resolved.args, { shell: resolved.shell, env: emptyPath, encoding: 'utf8' })
}
assert.deepEqual(testExecutable('node'), { command: process.execPath, args: [], shell: false })
const nodeRun = run('node', ['-p', 'JSON.stringify([process.execPath, process.argv.slice(1)])', 'argument with spaces'])
assert.equal(nodeRun.status, 0, `node must start with empty PATH: ${nodeRun.stderr}`)
assert.deepEqual(JSON.parse(nodeRun.stdout), [process.execPath, ['argument with spaces']])
assert.throws(() => testExecutable('other'), /Unsupported/)
assert.throws(() => testExecutable('npm', { npmPath: 'relative/npm', exists: () => true }), /explicit path/)
// 独立字面路径oracle，覆盖Windows/POSIX候选次序，不由被测join重算预期。
for (const [platform, execPath, cli, sibling, pathNpm, PATH] of [
  ['win32', 'X:\\Node tools\\node.exe', 'X:\\Node tools\\node_modules\\npm\\bin\\npm-cli.js', 'X:\\Node tools\\npm.cmd', 'Y:\\tools\\npm.cmd', 'relative;Y:\\tools'],
  ['linux', '/node tools/node', '/node tools/node_modules/npm/bin/npm-cli.js', '/node tools/npm', '/tools/npm', 'relative:/tools'],
]) {
  const options = { platform, execPath, env: { PATH }, exists: p => [cli, sibling, pathNpm].includes(p) }
  assert.deepEqual(testExecutable('npm', options), { command: execPath, args: [cli], shell: false })
  const sib = testExecutable('npm', { ...options, exists: p => [sibling, pathNpm].includes(p) })
  assert.deepEqual(sib, { command: platform === 'win32' ? `"${sibling}"` : sibling, args: [], shell: platform === 'win32' })
  assert.equal(testExecutable('npm', { ...options, exists: p => p === pathNpm }).command, platform === 'win32' ? `"${pathNpm}"` : pathNpm)
  assert.throws(() => testExecutable('npm', { ...options, exists: () => false }), /npm not found/)
  assert.throws(() => testExecutable('npm', { ...options, npmPath: platform === 'win32' ? 'Z:\\missing.cmd' : '/missing' }), /explicit path/, 'explicit miss must not fall through')
  assert.equal(testExecutable('npm', { ...options, npmPath: pathNpm }).command, platform === 'win32' ? `"${pathNpm}"` : pathNpm)
}
const work = mkdtempSync(join(tmpdir(), 'dsh-test-exec-'))
try {
  const dir = join(work, 'npm tools with spaces'); mkdirSync(dir)
  const script = join(dir, 'npm-cli.js')
  writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))')
  const npmRun = run('npm', ['--value', 'space argument'], { npmPath: script })
  assert.equal(npmRun.status, 0, `explicit npm script must run with empty PATH: ${npmRun.stderr}`)
  assert.deepEqual(JSON.parse(npmRun.stdout), ['--value', 'space argument'])
  if (process.platform === 'win32') {
    const cmd = join(dir, 'npm.cmd')
    writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
    const resolved = testExecutable('npm', { npmPath: cmd, args: ['--version', 'space argument'] })
    const cmdRun = spawnSync(resolved.command, resolved.args, { shell: resolved.shell, env: emptyPath, encoding: 'utf8' })
    assert.equal(cmdRun.status, 0, `explicit spaced npm.cmd must run with empty PATH: ${cmdRun.stderr}`)
    assert.deepEqual(JSON.parse(cmdRun.stdout), ['--version', 'space argument'])
  }
} finally { rmSync(work, { recursive: true, force: true }) }
console.log('PASS node empty PATH, npm explicit/adjacent/PATH/missing, spaced script and CMD execution')

// 有限词法面：普通引号字符串、模板整体、注释、标识符和标点。
// 不解析模板表达式、别名/动态计算命令、正则字面量、任意等价算法；这些仍由 review 覆盖。
// 字符串保持为一个token，故示例文字不会被当作实际调用；模板另检查生成CMD行。
function tokens(source) {
  const out = []
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue }
    if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue }
    const q = source[i]
    if (q === "'" || q === '"' || q === '`') {
      let value = ''; i++
      while (i < source.length && source[i] !== q) {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[++i]
          value += next === 'n' ? '\n' : next === 'r' ? '\r' : next
          i++
        } else value += source[i++]
      }
      i++; out.push({ kind: q === '`' ? 'template' : 'string', value }); continue
    }
    const word = /^[\w$]+/.exec(source.slice(i))
    if (word) { out.push({ kind: 'word', value: word[0] }); i += word[0].length }
    else out.push({ kind: 'punct', value: source[i++] })
  }
  return out
}
function violations(source, owner = false) {
  const ts = tokens(source), found = []
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]
    if (t.kind === 'word' && /^(spawnSync|spawn|execFileSync|execFile|execSync|exec)$/.test(t.value)
      && ts[i + 1]?.value === '(' && ts[i + 2]?.kind === 'string'
      && /^(?:node(?:\.exe)?|npm(?:\.cmd)?)(?:\s|$)/i.test(ts[i + 2].value)) found.push('bare executable call')
    if ((t.kind === 'string' || t.kind === 'template') && /@echo\s+off/i.test(t.value)
      && /(?:^|\n)[ \t]*@?(?:call[ \t]+)?"?(?:node(?:\.exe)?|npm(?:\.cmd)?)"?[ \t]+/i.test(t.value)) found.push('bare generated command')
    if (!owner && t.kind === 'string' && /^(npm-cli\.js|npm\.cmd)$/.test(t.value)) found.push('npm candidate copy')
    if (!owner && t.kind === 'word' && t.value === 'function' && ts[i + 1]?.value === 'testExecutable') found.push('resolver declaration copy')
  }
  return [...new Set(found)]
}

assert.deepEqual(violations("spawnSync('npm', args)"), ['bare executable call'])
assert.deepEqual(violations("child.spawn(\n 'node', args)"), ['bare executable call'])
assert.deepEqual(violations('const example = "spawnSync(\'npm\', args)"'), [])
assert.deepEqual(violations("// spawnSync('npm', args)\n/* 'npm-cli.js' */"), [])
assert.deepEqual(violations('writeFile(path, `@echo off\\r\\nnode "%~dp0a.js" %*`)'), ['bare generated command'])
assert.deepEqual(violations("const renamed = join(dir, 'npm-cli.js')"), ['npm candidate copy'])
console.log('PASS guard self-checks: real calls/copies/CMD detected, comments/examples inert')

function importsShared(source) {
  const ts = tokens(source)
  return ts.some((t, i) => t.value === 'import' && ts.slice(i + 1, i + 6).map(t => t.value).join('|') === '{|testExecutable|}|from|./lib-exec.mjs')
}
assert.equal(importsShared("import { testExecutable } from './lib-exec.mjs'"), true)
assert.equal(importsShared("// import { testExecutable } from './lib-exec.mjs'"), false)
assert.equal(importsShared('const example = "import { testExecutable } from \'./lib-exec.mjs\'"'), false)
for (const file of ['verify-installer.mjs', 'verify-dual-env.mjs', 'verify-packaged-payload.mjs']) {
  assert.equal(importsShared(readFileSync(join(REPO, 'tests', file), 'utf8')), true, `${file} must import the shared resolver`)
}
const failures = []
function scan(dir) {
  for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) scan(path)
    else if (entry.isFile() && entry.name.endsWith('.mjs') && path !== 'tests/verify-test-exec.mjs') {
      const hits = violations(readFileSync(join(REPO, path), 'utf8'), path === 'tests/lib-exec.mjs')
      if (hits.length) failures.push(`${path}: ${hits.join(', ')}`)
    }
  }
}
scan('tests')
assert.deepEqual(failures, [], `executable resolution must have one owner, no bare tool calls:\n${failures.join('\n')}`)
console.log('PASS tests executable source contract (declared finite syntax only)')
