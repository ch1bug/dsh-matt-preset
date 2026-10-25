/**
 * verify-roster-alignment.mjs — #117（方向 b：有据差异）：四个 matt 模式的 roster
 * 与官方对应模式的差异**逐行登记且恰好等于登记面**，「模式描述 ↔ 实挂 roster」
 * 的承诺面被机械钉住。
 *
 * 为什么存在（票面根因）：本仓长期认为「官方 preset 不可读」（verify-preset-modes.mjs
 * 旧注释自陈 *equally unreadable*，其 M3c/M6c 对官方的断言是 `plugins: []` 模拟），
 * 故四模式 roster 从未与官方对齐过。#117 打通取证：官方包 @deepseek-ai/dsh-web-app
 * 发布在 npm，tarball 内 `package/presets/{standard,ptc,minimal,cordis}.patch.yml`
 * **可读**（取证配方与版本锚现查口径：docs/preset-roster-alignment.md）。拍板
 * （2026-10-24 grill）：方向 **b 有据差异**——保留 matt 增量、不追平官方形态，
 * 但差异逐模式成表（多与少都要理由）+ 机械断言钉住。
 *
 * 断言标号 A<n>（Alignment）；`G<n>` 是前置守卫——缺工件时**点名失败**而非静默
 * 跳过 AC。判据只读**生成载体**（cordis.patch.yml + presets/*.patch.yml），不读
 * agent.cordis.yml 源——扰动必须打在运行时真正读的那份上（#108 纪律）。
 *
 * 数据形状（tests/fixtures/official-presets-roster-v1.json，冻结快照）：
 *   - `official`：官方四档**全部** `- id:` 行（含 `preset-<mode>` 声明行，保真取证
 *     读数；比较时两侧统一排除 `preset-*`——官方声明行不是缺口，10-19 计数口径）；
 *   - `registeredDiff`：每配对登记的 added/omitted 期望表（**独立手写**，不是实算
 *     的回显——断言的意义就在「实算 == 登记」，登记若由实算生成即同义反复负债）；
 *   - `reasons`：每条差异的理由（票面 AC「多与少都要有理由」的数据落点；唯一
 *     事实源在此，docs/preset-roster-alignment.md 只留指针不抄表）。
 * 快照锚定 `@deepseek-ai/dsh-web-app@0.2.1-rc.2`；官方版本线移动时按配方**有意
 * 重取**（D48 先例：随政策重取不是漂移）。套件不联网对账官方移动版本线——冻结
 * 快照即离线事实源，联网取证只发生在人跑配方时。
 *
 * 扰动证明（本票实施时逐条真跑，红读数见交付记录）：
 *   - 摘 `tool-plugin-market` 行（撤 Z1）→ A2 红（omitted 多出未登记行）——Z5：
 *     plugin-market 原先在 tests/lib/scripts/docs 零引用，补行若无此断言即「改完
 *     没人验」；
 *   - 撤 ROSTER_MUTATIONS 的 market 条件式（改回不一致状态）→ verify-bundle-sync
 *     N11/N11c 红（Z2 的钉在 N11 族，不在本文件重复）；
 *   - 删任一 matt 特征行（如 workflow-core）→ A2 红（added 缺登记行）；
 *   - minimal 载体被裁剪而描述仍称「能力面与标准档完全一致」→ A4 红。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_PRESETS } from '../lib/bundle-patch.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

// ── G1: the frozen snapshot this suite reads must exist and self-describe ────
let snap
try {
  snap = JSON.parse(readFileSync(join(repo, 'tests/fixtures/official-presets-roster-v1.json'), 'utf8'))
} catch (error) {
  bad('G1. official roster snapshot parses', String(error?.message ?? error))
  report('ROSTER ALIGNMENT VERIFY (#117)')
}
for (const field of ['sourcePackage', 'sourceVersion', 'tarballUrl', 'presetGlob', 'capturedOn']) {
  if (typeof snap.meta?.[field] !== 'string' || snap.meta[field] === '') {
    bad(`G1. snapshot meta.${field} is a non-empty string (version anchor — recapture recipe: docs/preset-roster-alignment.md)`)
  }
}
if (results.some(r => r.startsWith('  ✗'))) report('ROSTER ALIGNMENT VERIFY (#117)')
ok('G1. frozen snapshot parses with a complete version anchor',
  `${snap.meta.sourcePackage}@${snap.meta.sourceVersion}, captured ${snap.meta.capturedOn}`)

// ── A1: the snapshot itself is self-consistent (guard against a corrupted retake)
{
  const modes = ['standard', 'ptc', 'minimal', 'cordis']
  for (const mode of modes) {
    const rows = snap.official?.[mode]
    if (!Array.isArray(rows) || rows.length === 0) {
      bad(`A1. snapshot official.${mode} is a non-empty row list`)
      continue
    }
    if (new Set(rows).size !== rows.length) bad(`A1. snapshot official.${mode} has duplicate row ids`)
    if (!rows.includes(`preset-${mode}`)) {
      bad(`A1. snapshot official.${mode} carries its own preset-${mode} declaration row`)
    }
  }
  if (results.some(r => r.startsWith('  ✗'))) report('ROSTER ALIGNMENT VERIFY (#117)')
  ok('A1. snapshot self-consistency', modes.map(m => `${m}=${snap.official[m].length} rows`).join(', '))
}

/** A carrier's rows, read as (id, name) pairs from the GENERATED artifact.
 *  Indentation-agnostic ON PURPOSE (measured, this suite's own first run): the
 *  roster nests rows inside `cordis:group` blocks (planning/compaction/
 *  delegation), so a `^ {10}- id:` anchor silently drops every nested row and
 *  the diff fills with phantom gaps. The ticket's counting rule is "all
 *  `- id:` rows at any depth" — same regex family as the forensic script, N11's
 *  rowsOf and the frozen snapshot extraction. */
const ROW_ID = /^\s*- id: (\S+)\s*$/
const rowsOfCarrier = (rel) => {
  const lines = readFileSync(join(repo, rel), 'utf8').replace(/\r\n/g, '\n').split('\n')
  const rows = []
  for (let i = 0; i < lines.length; i++) {
    const id = ROW_ID.exec(lines[i])?.[1]
    if (id === undefined) continue
    let name
    for (let j = i + 1; j < lines.length; j++) {
      if (ROW_ID.test(lines[j])) break
      const hit = /^\s+name: '?([^'\n]+?)'?\s*$/.exec(lines[j])
      if (hit !== null) { name = hit[1]; break }
    }
    rows.push({ id, name, line: i })
  }
  return rows
}
const pluginIds = (rows) => rows.map(r => r.id).filter(id => !id.startsWith('preset-'))

// ── A2: per pairing, the measured diff is EXACTLY the registered diff ────────
// Both directions are asserted (set equality), so neither "an unregistered row
// appears" nor "a registered row disappears" can pass — the same two-sided lock
// style as verify-bundle-sync N11/N11b. `preset-*` rows are excluded on BOTH
// sides (the 10-19 counting rule: official declaration ids are not a gap).
{
  const pairings = snap.pairing
  const knownMatt = new Set(ALL_PRESETS.map(p => p.id))
  const fileOf = new Map(ALL_PRESETS.map(p => [p.id, p.file]))
  for (const pair of pairings) {
    const label = `${pair.matt} ↔ official ${pair.official}`
    if (!knownMatt.has(pair.matt)) {
      bad(`A2 account. ${label}: pairing names a matt id the identity table does not declare`)
      continue
    }
    // A2 reads the carrier from the FIXTURE while A3 reads it from the identity
    // table (lib/bundle-patch.mjs) — two lookups that must agree, else a typo in
    // the fixture's `carrier` makes the two assertion groups read DIFFERENT
    // files and their readings silently disagree (review finding, spec axis:
    // the two reads never cross-check). One cheap equality here closes it.
    if (pair.carrier !== fileOf.get(pair.matt)) {
      bad(`A2 account. ${label}: fixture carrier ${JSON.stringify(pair.carrier)} != identity-table file ${JSON.stringify(fileOf.get(pair.matt))}`)
      continue
    }
    const carrier = rowsOfCarrier(pair.carrier)
    const mine = new Set(pluginIds(carrier))
    const theirs = new Set(pluginIds(snap.official[pair.official].map(id => ({ id }))))
    const added = [...mine].filter(id => !theirs.has(id)).sort()
    const omitted = [...theirs].filter(id => !mine.has(id)).sort()
    const reg = snap.registeredDiff[pair.matt]
    if (reg === undefined) {
      bad(`A2. ${label}: snapshot has no registeredDiff entry`)
      continue
    }
    // Every registered entry needs a reason key that exists — the ticket's AC is
    // "多与少都要有理由"; an entry whose why dangles is a table that lies.
    const dangling = [...reg.added, ...reg.omitted].filter(e => typeof e?.why !== 'string' || !(e.why in snap.reasons))
    if (dangling.length > 0) {
      bad(`A2. ${label}: registered entries with a missing/dangling reason key`,
        dangling.map(e => `${e.id}→${String(e.why)}`).join(', '))
    }
    const regAdded = reg.added.map(e => e.id).sort()
    const regOmitted = reg.omitted.map(e => e.id).sort()
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (eq(added, regAdded) && eq(omitted, regOmitted)) {
      ok(`A2. ${label} diff is exactly the registered one`, `+${added.length}/−${omitted.length}`)
    } else {
      const unexpectedAdd = added.filter(id => !regAdded.includes(id))
      const unexpectedOmit = omitted.filter(id => !regOmitted.includes(id))
      const missingAdd = regAdded.filter(id => !added.includes(id))
      const missingOmit = regOmitted.filter(id => !omitted.includes(id))
      bad(`A2. ${label} roster drift vs the registered diff`,
        [
          unexpectedAdd.length > 0 ? `unregistered extra rows: ${unexpectedAdd.join(', ')}` : '',
          unexpectedOmit.length > 0 ? `unregistered missing rows: ${unexpectedOmit.join(', ')}` : '',
          missingAdd.length > 0 ? `registered-as-added but absent: ${missingAdd.join(', ')}` : '',
          missingOmit.length > 0 ? `registered-as-omitted but present: ${missingOmit.join(', ')}` : '',
        ].filter(Boolean).join(' | ') || 'order-only mismatch')
    }
  }
}

// ── A3: rows pinned "same shape as official" — name equality + adjacency ────
// The Z1 half that the byte lock cannot see: N7 only proves carrier == source,
// so a mistyped package name in the SOURCE would regenerate green. The frozen
// officialNameOf is the independent expectation. Adjacency (manager → market,
// upstream order) is asserted per carrier.
{
  const byId = new Map(ALL_PRESETS.map(p => [p.id, p]))
  for (const pair of snap.pairing) {
    const rel = byId.get(pair.matt).file
    const rows = rowsOfCarrier(rel)
    for (const [id, officialName] of Object.entries(snap.officialNameOf ?? {})) {
      const row = rows.find(r => r.id === id)
      if (row === undefined) {
        bad(`A3. ${rel} lacks pinned row ${id} (should have been caught by A2 — this names the snapshot pin)`)
      } else if (row.name !== officialName) {
        bad(`A3. ${rel} row ${id} name drift vs frozen official`, `got=${JSON.stringify(row.name)} want=${JSON.stringify(officialName)}`)
      }
    }
    // manager → market adjacency: upstream spells them as consecutive blocks
    // (standard.patch.yml:123-128); a market row parked elsewhere is a silent
    // re-order the byte lock would happily regenerate.
    const manager = rows.findIndex(r => r.id === 'tool-plugin-manager')
    const market = rows.findIndex(r => r.id === 'tool-plugin-market')
    if (manager >= 0 && market === manager + 1) {
      ok(`A3. ${rel} keeps tool-plugin-market adjacent after manager`, `rows ${manager + 1}→${market + 1}`)
    } else {
      bad(`A3. ${rel} must list tool-plugin-market immediately after tool-plugin-manager`,
        `manager=${manager} market=${market}`)
    }
  }
}

// ── A4: the mode DESCRIPTIONS' promises are true of the mounted roster ───────
// #117 拍板 ②：「模式描述/意图 ↔ 实挂 roster」一致。断言方向是**承诺面**：描述
// 里点名的具体能力，roster 必须真挂（描述说谎 = D3 类缺陷）。描述不提的能力
// 不要求断言（描述不是清单）。两种承诺形态：
//   - row 型：含 phrase → 载体必须有 row。`pendingUntil`：行缺席时登记在案才
//     豁免（ptc 的 run_code → tool-presentation 归 #116，方向 A 已拍、行未挂，
//     SG10 已登记该缺口）；一旦行真挂上，pending 登记必须删除——本断言会红，
//     那是提醒清理，不是障碍（与 SG10 的「登记的期望行一旦真挂上」检测同向）。
//   - sameRosterAs 型：含 phrase → 该模式载体行集合与目标模式全等（minimal 的
//     「能力面与标准档完全一致」就是这条承诺的文案面）。
// Descriptions come from lib/bundle-patch.mjs (the single identity table), so
// editing the copy without the roster (or vice versa) fails right here.
const DESCRIPTION_ROSTER_CONTRACT = [
  { matt: 'dsh-matt-preset', phrase: '七门', row: 'workflow-core' },
  { matt: 'dsh-matt-preset', phrase: 'subagent', row: 'tool-subagent' },
  { matt: 'dsh-matt-preset', phrase: '/compact', row: 'compaction' },
  { matt: 'dsh-matt-preset', phrase: '/handoff', row: 'handoff-tool' },
  { matt: 'dsh-matt-preset-ptc', phrase: 'run_code', row: 'tool-presentation', pendingUntil: '#116' },
  { matt: 'dsh-matt-preset-ptc', phrase: 'agent()', row: 'tool-workflow' },
  { matt: 'dsh-matt-preset-minimal', phrase: '七门', row: 'workflow-core' },
  { matt: 'dsh-matt-preset-minimal', phrase: '能力面与标准档完全一致', sameRosterAs: 'dsh-matt-preset' },
  { matt: 'dsh-matt-preset-cordis', phrase: 'plugin_manager', row: 'tool-plugin-manager' },
  { matt: 'dsh-matt-preset-cordis', phrase: 'cordis_inspect_list', row: 'tool-cordis' },
]
{
  const byId = new Map(ALL_PRESETS.map(p => [p.id, p]))
  for (const entry of DESCRIPTION_ROSTER_CONTRACT) {
    const preset = byId.get(entry.matt)
    if (preset === undefined) {
      bad(`A4 account. contract entry names unknown matt id ${entry.matt}`)
      continue
    }
    if (!preset.description.includes(entry.phrase)) {
      // The phrase is GONE from the description: the promise was retracted. A
      // retracted promise must not leave a contract entry behind (dead entry =
      // a guard that can never fire again). Fail loudly so the table stays true.
      bad(`A4. ${entry.matt} description no longer contains ${JSON.stringify(entry.phrase)} — update the contract table`)
      continue
    }
    const rows = rowsOfCarrier(preset.file)
    if (entry.sameRosterAs !== undefined) {
      const target = byId.get(entry.sameRosterAs)
      const a = pluginIds(rows).join(',')
      const b = pluginIds(rowsOfCarrier(target.file)).join(',')
      if (a === b) {
        ok(`A4. ${entry.matt} description's「${entry.phrase}」is true of the roster`, `identical to ${entry.sameRosterAs} (${a.split(',').length} rows)`)
      } else {
        const setA = new Set(a.split(',')); const setB = new Set(b.split(','))
        const drift = [...setA].filter(x => !setB.has(x)).concat([...setB].filter(x => !setA.has(x)))
        bad(`A4. ${entry.matt} description promises「${entry.phrase}」but the roster differs from ${entry.sameRosterAs}`, drift.join(', '))
      }
      continue
    }
    const has = rows.some(r => r.id === entry.row)
    if (has && entry.pendingUntil === undefined) {
      ok(`A4. ${entry.matt} description's ${JSON.stringify(entry.phrase)} is backed by roster row ${entry.row}`)
    } else if (!has && entry.pendingUntil !== undefined) {
      ok(`A4. ${entry.matt} ${entry.row} still absent — registered pending until ${entry.pendingUntil} (SG10 tracks the promise)`)
    } else if (!has) {
      bad(`A4. ${entry.matt} description promises ${JSON.stringify(entry.phrase)} but roster row ${entry.row} is absent (documentation that lies, D3)`)
    } else {
      bad(`A4. ${entry.matt} roster row ${entry.row} is now PRESENT — remove the pendingUntil:${entry.pendingUntil} entry`, 'the gap it registered has closed')
    }
  }
}

report('ROSTER ALIGNMENT VERIFY (#117: registered diffs vs official 0.2.1-rc.2 + description promises)')
