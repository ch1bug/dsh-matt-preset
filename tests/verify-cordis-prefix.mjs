/**
 * #131：personaPrefix 的独立 oracle 与单源守卫。
 * 只守仓内约定的 prefix 提取，不承诺通用 YAML 解析。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { personaPrefix } from '../lib/cordis-prefix.mjs'
import { personaPrefix as scriptPrefix } from '../scripts/retake-workflow-fixtures.mjs'

assert.equal(scriptPrefix, personaPrefix, 'fixture script must re-export the same implementation')

const REPO = fileURLToPath(new URL('..', import.meta.url))
const expected = 'You are {{model}} — ask-matt.'
for (const eol of ['\n', '\r\n']) {
  const inline = ['persona:', `    prefix: ${expected}`, '    suffix: ignored'].join(eol)
  const block = ['persona:', '    prefix: |', `      ${expected}`, '    suffix: ignored'].join(eol)
  assert.equal(personaPrefix(inline), expected, 'inline prefix must match independent literal')
  assert.equal(personaPrefix(block), expected, 'block prefix must match independent literal')
  assert.equal(personaPrefix(inline), personaPrefix(block), 'inline/block bytes must agree')
}
assert.equal(personaPrefix('    prefix: '), '', 'empty inline remains empty')
assert.equal(personaPrefix('    prefix: |\n      first\n\n      second\n    suffix: ignored'), 'first\n\nsecond', 'block keeps internal blank lines and stops at next property')
assert.throws(() => personaPrefix('persona:\n    suffix: none'), /prefix:/, 'missing prefix must fail loudly')
console.log('PASS independent inline/block oracle, LF/CRLF, empty/missing prefix and block boundary')

// 源码契约是本票明确要求的结构 seam：守同名声明与现有 findIndex/slice 提取形态。
// declared not covered：不是 JS AST/语义等价判定；跨行改写、任意新算法仍靠 code-review。
const sources = []
function collect(dir) {
  for (const entry of readdirSync(resolve(REPO, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) collect(path)
    else if (entry.isFile() && entry.name.endsWith('.mjs')) sources.push(path)
  }
}
for (const dir of ['lib', 'tests', 'scripts']) collect(dir)
// 与仓内同类守卫一致：只判剥掉注释后的行式代码，不把说明文字当实现。
const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
function ownsPrefixParser(text) {
  const code = codeOnly(text)
  const named = /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+personaPrefix\s*\(|^[ \t]*(?:export\s+)?(?:const|let|var)\s+personaPrefix\s*=/m.test(code)
  const extraction = /^[ \t]*(?:const|let|var)\s+\w+\s*=\s*\w+\.findIndex\([^\n]*prefix:/m.test(code) && /\.slice\(6\)/.test(code)
  return named || extraction
}
const importsPrefixParser = (text) => /^[ \t]*import\s*\{\s*personaPrefix\s*\}\s*from\s*['"]\.\.\/lib\/cordis-prefix\.mjs['"]/m.test(codeOnly(text))

// 同一判定函数的双向夹具：注释不算声明/导入，真代码仍要被识别。
const declaration = 'function personaPrefix(text) { return text }'
const sharedImport = "import { personaPrefix } from '../lib/cordis-prefix.mjs'"
for (const text of [`// ${declaration}`, `/*\n${declaration}\n*/`]) {
  assert.equal(ownsPrefixParser(text), false, 'comment-only declaration must not be a parser')
}
assert.equal(ownsPrefixParser(declaration), true, 'real declaration must be detected')
for (const text of [`// ${sharedImport}`, `/*\n${sharedImport}\n*/`]) {
  assert.equal(importsPrefixParser(text), false, 'commented import must not wire a reader')
}
assert.equal(importsPrefixParser(sharedImport), true, 'real shared import must be detected')
assert.equal(ownsPrefixParser(`const example = ${JSON.stringify(declaration)}`), false, 'ordinary string is not a declaration')
assert.equal(importsPrefixParser(`const example = ${JSON.stringify(sharedImport)}`), false, 'ordinary string is not an import')
const renamedExtraction = 'const start = lines.findIndex(line => /^\\s*prefix:/.test(line))\nout.push(lines[i].slice(6))'
assert.equal(ownsPrefixParser(renamedExtraction), true, 'renamed legacy parser must still be detected')
assert.equal(ownsPrefixParser(`/*\n${renamedExtraction}\n*/`), false, 'legacy algorithm in a block comment is not a parser')
console.log('PASS guard self-checks: comments/strings inert, real declarations/imports/copies detected')

const definitions = []
for (const path of sources) {
  const text = readFileSync(resolve(REPO, path), 'utf8')
  if (ownsPrefixParser(text)) definitions.push(path)
}
assert.deepEqual(definitions.sort(), ['lib/cordis-prefix.mjs'], 'prefix parser definitions must have exactly one owner')
for (const path of [
  'scripts/retake-workflow-fixtures.mjs',
  'tests/verify-production.mjs',
  'tests/verify-workflow-core.mjs',
  'tests/verify-workflow-core-render.mjs',
  'tests/verify-batch-state.mjs',
]) {
  const text = readFileSync(resolve(REPO, path), 'utf8')
  assert.equal(importsPrefixParser(text), true, `${path} must import the shared parser`)
}
console.log('PASS one prefix parser owner and all five reader imports')
