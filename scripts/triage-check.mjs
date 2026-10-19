#!/usr/bin/env node
/**
 * triage-check.mjs —— 分诊 / grill 收尾的**机械面**判据（#128 / 折叠自 #102 AC3）。
 *
 * 为什么只有这一半是机械的（D15 口径，写出来而不是装作覆盖了全部）：措辞黑名单
 * 里有**语境依赖**的词——`或`（并列选项语境）、`建议`（"要不要做"语境）、挂在决策上
 * 的裸 `?`——同一串字符在非决策语境里完全正常（"或"在描述二选一实现时是事实，
 * 不是推诿）。**判不了的不装成判据**：这一半在 `docs/agents/issue-tracker.md` 里
 * 显式写成「人判面」，本脚本只判**无歧义**的那几个词。
 *
 * 判据面（三条，各自独立可红）：
 *   1. 措辞黑名单（机械面）：草案 / 可微调 / 时微调 / 视情况 / 酌情 / 待定 / TBD
 *   2. RFA 互斥面（仅 --rfa 时要求）：票面自认「要 human 决定 / 实现时再定」——
 *      与 RFA 的定义（无任何待决项）直接互斥。非 RFA 票写这些是对的，故不判。
 *   3. RFA 的「四类核对」声明（仅 --rfa 时要求）：票面必须写出四类冲突的处置，
 *      ①②③④ 逐类在场。缺任一类 → 不许打 RFA（标签是人的动作，本脚本只判
 *      票面是否**够格**）。非 RFA 票不要求这一步。
 *
 * 用法：
 *   node scripts/triage-check.mjs <body-file>          # 只判黑名单
 *   node scripts/triage-check.mjs <body-file> --rfa    # 再判四类核对
 *   gh issue view <n> --json body --jq -r .body | node scripts/triage-check.mjs - --rfa
 *
 * exit：0 = 全绿；1 = 有红；2 = 用法错（缺输入 / 读了不存在的文件）。
 *
 * 观测面**只有一张**：本脚本不联网、不读 GitHub——票面在 tracker 上，套件不联网核
 * （#128 AC6）。判据的夹具自检在 `tests/verify-triage-check.mjs`。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 措辞黑名单的**机械面**：无歧义、任何语境下都不该出现在票面里。 */
export const BLACKLIST = [
  ['草案', /草案/],
  ['可微调', /可微调/],
  ['时微调', /时微调/],
  ['视情况', /视情况/],
  ['酌情', /酌情/],
  ['待定', /待定/],
  ['TBD', /\bTBD\b/i],
]

/** 显式声明「判不了、交人读」的那一半（写在这里是为了让它别悄悄变成"已覆盖"）。 */
export const HUMAN_JUDGED = ['或（并列选项语境）', '建议（"要不要做"语境）', '挂在决策上的裸 ?']

/** RFA 互斥面：票面**自认**还有待决项（"要 human 决定" / "实现时再定"）。
 * 只在 `--rfa` 时判 —— 非 RFA（RFH）票写这些是**对的**，正是它该写的东西。
 * 没有这一条时，一份「四类核对齐备 + 明写要 human 决定」的票面会绿着通过
 * （第 1 轮 Spec 轴实测的反例）；而 RFA 的定义就是不待决，两者直接互斥。 */
export const PENDING_DECISION = [
  ['要 human 决定', /(要|需|由)\s*human\s*决定/],
  ['human 拍板', /human\s*拍板/],
  ['实现时再定', /实现时再(定|问)|到时再(定|问)/],
]

/** 四类冲突（#102 的 ①–④；票面里用圈号或类名写出来都算）。 */
export const CONFLICT_FACES = [
  ['① 票面内部', /①|票面内部/],
  ['② 票面 vs 实测', /②|票面\s*vs\s*实测|与实测/],
  ['③ 文档 vs 实测', /③|文档\s*vs\s*实测|文档面/],
  ['④ 票级', /④|票级/],
]

/**
 * 判一份票面正文。
 * @param {{ text: string, rfa?: boolean }} input
 * @returns {{ pass: boolean, findings: string[], missingFaces: string[] }}
 */
export function checkTicketBody({ text, rfa = false }) {
  const body = String(text ?? '').replace(/\r\n/g, '\n')
  const findings = []
  const hits = BLACKLIST.filter(([, re]) => re.test(body)).map(([name]) => name)
  if (hits.length > 0) findings.push(`措辞黑名单命中：${hits.join(' / ')}（= 有一类冲突没读，推给下一会话）`)
  const pending = rfa ? PENDING_DECISION.filter(([, re]) => re.test(body)).map(([name]) => name) : []
  if (pending.length > 0) findings.push(`标了 RFA 却自认还有待决项：${pending.join(' / ')}（RFA 的定义就是不待决）`)
  const missingFaces = rfa ? CONFLICT_FACES.filter(([, re]) => !re.test(body)).map(([name]) => name) : []
  if (missingFaces.length > 0) findings.push(`标了 RFA 但四类核对缺：${missingFaces.join(' / ')}`)
  return { pass: findings.length === 0, findings, missingFaces, pending }
}

/** 结果 → 中文读数行（CLI 与夹具自检共用一份，避免"两处各写一份"）。 */
export function render({ pass, findings, missingFaces }, { rfa = false } = {}) {
  const lines = []
  if (pass) {
    lines.push(`  ✓ 措辞黑名单：无命中（机械面 ${BLACKLIST.length} 词；人判面 ${HUMAN_JUDGED.length} 项不在此判）`)
    if (rfa) lines.push(`  ✓ RFA 面：四类核对 ${CONFLICT_FACES.length} 类逐类在场；无待决项自认（${PENDING_DECISION.length} 条）`)
  } else {
    for (const finding of findings) lines.push(`  ✗ ${finding}`)
    if (missingFaces.length > 0) {
      lines.push(`    四类核对应形如：① 票面内部 … ② 票面 vs 实测 … ③ 文档 vs 实测 … ④ 票级 …`)
    }
  }
  return lines.join('\n')
}

/** CLI 入口（import 时不执行）。 */
function main(argv) {
  const args = argv.slice(2)
  const rfa = args.includes('--rfa')
  const targets = args.filter(a => !a.startsWith('--'))
  if (targets.length !== 1) {
    console.error('用法: node scripts/triage-check.mjs <body-file | -> [--rfa]')
    return 2
  }
  let text
  try {
    text = targets[0] === '-' ? readStdin() : readFileSync(targets[0], 'utf8')
  } catch (error) {
    console.error(`✗ 读不到票面正文：${targets[0]} —— ${String(error?.message ?? error)}`)
    return 2
  }
  // 空输入不是「票面没有冲突」，是**取数失败**。不响亮拦下来的话，它会被读成
  // 「四类核对全缺」——2026-10-19 实测就这么把人骗去追了一个不存在的编码问题：
  // `gh issue view <n> --json body --jq -r .body` 会被 gh 拒（`accepts 1 arg(s),
  // received 2`），变量为空、文件为空，判据报四类全缺。
  if (String(text).trim() === '') {
    console.error('✗ 输入为空（0 字节）—— 这是取数失败，不是「票面没有冲突」')
    console.error('  取票面正文：gh issue view <n> --json body --jq .body（--jq 只收一个参数；别加 -r）')
    return 2
  }
  const result = checkTicketBody({ text, rfa })
  console.log(render(result, { rfa }))
  console.log(result.pass ? '  · 判据：票面够格（标签动作是人的）' : '  · 判据：不够格 —— 先归零，再打标签')
  return result.pass ? 0 : 1
}

function readStdin() {
  return readFileSync(0, 'utf8')
}

// 只有**直接执行**才跑 CLI：被 import（夹具自检）时只暴露判据本身。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(main(process.argv))