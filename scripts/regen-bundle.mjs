// regen-bundle.mjs — regenerate cordis.patch.yml from agent.cordis.yml
// (same logic verify-bundle-sync.mjs asserts). One-off maintenance helper.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const sync = readFileSync(join(repo, 'tests', 'verify-bundle-sync.mjs'), 'utf8')
// Reuse the asserted header verbatim from the test's own constant.
const header = sync.match(/const header = `([\s\S]*?)`/)[1]
const src = readFileSync(join(repo, 'agent.cordis.yml'), 'utf8').replace(/\r\n/g, '\n')
const out = header + src.split('\n').map(l => (l.trimEnd() === '' ? '' : '          ' + l)).join('\n')
writeFileSync(join(repo, 'cordis.patch.yml'), out)
console.log('cordis.patch.yml regenerated from agent.cordis.yml')
