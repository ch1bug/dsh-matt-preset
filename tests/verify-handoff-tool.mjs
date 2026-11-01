/**
 * verify-handoff-tool.mjs —— handoff-tool **首个守卫**（#168：模板防呆合取形态的模板面）。
 *
 * 被测面 = `handoff-tool.mjs` 导出的 `assembleHandoffDocument`（#168 起从 executeHandoff
 * 提出的可导入拼装面；#172 item1 的 tracker 回读将落在同一函数上）。执行面（真挂具、真
 * 子会话）由 `tests/verify.mjs` Track A 覆盖；本文件管模板面：
 *
 *   T0  插件面（name / inject 契约形状）
 *   T1  无产物声明 → 产出**无产物清单节**（整节缺席，不是占位行）
 *   T2  快照节含**探针实值**（与守卫用 `gitIn` 独立读出的分支/HEAD 对照；干净树 = clean；
 *       旧模板的空值标签行零在场）
 *   T3  有产物声明 → 清单行 sha256 与守卫**独立现算**一致（重复声明幂等、相对路径按 cwd 解析）
 *   T4  占位行字面（`替换本行` / `sha256:0000` / 64 零哈希 / 「无产物 → 删除本节」指令注释）
 *       在**所有**产出物零在场
 *   T5  探针失败（非仓目录）→ 「探针失败：<原因>」响亮标记，**零空壳值行**
 *   T5b 产物声明非法（空白路径 / 缺文件 / 非数组）→ 响亮拒绝，不生成核不过的清单
 *   T6  status 短读数随树态变化（干净 → untracked×1）
 *   T7  凭据 / skill 门经新拼装面照常响亮（拒绝发生在写盘/建子会话之前）
 *   T8  定向 invocation 钉首行 + 交接边界段照常携带
 *   T9  #172 票面回读（注入 reader，不打真网）：票号凭据 → 节内 = reader 实值 +
 *       「以本节为准」规约 + 「生成后漂移」标记；T9b 失败面响亮零空壳、不造转抄实值行；
 *       T9c 批次凭据 / 候选 → 整节缺席且 reader 零调用
 *   T9d #172 复审①：gh 回读器 env 过滤（GIT_* 与 GH_REPO 剥离、认证面/PATH 保留）+
 *       源码消费锚；真 execFile 的 env 子进程传递显式声明不在断言面
 *   T10 #144 AC① 已关告警：回读 state=CLOSED → ticketClosed 信号 + Number 字段 +
 *       文本行钉票面措辞（「已关闭」「重复 handoff 可能重做已完成的工作」），文档照常产出（不阻断）
 *   T11 #144 未关票不告警：state=OPEN（含小写归一读数）→ 零信号零字段零文本行
 *   T12 #144 AC② 二次告警独立：open+已交过 → 仅 duplicateTicket；closed+已交过 →
 *       两独立信号并存（closed 不吞 duplicate）；未交过 → 不误报
 *   T13 #144 AC③ 未核不阻断 + 票号提取优先级：reader 失败 → ticketCheckUnverified
 *       （带票号与原因，字段+文本行「未核…不阻断」）；批次凭据/候选 → unverified（提取不到）
 *       且 reader 零调用；凭据行优先于节内引用；批次凭据退而在定向节扫 #<n>
 *   T14 #144 AC⑤ sidebarAttached：attachToWorkspace 五分支（no-workspace / attach-error
 *       ×2 / 成功 / 机会性 skip ×2）+ sidebarFields 映射（true 也机械可断言）
 *   T15 #144 执行面接线源码锚（handedOff 探针 / 信号收集 / 记忆 add / 字段文本映射 /
 *       sidebar 消费）；⚠ declare：真执行面（真挂具、记忆跨调用、Track A）不在本守卫
 *       断言面——接线由锚 + T10–T14 真函数注入面组合钉住，显式声明
 *
 * git 隔离：夹具仓走 `tests/isolated-git.mjs` 挂具（`fixtureEnv` + `gitIn`，`git -C` 定位、
 * env 剥 `GIT_*`）—— 与被测探针（`git -C` + 剥 `GIT_*`）同一套定位语义，夹具读数与探针
 * 读数因此可比。探针失败分支用**真非仓目录**实测，不注入假探针。#172 的 tracker 回读器
 * 反之**一律注入**（T8/T9 族）：守卫不打真网，缺省 gh 实现的两态语义由 tests/verify.mjs
 * Track A 在真挂具上断言（成功实值 / 失败原因都响亮）。
 *
 * 扰动真红（非空洞记录，字节级还原后零残留）：`.scratch/verify168/perturbation.md`、
 * `.scratch/verify172/perturbation.md`（#172）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

import { assembleHandoffDocument, attachToWorkspace, CREDENTIAL_FORMATS, HANDOFF_BOUNDARY, inject, name, readerEnv, sidebarFields, ticketGuardFields, ticketGuardTextLines } from '../handoff-tool.mjs'
import { fixtureEnv, gitIn } from './isolated-git.mjs'

const results = []
const ok = (label, detail = '') => results.push('  ✓ ' + label + (detail ? ' — ' + detail : ''))
const bad = (label, detail = '') => results.push('  ✗ ' + label + (detail ? ' — ' + detail : ''))

/** 取 `## <title>` 节的正文（到下一个 `\n## ` 或文末）。 */
const sectionOf = (text, title) => {
  const start = text.indexOf('## ' + title)
  if (start < 0) return ''
  const next = text.indexOf('\n## ', start)
  return text.slice(start, next < 0 ? text.length : next)
}
/** 快照节里的空壳值行：带 `: ` 标签但值为空（#168 明令禁止的旧壳形状）。 */
const emptyShells = (snapshot) => snapshot.split('\n').filter((l) => /^- [^:]+:\s*$/.test(l))
/** 旧模板的四个永远填不进去的空值标签（#168 拆除，禁止回植）。 */
const OLD_SHELL_LABELS = ['- 关键文件状态: ', '- 环境结论（', '- 已确认决策: ', '- 下一步（']
/** 旧模板的占位行字面（#168 绝迹清单）。 */
const PLACEHOLDER_LITERALS = ['替换本行', 'sha256:0000', '无产物 → 删除本节']
const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const tmpRoot = mkdtempSync(join(tmpdir(), 'verify-handoff-tool-'))
try {
  // ── 夹具仓（挂具隔离）：fixture-main 分支 + 一个干净提交 ─────────────────────────
  const repoDir = join(tmpRoot, 'repo')
  const bareDir = join(tmpRoot, 'not-a-repo')
  mkdirSync(repoDir)
  mkdirSync(bareDir)
  const env = fixtureEnv()
  const G = gitIn(repoDir, env)
  const die = (what, r) => {
    bad('夹具自检（不可继续）', `${what}: exit=${r.status} ${String(r.stdout || r.stderr || '').slice(0, 200)}`)
    console.log('\n=== HANDOFF-TOOL VERIFY ===')
    console.log(results.join('\n'))
    process.exit(1)
  }
  die.unless = (cond, what, r) => { if (!cond) die(what, r) }
  let r = G('init', '-q', '-b', 'fixture-main')
  die.unless(r.status === 0, 'git init', r)
  r = G('config', 'user.email', 'fixture@example.invalid')
  die.unless(r.status === 0, 'git config email', r)
  r = G('config', 'user.name', 'fixture')
  die.unless(r.status === 0, 'git config name', r)
  writeFileSync(join(repoDir, 'README.md'), '# fixture repo for the handoff-tool guard\n')
  r = G('add', '-A')
  die.unless(r.status === 0, 'git add', r)
  r = G('commit', '-qm', 'fixture seed')
  die.unless(r.status === 0, 'git commit', r)
  // 独立读数（不走被测探针）：守卫自己的对照基准
  const branch = G('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()
  const head = G('rev-parse', '--short', 'HEAD').stdout.trim()
  die.unless(branch === 'fixture-main' && head.length >= 7, '夹具读数', r)

  const BODY = '候选交接验证正文：只写本会话现场事实。\n\n## 未验面\n\n- 守卫断言面已跑；GUI 侧子会话渲染未验（本守卫不建子会话）。'
  const docs = [] // T4 的占位行扫描面：所有产出物都进这里

  // ── T0 插件面 ─────────────────────────────────────────────────────────────────
  if (name === 'handoff-tool' && JSON.stringify(inject) === JSON.stringify(['tools', 'agents', 'agentPresets'])) {
    ok(`T0. 插件面（name=${name}；inject=${inject.join('/')}）`)
  } else {
    bad('T0. 插件面', `name=${JSON.stringify(name)} inject=${JSON.stringify(inject)}`)
  }

  // ── T1 + T2：无产物候选交接（干净树）──────────────────────────────────────────
  const doc1 = await assembleHandoffDocument(BODY, { cwd: repoDir })
  docs.push(doc1)
  if (!doc1.includes('产物清单') && !/sha256:[0-9a-f]/.test(doc1)) {
    ok('T1. 无产物声明 → 产出无产物清单节（整节缺席，无任何 sha256 行）')
  } else {
    bad('T1. 无产物声明 → 无产物清单节', '产出物含 产物清单/sha256 —— 占位行形态回潮')
  }
  {
    const snapshot = sectionOf(doc1, '环境快照（起手式验证）')
    const shells = emptyShells(snapshot)
    const oldLabels = OLD_SHELL_LABELS.filter((l) => snapshot.includes(l))
    const boundaryThere = doc1.includes('## 交接边界（首轮必读）') && doc1.includes('不是本会话的任务指令')
    if (snapshot === '') {
      bad('T2. 快照节含探针实值', '产出物无「## 环境快照」节')
    } else if (snapshot.includes(`- 分支/HEAD: ${branch} @ ${head}`) && snapshot.includes('- 工作树: clean')
      && !snapshot.includes('探针失败') && shells.length === 0 && oldLabels.length === 0 && boundaryThere) {
      ok('T2. 快照节含探针实值（对照 gitIn 独立读数）+ 干净树 clean + 旧空值标签零在场 + 边界段在场',
        `- 分支/HEAD: ${branch} @ ${head}`)
    } else {
      bad('T2. 快照节含探针实值', JSON.stringify({ snapshot, shells, oldLabels, boundaryThere, expect: `${branch} @ ${head}` }))
    }
  }

  // ── T6：树态变脏 → status 短读数跟随 ─────────────────────────────────────────
  writeFileSync(join(repoDir, 'notes-draft.txt'), 'untracked draft\n')
  const doc6 = await assembleHandoffDocument(BODY, { cwd: repoDir })
  docs.push(doc6)
  {
    const worktreeLine = sectionOf(doc6, '环境快照（起手式验证）').split('\n').find((l) => l.startsWith('- 工作树: ')) ?? ''
    if (worktreeLine.includes('untracked×1') && worktreeLine.includes('1 行变更')) {
      ok('T6. status 短读数随树态变化（clean → untracked×1）', worktreeLine.slice(0, 90))
    } else {
      bad('T6. status 短读数随树态变化', worktreeLine)
    }
  }

  // ── T3：有产物 → 清单行哈希 = 守卫独立现算 ───────────────────────────────────
  mkdirSync(join(repoDir, 'utils'), { recursive: true })
  mkdirSync(join(repoDir, 'evidence'), { recursive: true })
  writeFileSync(join(repoDir, 'utils', 'slug.js'), 'export const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")\n')
  writeFileSync(join(repoDir, 'evidence', 'green.txt'), 'verify-all quick set exit 0\n')
  const expectSha = {
    'utils/slug.js': sha256Of(join(repoDir, 'utils', 'slug.js')),
    'evidence/green.txt': sha256Of(join(repoDir, 'evidence', 'green.txt')),
  }
  // 同一文件以相对形态 + 绝对形态 + 重复共声明 4 次：归一化后必须幂等成 2 行（#168 复审 F3）
  const doc3 = await assembleHandoffDocument(BODY, {
    cwd: repoDir,
    artifacts: ['utils/slug.js', 'evidence/green.txt', 'utils/slug.js', join(repoDir, 'utils', 'slug.js')],
  })
  docs.push(doc3)
  {
    const manifest = sectionOf(doc3, '产物清单（子会话逐条机械校验）')
    const lines = [...manifest.matchAll(/^- `([^`]+)` sha256:([0-9a-f]{64})$/gm)].map((m) => [m[1], m[2]])
    const dupGone = manifest.split('\n').filter((l) => l.startsWith('- `') && l.includes('utils/slug.js')).length === 1
    const allMatch = lines.length === 2 && lines.every(([p, h]) => expectSha[p] === h)
    if (manifest === '') {
      bad('T3. 有产物 → 清单行 sha256 现算实值', '声明了两个产物，产出物仍无产物清单节')
    } else if (allMatch && dupGone) {
      ok('T3. 有产物 → 清单行 sha256 与独立现算一致（相对/绝对声明归一幂等成 2 行，行路径为相对形态）',
        lines.map(([p, h]) => `${p}=${h.slice(0, 12)}…`).join(' '))
    } else {
      bad('T3. 有产物 → 清单行 sha256 现算实值', JSON.stringify({ lines, expectSha, dupGone }))
    }
  }

  // ── T4：占位行字面在所有产出物零在场 ─────────────────────────────────────────
  {
    const offenders = []
    for (const [i, doc] of docs.entries()) {
      for (const lit of PLACEHOLDER_LITERALS) {
        if (doc.includes(lit)) offenders.push(`doc#${i}: ${lit}`)
      }
      if (/sha256:0{64}/.test(doc)) offenders.push(`doc#${i}: sha256:0{64}`)
    }
    if (offenders.length === 0 && docs.length >= 3) {
      ok(`T4. 占位行字面零在场（${docs.length} 份产出物 × ${PLACEHOLDER_LITERALS.length} 字面 + 64 零哈希）`)
    } else {
      bad('T4. 占位行字面零在场', offenders.length > 0 ? offenders.join(' ｜ ') : `产出物只有 ${docs.length} 份（扫描面不足，不报假绿）`)
    }
  }

  // ── T5：探针失败 → 响亮标记 + 零空壳（真非仓目录）────────────────────────────
  {
    const doc5 = await assembleHandoffDocument(BODY, { cwd: bareDir })
    docs.push(doc5)
    const snapshot = sectionOf(doc5, '环境快照（起手式验证）')
    const branchLine = snapshot.split('\n').find((l) => l.startsWith('- 分支/HEAD: ')) ?? ''
    const worktreeLine = snapshot.split('\n').find((l) => l.startsWith('- 工作树: ')) ?? ''
    const bothLoud = branchLine.includes('探针失败：') && worktreeLine.includes('探针失败：')
      && branchLine.slice('- 分支/HEAD: 探针失败：'.length).trim().length > 0
      && worktreeLine.slice('- 工作树: 探针失败：'.length).trim().length > 0
    const reallyBare = !existsSync(join(bareDir, '.git'))
    if (bothLoud && emptyShells(snapshot).length === 0 && reallyBare) {
      ok('T5. 探针失败（非仓目录）→ 两个值都是「探针失败：<非空原因>」，零空壳值行',
        branchLine.slice(0, 80))
    } else {
      bad('T5. 探针失败 → 响亮标记', JSON.stringify({ branchLine, worktreeLine, reallyBare }))
    }
  }

  // ── T5b：产物声明非法 → 响亮拒绝 ─────────────────────────────────────────────
  {
    const rejects = []
    const expectReject = async (label, artifacts, needle) => {
      try {
        await assembleHandoffDocument(BODY, { cwd: repoDir, artifacts })
        rejects.push(`${label}: 未拒绝`)
      } catch (error) {
        if (!String(error?.message ?? error).includes(needle)) {
          rejects.push(`${label}: 报错不含「${needle}」—— ${String(error?.message ?? error).slice(0, 120)}`)
        }
      }
    }
    await expectReject('路径含空白', ['has space.txt'], '空白/反引号/星号')
    await expectReject('路径含反引号', ['a`b.txt'], '空白/反引号/星号')
    await expectReject('缺文件', ['missing-file.bin'], '现算哈希失败')
    await expectReject('非数组', 'utils/slug.js', 'path 字符串数组')
    await expectReject('空串项', [''], '非空 path 字符串')
    // 基准目录之外（#168 复审 F3）：绝对路径无法归一化 → 响亮拒绝——verifyManifest 按
    // join(rootDir, rel) 解析，绝对路径 rel 会假失真，不进清单。
    writeFileSync(join(bareDir, 'outside-artifact.txt'), 'outside the fixture repo cwd\n')
    await expectReject('基准目录外绝对路径', [join(bareDir, 'outside-artifact.txt')], '归一化')
    // 显式空数组 = 无产物：整节缺席（与 T1 同形）
    const docEmpty = await assembleHandoffDocument(BODY, { cwd: repoDir, artifacts: [] })
    docs.push(docEmpty)
    if (rejects.length === 0 && !docEmpty.includes('产物清单')) {
      ok('T5b. 产物声明非法逐条响亮拒绝（空白/反引号/缺文件/非数组/空串/基准目录外）+ 空数组 = 整节缺席')
    } else {
      bad('T5b. 产物声明非法 → 响亮拒绝', rejects.join(' ｜ ') + (docEmpty.includes('产物清单') ? ' ｜ 空数组仍生成清单节' : ''))
    }
  }

  // ── T7：凭据 / skill 门经新拼装面照常响亮 ────────────────────────────────────
  {
    const rejects = []
    try {
      await assembleHandoffDocument('正文\n\n## 本会话任务（human 已定向）\n\n- verify-ticket（无凭据行）', { skill: 'implement' })
      rejects.push('定向缺凭据: 未拒绝')
    } catch (error) {
      if (!String(error?.message ?? error).includes('凭据')) rejects.push('定向缺凭据: 报错不含「凭据」')
    }
    try {
      await assembleHandoffDocument('候选正文（无定向节）', { skill: 'implement' })
      rejects.push('候选带 skill: 未拒绝')
    } catch (error) {
      if (!String(error?.message ?? error).includes('skill')) rejects.push('候选带 skill: 报错不含「skill」')
    }
    if (rejects.length === 0) {
      ok('T7. 凭据 / skill 门照常响亮（凭据字面 = CREDENTIAL_FORMATS 单点）',
        `${CREDENTIAL_FORMATS.batch} / ${CREDENTIAL_FORMATS.ticket}`)
    } else {
      bad('T7. 凭据 / skill 门', rejects.join(' ｜ '))
    }
  }

  // ── T8：定向 invocation 钉首行 + 定向节透传（注入 reader：守卫不打真网）───────
  {
    const doc8 = await assembleHandoffDocument(
      '定向验证正文。\n\n## 本会话任务（human 已定向）\n\n- verify-ticket\n- 凭据：#168（已落票，票 open）',
      { skill: 'implement', cwd: repoDir, trackerReader: async () => ({ ok: false, reason: 'T8 注入 reader：不回读' }) },
    )
    docs.push(doc8)
    const passThrough = doc8.includes('## 本会话任务（human 已定向）') && doc8.includes('凭据：#168')
    const pinned = doc8.startsWith('/implement\n\n# Handoff')
    if (passThrough && pinned) {
      ok('T8. 定向 invocation 钉首行（/implement → # Handoff）+ 定向节与凭据行透传')
    } else {
      bad('T8. 定向 invocation / 定向节透传', JSON.stringify({ pinned, passThrough, head: doc8.slice(0, 60) }))
    }
  }

  // ── T9：#172 票面回读（注入 reader，不打真网）────────────────────────────────
  // T9  成功面：票号凭据 → 节内值行 = reader 实值（转抄值被规约行裁定：以本节为准）+
  //          「生成后漂移」标记在场；tool 不改正文（转抄行透传，判定交给节）。
  // T9b 失败面：「回读失败：<非空原因>」响亮标记 + 实读规约，零空壳、不造转抄实值行。
  // T9c 无对象面：批次凭据 / 候选交接 → 整节缺席，且 reader **零调用**（reader 被调即炸）。
  {
    const reads = []
    const fakeReader = async (ticket, cwd) => {
      reads.push({ ticket, cwd })
      return {
        ok: true,
        fields: {
          number: ticket,
          title: '回读实值标题（tracker 单源）',
          state: 'OPEN',
          labels: 'enhancement, ready-for-agent',
          url: 'https://tracker.invalid/issues/' + ticket,
        },
      }
    }
    const doc9 = await assembleHandoffDocument(
      '定向验证正文（#172 回读）。\n\n## 本会话任务（human 已定向）\n\n- verify-ticket\n'
      + '- 转抄标签：P0, ready-for-human（与 tracker 相反的转抄——扰动面）\n- 凭据：#171（已落票，票 open）',
      { skill: 'implement', cwd: repoDir, trackerReader: fakeReader },
    )
    docs.push(doc9)
    {
      const section = sectionOf(doc9, '票面回读（tracker 实读，#172）')
      const afterDirected = doc9.indexOf('## 票面回读') > doc9.indexOf('## 本会话任务（human 已定向）')
      const beforeSnapshot = doc9.indexOf('## 票面回读') < doc9.indexOf('## 环境快照')
      const valuesFromReader = section.includes('- 标题: 回读实值标题（tracker 单源）')
        && section.includes('- 状态: OPEN')
        && section.includes('- 标签: enhancement, ready-for-agent')
        && section.includes('- URL: https://tracker.invalid/issues/171')
      const transcriptionRuled = !section.includes('P0, ready-for-human') && doc9.includes('转抄标签：P0, ready-for-human')
        && section.includes('以本节为准')
      const driftMarked = section.includes('生成后漂移') && section.includes('以实读')
      const readerCalled = reads.length === 1 && reads[0].ticket === '171' && reads[0].cwd === repoDir
      if (section !== '' && afterDirected && beforeSnapshot && valuesFromReader && transcriptionRuled
        && driftMarked && readerCalled && emptyShells(section).length === 0) {
        ok('T9. 票号凭据 → 票面回读节 = reader 实值（转抄值被「以本节为准」裁定，正文透传）+ 生成后漂移标记 + 节序在定向节后快照前',
          `ticket=#${reads[0].ticket}`)
      } else {
        bad('T9. 票面回读成功面', JSON.stringify({ section: section.slice(0, 240), afterDirected, beforeSnapshot, valuesFromReader, transcriptionRuled, driftMarked, readerCalled }))
      }
    }
    const doc9b = await assembleHandoffDocument(
      '定向验证正文（回读失败面）。\n\n## 本会话任务（human 已定向）\n\n- verify-ticket\n- 凭据：#42（已落票，票 open）',
      { skill: 'implement', cwd: repoDir, trackerReader: async () => ({ ok: false, reason: '（注入）tracker 不可达' }) },
    )
    docs.push(doc9b)
    {
      const section = sectionOf(doc9b, '票面回读（tracker 实读，#172）')
      const loud = section.includes('- 回读失败：（注入）tracker 不可达')
        && section.includes('实读') && section.includes('不做机械背书')
      // 失败面不造实值：转抄值不冒充回读值（不静默降级）
      const noFakeValues = !section.includes('- 标题: ') && !section.includes('- 标签: ')
      if (section !== '' && loud && noFakeValues && emptyShells(section).length === 0) {
        ok('T9b. 回读失败 → 「回读失败：<非空原因>」响亮标记 + 实读规约，零空壳、不造转抄实值行')
      } else {
        bad('T9b. 票面回读失败面', JSON.stringify({ section: section.slice(0, 240), loud, noFakeValues }))
      }
    }
    {
      let calls = 0
      const explodingReader = async () => { calls += 1; throw new Error('无票号凭据不得触发回读') }
      const batchDoc = await assembleHandoffDocument(
        `定向验证正文（批次凭据）。\n\n## 本会话任务（human 已定向）\n\n- verify-ticket\n- ${CREDENTIAL_FORMATS.batch}（.scratch/batch-state.md 在案）`,
        { skill: 'implement', cwd: repoDir, trackerReader: explodingReader },
      )
      docs.push(batchDoc)
      const candidateDoc = await assembleHandoffDocument(BODY, { cwd: repoDir, trackerReader: explodingReader })
      docs.push(candidateDoc)
      if (!batchDoc.includes('票面回读') && !candidateDoc.includes('票面回读') && calls === 0) {
        ok('T9c. 批次凭据 / 候选交接 → 回读节整节缺席且 reader 零调用（无 tracker 对象不造该节）')
      } else {
        bad('T9c. 无票号凭据面', JSON.stringify({ batch: batchDoc.includes('票面回读'), candidate: candidateDoc.includes('票面回读'), calls }))
      }
    }
    // T9d（#172 复审①）：gh 回读器的 env 过滤面——GIT_*（GIT_DIR/GIT_WORK_TREE 会劫持 gh
    // 内部 git remote 解析）与 GH_REPO（静默覆盖 gh 仓库定位 → 读到别的 tracker 的同号票
    // 还顶着机械背书）必须被剥；认证面 GH_TOKEN/GH_HOST 与 PATH 必须保留。
    // 断言两级：① readerEnv 函数本身（真函数真行为）；② 源码消费锚 `env: readerEnv(process.env)`
    // 在 ghTicketReader 的 execFile options 里（同 O7b 钉 HANDOFF_BOUNDARY 消费的手法）。
    // ⚠ declare：真 execFile 把过滤后 env 传给子进程这一层不在守卫断言面（守卫注入 reader
    // 不走真 execFile）——靠源码锚 + 函数级断言组合钉住，不是「已完整验证子进程 env」。
    {
      const filtered = readerEnv({ GIT_DIR: 'x', GIT_WORK_TREE: 'y', GIT_INDEX_FILE: 'z', GH_REPO: 'o/r', GH_TOKEN: 't', GH_HOST: 'h', PATH: 'p', HOME: 'hd' })
      const stripped = !('GIT_DIR' in filtered) && !('GIT_WORK_TREE' in filtered) && !('GIT_INDEX_FILE' in filtered) && !('GH_REPO' in filtered)
      const kept = filtered.GH_TOKEN === 't' && filtered.GH_HOST === 'h' && filtered.PATH === 'p' && filtered.HOME === 'hd'
      const consumed = readFileSync(join(REPO, 'handoff-tool.mjs'), 'utf8').includes('{ timeout: GH_TICKET_TIMEOUT_MS, windowsHide: true, cwd, env: readerEnv(process.env) }')
      if (stripped && kept && consumed) {
        ok('T9d. gh 回读器 env 过滤（#110 同族，复审①）：GIT_*/GH_REPO 剥离、GH_TOKEN/GH_HOST/PATH 保留 + 源码消费锚在场')
      } else {
        bad('T9d. gh 回读器 env 过滤', JSON.stringify({ stripped, kept, consumed }))
      }
    }
  }

  // ── T10–T13：#144 调用前防呆（注入 reader / handedOff 记忆探针，不打真网）─────────
  // 判定落点 = 拼装面 buildTicketSection（与 #172 回读共用一次读取）；信号经
  // ticketGuardSignals 收集器带出，ticketGuardFields/ticketGuardTextLines 是同一映射的
  // 消费面（executeHandoff 用它组装返回值）——守卫直接断言「信号 → 字段/文本」端到端。
  {
    const openRead = (n) => async () => ({ ok: true, fields: { number: n, title: `在办票 ${n}（fixture）`, state: 'OPEN', labels: 'enhancement', url: `https://tracker.invalid/issues/${n}` } })
    const closedRead = (n) => async () => ({ ok: true, fields: { number: n, title: `已关票 ${n}（fixture）`, state: 'CLOSED', labels: 'enhancement', url: `https://tracker.invalid/issues/${n}` } })
    const directedBody = (n) => `定向验证正文（#144）。\n\n## 本会话任务（human 已定向）\n\n- verify-ticket\n- 凭据：#${n}（已落票）`

    // T10（AC①）：已关票 → ticketClosed 信号 + Number 字段 + 文本行钉票面措辞；文档照常
    // 产出（不阻断——告警不是拦截）且回读节状态行 = tracker 实值 CLOSED。
    {
      const signals10 = []
      const doc10 = await assembleHandoffDocument(directedBody(140), { skill: 'implement', cwd: repoDir, trackerReader: closedRead(140), ticketGuardSignals: signals10 })
      docs.push(doc10)
      const fields = ticketGuardFields(signals10)
      const lines = ticketGuardTextLines(signals10)
      const closed = signals10.find((s) => s?.kind === 'ticketClosed')
      const stateLine = sectionOf(doc10, '票面回读（tracker 实读，#172）').split('\n').find((l) => l.startsWith('- 状态: ')) ?? ''
      const pass = closed?.ticket === '140'
        && fields.ticketClosed === 140 && !('duplicateTicket' in fields) && !('ticketCheckUnverified' in fields)
        && lines.length === 1 && lines[0].includes('已关闭') && lines[0].includes('重复 handoff 可能重做已完成的工作')
        && stateLine === '- 状态: CLOSED' && doc10.includes('## 交接边界（首轮必读）')
      if (pass) {
        ok('T10. 已关票 → ticketClosed 字段（结构化，AC①）+ 文本行钉「已关闭…重复 handoff 可能重做已完成的工作」+ 文档照常产出（不阻断）', fields.ticketClosed === 140 ? 'ticketClosed=140' : JSON.stringify(fields))
      } else {
        bad('T10. 已关票告警', JSON.stringify({ signals: signals10, fields, lines, stateLine }))
      }
    }

    // T11：未关票**不**告警——open（含小写归一读数）零信号零字段零文本行（扰动断言之一）。
    {
      const signals11 = []
      const doc11 = await assembleHandoffDocument(directedBody(141), { skill: 'implement', cwd: repoDir, trackerReader: openRead(141), ticketGuardSignals: signals11 })
      docs.push(doc11)
      const signals11b = []
      const doc11b = await assembleHandoffDocument(directedBody(141), { skill: 'implement', cwd: repoDir, trackerReader: async () => ({ ok: true, fields: { number: '141', title: 't', state: 'open', labels: 'l', url: 'u' } }), ticketGuardSignals: signals11b })
      docs.push(doc11b)
      const pass = signals11.length === 0 && signals11b.length === 0
        && Object.keys(ticketGuardFields(signals11)).length === 0 && ticketGuardTextLines(signals11).length === 0
        && sectionOf(doc11, '票面回读（tracker 实读，#172）').includes('- 状态: OPEN')
      if (pass) {
        ok('T11. 未关票不告警（OPEN/小写 open 零信号、零字段、零文本行——正常态零噪音）')
      } else {
        bad('T11. 未关票不告警', JSON.stringify({ open: signals11, lowerOpen: signals11b }))
      }
    }

    // T12（AC②）：二次告警与已关是**两个独立信号**——open+已交过 → 仅 duplicateTicket；
    // closed+已交过 → 两信号并存（closed 不吞 duplicate，反之亦然）。
    {
      const signals12a = []
      const doc12a = await assembleHandoffDocument(directedBody(142), { skill: 'implement', cwd: repoDir, trackerReader: openRead(142), handedOff: () => true, ticketGuardSignals: signals12a })
      docs.push(doc12a)
      const fields12a = ticketGuardFields(signals12a)
      const signals12b = []
      const doc12b = await assembleHandoffDocument(directedBody(142), { skill: 'implement', cwd: repoDir, trackerReader: closedRead(142), handedOff: () => true, ticketGuardSignals: signals12b })
      docs.push(doc12b)
      const fields12b = ticketGuardFields(signals12b)
      const pass = signals12a.length === 1 && signals12a[0]?.kind === 'duplicateTicket' && signals12a[0]?.ticket === '142'
        && fields12a.duplicateTicket === 142 && !('ticketClosed' in fields12a) && !('ticketCheckUnverified' in fields12a)
        && signals12b.length === 2 && fields12b.ticketClosed === 142 && fields12b.duplicateTicket === 142
        && ticketGuardTextLines(signals12b).some((l) => l.includes('同票重复调用'))
      if (pass) {
        ok('T12. 二次告警独立（AC②）：open+已交过仅 duplicateTicket；closed+已交过两独立信号并存（Number 字段各自可断言）')
      } else {
        bad('T12. 二次告警独立', JSON.stringify({ openPlusSeen: { signals: signals12a, fields: fields12a }, closedPlusSeen: { signals: signals12b, fields: fields12b } }))
      }
    }

    // T13（AC③ + brief 提取优先级）：未核不阻断——reader 失败 → ticketCheckUnverified
    // （带票号与原因）；批次凭据 / 候选 → unverified（提取不到）且 reader 零调用；
    // 提取优先级 = 凭据行 > 定向节内第一个 #<n> 引用。
    {
      const signals13a = []
      const doc13a = await assembleHandoffDocument(directedBody(143), { skill: 'implement', cwd: repoDir, trackerReader: async () => ({ ok: false, reason: '（T13）gh 不可达' }), ticketGuardSignals: signals13a })
      docs.push(doc13a)
      const fields13a = ticketGuardFields(signals13a)
      const lines13a = ticketGuardTextLines(signals13a)
      const unv = signals13a.find((s) => s?.kind === 'ticketCheckUnverified')

      const signals13b = []
      let calls13b = 0
      const doc13b = await assembleHandoffDocument(
        `定向验证正文（批次凭据）。\n\n## 本会话任务（human 已定向）\n\n- verify-ticket\n- ${CREDENTIAL_FORMATS.batch}（.scratch/batch-state.md 在案）`,
        { skill: 'implement', cwd: repoDir, trackerReader: async () => { calls13b += 1; return { ok: true, fields: { number: '0', title: 't', state: 'OPEN', labels: 'l', url: 'u' } } }, ticketGuardSignals: signals13b },
      )
      docs.push(doc13b)
      const unv13b = signals13b.find((s) => s?.kind === 'ticketCheckUnverified')

      const signals13c = []
      let calls13c = 0
      const doc13c = await assembleHandoffDocument(BODY, { cwd: repoDir, trackerReader: async () => { calls13c += 1; return { ok: true, fields: { number: '0', title: 't', state: 'OPEN', labels: 'l', url: 'u' } } }, ticketGuardSignals: signals13c })
      docs.push(doc13c)
      const unv13c = signals13c.find((s) => s?.kind === 'ticketCheckUnverified')

      // 13d 凭据行优先：凭据 #145 在场时，节内另一引用 #999 不得盖过它
      const seen13d = []
      const doc13d = await assembleHandoffDocument(
        '定向验证正文。\n\n## 本会话任务（human 已定向）\n\n- 上下文引用：#999\n- 凭据：#145（已落票）',
        { skill: 'implement', cwd: repoDir, trackerReader: async (t) => { seen13d.push(t); return { ok: true, fields: { number: t, title: 't', state: 'OPEN', labels: 'l', url: 'u' } } }, ticketGuardSignals: [] },
      )
      docs.push(doc13d)
      // 13e 批次凭据 + 定向节内引用 #146 → 退而扫定向节命中 146（reader 被调且票号正确）
      const seen13e = []
      const doc13e = await assembleHandoffDocument(
        `定向验证正文。\n\n## 本会话任务（human 已定向）\n\n- ${CREDENTIAL_FORMATS.batch}（.scratch/batch-state.md 在案）\n- 延续 #146 的收尾`,
        { skill: 'implement', cwd: repoDir, trackerReader: async (t) => { seen13e.push(t); return { ok: true, fields: { number: t, title: 't', state: 'OPEN', labels: 'l', url: 'u' } } }, ticketGuardSignals: [] },
      )
      docs.push(doc13e)

      const pass = unv?.ticket === '143' && String(unv?.reason).includes('（T13）gh 不可达')
        && fields13a.ticketCheckUnverified === String(unv?.reason) && !('ticketClosed' in fields13a)
        && lines13a.length === 1 && lines13a[0].includes('未核') && lines13a[0].includes('不阻断')
        && calls13b === 0 && signals13b.length === 1 && unv13b?.ticket === undefined && String(unv13b?.reason).includes('无单票对象')
        && calls13c === 0 && signals13c.length === 1 && String(unv13c?.reason).includes('无定向节')
        && seen13d.length === 1 && seen13d[0] === '145'
        && seen13e.length === 1 && seen13e[0] === '146'
      if (pass) {
        ok('T13. 未核不阻断（AC③）：reader 失败 → unverified 带票号原因（字段+「未核…不阻断」文本行）；批次/候选 → unverified（提取不到）且 reader 零调用；提取 = 凭据行优先、退而定向节扫 #<n>')
      } else {
        bad('T13. 未核与提取优先级', JSON.stringify({ unv, fields13a, lines13a, calls13b, unv13b, calls13c, unv13c, seen13d, seen13e }))
      }
    }
  }

  // ── T14：#144 AC⑤ attachToWorkspace 失败提升为模型可见（fake ctx，无真挂具）────────
  {
    const warns = []
    const fakeCtx = (registry) => ({
      get: (n) => (n === 'workspaceRegistry' ? registry : undefined),
      logger: { warn: (m) => warns.push(String(m)) },
    })
    const okRegistry = { resolveByPath: async () => ({ attachSession: async () => {} }) }
    const attachThrows = { resolveByPath: async () => ({ attachSession: async () => { throw new Error('（T14）attach 炸') } }) }
    const resolveThrows = { resolveByPath: async () => { throw new Error('（T14）resolve 炸') } }
    const noWsRegistry = { resolveByPath: async () => undefined }
    const rOk = await attachToWorkspace(fakeCtx(okRegistry), 'sid', repoDir)
    const warnsBeforeNoWs = warns.length
    const rNoWs = await attachToWorkspace(fakeCtx(noWsRegistry), 'sid', repoDir)
    const rErr1 = await attachToWorkspace(fakeCtx(attachThrows), 'sid', repoDir)
    const rErr2 = await attachToWorkspace(fakeCtx(resolveThrows), 'sid', repoDir)
    const rNoReg = await attachToWorkspace(fakeCtx(undefined), 'sid', repoDir)
    const rNoCwd = await attachToWorkspace(fakeCtx(okRegistry), 'sid', undefined)
    const fOk = sidebarFields(rOk)
    const fNoWs = sidebarFields(rNoWs)
    const fErr = sidebarFields(rErr1)
    const fSkip = sidebarFields(rNoReg)
    const pass = rOk?.attached === true
      && rNoWs?.attached === false && rNoWs?.reason === 'no-workspace'
      && rErr1?.attached === false && rErr1?.reason === 'attach-error'
      && rErr2?.attached === false && rErr2?.reason === 'attach-error'
      && rNoReg === undefined && rNoCwd === undefined
      && warns.length > warnsBeforeNoWs // 失败面日志照旧（返回值是新增模型可见面，不替代日志）
      && fOk.sidebarAttached === true && !('sidebarAttachReason' in fOk)
      && fNoWs.sidebarAttached === false && fNoWs.sidebarAttachReason === 'no-workspace'
      && fErr.sidebarAttached === false && fErr.sidebarAttachReason === 'attach-error'
      && Object.keys(fSkip).length === 0
    if (pass) {
      ok('T14. attachToWorkspace 五分支 + sidebarFields 映射（AC⑤）：no-workspace / attach-error（两 throw 面）/ 成功 / 机会性 skip×2（无 registry、无 cwd → 零字段）；成功也机械可断言（sidebarAttached: true）')
    } else {
      bad('T14. sidebarAttached', JSON.stringify({ rOk, rNoWs, rErr1, rErr2, rNoReg, rNoCwd, fOk, fNoWs, fErr, fSkip, warns: warns.length }))
    }
  }

  // ── T15：#144 执行面接线源码锚（executeHandoff 需真挂具，接线用锚钉住）─────────────
  // ⚠ declare：真执行面（真挂具上的记忆跨调用行为、返回字段实际出现）不在本守卫断言面
  // （Track A 未扩）——接线靠本锚 + T10–T14 的真函数注入面组合钉住，显式声明。
  {
    const src = readFileSync(join(REPO, 'handoff-tool.mjs'), 'utf8')
    const anchors = {
      memoryDeclared: src.includes('const HANDOFF_TICKET_MEMORY = new WeakMap()'),
      probeInjected: src.includes('handedOff: (ticket) => handedOffTickets.has(ticket)'),
      // signalsCollected 用含逗号的 shorthand 实传字面（#144 复审④：裸词会被注释残留命中，
      // 10 处→弱锚；`ticketGuardSignals,` 在源码恰 1 处 = executeHandoff 实传给 assemble 的行）
      signalsCollected: src.includes('ticketGuardSignals,'),
      memoryRecorded: src.includes("if (typeof event?.ticket === 'string') handedOffTickets.add(event.ticket)"),
      fieldsMapped: src.includes('...ticketGuardFields(ticketGuardSignals)'),
      textMapped: src.includes('...ticketGuardTextLines(ticketGuardSignals)'),
      sidebarConsumed: src.includes('const sidebar = await attachToWorkspace(ctx, handle.agent.session.id, header?.cwd)')
        && src.includes('...sidebarFields(sidebar)')
        && src.includes('sidebar?.attached === false'),
      schemaFields: src.includes('ticketClosed: { type: \'number\' }') && src.includes('duplicateTicket: { type: \'number\' }')
        && src.includes('ticketCheckUnverified: { type: \'string\' }') && src.includes('sidebarAttached: { type: \'boolean\' }'),
    }
    const missing = Object.entries(anchors).filter(([, v]) => !v).map(([k]) => k)
    if (missing.length === 0) {
      ok('T15. 执行面接线源码锚（记忆声明/探针注入/信号收集/拼装后记忆 add/字段文本映射/sidebar 消费/schema 字段）')
    } else {
      bad('T15. 执行面接线源码锚', `missing: ${missing.join(', ')}`)
    }
  }
} finally {
  // 只删本守卫自建的 mkdtemp 路径（home 安全判据：删除目标 = 本条命令自己建出来的路径）
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3 })
}

console.log('\n=== HANDOFF-TOOL VERIFY (T0–T15) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)
