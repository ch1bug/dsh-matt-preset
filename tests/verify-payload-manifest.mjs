/**
 * verify-payload-manifest.mjs — package.json `files` 白名单的**离线**守卫
 * （retro 2026-10-16 第 1 项；对应 issue #66 那类"清单对、货少发"）。
 *
 * 为什么存在：展开规则原在 bin/install.mjs 内部，而该文件 import 即执行 CLI
 * （无 main 守卫）→ 无法单测。于是 #55 实测到的缺陷默认套件全绿：
 * `workflow-profile-*.txt` 这类**文件名前缀通配**被 expandEntry 静默展开成空数组，
 * payload 少发货，而清单 / manifest / 安装日志全都正常；唯一的防线是环境门禁
 * （DSH_MATT_INSTALLER）下的 verify-installer，常规 `pnpm test` 看不到。
 *
 * 本用例用**安装器自己的实现**（lib/payload.mjs，单一事实源；不重写一份语义），
 * 离线断言每个白名单条目至少解析出一个现存文件——#66 落地前它保证缺陷变红，
 * 落地后它保证没有条目再被静默吞掉。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandEntry, payloadOf } from '../lib/payload.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

// ── P1: 没有条目被静默吞掉 ──────────────────────────────────────────────────
const expansions = await Promise.all(
  PKG.files.map(async (entry) => ({ entry, files: await expandEntry(REPO, entry) })),
)
const silent = expansions.filter(({ files }) => !files.some((f) => existsSync(join(REPO, f))))
if (Array.isArray(PKG.files) && PKG.files.length > 0 && silent.length === 0) {
  ok('P1. every files entry resolves to at least one existing file', `${PKG.files.length} entries`)
} else {
  bad(
    'P1. files entry resolves to NOTHING (installer would silently ship without it)',
    silent.length > 0 ? silent.map(({ entry }) => entry).join(', ') : 'package.json has no files whitelist',
  )
}

// ── P2: 展开结果就是安装器要拷的 payload ─────────────────────────────────────
const { entries } = await payloadOf(REPO)
if (entries.length >= 10 && new Set(entries).size === entries.length) {
  ok('P2. payloadOf() yields a non-empty, duplicate-free payload', `${entries.length} paths`)
} else {
  bad('P2. payloadOf()', `${entries.length} paths, ${new Set(entries).size} unique`)
}

// ── P3: bundle 载体必须在 payload 里（否则挂载成功但无 patch 可装载，#28） ────
const patch = PKG.dsh?.bundle?.patch
const patchPath = typeof patch === 'string' ? patch.replace(/^\.\//, '') : undefined
if (patchPath !== undefined && entries.includes(patchPath)) {
  ok('P3. the declared bundle patch rides in the payload', patchPath)
} else {
  bad('P3. bundle patch in payload', `declared=${String(patchPath)} present=${String(entries.includes(patchPath))}`)
}

console.log('\n=== PAYLOAD MANIFEST VERIFY (offline) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)