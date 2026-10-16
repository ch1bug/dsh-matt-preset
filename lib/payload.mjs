/**
 * payload.mjs — package.json `files` 白名单的展开规则（安装器与守卫共用的单一事实源）。
 *
 * 为什么单独成模块（retro 2026-10-16）：这段逻辑原在 bin/install.mjs 内部，而该文件
 * 被 import 即执行 CLI（无 main 守卫）→ 无法单测。后果是一整类**静默**缺陷：
 * #55 实测 `workflow-profile-*.txt` 这条"看起来完全正确"的白名单条目被展开成空数组，
 * payload 少发货，而清单、manifest、安装日志全都正常；唯一的防线是环境门禁用例
 * （DSH_MATT_INSTALLER），默认套件照样全绿（见 issue #66）。
 * 抽出来后 tests/verify-payload-manifest.mjs 可以**离线**断言"每个条目至少解析出
 * 一个现存文件"，把这类缺陷变成默认红灯。
 *
 * 语义（npm `files` 字段的最小实现，与 bin/install.mjs 原实现逐字一致）：
 *   - 无 `*`：单个路径（文件或目录），原样返回，**不查存在**（调用方按存在性过滤）；
 *   - 有 `*`：通配——前缀必须是**目录**（`*.mjs` 的前缀是空串 = 包根；`skills/*` 的
 *     前缀是 `skills/`）。**文件名前缀通配**（`dir/name-*.txt`）当前不支持，返回空数组：
 *     这是已知缺陷（#66）。在修法落地前，守卫用例保证它不会静默通过。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 展开单个 `files` 条目（相对 `srcDir`）。 */
export async function expandEntry(srcDir, entry) {
  if (!entry.includes('*')) return [entry]
  const prefix = entry.slice(0, entry.indexOf('*'))
  const dir = join(srcDir, prefix)
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  const pattern = new RegExp('^' + entry.replaceAll('.', '\\.').replaceAll('*', '[^/]*') + '$')
  return names.filter((n) => pattern.test(n)).map((n) => prefix + n)
}

/**
 * 读取 `pkgDir/package.json` 的 `files` 白名单，返回**实际存在**的 payload 相对路径。
 * 无白名单（或空）时抛错——调用方决定怎么死（CLI: die；测试: 直接红）。
 */
export async function payloadOf(pkgDir) {
  const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    throw new Error(`package.json has no files whitelist: ${pkgDir}`)
  }
  const entries = (await Promise.all(pkg.files.map((e) => expandEntry(pkgDir, e)))).flat()
  const present = []
  for (const e of entries) if (existsSync(join(pkgDir, e))) present.push(e)
  // payload 是路径**集合**：显式条目与命中它的通配（如 `workflow-core.mjs` + `*.mjs`）
  // 会指向同一文件——去重后 manifest.files 才是真实的发货清单，也不会重复拷两遍。
  return { pkg, entries: [...new Set(present)] }
}