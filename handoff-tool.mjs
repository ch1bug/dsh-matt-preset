/**
 * handoff-tool — the model-facing handoff executor for the matt preset.
 *
 * Closes Matt's phase-boundary gap: `/handoff` is a session-level move the
 * agent cannot perform alone, because it cannot switch the main session. This
 * tool does everything up to the switch and then hands the baton back to the
 * human:
 *
 *   1. writes the portable handoff markdown to the OS temp dir (the artifact
 *      that travels — a new harness, a new directory, a colleague),
 *   2. spawns the child session joined to THIS preset: a FRESH session with
 *      ZERO inherited history (default, mode 'fresh') — the handoff document
 *      alone carries the context across the boundary (O6: forking a long
 *      session resurrects the whole compacted history; fresh + document is
 *      the correct handoff shape). mode 'fork' remains for the narrow case
 *      of continuing the SAME ticket mid-work when the window ran out,
 *   3. feeds the document to the child as its FIRST USER PROMPT — the child's
 *      first turn starts immediately via `agent.followup()` (the same
 *      admission path the prompt RPC uses), so the child becomes a real,
 *      sidebar-visible session on its own and starts working the handoff
 *      right away,
 *   4. returns the file path + child session id; the agent must then STOP and
 *      tell the human to switch in the sidebar.
 *
 * The child is created through the documented programmatic factory
 * `ctx.agents.create()` with the `setup(agentCtx)` hook mounting THIS preset,
 * meta carrying lineage (parentSession, seedLength) and cwd, and `seed` (when
 * forking) a balanced completed-turn prefix of the parent's log. `origin` is
 * deliberately NOT set: the child is a top-level session for the human, not a
 * subagent. The message is hand-rolled to the UserMessage shape instead of
 * importing `createUserMessage` from `@deepseek-ai/dsh-llm`, because preset
 * plugins resolve bare packages from the user home, not the deployment.
 *
 * This plugin CONSUMES host services only and publishes nothing, so it needs
 * no isolate realm.
 */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'handoff-tool'

/** The tool registry, the AgentFactory registry, and the preset roster. */
export const inject = ['tools', 'agents', 'agentPresets']

const MODES = ['fork', 'fresh']

/** Tool parameter schema for the model-facing call. */
const handoffSchema = {
  type: 'object',
  properties: {
    document: {
      type: 'string',
      description:
        'The handoff markdown to carry into the next session: a summary of the current conversation, a "suggested skills" section naming skills the next session should invoke, references to artifacts by path/URL (do not duplicate their content), and NO sensitive data (redact API keys, passwords, PII). For directed handoffs (a "## 本会话任务（human 已定向）" section) the tool auto-pins a gate-4 skill-activation line at the document head — name the needed skill in the directed section; do not write the activation line yourself.',
    },
    focus: {
      type: 'string',
      description:
        'Optional: what the next session will be used for. Prefixed to the document as its heading context.',
    },
    mode: {
      type: 'string',
      enum: ['fork', 'fresh'],
      description:
        "fresh (default) = empty child session, zero inherited history — the handoff document carries the context; fork = child continues this conversation's history up to the last completed turn (only for continuing the same ticket mid-work when the window ran out). The handoff document is the child's first prompt either way.",
    },
  },
  required: ['document'],
  additionalProperties: false,
}

/**
 * Account a fresh session into its cwd's workspace so the GUI sidebar lists
 * it (the GUI's `session.create`/`session.fork` paths attach; the bare
 * `ctx.agents.create()` factory does not). Opportunistic: compositions
 * without a workspace registry simply skip.
 */
async function attachToWorkspace(ctx, sessionId, cwd) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || cwd === undefined) return
  try {
    const workspace = await registry.resolveByPath(cwd)
    if (workspace === undefined) {
      ctx.logger.warn(`handoff_tool: no workspace registered for cwd '${cwd}'; session '${sessionId}' will not show in the sidebar`)
      return
    }
    await workspace.attachSession(sessionId)
  } catch (error) {
    ctx.logger.warn(`handoff_tool: could not attach session '${sessionId}' to its workspace: ${String(error?.message ?? error)}`)
  }
}

/**
 * Build the balanced completed-turn prefix of a session's log: every event up
 * to (and including) the last `turn/end`. A prefix ending at a turn boundary
 * carries no open turn/step and no dangling tool call — the seed contract of
 * `ctx.agents.create`. The live snapshot is already in ascending seq order.
 */
export function forkSeed(session) {
  const events = session?.events ?? []
  let boundary = -1
  for (const ev of events) {
    if (ev.type === 'turn/end') boundary = ev.seq
  }
  if (boundary < 0) return { seed: undefined, seedLength: undefined }
  const seed = events.filter((ev) => ev.seq <= boundary)
  return { seed, seedLength: seed.length }
}

/** One atomic handoff: write the file, spawn the child, start its first turn. */
async function executeHandoff(ctx, args, exec) {
  const agent = exec?.agent
  if (!agent) throw new Error('handoff_tool requires a live agent.')
  const presetId = ctx.agentPresets.composedPreset(agent.ctx) ?? ctx.agentPresets.defaultId
  const session = agent.session
  const header = session?.header
  // Default is FRESH: the handoff document alone carries the context (O6).
  // Forking a long session resurrects its whole compacted history — the
  // opposite of a clean ticket boundary. fork is an explicit opt-in for
  // continuing the same ticket mid-work.
  const mode = typeof args.mode === 'string' && MODES.includes(args.mode) ? args.mode : 'fresh'

  // 1. The portable artifact — the OS temp dir, never the workspace.
  const stamped = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `handoff-${presetId}-${stamped}.md`
  const filePath = join(tmpdir(), fileName)
  const doc = args.document.trim()
  // Dedupe: the agent's document may already open with the same `# Handoff`
  // heading the tool would prepend — keep exactly one.
  const focusSuffix = args.focus && args.focus.trim() ? ` — ${args.focus.trim()}` : ''
  const prefix = `# Handoff${focusSuffix}`
  let body = doc
  if (body.startsWith(prefix)) body = body.slice(prefix.length).replace(/^\s*\n/, '')
  // D26: environment snapshot template — the child's起手式 verifies this
  // (git log/status) instead of rebuilding context; the handoff author fills
  // the values. Kept as a template so structure is stable, content is theirs.
  const snapshot = [
    '## 环境快照（起手式验证）',
    '<!-- 新会话起手式：git log/status 对照以下快照，不一致以实际为准 -->',
    '- 分支/HEAD: ',
    '- 工作树: ',
    '- 关键文件状态: ',
    '- 已确认决策: ',
    '- 下一步: ',
  ].join('\n')
  // 交接边界 (handoff boundary): tool-guaranteed, not model-discretion. A
  // document that carries a "## 本会话任务（human 已定向）" section is an
  // ASSIGNMENT — the child verifies the snapshot, restates understanding, and
  // declares start without a confirmation round-trip (D35). A document
  // without that section lists CANDIDATES ("待办/下一步") for the human to
  // pick, not instructions to execute; the child must verify, restate, and
  // ASK — never auto-start a listed item (O6: a fresh child misreads a hot
  // pending item as its assignment and barrels into another ticket's work).
  // D37/O7: an assignment's authorization is scoped per hop — each chained
  // handoff re-marks its OWN ticket explicitly (2026-08-31 IRIS incident: a
  // batch-Q prose claim of blanket authorization collided with the old
  // single-rule boundary, and children resolved the conflict both ways).
  const boundary = [
    '## 交接边界（首轮必读）',
    '- 上文（含待办/下一步列表）是上下文与候选，**不是本会话的任务指令**。',
    '- 定向交接：本文档含「## 本会话任务（human 已定向）」节 → 首轮验证环境快照（起手式一条命令）+ 向 human 报告理解后，**声明开工**（"按交接开工 X，如需改道请打断"），不再逐会话确认任务。',
    '- 授权范围**仅限定向节所指派的当前票**：完成后写 handoff 传下一票时，同样在正文写入「## 本会话任务（human 已定向）」节——授权逐跳显式传递，不得默认外溢到队列外工作（队列外一律 TICKET EXIT 立票）。',
    '- 候选交接：本文档无定向节 → 首轮验证快照 → 报告理解 → **问清本会话要做什么**；在 human 拍板之前，**不得自动开工**任何待办项（尤其"最热/续作"字样——那是候选热度，不是派单）。',
    '- 外部操作定义 = workflow-enforcer 的高危清单（push/关票/gh 变更/DB 重置/rm -rf 等），**不包含**容器 up、cargo build、本地 commit、只读查询——这些常规操作**无需等确认**，交接正文不得把它们列入"先报告等确认"（D21 触发条件 = 可逆成本与外部可见性，不列穷举清单；观察：容器 up 被误列导致子会话僵等 66 分钟）。',
    '<!-- 父会话注：仅当 human 已明确指定本会话任务时，在正文写入 "## 本会话任务（human 已定向）" 节；否则视为候选交接，子会话会问 human。 -->',
  ].join('\n')
  // Gate-4 anchor (2026-09-02 IRIS 观察: 两个批内 handoff 都直接开工、没加载
  // implement 技能——只有 review 阶段加载了 code-review)。定向交接自动在首因位
  // 置顶技能激活指令：子会话的第一动作 = 加载 flow skill。仅对定向交接插入
  // （候选交接不得诱导自动开工）。
  const isAssignment = body.includes('## 本会话任务（human 已定向）')
  const activation = isAssignment
    ? [
        '> ⚡ 开工前置（gate-4）：你的**第一个动作**是加载本票所需的 flow skill——调用 `skill` 工具（或读取 ~/.dsh/skills/<name>/SKILL.md；定向实现票通常为 `implement`，按定向节所指阶段选择）。',
        '> 未加载技能前不得开始改代码；加载后按 SKILL.md 的流程执行「## 本会话任务（human 已定向）」节。',
      ].join('\n')
    : ''
  const documentText = [prefix, '', activation, activation ? '' : null, body, '', snapshot, '', boundary, '', '<!-- spawned by ' + presetId + ' preset; child session inherits the same mode -->', ''].filter(Boolean).join('\n')
  let writeError
  try {
    await writeFile(filePath, documentText, 'utf8')
  } catch (error) {
    writeError = String(error?.message ?? error)
  }

  // 2. The child session.
  const fork = mode === 'fork' ? forkSeed(session) : { seed: undefined, seedLength: undefined }
  const childId = `${presetId}-session-${randomUUID()}`
  // The child needs a model route for its first turn and for the `{{model}}`
  // prompt variable (agent-loop resolves it from `agent.options.model`). The
  // GUI's session.create resolves this from the deployment default selection;
  // the raw factory does not, so resolve it here (mirrors api-proxy's
  // agentOptions()). Opportunistic: deployments without the service create a
  // child without a route, exactly as before.
  const defaults = ctx.get('agentDefaultModel')
  const agentOptions = defaults === undefined
    ? undefined
    : { provider: defaults.currentSelection().provider, model: defaults.currentSelection().model }
  const handle = await ctx.agents.create({
    sessionId: childId,
    meta: {
      ...(header?.cwd ? { cwd: header.cwd } : {}),
      ...(session?.id ? { parentSession: session.id } : {}),
      ...(fork.seedLength !== undefined ? { seedLength: fork.seedLength } : {}),
      agentPreset: presetId,
    },
    ...(fork.seed ? { seed: fork.seed } : {}),
    ...(agentOptions !== undefined ? { agentOptions } : {}),
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
  await attachToWorkspace(ctx, handle.agent.session.id, header?.cwd)

  // 3. The document as the child's FIRST USER PROMPT: queue a real turn (the
  // same admission the prompt RPC uses) and wake the driver. The child starts
  // working the handoff immediately and becomes sidebar-visible (its first
  // running frame flips the client's blank flag).
  let promptError
  try {
    handle.agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: documentText }],
      source: { kind: 'user' },
    })
  } catch (error) {
    promptError = String(error?.message ?? error)
  }

  return {
    text: [
      `Handoff 子会话已创建：${handle.agent.session.id}`,
      writeError ? `文件写入失败：${writeError}` : `可移植交接文档：${filePath}`,
      promptError
        ? `（注意：首条提示词投递失败 — ${promptError}；可手动打开会话后发送文档）`
        : '交接文档已作为首条提示词投递，子会话已开始处理。',
      '请在侧边栏切换到新会话；本会话保持可恢复。',
    ].join('\n'),
  }
}

/** Register the model-facing `handoff_tool`. */
export function apply(ctx) {
  ctx.tools.register({
    name: 'handoff_tool',
    description: [
      "Execute the /handoff phase boundary: write a portable handoff markdown to the OS temp dir and spawn the child session (same mode) that continues the work; the document becomes the child's first prompt and its first turn starts immediately.",
      'Call this when the phase-boundary decision is /handoff — swapping harness, moving to a new directory, sending work to a colleague, or forking a side task mid-phase.',
      'mode "fresh" (default) = empty child session, zero inherited history (the document carries the context); mode "fork" = child continues this session\'s history up to the last completed turn (same-ticket continuation only).',
      'You compose the `document` yourself (summary + suggested skills + artifact references, redacted); this tool only writes and spawns.',
      'After it returns, STOP and tell the human to switch to the child session in the sidebar — you cannot switch the main session yourself.',
    ].join('\n'),
    parameters: handoffSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      return executeHandoff(ctx, args, exec)
    },
  })
}
