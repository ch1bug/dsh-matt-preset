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
 * 语义（`files` 白名单的收敛语法；2026-10-16 #66 修展开，2026-10-23 #72 收敛语法与逐文件）：
 *   - 接受的条目**恰好两种**：
 *     1. 显式路径（无 `*`）：原样返回，**不查存在**（payloadOf 负责存在性判定）。目录
 *        条目就是一条（`skills` / `lang-packs` / `sandcastle` / `lib`），递归拷贝是
 *        安装器的行为——显式目录在 manifest 里不膨胀（#72）；
 *     2. 单层 `*` 通配（`*` 不跨 `/`）。目录 = 第一个 `*` 之前最后一个 `/` 的左侧
 *        （`*.mjs` → 包根；`skills/*` → `skills`；`dir/name-*.txt` → `dir`），名称正则
 *        只匹配**该目录下的 basename**，命中结果再拼回目录前缀。命中**逐文件**进
 *        payload：命中目录时递归枚举其下的**文件**（npm 对命中目录递归的语义），目录
 *        本身不再是条目、空目录不发货也不报错——manifest.files 对通配条目是逐文件的
 *        真实清单（#72）。
 *   - 其余语法（`**`、`?`、`{}`、`[]`、`!`）在展开层**抛具名错误**
 *     （`unsupported files pattern: <条目>`，安装器 die、不落 store）：`**` 曾被当成
 *     单层 `*` 静默接受（`dir/**` 等价 `dir/*`，把直接子目录当条目发货）；`?`/`{}`/
 *     `[]`/`!` 被当字面量，在允许这些字符的文件系统上会静默命中同名文件。语义降级与
 *     平台相关行为都必须在展开层响亮，与"零展开必响亮"同一口径（#72）。
 *     历史缺陷（#66 修正前的 #55 症状，保留作背景）：更早的实现只有通配符占满第一段
 *     的写法能用（`*.mjs`）——旧正则拿整条 entry 去匹配 basename、且把通配符前缀当
 *     目录查存在，`a*.mjs`、`dir/*`、`dir/name-*.txt` 全部静默展开成空；静默空数组 =
 *     payload 少发货，而清单 / manifest / 安装日志全都正常（防线只剩环境门禁用例）。
 *   - 零展开（通配没命中——含**只命中空目录**，或无 `*` 但路径不存在）→ `payloadOf`
 *     **抛错**，安装器 die、不写 store：`files` 是唯一的发货契约，静默跳过 = 货少发
 *     （#66 修法②）。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 把 glob 片段翻成正则源码：转义正则元字符（`*` 除外），再把 `*` 放开成"不跨 `/`"的任意串。
 *  #72 起 `?`/`{}`/`[]`/`!` 进不到这里（assertSupportedPattern 已在展开层拒收），
 *  转义只服务 `.` 一类合法字面元字符。 */
function regexSourceOf(segment) {
  return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')
}

/** #72：`files` 条目语法收敛——显式路径 + 单层 `*` 之外（`**`、`?`、`{}`、`[]`、`!`）
 *  一律具名拒绝。判据**先于一切文件系统访问**：这些字符即使在文件系统上有同名文件，
 *  也不得静默命中（旧实现把它们当字面量，Linux 上会静默发货）。 */
function assertSupportedPattern(entry) {
  if (/\*\*|[?{}[\]!]/.test(entry)) {
    throw new Error(`unsupported files pattern: ${entry} ` +
      '(accepted: explicit paths and single-level `*` only; `**`, `?`, `{}`, `[]`, `!` are not supported)')
  }
}

/** 递归枚举 `rel` 目录之下的**文件**（不含目录条目；#72 通配命中的目录走这里，
 *  空目录贡献零个文件。读不了子目录就往上抛——响亮，不静默少发货）。 */
async function filesUnder(srcDir, rel) {
  const entries = await readdir(join(srcDir, rel), { withFileTypes: true })
  const files = []
  for (const e of entries) {
    const child = `${rel}/${e.name}`
    files.push(...(e.isDirectory() ? await filesUnder(srcDir, child) : [child]))
  }
  return files
}

/** 展开单个 `files` 条目（相对 `srcDir`）。 */
export async function expandEntry(srcDir, entry) {
  assertSupportedPattern(entry)
  if (!entry.includes('*')) return [entry]
  // 目录 = 第一个 `*` 之前最后一个 `/` 的左侧；空串 = 包根（`*.mjs` 这类）。
  const star = entry.indexOf('*')
  const slash = entry.lastIndexOf('/', star)
  const dir = slash === -1 ? '' : entry.slice(0, slash)
  // 正则只对**该目录下的 basename** 匹配，命中后再把 `dir/` 拼回去——#66 的修法①。
  const pattern = new RegExp('^' + regexSourceOf(entry.slice(slash + 1)) + '$')
  let hits
  try { hits = await readdir(dir === '' ? srcDir : join(srcDir, dir), { withFileTypes: true }) } catch { return [] }
  // #72：命中**逐文件**——命中目录时递归枚举其下的文件（npm 对命中目录递归的语义），
  // 目录本身不再是条目；空目录不发货也不报错（只命中空目录 = 零展开 → payloadOf 响亮）。
  const files = []
  for (const hit of hits.filter((h) => pattern.test(h.name))) {
    const rel = dir === '' ? hit.name : `${dir}/${hit.name}`
    if (hit.isDirectory()) files.push(...await filesUnder(srcDir, rel))
    else files.push(rel)
  }
  return files
}

/**
 * 读取 `pkgDir/package.json` 的 `files` 白名单，返回**实际存在**的 payload 相对路径
 * （#72 起通配条目解析出的都是**文件**：命中目录已递归成文件、空目录不发货）。
 * 三种情形抛错（调用方决定怎么死：CLI 走 die；测试直接红）：
 *   1. 无白名单（或空）；
 *   2. 任一 `files` 条目解析出 **0 个现存文件**（#66 修法②：`files` 是唯一发货契约，
 *      静默跳过 = "清单对、货少发"）。判据是**零展开**而非"少于预期"——`files` 表达
 *      不了预期数量，部分命中的条目仍可能发货不全（已知残余面）；
 *   3. 任一条目含子集外通配语法（`**`/`?`/`{}`/`[]`/`!`）→ 展开层抛
 *      `unsupported files pattern: <条目>`（#72）。
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