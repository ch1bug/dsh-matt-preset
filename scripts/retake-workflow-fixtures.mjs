#!/usr/bin/env node
/**
 * retake-workflow-fixtures.mjs —— 机械重取两份 body 冻结基线（#100 AC Z4 / D48 先例）。
 *
 * 为什么要脚本而不是"照抄一份"：`tests/fixtures/workflow-body-v1.txt` 与
 * `persona-prefix-v1.txt` 是「正文随文本政策有意变更」时**必须同步重取**的基线
 * （`verify-workflow-core` 的 L1、`verify-workflow-core-render` 的 R4、
 * `verify-workflow-profiles` 的 AC1/AC3、`verify-batch-state` 的 C8 都在读它们）。
 * 重取的正确形态是**骨架往返**：`parseSections` → `joinSections`（骨架的恒等变换），
 * 而不是手抄一份新正文——手抄出来的是**第二份手写清单**（brief §3.1 问句①）。
 *
 * 两道自证（任一不成立就停下，绝不静默改写）：
 *   ① **对**（结构关系）：磁盘上的 `persona-prefix-v1.txt` == `prefix` +
 *      `"\n\n"` + `workflow-body-v1.txt`。不成立 → 有人手改过其中一份。
 *   ② **变换**（剥标记）：基线存的是**渲染后的正文**（`@@ <id>` 标记行不进模型），
 *      所以 `joinSections(parseSections(当前正文))` 必须比带标记的源**短**、且一行
 *      `@@` 都不含。不成立 → 解析/拼接语义变了，重取会写坏。
 * 行尾沿用 `workflow-body.txt` 的形态（CRLF）。
 *
 * 用法：
 *   node scripts/retake-workflow-fixtures.mjs          # 自证 + 重取并落盘
 *   node scripts/retake-workflow-fixtures.mjs --check  # 只自证并报告是否已同步（不写盘）
 *
 * exit：0 = 成功（或 --check 已同步）；1 = 自证失败 / --check 未同步；2 = 读不到输入。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BODY = resolve(REPO, 'workflow-body.txt')
const BODY_FIXTURE = resolve(REPO, 'tests/fixtures/workflow-body-v1.txt')
const PERSONA_FIXTURE = resolve(REPO, 'tests/fixtures/persona-prefix-v1.txt')
const COMPOSITION = resolve(REPO, 'agent.cordis.yml')

const lf = (text) => String(text).replace(/\r\n/g, '\n')
const crlf = (text) => String(text).replace(/\n/g, '\r\n')

/** 取 persona 前缀：`prefix: |` 块标量**或** `prefix: <inline>`（两种形态都要认——
 *  与 `tests/verify-production.mjs` 的取法同构；只认块标量时，inline 形态会被读成空串，
 *  重取就会把基线写歪而测试侧仍绿）。 */
export function personaPrefix(yml) {
  const lines = lf(yml).split('\n')
  const start = lines.findIndex(line => /^\s*prefix:/.test(line))
  if (start < 0) throw new Error('composition has no `prefix:` block')
  const inline = lines[start].match(/^\s*prefix:\s*(.*)$/)?.[1]
  if (inline !== undefined && inline !== '|') return inline
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}

/** 一份骨架正文 → 它的往返字节（parse → join，恒等）。 */
async function retake(core, bodyText) {
  const parsed = core.parseSections(bodyText)
  return { body: core.joinSections(parsed.sections, parsed.trailingNewline), sections: parsed.sections.length }
}

async function main(argv) {
  const checkOnly = argv.includes('--check')
  const core = await import(pathToFileURL(resolve(REPO, 'workflow-core.mjs')).href)

  const prefix = personaPrefix(readFileSync(COMPOSITION, 'utf8'))
  const bodyText = lf(readFileSync(BODY, 'utf8'))
  const diskBody = lf(readFileSync(BODY_FIXTURE, 'utf8'))
  const diskPersona = lf(readFileSync(PERSONA_FIXTURE, 'utf8'))

  // 自证 ①（结构关系）：磁盘上那对基线必须仍然同构。
  if (diskPersona !== prefix + '\n\n' + diskBody) {
    console.error('✗ 自证① 失败：persona-prefix-v1.txt != prefix + "\\n\\n" + workflow-body-v1.txt')
    console.error('  这对基线被人手改过其中一份 —— 先确认（D48：有意变更要一次重取，不是逐份手修）')
    return 1
  }
  console.log(`✓ 自证①：persona 基线 == prefix + "\\n\\n" + body 基线（prefix ${prefix.length} chars / body ${diskBody.length} chars）`)

  // 自证 ②（变换真的做了「剥标记」这件事）：基线存的是**渲染后的正文**（标记行不进模型），
  // 所以 joinSections 的结果必须①比带标记的源短 ②一行 `@@` 都不含 ③源里确实有标记。
  // 三条任一不成立 = 解析/拼接语义变了，此时重取会把坏字节写进基线。
  const hasMarker = (text) => /^@@ /m.test(text)
  const next = await retake(core, bodyText)
  if (!hasMarker(bodyText) || hasMarker(next.body) || next.body.length >= bodyText.length) {
    console.error('✗ 自证② 失败：骨架往返没有剥掉标记行（源含 "@@ " / 结果含 "@@ " / 结果不比源短）')
    console.error(`  源 ${bodyText.length} chars → 结果 ${next.body.length} chars；先修 workflow-core.mjs 再重取`)
    return 1
  }
  console.log(`✓ 自证②：骨架往返剥标记（源 ${bodyText.length} → 渲染 ${next.body.length} chars，${next.sections} 节）`)

  const nextPersona = prefix + '\n\n' + next.body
  if (next.body === diskBody && nextPersona === diskPersona) {
    console.log('✓ 基线已与当前正文同步（无需重取）')
    return 0
  }
  if (checkOnly) {
    console.error(`✗ --check：基线未同步（workflow-body-v1 ${diskBody.length} → ${next.body.length} chars）`)
    return 1
  }
  writeFileSync(BODY_FIXTURE, crlf(next.body), 'utf8')
  writeFileSync(PERSONA_FIXTURE, crlf(nextPersona), 'utf8')
  console.log(`✓ 重取：workflow-body-v1.txt ${diskBody.length} → ${next.body.length} chars`)
  console.log(`✓ 重取：persona-prefix-v1.txt ${diskPersona.length} → ${nextPersona.length} chars`)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(await main(process.argv))