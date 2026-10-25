/**
 * bundle-patch.mjs — bundle 补丁层的**单一构造事实源**（#99）。
 *
 * 为什么单独成模块（#99-B 的形态决策）：一个 bundle 现在声明**四份** patch 文件——
 * `cordis.patch.yml`（matt 默认模式，数组第 1 项）+ 三份 `presets/matt{,-ptc,-minimal,-cordis}`…
 * 精确地说：`presets/matt-ptc.patch.yml` / `presets/matt-minimal.patch.yml` /
 * `presets/matt-cordis.patch.yml`。四份的 `plugins` 是**同一份 matt roster**
 * （`agent.cordis.yml`），差异**只有四个字段**：`config.id` / `config.name` /
 * `config.description` / `order`，外加其 `workflow-core` 行的 `config.profile`。
 *
 * **默认档为什么不另起一份文件**（本仓实测事故）：`cordis.patch.yml` 本来就是默认模式
 * （`config.id: dsh-matt-preset`）。再补一份同 id 的 `presets/matt.patch.yml`，运行时的
 * 注册表会**响亮拒绝**（`Duplicate agent preset: dsh-matt-preset`）——整包挂不上。故默认档
 * 单独成 `DEFAULT_PRESET` 常量，机制上不可能被复制；`verify-bundle-sync.mjs` 另有
 * **四条声明 config.id 互不重复**的机械断言锁住这类回归。
 *
 * 若把四份文件手抄落盘，任何一次 roster 变更都要改四遍，且**没有任何机械保证它们真的一致**
 * （ADR-0015 §5 / ADR-0014 §5(d) 明文禁止手抄）。所以：本模块是唯一的构造处，
 *   - `scripts/regen-bundle.mjs` 用它**写盘**；
 *   - `tests/verify-bundle-sync.mjs` 用**同一批函数**算期望值并逐字节断言。
 * 生成器与锁定器共用一份实现 ⇒ 二者可以永不脱节（不是靠"两边都记得改"）。
 *
 * 缩进契约（沿用 #6 的既有约定，字节级）：`agent.cordis.yml` 的正文逐行缩进 **10 格**
 * 后拼在声明头之下；空行保持空行（不留尾随空格）。行尾统一 `\n`。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** `agent.cordis.yml` 正文在 patch 里的缩进宽度（既有约定，勿改）。 */
export const NEST = '          ' // 10 格

/**
 * 四模式的**身份表**（显示名与简介的唯一事实源）——**只列非默认档**。
 *
 * 为什么默认档不在这里（#99 事故的直接教训）：`cordis.patch.yml`（数组第 1 项）本来就是
 * matt 默认模式，`config.id: dsh-matt-preset`。若再补一份 `presets/matt.patch.yml` 声明同一个
 * id，运行时的 `agentPresetRegistry.register` **响亮拒绝**（`Duplicate agent preset: dsh-matt-preset`）
 * —— 整包挂不上，而不是"少一个模式"。故 DEFAULT_PRESET 单独成常量、机制上不可能被复制。
 *
 * 每条 `description` 各写各的（票面 AC：命名与简介互不相同）；`id` 一律带
 * `dsh-matt-preset` 前缀——**与官方四档 `standard`/`ptc`/`minimal`/`cordis` 刻意不相交**，
 * 官方四模式保留、不被覆盖（ADR-0015 §3）。
 *
 * `file` 是相对仓根的路径，`patchId` 是补丁行的 `insert` id（四者互不相同）。
 */
export const DEFAULT_PRESET = {
  file: 'cordis.patch.yml',
  patchId: 'preset-dsh-matt-preset',
  id: 'dsh-matt-preset',
  name: 'Matt 工作流',
  description:
    '默认全量工作流：七门 + 批次模式 + 全部辅助节，Matt Pocock 的 ask-matt 流程原样。'
    + '形状未定先 grill、spec 已定走 to-spec/to-tickets、形状已定直接 implement，'
    + '阶段边界由 continue → subagent → /compact → /handoff 承接。',
  order: 0,
  profile: 'standard',
}

/** 三个非默认档（各自的 `presets/*.patch.yml`）。 */
export const PRESETS = [
  {
    file: 'presets/matt-ptc.patch.yml',
    patchId: 'preset-dsh-matt-preset-ptc',
    id: 'dsh-matt-preset-ptc',
    name: 'Matt 工作流 · PTC',
    description:
      '工具面即程序面：用 run_code 写程序替代逐条工具调用，程序一次性执行、状态落文件，'
      + '编排走 agent() / parallel() / pipeline()。七门按**效果**判定（只读不确认），'
      + '门清单一条不改、语义零改动。',
    order: 1,
    profile: 'ptc',
  },
  {
    file: 'presets/matt-minimal.patch.yml',
    patchId: 'preset-dsh-matt-preset-minimal',
    id: 'dsh-matt-preset-minimal',
    name: 'Matt 工作流 · 精简',
    description:
      '七门逐字保留、其余节压到约三分之一：token 预算紧张的长会话里仍不丢门，'
      + '辅助节只留锚点。压的是注入正文不是工具——能力面与标准档完全一致，'
      + '「精简」不裁工具。适合上下文吃紧但仍要走完整流程的场景。',
    order: 2,
    profile: 'minimal',
  },
  {
    file: 'presets/matt-cordis.patch.yml',
    patchId: 'preset-dsh-matt-preset-cordis',
    id: 'dsh-matt-preset-cordis',
    name: 'Matt 工作流 · Cordis',
    description:
      '面向 DSH 插件 / preset 创作：plugin_manager 的 install_bundle / set_plugin / '
      + 'set_bundle 纳入外部动作门（只读 list_* 不确认），写插件代码前先 '
      + 'cordis_inspect_list → cordis_inspect_query 读准契约。',
    order: 3,
    profile: 'cordis',
  },
]

/** 合法的 profile 名（与 `workflow-core.mjs` 的 `PROFILES` 键同集合）。 */
export const PROFILES = ['standard', 'ptc', 'minimal', 'cordis']

/**
 * 每个模式在正文里"自述"的那一小段（`PROFILE-NOTE-BEGIN` … `PROFILE-NOTE-END` 之间）。
 *
 * 为什么需要：四份 patch 的正文是 `agent.cordis.yml` 的**逐字复制**，而源文件里那段
 * 注释自述"本 preset 显式挂 profile: standard（= 骨架 verbatim…）"。照抄的话，
 * ptc / minimal / cordis 三份都会自称 standard —— 注释说了假话。故源文件把这一段
 * 用显式标记围起来，由生成器按模式替换；标记本身**不进产物**（生成器整段重写）。
 * `standard` 那条逐字保留原文（它是 AC1 的既有措辞）。
 */
export const PROFILE_NOTES = {
  standard:
    '# 本模式挂 profile: standard（= 骨架 verbatim，与冻结基线逐字节一致——AC1 见\n'
    + '# tests/verify-workflow-profiles.mjs；基线于 #85 随文本政策变更重取，现 16 节）。',
  ptc:
    '# 本模式挂 profile: ptc（PTC 执行形态：工具面即程序面 run_code + 生成 SDK、one-shot\n'
    + '# 程序状态落文件、agent() 编排契约、门按效果判定；只增不改、不引用 shell-host——D41）。\n'
    + '# 七门节 verbatim，与 standard 同一份骨架文本。',
  minimal:
    '# 本模式挂 profile: minimal（七门节 verbatim、其余压缩到 ~1/3——token 预算紧张的长会话\n'
    + '# 仍不丢门；AC2 见 tests/verify-workflow-profiles-2.mjs）。',
  cordis:
    '# 本模式挂 profile: cordis（创作者 preset：plugin_manager 变更纳入外部动作门 +\n'
    + '# inspect-first 契约；#55 机制、#99 起档名 cordis——原 creative）。',
}

/** 源文件里那段自述的边界标记（生成器整段重写，标记不进产物）。 */
const NOTE_BEGIN = '# PROFILE-NOTE-BEGIN'
const NOTE_END = '# PROFILE-NOTE-END'

/**
 * `matt-cordis` 那一份**额外插入**的行（其余三份没有）——声明式，不是字符串拼接。
 *
 * 为什么需要（#99-D，复核阶段实测的真缺陷）：`workflow-profile-cordis.txt:21-22`
 * 的注入文本叫模型调 `cordis_inspect_list` / `cordis_inspect_query`，而 `cordis_inspect_*`
 * 的**工具**是 per-preset 声明的——matt 四份 roster 里原本没有任何一行提供它们。
 * 即**这个模式教模型用它自己调不到的工具**（D3 文档说谎那一类）。
 *
 * 上游第四档 `cordis` 有这一行（`web-app/presets/cordis.patch.yml:120-121`），且它的
 * `tool-plugin-manager` 是**条件启用**（`disabled: !!js "!ctx.get('profileContext')"`，
 * 同上 :131-133）而不是硬关——照抄该形态。
 *
 * `after` 是**锚行 id**：新行插在该行的块（到下一个顶层 `- id:` 之前）**之后**。
 * 上游 `tool-cordis` 紧接 `tool-web` 块，故锚为 `tool-web`。
 */
const CORDIS_EXTRA_ROWS = [
  { after: 'tool-web', lines: ["- id: tool-cordis", "  name: '@deepseek-ai/dsh-tool-cordis'"] },
]

/**
 * 每个模式对 roster 的**具名差异**（默认档与另外两档为空 = 逐字复制源文件）。
 *
 * 只支持本仓真正需要的两种变换——**刻意不做通用引擎**（D29：不为未出现的问题堆机制）：
 *   - `insertAfter`：插一行（上面 `CORDIS_EXTRA_ROWS` 的形状）；
 *   - `disabledFor`：把某个具名行的 `disabled:` 值换成条件表达式。
 */
export const ROSTER_MUTATIONS = {
  'dsh-matt-preset-cordis': {
    insertAfter: CORDIS_EXTRA_ROWS,
    // 上游同形：`plugin_manager` 在带 profileContext 的宿主上**可用**（不再硬关）。
    // 理由是这条模式的用途就是插件/preset 创作——把它硬关等于让该模式做不了本职。
    // `tool-plugin-market` 逐份跟 manager 同款（#117 Z2，折叠自 #97）：上游对 market
    // 从不单独设值（`cordis.patch.yml` 两行同为条件式、standard/ptc 同为字面 true），
    // 本仓若只换 manager 就重现「manager 活的、market 关着」的单边缺口。
    disabledFor: {
      'tool-plugin-manager': '!!js "!ctx.get(\'profileContext\')"',
      'tool-plugin-market': '!!js "!ctx.get(\'profileContext\')"',
    },
  },
}

/** 十格缩进 + 空行不留尾随空格（与既有 `cordis.patch.yml` 的字节形状一致）。 */
export function nest(text, indent = NEST) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.trimEnd() === '' ? '' : indent + line))
    .join('\n')
}

/** 从「id: x」这样的行里取 JSON 标量值，用于断言生成器读到的 profile 行。 */
export function profileLineValue(pluginsText) {
  const match = /^ {0,10}- id: workflow-core\n {0,12}name: dsh-matt-preset\/workflow-core\.mjs\n {0,12}config:\n {0,14}profile: (\S+)\s*$/m
    .exec(pluginsText)
  return match?.[1]
}

/** 顶层 `- id: <x>` 行的索引（块边界判据）。 */
const ROW_ID = /^- id: (\S+)\s*$/

/**
 * 应用某模式的 roster 差异（`ROSTER_MUTATIONS`）——**在缩进之前**，行级操作。
 *
 * 静默是这里最坏的失败模式：锚行改名、目标行被删、或行**已经**存在时若悄悄跳过，
 * 产物会是一份**看起来正常但语义不对**的 roster（D3）。故三种情形一律抛。
 */
function applyMutations(lines, preset, mutation) {
  if (mutation === undefined) return lines
  const findRow = (id) => {
    const at = lines.findIndex((line) => ROW_ID.exec(line)?.[1] === id)
    if (at < 0) throw new Error(`${preset.file}: roster mutation targets row "${id}", which agent.cordis.yml does not declare`)
    return at
  }
  // 块 = 该行到下一个顶层 `- id:` 之前（含中间的 config: 子块与空行）。
  const endOfBlock = (at) => {
    for (let i = at + 1; i < lines.length; i++) if (ROW_ID.test(lines[i])) return i
    return lines.length
  }

  let out = lines
  for (const insert of mutation.insertAfter ?? []) {
    const newId = ROW_ID.exec(insert.lines[0])?.[1]
    if (newId === undefined) throw new Error(`${preset.file}: inserted row does not start with "- id: …": ${insert.lines[0]}`)
    if (out.some((line) => ROW_ID.exec(line)?.[1] === newId)) {
      throw new Error(`${preset.file}: row "${newId}" would be inserted but agent.cordis.yml already declares it`)
    }
    const at = findRow(insert.after)
    // 插到锚行块**结束之后**、块间那个空行**之前**——上游 `tool-cordis` 紧贴 `tool-web`
    // 块（`presets/cordis.patch.yml:119-121`），故新行不留自己的空行；源文件既有的
    // 块间空行原样保留在下面。
    let end = endOfBlock(at)
    while (end > at && out[end - 1].trim() === '') end--
    out = [...out.slice(0, end), ...insert.lines, ...out.slice(end)]
  }

  for (const [id, value] of Object.entries(mutation.disabledFor ?? {})) {
    const at = findRow(id)
    const end = endOfBlock(at)
    const rel = out.slice(at, end).findIndex((line) => /^\s*disabled:/.test(line))
    if (rel < 0) throw new Error(`${preset.file}: roster mutation sets "disabled" on row "${id}", which declares none`)
    out = [...out.slice(0, at + rel), `  disabled: ${value}`, ...out.slice(at + rel + 1)]
  }
  return out
}

/**
 * 把 `agent.cordis.yml` 的正文改写成**该模式**的正文。
 *
 * 只做**行级**变换，不重排、不合并：`agent.cordis.yml` 仍是唯一手写源。
 *   1. `- id: workflow-core` 块里的 `profile: <name>` —— 四模式唯一的机制差异；
 *   2. `PROFILE-NOTE-BEGIN` … `PROFILE-NOTE-END` 之间那段自述 —— 照抄会让三个模式自称
 *      standard（注释说假话），故由 `PROFILE_NOTES` 按模式重写；
 *   3. 两个边界标记本身 —— 它们是生成器的**内部信号**，不进产物；
 *   4. `ROSTER_MUTATIONS`（仅 `matt-cordis`）—— 补 `tool-cordis` 行 + `tool-plugin-manager`
 *      条件启用，见那里的注释（#99-D 修 D3 类缺陷）。
 *
 * 标记缺失/倒置/重复、或差异锚点找不到，都是**打包 bug**，必须响亮。
 *
 * @param pluginsText `agent.cordis.yml` 全文（CRLF 容忍）。
 * @param preset `PRESETS` 里的一项。
 * @returns 该 preset 的 plugins 正文（未缩进）。
 */
export function pluginsFor(pluginsText, preset) {
  const lines = pluginsText.replace(/\r\n/g, '\n').split('\n')
  const begin = lines.indexOf(NOTE_BEGIN)
  const end = lines.indexOf(NOTE_END)
  if (begin < 0 || end < 0) {
    throw new Error(`agent.cordis.yml is missing ${NOTE_BEGIN} / ${NOTE_END} — the generator cannot compose ${preset.file}`)
  }
  if (end < begin) throw new Error(`agent.cordis.yml: ${NOTE_END} precedes ${NOTE_BEGIN}`)
  for (const [name, line] of [['NOTE_BEGIN', begin], ['NOTE_END', end]]) {
    if (lines.indexOf(line, line + 1) !== -1) throw new Error(`agent.cordis.yml: duplicate ${name} marker`)
  }
  let rewritten = [
    ...lines.slice(0, begin),
    ...PROFILE_NOTES[preset.profile].split('\n'),
    ...lines.slice(end + 1),
  ]
  rewritten = applyMutations(rewritten, preset, ROSTER_MUTATIONS[preset.id])

  const out = []
  let inWorkflowCore = false
  for (const line of rewritten) {
    const isRow = /^\s*- id: workflow-core\s*$/.test(line)
    if (isRow) {
      inWorkflowCore = true
      out.push(line)
      continue
    }
    if (inWorkflowCore) {
      const profile = /^(\s*)profile: \S+\s*$/.exec(line)
      if (profile !== null) {
        out.push(`${profile[1]}profile: ${preset.profile}`)
        inWorkflowCore = false
        continue
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * 合成 `cordis.patch.yml`（matt 默认模式的载体）。
 *
 * 它是数组的**第一项**，也是唯一带完整说明头的文件（四份 `presets/*.patch.yml` 用简短头）。
 * 声明 meta 沿用历史值（`name: Matt 工作流` / `order: 0`）——换载体不改语义：
 * `preset.yml` 的显示 meta（`Matt 工作流模式` / `order: 5`）属已退役的 `.agent-presets`
 * 目录读取器，从来不是 live 值（#6 记录在案，勿回抄）。
 */
/** 全部四条声明的身份（默认档在前）——去重断言的唯一读法。 */
export const ALL_PRESETS = [DEFAULT_PRESET, ...PRESETS]

export function composeBundlePatch(pluginsText) {
  const preset = DEFAULT_PRESET
  const header = `# dsh-matt-preset bundle patch (GENERATED — do not hand-edit).
# Source of truth: agent.cordis.yml (plugin entry list, verbatim below) +
# the declaration meta. Regenerate/check with: node tests/verify-bundle-sync.mjs
# Mount shape per ADR-0001 (workspace docs/adr/0001) and DSH composition-
# reference's legacy-preset migration recipe: profiles link: this repo and
# list "dsh-matt-preset" in dsh.profile.bundles; this patch inserts the
# preset declaration row.
#
# One bundle, four modes (ADR-0015): this file is the DEFAULT mode's carrier
# (array item 1). The other three ride presets/matt-{ptc,minimal,cordis}.patch.yml,
# all four composed from this same agent.cordis.yml by lib/bundle-patch.mjs and
# byte-locked by tests/verify-bundle-sync.mjs. The four preset IDs stay disjoint
# from the shipped standard/ptc/minimal/cordis presets, which are preserved.
#
# Declaration meta (id/name/order) intentionally preserves the values the
# pre-migration profile patch insert carried live (name "Matt 工作流",
# order 0) — 换载体不改语义; preset.yml's display meta (Matt 工作流模式 /
# order 5) belonged to the legacy .agent-presets reader nothing reads any
# more and was never the live value.
- insert:
    - id: ${preset.patchId}
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: ${preset.id}
        name: ${preset.name}
        description: ${preset.description}
        order: ${preset.order}
        plugins:
`
  return header + nest(pluginsFor(pluginsText, preset))
}

/**
 * 合成一份 `presets/*.patch.yml`（非默认模式）。
 *
 * 与 `cordis.patch.yml` 的结构**逐字同构**（同一缩进、同一行序），只是头更短、meta 换成本
 * 模式的四个字段；正文来自**同一个** `agent.cordis.yml`。这是"roster 不许手抄"的落点。
 */
export function composePresetPatch(pluginsText, preset) {
  const header = `# dsh-matt-preset mode patch — "${preset.name}" (GENERATED — do not hand-edit).
# Source of truth: agent.cordis.yml (shared roster, verbatim below) + this mode's
# declaration meta. Regenerate/check with: node tests/verify-bundle-sync.mjs
# Composed by lib/bundle-patch.mjs; one bundle declares every mode via
# package.json dsh.bundle.patch (ADR-0015). The DEFAULT mode rides
# cordis.patch.yml and is deliberately NOT repeated here — a second declaration
# of the same config.id makes the registry throw (Duplicate agent preset).
# id is deliberately disjoint from the shipped ${PROFILES.join('/')} presets.
- insert:
    - id: ${preset.patchId}
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: ${preset.id}
        name: ${preset.name}
        description: ${preset.description}
        order: ${preset.order}
        plugins:
`
  return header + nest(pluginsFor(pluginsText, preset))
}

/** 读 `agent.cordis.yml`（唯一手写正文源）。 */
export async function readAgentComposition(repo) {
  return readFile(join(repo, 'agent.cordis.yml'), 'utf8')
}

/**
 * 期望的**磁盘形状表**：路径 → 内容。`cordis.patch.yml`（默认档）在数组第一位，
 * 其后按 `PRESETS` 顺序三份模式文件——**共四份**。生成器写盘与锁定器断言都只用这一个函数。
 */
export async function expectedPatches(repo) {
  const pluginsText = await readAgentComposition(repo)
  const out = new Map([[DEFAULT_PRESET.file, composeBundlePatch(pluginsText)]])
  for (const preset of PRESETS) {
    out.set(preset.file, composePresetPatch(pluginsText, preset))
  }
  return out
}

/** `dsh.bundle.patch` 的期望数组（package.json 的唯一事实源）：默认档 + 三个非默认档。 */
export const BUNDLE_PATCH_ARRAY = [
  `./${DEFAULT_PRESET.file}`,
  ...PRESETS.map((p) => `./${p.file}`),
]