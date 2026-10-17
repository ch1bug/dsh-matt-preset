// regen-bundle.mjs — regenerate the bundle's patch layer from agent.cordis.yml.
//
// #99 (ADR-0015): one bundle declares FOUR modes across FOUR patch files —
//   cordis.patch.yml                      (matt default, dsh.bundle.patch[0])
//   presets/matt-ptc.patch.yml
//   presets/matt-minimal.patch.yml
//   presets/matt-cordis.patch.yml
// The default mode has NO file of its own: it rides the existing carrier (a
// second declaration of the same config.id makes the registry throw and takes
// the whole bundle down). All four are composed by lib/bundle-patch.mjs from the
// single hand-edited source (agent.cordis.yml). This script is the write side of
// the same code tests/verify-bundle-sync.mjs asserts against, so the two cannot
// drift.
//
// Usage: node scripts/regen-bundle.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { expectedPatches } from '../lib/bundle-patch.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const patches = await expectedPatches(repo)

await mkdir(join(repo, 'presets'), { recursive: true })
for (const [rel, content] of patches) {
  await writeFile(join(repo, rel), content)
  console.log(`regenerated ${rel}`)
}
console.log(`${patches.size} bundle patch files regenerated from agent.cordis.yml`)