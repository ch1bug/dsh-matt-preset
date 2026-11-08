#!/usr/bin/env node
/**
 * retake-workflow-fixtures.mjs —— 机械重取两份 body 冻结基线（#100 AC Z4 / D48 先例）。
 *
 * 为什么要脚本而不是"照抄一份"：`tests/fixtures/workflow-body-v1.txt` 与
 * `persona-prefix-v1.txt` 是「正文随文本政策有意变更」时**必须同步重取**的基线
 * （`verify-workflow-core` 的 L1、`verify-workflow-core-render` 的 R4、
 * `verify-workflow-profiles` 的 AC1/AC3、`verify-batch-state` 的 C8 都在读它们）。
 * 重取的正确形态是**机械拼装**而不是手抄一份新正文——手抄出来的是**第二份手写
 * 清单**（brief §3.1 问句①）。
 *
 * #58 起基线 = **组件开 standard 的注入文本**（默认 components = 全部注册组件——
 * 与改动前行为一致），重取直接取 `workflow-core.profileBody('standard')`（机制
 * 自己拼装，组件 delta 的组成变化自动跟随），不再手写骨架+组件的二次拼装。
 *
 * 自证（任一不成立就停下，绝不静默改写）：
 *   ① **对**（结构关系）：磁盘上的 `persona-prefix-v1.txt` == `prefix` +
 *      `"\n\n"` + `workflow-body-v1.txt`。不成立 → 有人手改过其中一份。
 *   ② **变换**（剥标记）：基线存的是**渲染后的正文**（`@@ <id>` 标记行不进模型），
 *      所以骨架的 `joinSections(parseSections(骨架))` 必须比带标记的源**短**、且一行
 *      `@@` 都不含。不成立 → 解析/拼接语义变了，重取会写坏。
 *   ②b **组合**（#58）：重取对象 `profileBody('standard')` 必须无标记、比骨架往返
 *      长（batch 组件节在场）、且含 batch 节首行特征。不成立 → 组件组装面变了。
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

import { personaPrefix } from '../lib/cordis-prefix.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BODY = resolve(REPO, 'workflow-body.txt')
const BODY_FIXTURE = resolve(REPO, 'tests/fixtures/workflow-body-v1.txt')
const PERSONA_FIXTURE = resolve(REPO, 'tests/fixtures/persona-prefix-v1.txt')
const COMPOSITION = resolve(REPO, 'agent.cordis.yml')

const lf = (text) => String(text).replace(/\r\n/g, '\n')
const crlf = (text) => String(text).replace(/\n/g, '\r\n')

// 保留脚本已有的公开导出，但解析只由 lib 持有。
export { personaPrefix } from '../lib/cordis-prefix.mjs'

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

  // 自证 ②b（#58 组件组合面）：重取对象 = 组件开 standard 注入文本——必须无标记、
  // 比骨架往返长（batch 组件节在场）、且含 batch 节首行特征。#137 起 lane 组件同批
  // 注册且默认全开——组合面还必须含 lane 节首行特征，否则重取会把缺 lane 组件的
  // 文本写进基线。任一不成立 = 组件组装面变了，重取会把坏字节写进基线。
  const composed = await core.profileBody('standard')
  if (hasMarker(composed) || composed.length <= next.body.length ||
      !composed.includes('BATCH MODE') || !composed.includes('LANE BATCH')) {
    console.error('✗ 自证②b 失败：profileBody("standard") 组合面异常（含 "@@ " / 不比骨架往返长 / 缺 batch 或 lane 组件节）')
    console.error(`  骨架往返 ${next.body.length} chars → 组合 ${composed.length} chars；先修 workflow-core.mjs 再重取`)
    return 1
  }
  console.log(`✓ 自证②b：组件开组合 = 重取对象（骨架往返 ${next.body.length} → 组合 ${composed.length} chars，batch + lane 组件节在场）`)

  const nextPersona = prefix + '\n\n' + composed
  if (composed === diskBody && nextPersona === diskPersona) {
    console.log('✓ 基线已与当前正文同步（无需重取）')
    return 0
  }
  if (checkOnly) {
    console.error(`✗ --check：基线未同步（workflow-body-v1 ${diskBody.length} → ${composed.length} chars）`)
    return 1
  }
  writeFileSync(BODY_FIXTURE, crlf(composed), 'utf8')
  writeFileSync(PERSONA_FIXTURE, crlf(nextPersona), 'utf8')
  console.log(`✓ 重取：workflow-body-v1.txt ${diskBody.length} → ${composed.length} chars`)
  console.log(`✓ 重取：persona-prefix-v1.txt ${diskPersona.length} → ${nextPersona.length} chars`)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(await main(process.argv))