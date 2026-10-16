/**
 * payload.mjs — package.json `files` 白名单的展开规则（安装器与守卫共用的单一事实源）。
 *
 * 为什么单独成模块（retro 2026-10-16）：这段逻辑原在 bin/install.mjs 内部，而该文件
 * 当时被 import 即执行 CLI（main 守卫是同一 retro 才补上的）→ 无法单测。后果是一整类
 * **静默**缺陷：
 * #55 实测 `workflow-profile-*.txt` 这条"看起来完全正确"的白名单条目被展开成空数组，
 * payload 少发货，而清单、manifest、安装日志全都正常；唯一的防线是环境门禁用例
 * （DSH_MATT_INSTALLER），默认套件照样全绿（见 issue #66）。
 * 抽出来后 tests/verify-payload-manifest.mjs 可以**离线**断言"每个条目至少解析出
 * 一个现存文件"，把这类缺陷变成默认红灯。
 *
 * 语义（npm `files` 字段的最小实现；2026-10-16 #66 修正）：
 *   - 无 `*`：单个路径（文件或目录），原样返回，**不查存在**（payloadOf 负责存在性判定）；
 *   - 有 `*`：通配。目录 = 第一个 `*` 之前最后一个 `/` 的左侧（`*.mjs` → 包根；
 *     `skills/*` → `skills`；`dir/name-*.txt` → `dir`），名称正则只匹配**该目录下的
 *     basename**，命中结果再拼回目录前缀。`*` 不跨 `/`（`[^/]*`），无 `**` 语义。
 *     修复前（对 HEAD 实测）**只有通配符占满第一段的写法能用**（`*.mjs`）：旧的
 *     正则拿整条 entry 去匹配 basename、且把通配符前缀当目录查存在，于是 `a*.mjs`、
 *     `dir/*`、`dir/name-*.txt` 全部静默展开成空——票面"目录前缀通配（前缀以 `/`
 *     结尾）可用"的说法不成立，#66 的修法①顺带把它们一并修正。静默空数组 =
 *     payload 少发货，而清单 / manifest / 安装日志全都正常（防线只剩环境门禁用例）。
 *   - 零展开（通配没命中，或无 `*` 但路径不存在）→ `payloadOf` **抛错**，安装器 die、
 *     不写 store：`files` 是唯一的发货契约，静默跳过 = 货少发（#66 修法②）。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 把 glob 片段翻成正则源码：转义正则元字符（`*` 除外），再把 `*` 放开成"不跨 `/`"的任意串。 */
function regexSourceOf(segment) {
  return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')
}

/** 展开单个 `files` 条目（相对 `srcDir`）。 */
export async function expandEntry(srcDir, entry) {
  if (!entry.includes('*')) return [entry]
  // 目录 = 第一个 `*` 之前最后一个 `/` 的左侧；空串 = 包根（`*.mjs` 这类）。
  const star = entry.indexOf('*')
  const slash = entry.lastIndexOf('/', star)
  const dir = slash === -1 ? '' : entry.slice(0, slash)
  // 正则只对**该目录下的 basename** 匹配，命中后再把 `dir/` 拼回去——#66 的修法①。
  const pattern = new RegExp('^' + regexSourceOf(entry.slice(slash + 1)) + '$')
  let names
  try { names = await readdir(dir === '' ? srcDir : join(srcDir, dir)) } catch { return [] }
  return names.filter((n) => pattern.test(n)).map((n) => (dir === '' ? n : `${dir}/${n}`))
}

/**
 * 读取 `pkgDir/package.json` 的 `files` 白名单，返回**实际存在**的 payload 相对路径。
 * 两种情形抛错（调用方决定怎么死：CLI 走 die；测试直接红）：
 *   1. 无白名单（或空）；
 *   2. 任一 `files` 条目解析出 **0 个现存文件**（#66 修法②：`files` 是唯一发货契约，
 *      静默跳过 = "清单对、货少发"）。判据是**零展开**而非"少于预期"——`files` 表达
 *      不了预期数量，部分命中的条目仍可能发货不全（本票已知残余面）。
 */
export async function payloadOf(pkgDir) {
  const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    throw new Error(`package.json has no files whitelist: ${pkgDir}`)
  }
  const expansions = await Promise.all(
    pkg.files.map(async (entry) => ({ entry, files: await expandEntry(pkgDir, entry) })),
  )
  // #66 修法②：`files` 是唯一的发货契约，**任何**解析出 0 个现存文件的条目都必须
  // 响亮（安装器 die / 用例红），不再按条目名 existsSync 后静默丢弃——静默就是
  // "清单 / manifest / 日志全正常、货少发"（#55 实测）。
  const unresolved = expansions.filter(({ files }) => !files.some((f) => existsSync(join(pkgDir, f))))
  if (unresolved.length > 0) {
    throw new Error(`package.json files entry matched no existing file: ${unresolved.map(({ entry }) => entry).join(', ')} (${pkgDir})`)
  }
  const present = expansions.flatMap(({ files }) => files).filter((f) => existsSync(join(pkgDir, f)))
  // payload 是路径**集合**：显式条目与命中它的通配（如 `workflow-core.mjs` + `*.mjs`）
  // 会指向同一文件——去重后 manifest.files 才是真实的发货清单，也不会重复拷两遍。
  return { pkg, entries: [...new Set(present)] }
}