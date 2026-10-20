/**
 * verify-sandcastle-pins.mjs —— sandcastle 模板的 DSH 钉版一致性守卫（#34 第 3 项）。
 *
 * 为什么存在：模板 `sandcastle/templates/Dockerfile` 里必须**写死**一个 dsh 版本
 * （镜像构建期读不到本仓的 package.json），而钉版的**单一事实源**是本仓
 * `package.json` 的 `version`——去掉 `-r<N>` 后缀即宿主锚（ADR-0008 /
 * docs/dev-environment.md §2，与 tests/verify-runtime-anchor.mjs 的 R2 同一口径）。
 * 两处一旦漂移，容器里装的就是**另一条 rc 线**，而套件照样全绿——D47「防线缺席
 * 必须响亮」。现场（2026-10-20）：Dockerfile 仍钉 `0.1.1-rc.2`，包内已升
 * `0.2.1-rc.2-r1`（#34 票面第 3 项）。
 *
 * P0 比较器非空洞自检（两个历史漂移值必须判为**不等**——否则 P1 永远绿）
 * P1 Dockerfile 里唯一一条 `npm i -g @deepseek-ai/dsh@<ver>`，且 `<ver>` == 声明锚
 * P2 无浮动钉版（`@latest` / `@next` / 裸包名）——浮动即红
 * P3 README 写明策略与守卫指针（"一处单一事实源"必须读者可见，只活在代码里没用）
 * P4 docs/dev-environment.md §2 的「当前锚」行与「本仓 `<version>`」字面量与事实源同字面量
 *
 * 不做的事：不联网核对 npm 上该版本是否存在（离线可跑；发布面由
 * `podman build` 与 complete-check.sh 的镜像内版本断言负责）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** `0.2.1-rc.2-r1` → `0.2.1-rc.2`（与 scripts/link-runtime-deps.mjs / verify-runtime-anchor.mjs 同口径）。 */
const anchorOf = (version) => {
  const m = /^(.+)-[ra]\d+$/.exec(String(version))
  return m === null ? undefined : m[1]
}

// ── P0: 比较器非空洞 ────────────────────────────────────────────────────────
const declaredAnchor = anchorOf(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version)
const HISTORIC_DRIFT = ['0.1.1-rc.2-r1', '0.2.0-rc.2-r1']
const outputs = HISTORIC_DRIFT.map(anchorOf)
if (declaredAnchor !== undefined && outputs.every((a) => a !== undefined && a !== declaredAnchor)) {
  ok('P0. anchor comparator is non-vacuous', `${HISTORIC_DRIFT.join(' / ')} 都不等于 ${declaredAnchor}`)
} else {
  bad('P0. anchor comparator degenerate', `declared=${declaredAnchor ?? '?'} historic=${outputs.join(' / ')} —— P1 会永远绿`)
}

// ── P1: Dockerfile 唯一一条钉版行 == 声明锚 ─────────────────────────────────
const dockerfile = read('sandcastle/templates/Dockerfile')
if (dockerfile === undefined) {
  bad('P1. sandcastle/templates/Dockerfile readable')
} else {
  const pins = [...dockerfile.matchAll(/npm\s+i(?:nstall)?\s+(?:-g|--global)\s+@deepseek-ai\/dsh@(\S+)/g)].map((m) => m[1])
  if (pins.length !== 1) {
    bad('P1. exactly one pinned `npm i -g @deepseek-ai/dsh@<ver>` line', `找到 ${pins.length} 条：${pins.join(', ') || '无'}`)
  } else if (pins[0] !== declaredAnchor) {
    bad(
      'P1. Dockerfile pin == declared host anchor（漂移）',
      `Dockerfile=${pins[0]} declared=${declaredAnchor ?? '?'}（事实源：package.json version ${JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version}）`,
    )
  } else {
    ok('P1. Dockerfile pin == declared host anchor', pins[0])
  }
  // ── P2: 无浮动/裸钉版 ────────────────────────────────────────────────────
  // 每一处 `@deepseek-ai/dsh` 引用都必须紧跟具体版本（`@<数字>…`）；`@latest` / `@next` /
  // `@^0.2` / 裸包名都会让镜像行为随 npm 漂移。
  const refs = [...dockerfile.matchAll(/@deepseek-ai\/dsh(@\S*)?/g)].map((m) => m[1] ?? '')
  const floating = refs.filter((v) => !/^@\d/.test(v))
  if (floating.length === 0) ok('P2. every dsh reference carries a concrete version', `${refs.length} 处`)
  else bad('P2. floating / bare dsh pin', `${floating.map((v) => `@deepseek-ai/dsh${v}`).join(', ')} —— 镜像行为会随 npm 漂移`)
}

// ── P3: README 写明策略 + 守卫指针 ──────────────────────────────────────────
const readme = read('sandcastle/README.md')
if (readme === undefined) {
  bad('P3. sandcastle/README.md readable')
} else {
  const missing = []
  if (!readme.includes('tests/verify-sandcastle-pins.mjs')) missing.push('守卫指针 tests/verify-sandcastle-pins.mjs')
  if (!readme.includes('package.json')) missing.push('事实源 package.json')
  if (!readme.includes('单一事实源')) missing.push('策略措辞「单一事实源」')
  if (missing.length === 0) ok('P3. README documents the pin policy and its guard')
  else bad('P3. README 缺钉版策略说明', `缺：${missing.join(' / ')}`)
}

// ── P4: dev-environment §2 的锚点行与事实源同字面量 ─────────────────────────
const devenv = read('docs/dev-environment.md')
if (devenv === undefined) {
  bad('P4. docs/dev-environment.md readable')
} else {
  const pkgVersion = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
  const declaredInDoc = /本仓 `([^`]+)`/.exec(devenv)?.[1]
  const currentRow = devenv.split(/\r?\n/).find((l) => /^\|\s*\*\*当前\*\*\s*\|/.test(l))
  const docTag = /dsh-v[\dA-Za-z.\-]+/.exec(currentRow ?? '')?.[0]
  const problems = []
  if (declaredInDoc !== pkgVersion) problems.push(`本仓版本文档=${declaredInDoc ?? '?'} package.json=${pkgVersion}`)
  if (docTag !== `dsh-v${declaredAnchor ?? '?'}`) problems.push(`当前锚文档=${docTag ?? '?'} 期望=dsh-v${declaredAnchor ?? '?'}`)
  if (problems.length === 0) ok('P4. dev-environment §2 anchor row matches the source of truth', `${pkgVersion} ↔ ${docTag}`)
  else bad('P4. dev-environment §2 锚点行漂移', problems.join('；'))
}

console.log('\n=== SANDCASTLE-PINS VERIFY RESULTS ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)