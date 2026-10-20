/**
 * verify-sandcastle-pins.mjs —— sandcastle 模板的 DSH 钉版一致性守卫（#34 第 3 项，Q2 口径）。
 *
 * 为什么存在：模板 `sandcastle/templates/Dockerfile` 必须能**裸 `podman build`**（消费者树里
 * 没有本仓的 `scripts/`），所以它带一个 `ARG DSH_VERSION=<默认值>`；而钉版的**单一事实源**是
 * 本仓 `package.json` 的 `version`（去掉 `-r<N>` 后缀即宿主锚，ADR-0008 /
 * docs/dev-environment.md §2）。默认值与派生锚一旦漂移，容器里装的就是**另一条 rc 线**，
 * 而套件照样全绿——D47「防线缺席必须响亮」。现场（2026-10-20）：Dockerfile 钉 `0.1.1-rc.2`，
 * 包内已是 `0.2.1-rc.2-r1`。
 *
 * 派生规则**不在此重写**：`anchorOf` 直接 import `scripts/runtime-anchor.mjs`（唯一实现，
 * #34 的 Q2：不新写第二份派生逻辑）。
 *
 * P0 比较器非空洞自检（历史两个漂移值必须判为**不等**——否则 P1 永远绿）
 * P1 Dockerfile 的 `ARG DSH_VERSION=<默认值>` 唯一且 == 派生锚；且安装行**真的消费**该 ARG
 *    （`npm i -g @deepseek-ai/dsh@${DSH_VERSION}`）——否则 ARG 是装饰品
 * P2 Dockerfile 里任何 dsh 版本字面量都必须等于派生锚（注释里写旧版本也算漂移）；
 *    安装行不得写死字面量
 * P3 README 写明机制（ARG / 构建包装器 / 守卫指针），且本身不含旧版本字面量
 * P4 docs/dev-environment.md **§2 段落内**：`本仓 `<version>`` 与「当前锚」行都等于事实源
 *    （限定在 §2 内提取：全文首个 `本仓 `…`` 可能是别处的散文，那是 D13 的形态）
 * P5 docs/RELEASE.md 的锚点表：`latest（跟 RC）` 行与 `打包产物` 行都等于事实源
 * P6 docs/dev-environment.md 的两处 `--version` 期望值 == 派生锚
 *
 * 不做的事：不联网核对 npm 上该版本是否存在（离线可跑；发布面由 `podman build` 与
 * complete-check.sh 的镜像内版本断言负责）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// 派生规则唯一实现（#34 Q2）：不在此手抄正则。
import { anchorOf } from '../scripts/runtime-anchor.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

const read = (rel) => {
  try {
    return readFileSync(join(REPO, rel), 'utf8')
  } catch {
    return undefined
  }
}

const pkgVersion = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
const declaredAnchor = anchorOf(pkgVersion)
/** `docs/**` 与模板里的版本字面量形状（`0.2.1-rc.2`、`0.2.1-rc.2-r1` …）。 */
const VERSION_RE = /\b\d+\.\d+\.\d+-(?:rc|alpha|beta)\.\d+(?:-[ra]\d+)?\b/g

// ── P0: 比较器非空洞 ────────────────────────────────────────────────────────
const HISTORIC_DRIFT = ['0.1.1-rc.2-r1', '0.2.0-rc.2-r1']
const outputs = HISTORIC_DRIFT.map(anchorOf)
if (declaredAnchor !== undefined && outputs.every((a) => a !== undefined && a !== declaredAnchor)) {
  ok('P0. anchor comparator is non-vacuous', `${HISTORIC_DRIFT.join(' / ')} 都不等于 ${declaredAnchor}`)
} else {
  bad('P0. anchor comparator degenerate', `declared=${declaredAnchor ?? '?'} historic=${outputs.join(' / ')} —— P1 会永远绿`)
}

// ── P1 / P2: Dockerfile ────────────────────────────────────────────────────
const dockerfile = read('sandcastle/templates/Dockerfile')
if (dockerfile === undefined) {
  bad('P1. sandcastle/templates/Dockerfile readable')
} else {
  const argDefaults = [...dockerfile.matchAll(/^\s*ARG\s+DSH_VERSION=(\S+)\s*$/gm)].map((m) => m[1])
  if (argDefaults.length !== 1) {
    bad('P1. exactly one `ARG DSH_VERSION=<默认值>` line', `找到 ${argDefaults.length} 条：${argDefaults.join(', ') || '无'}`)
  } else if (argDefaults[0] !== declaredAnchor) {
    bad(
      'P1. ARG 默认值 == 派生锚（漂移）',
      `ARG DSH_VERSION=${argDefaults[0]} declared=${declaredAnchor ?? '?'}（事实源 package.json version ${pkgVersion}）`,
    )
  } else {
    ok('P1. ARG default == declared host anchor', argDefaults[0])
  }
  // ARG 必须被安装行消费（否则加了 ARG 却仍装别的版本 = 装饰品）
  const consuming = [...dockerfile.matchAll(/^\s*RUN\s+npm\s+i(?:nstall)?\s+(?:-g|--global)\s+@deepseek-ai\/dsh@\$\{DSH_VERSION\}\s*$/gm)]
  if (consuming.length === 1) ok('P1b. the install line consumes ${DSH_VERSION}')
  else bad('P1b. install line 没有消费 ${DSH_VERSION}', `命中 ${consuming.length} 条 —— ARG 成了装饰品`)

  // P2: 任何 dsh 版本字面量都必须等于派生锚；安装行不得写死
  const pinnedLiterals = [...dockerfile.matchAll(/@deepseek-ai\/dsh@(\S+)/g)].map((m) => m[1])
  const hardPinned = pinnedLiterals.filter((v) => v !== '${DSH_VERSION}')
  const stale = hardPinned.filter((v) => v !== declaredAnchor)
  if (stale.length === 0) ok('P2. no stale dsh version literal in the Dockerfile', hardPinned.length === 0 ? '无字面量钉版（全走 ARG）' : `${hardPinned.join(', ')}`)
  else bad('P2. stale dsh version literal in the Dockerfile', `${stale.join(', ')} != ${declaredAnchor ?? '?'}（注释里写旧版本也算漂移）`)
  const otherVersions = [...(dockerfile.match(VERSION_RE) ?? [])].filter((v) => v !== declaredAnchor && v !== pkgVersion)
  if (otherVersions.length === 0) ok('P2b. every version literal in the Dockerfile matches the source of truth')
  else bad('P2b. Dockerfile 里有其它版本字面量', `${otherVersions.join(', ')}（只允许 ${declaredAnchor} / ${pkgVersion}）`)
}

// ── P3: README 写明机制 + 不含旧字面量 ──────────────────────────────────────
const readme = read('sandcastle/README.md')
if (readme === undefined) {
  bad('P3. sandcastle/README.md readable')
} else {
  const needles = ['ARG DSH_VERSION', 'build-image.sh', '--build-arg DSH_VERSION', 'tests/verify-sandcastle-pins.mjs']
  const missing = needles.filter((n) => !readme.includes(n))
  if (missing.length === 0) ok('P3. README documents ARG + build wrapper + guard pointer', `${needles.length} 个指针`)
  else bad('P3. README 缺钉版机制说明', `缺：${missing.join(' / ')}`)
  const staleLiterals = [...(readme.match(VERSION_RE) ?? [])].filter((v) => v !== declaredAnchor && v !== pkgVersion)
  if (staleLiterals.length === 0) ok('P3b. README 不含旧版本字面量')
  else bad('P3b. README 含旧版本字面量', `${[...new Set(staleLiterals)].join(', ')}`)
}

// ── P4: dev-environment §2 段落（不是全文散文） ─────────────────────────────
const devenv = read('docs/dev-environment.md')
if (devenv === undefined) {
  bad('P4. docs/dev-environment.md readable')
} else {
  const sec2 = devenv.split(/^## /m).find((s) => s.startsWith('2. '))
  if (sec2 === undefined) {
    bad('P4. dev-environment §2 段落存在', '结构变了：找不到以「## 2. 」开头的段落')
  } else {
    const claimed = /本仓 `([^`]+)`/.exec(sec2)?.[1]
    const currentRow = sec2.split(/\r?\n/).find((l) => /^\|\s*\*\*当前\*\*\s*\|/.test(l))
    const docTag = /dsh-v[\dA-Za-z.\-]+/.exec(currentRow ?? '')?.[0]
    const problems = []
    if (claimed !== pkgVersion) problems.push(`§2 本仓版本=${claimed ?? '?'} package.json=${pkgVersion}`)
    if (docTag !== `dsh-v${declaredAnchor ?? '?'}`) problems.push(`§2 当前锚=${docTag ?? '?'} 期望=dsh-v${declaredAnchor ?? '?'}`)
    if (problems.length === 0) ok('P4. dev-environment §2 anchors match the source of truth', `${pkgVersion} ↔ ${docTag}`)
    else bad('P4. dev-environment §2 锚点漂移', problems.join('；'))
  }
}

// ── P5: RELEASE.md 的锚点表 ───────────────────────────────────────────────
const release = read('docs/RELEASE.md')
if (release === undefined) {
  bad('P5. docs/RELEASE.md readable')
} else {
  const lines = release.split(/\r?\n/)
  const latestRow = lines.find((l) => /^\|\s*latest（跟 RC）\s*\|/.test(l))
  const tgzRow = lines.find((l) => /^\|\s*打包产物\s*\|/.test(l))
  const problems = []
  if (latestRow === undefined) problems.push('找不到「latest（跟 RC）」行')
  else {
    const cells = [...latestRow.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    if (!cells.includes(`dsh-v${pkgVersion}`)) problems.push(`latest 行缺 dsh-v${pkgVersion}（读到 ${cells.join(', ')}）`)
    if (!cells.includes(pkgVersion)) problems.push(`latest 行缺 ${pkgVersion}`)
  }
  if (tgzRow === undefined) problems.push('找不到「打包产物」行')
  else if (!tgzRow.includes(`dsh-matt-preset-${pkgVersion}.tgz`)) problems.push(`打包产物行缺 dsh-matt-preset-${pkgVersion}.tgz`)
  if (problems.length === 0) ok('P5. RELEASE.md anchor table matches the source of truth')
  else bad('P5. RELEASE.md 锚点表漂移', problems.join('；'))
}

// ── P6: dev-environment 的 --version 期望 ──────────────────────────────────
if (devenv !== undefined) {
  const expected = [
    /--version` 应为 `([^`]+)`/.exec(devenv)?.[1],
    /dsh --version\s+# → ([\w.\-]+)/.exec(devenv)?.[1],
  ]
  const wrong = expected.filter((v) => v !== declaredAnchor)
  if (expected.every((v) => v !== undefined) && wrong.length === 0) {
    ok('P6. dev-environment 的 --version 期望 == 派生锚', declaredAnchor)
  } else {
    bad(
      'P6. dev-environment 的 --version 期望与派生锚不一致（或结构变了）',
      `读到 ${expected.map((v) => v ?? '未找到').join(' / ')}；期望 ${declaredAnchor ?? '?'}`,
    )
  }
}

console.log('\n=== SANDCASTLE-PINS VERIFY RESULTS ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)