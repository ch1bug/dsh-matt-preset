/**
 * verify-instance-assumptions.mjs — 端口 / 实例假设的静态回归守卫（D47 高危③，#69 的落地）。
 *
 * Why：这条高危的形态是"用例连一个**固定端口上跑着的实例**（3080 / 3090 / 19501…）；占用或没起
 * 时用例是**超时**而不是报错"（docs/dev-environment.md §0.3）。现役用例已经全部改成
 * `--port 0`（OS 分配）+ 未就绪 120s 响亮失败，但**钉住这条口径的东西并不存在**：谁再写一个
 * `--port 19501`、或把未就绪的超时出口删掉，症状就退回"卡住 / 超时"而不是一行红。
 * 本用例把那条口径变成静态守卫（与 verify-skills-mirror 的 M3/M4、verify-doc-references 的 R1 同族）。
 *
 *   A1 实例启动点一律 `--port 0`（出现非 0 值 = 固定口假设 → 红）
 *   A2 带 `--port` 的用例必须同时有**响亮的未就绪出口**（`instance not ready in …`）——
 *      没有它，端口占着/实例没起时就是静默超时
 *   A3 扫描面自检：扫到的用例数 ≥ 20 且起实例的用例 ≥ 1 —— 只防**判据静默失效**（不钉用例数量）
 *   A4 判据自检（非空洞）：合成样本必须让 clean 绿、固定口（空格形态与 `=` 形态）红、缺响亮
 *      出口红、**只在注释里写出口串**红 —— 真扫与 A4 走同一条聚合路径
 *
 * 判据只看**代码行**（注释不算实现）：复核实测，注释里写一句 `instance not ready in …` 曾让 A2 假绿。
 * 本文件自身含判据字面（`--port` / 出口串），自扫排除它（`SELF`）——A4 的合成样本代替它作自检。
 *
 * 口径边界：高危清单只到三条（本文件只做第③条），其余后议；汇总行不加 `gates=`（D29）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

const REPO = fileURLToPath(new URL('..', import.meta.url))
const SELF = 'verify-instance-assumptions.mjs'

/** 只看代码行：`//` / `*` / `/*` 起头的行全丢掉（判据不该被注释满足）。 */
const codeOnly = (text) => text.split(/\r?\n/u)
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
  .join('\n')

/** 启动点端口值：`--port 0`、`'--port', '19501'`、`--port=19501` 三种形态都算。 */
const PORT_ARG = /--port['"=\s,]+(\d+)/gu
/** "实例未就绪"的响亮出口（三条 live 用例同形；D47：超时必须是响亮失败）。 */
const LOUD_READY = /instance not ready in/u

/** 判据读数：代码行里的端口值 + 是否带响亮未就绪出口。 */
const probe = (text) => {
  const code = codeOnly(text)
  return {
    ports: [...code.matchAll(PORT_ARG)].map((m) => Number(m[1])),
    loudReady: LOUD_READY.test(code),
  }
}

/** 判据本体：真扫与 A4 的合成样本走**同一条聚合路径**，否则自检证明不了判据能红。 */
const check = (probed) => {
  const fixedPort = []
  const missingExit = []
  let occurrences = 0
  for (const { name, ports, loudReady } of probed) {
    if (ports.length === 0) continue
    occurrences += ports.length
    for (const port of ports) if (port !== 0) fixedPort.push(`${name}: --port ${port}`)
    if (!loudReady) missingExit.push(name)
  }
  return { fixedPort, missingExit, occurrences }
}

const files = readdirSync(join(REPO, 'tests'))
  .filter((f) => f.endsWith('.mjs') && f !== SELF)
  .sort()
const probed = files.map((f) => ({ name: f, ...probe(readFileSync(join(REPO, 'tests', f), 'utf8')) }))
const real = check(probed)
const withPort = probed.filter((p) => p.ports.length > 0).map((p) => p.name)

// A1
if (real.fixedPort.length === 0) {
  ok('A1. 实例启动点一律 --port 0（无固定口假设）',
    `起实例 ${withPort.length} 份 / --port 出现点 ${real.occurrences} 处：${withPort.join(', ')}`)
} else {
  bad('A1. 发现固定端口假设（占用/未起时会是超时而非报错）', real.fixedPort.join(' | '))
}

// A2
if (real.missingExit.length === 0) {
  ok('A2. 起实例的用例都带响亮未就绪出口（instance not ready in …）', withPort.join(', '))
} else {
  bad('A2. 起实例却没有响亮的未就绪出口', real.missingExit.join(', '))
}

// A3：判据静默失效时文件/启动点会骤降 → 这里亮红，而不是假绿。阈值只保证"扫到东西了"，
// 不钉用例数量（合法重命名 / 删除用例不该被这条误红）。
if (files.length >= 20 && withPort.length >= 1) {
  ok('A3. 扫描面自检：用例数 ≥ 20 且起实例的用例 ≥ 1',
    `用例 ${files.length} 份 / 起实例 ${withPort.length} 份 / 出现点 ${real.occurrences} 处`)
} else {
  bad('A3. 扫描面可能静默失效',
    `用例 ${files.length} 份 / 起实例 ${withPort.length} 份 / 出现点 ${real.occurrences} 处`)
}

// A4：判据自检。样本走 `probe` → `check` 同一条路（不是另写一遍语义）。
const synth = (name, text) => ({ name, ...probe(text) })
const LOUD_EXIT = `setTimeout(() => reject(new Error('instance not ready in 120s')), 120_000)`
const clean = check([synth('clean.mjs', `spawn(a, ['--port', '0'])\n${LOUD_EXIT}\n`)])
const fixedArg = check([synth('fixed-arg.mjs', `spawn(a, ['--port', '19501'])\n${LOUD_EXIT}\n`)])
const fixedEq = check([synth('fixed-eq.mjs', `spawn(a, ['--port=19501'])\n${LOUD_EXIT}\n`)])
/** 出口串**只在注释里**：判据必须仍然判红（这是"只看代码行"的锁）。 */
const commentOnly = check([synth('comment-only.mjs', `spawn(a, ['--port', '0'])\n// instance not ready in 120s\n`)])
if (clean.fixedPort.length === 0 && clean.missingExit.length === 0
  && fixedArg.fixedPort.length === 1 && fixedEq.fixedPort.length === 1
  && commentOnly.fixedPort.length === 0 && commentOnly.missingExit.length === 1) {
  ok('A4. 判据自检：clean 绿 / 固定口（空格与 `=` 两种）红 / 缺出口红 / 注释不算出口')
} else {
  bad('A4. 判据自检失败（判据可能恒绿）',
    `clean=${JSON.stringify(clean)} fixedArg=${fixedArg.fixedPort.length} fixedEq=${fixedEq.fixedPort.length} commentOnly=${commentOnly.missingExit.length}`)
}

console.log('\n=== INSTANCE ASSUMPTIONS VERIFY (A1–A4) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)