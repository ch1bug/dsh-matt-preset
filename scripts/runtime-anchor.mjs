/**
 * runtime-anchor.mjs —— 宿主锚派生规则的**唯一实现**（`0.2.1-rc.2-r1` → `0.2.1-rc.2`）。
 *
 * 为什么单独成模块（#34 的 Q2 拍定口径）：同一条派生规则此前**各有各的写法**——
 * `scripts/link-runtime-deps.mjs` 的私有 `declaredAnchor()`、`tests/verify-runtime-anchor.mjs`
 * 的 `anchorOf`、`tests/verify-sandcastle-pins.mjs` 的比较器——而 sandcastle 模板的构建包装器
 * 又要用它注入 `--build-arg DSH_VERSION`。第二份派生逻辑就是漂移的种子（D4「守卫手抄被测实现」/
 * D6「判定点重复」），所以规则收敛到这一个文件：链接脚本、两个守卫、构建包装器都 import/调用它，
 * **不再另写一份**。
 *
 * 两种用法：
 *   import { anchorOf, anchorOfPackage } from './runtime-anchor.mjs'   // 纯函数
 *   node scripts/runtime-anchor.mjs                                   // 打印本仓锚（CLI，包装器用）
 *
 * CLI 失败**响亮**（不猜）：package.json 读不到、或 version 不是 `<official>-r<N>` / `-a<N>`
 * 形态 → stderr 一行 + exit 1。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `<official>-r<N>` / `<official>-a<N>` → `<official>`；形态不符返回 undefined。 */
export function anchorOf(version) {
  const m = /^(.+)-[ra]\d+$/.exec(String(version ?? ''))
  return m === null ? undefined : m[1]
}

/** 读 `<dir>/package.json` 的 version 并派生锚；读不到或形态不符返回 undefined。 */
export function anchorOfPackage(dir = REPO) {
  try {
    return anchorOf(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version)
  } catch {
    return undefined
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const anchor = anchorOfPackage()
  if (anchor === undefined) {
    console.error(
      'runtime-anchor: 读不到 package.json 的 version，或版本不是 `<official>-r<N>` / `-a<N>` 形态 —— 无法派生宿主锚（ADR-0008）',
    )
    process.exit(1)
  }
  console.log(anchor)
}