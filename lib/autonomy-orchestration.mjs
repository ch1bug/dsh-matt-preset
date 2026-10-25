/**
 * autonomy-orchestration.mjs — 自主化 L2 编排件（#163；正典单点定义）。
 *
 * 为什么存在：#50 评测实测两次断链（A 组 run3 首跑 / B 组 chain1 首跑）——会话在等
 * 并行 code-review 子代理时结束 turn 干等，无人值守编排只看到 `turn/end` 就判完成，
 * 交付未产出即断链。runner 补「turn/end 后 6 分钟宽限 + 交付就绪判据未满足则 1 次
 * nudge」后全部恢复（三链最终 nudge 计数 0/0/0）。#160 拍板（2026-10-25）：开 L2、
 * 唤醒首版 = **编排器轮询 subagentCatalog**；本模块把这套唤醒/判据/计量逻辑从评测
 * 脚本（evals/autonomy/runner.mjs 内嵌副本）沉淀为可复用编排件——runner 改为消费
 * 本模块，不再内嵌副本（155族 retro 候选 2 的「第二张脸」口径）。
 *
 * 机制（票面①，判据口径照 #50）：
 *   - 轮询判据用 `session/page` 事件流的 `turn/end`-after-`turn/start` 序，**不是**
 *     `projections.running`（实测形状不稳：turn 进行中就被判 false 截早——#50 runner
 *     缺陷 ①，retro 候选 2）；
 *   - turn/end 后**轮询 subagentCatalog**（票面拍板形态）：catalog 有 `continuable`
 *     项且 `subagentTiming.settledMs === 0` → 子代理在飞 → **不判闲置**（turn 不再
 *     提前死亡——run2 实测形态：两个评审子代理 continuable、settledMs=0、turn 已 end）；
 *     总超时（TURN_TIMEOUT_MS）仍兜底；
 *   - 子代理不在飞 + turn/end 闲置超过宽限（#50 实测 6 分钟）→ 交付就绪判据未满足
 *     则发 **1 次** nudge（MAX_NUDGE=1：编排者代行 human 的「戳一下」，之后仍不收
 *     交付就如实停，不无限戳）；
 *   - 判据只覆盖 #50 的三形态（A 组 / relayHop1 / relayHop2）——nudge 不是任意口径
 *     的「交付未齐」（收尾问询等应答走应答通道，不触发 nudge，#50 chain3 实测）。
 *
 * 计量（票面②，#50 retro 候选 4 口径——编排者代行动作是一等公民读数，不是被消除
 * 的噪音）：nudge / 代答（humanRelays）/ 子代理 hold（subagentHolds）全部显式计数、
 * 随结论携带（runWakeLoop 返回值）——「全自动」的读数不得把编排兜底藏进实现细节。
 *
 * 应答通道（票面②，#50 chain3 实测断点）：会话 `ask_user_question` 挂起（事件流末尾
 * 的 ask 调用之后无新 turn/start）→ runWakeLoop 调 `onAwaitingHuman(question)` 转达；
 * 回传应答文本 → 作为 prompt 注入（代答，计量）；回传 null → 停在 awaiting-human
 * （问题全文随结论携带）——交付全自动，push/关票等 D21 外部动作的收尾确认由编排
 * 转达 human，编排不再让问询被总超时静默截断。
 *
 * 消费方：evals/autonomy/runner.mjs（评测面，#50 runner 形态）、批内 auto-handoff
 * 编排器、tests/verify-autonomy-orchestration.mjs（守卫）。唤醒/判据/计量的口径
 * 改动以本模块为正典，消费方不得另写副本。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 唤醒策略常量（#50 实测口径；测试与消费方注入小值加速，不改默认）。 */
export const WAKE_POLICY = {
  /** 轮询间隔（#50 runner 形态）。 */
  POLL_MS: 5_000,
  /** 单会话总超时：子代理在飞 hold 的兜底（#50 runner 形态 45 分钟）。 */
  TURN_TIMEOUT_MS: 45 * 60_000,
  /** turn/end 后闲置宽限：等「子代理落定 → 运行时自动续跑」（#50 实测 6 分钟）。 */
  TURN_END_GRACE_MS: 6 * 60_000,
  /** nudge 上限：之后仍不收交付就如实停（#50 runner 形态）。 */
  MAX_NUDGE: 1,
  /** nudge 文本（编排者代行 human 的「戳一下」；语气面向「收尾没做完的会话」）。 */
  NUDGE_TEXT:
    "你上一轮结束时还有未完成的收尾工作（评审子代理已落定，没有新 turn 被唤醒）。请继续你的任务，直到全部交付完成——该提交的提交、该落盘的交付产物逐个落盘之后，再给出最终完成回复。不要向 tracker 做任何写操作。",
};

// ── 轮询判据（纯函数；输入 = RPC 面的真实形状）────────────────────────────────

/**
 * turn 状态：page 事件流里最后一次 `turn/end` 是否晚于最后一次 `turn/start`。
 * 返回 "running"（turn 在跑 / 新 turn 已开 / 事件流为空）或 "turn-ended"。
 * 别退回 `projections.running` 判据（#50 runner 缺陷 ①：形状不稳，turn 进行中
 * 就被判 false 截早——retro 候选 2 的「实时证据别拿 X」第三条）。
 */
export function turnState(page) {
  const records = (page?.records ?? []).map((r) => r.event ?? r);
  let lastStart = -1;
  let lastEnd = -1;
  for (const e of records) {
    if (e?.type === "turn/start") lastStart = Math.max(lastStart, e.seq ?? -1);
    else if (e?.type === "turn/end") lastEnd = Math.max(lastEnd, e.seq ?? -1);
  }
  return lastEnd > lastStart && lastEnd >= 0 ? "turn-ended" : "running";
}

/**
 * 子代理在飞判据（票面①「轮询 subagentCatalog」，#50 run2 实测形态：catalog 两项
 * `continuable` + `subagentTiming.settledMs === 0` + turn 已 end——会话在等评审
 * 子代理）。`subagentTiming` 缺席时按在飞读（宁可多等到总超时，不提前死亡——两次
 * 实测断链都是提前死更贵）。
 */
export function subagentsInFlight(projectionValues) {
  const catalog = projectionValues?.subagentCatalog ?? [];
  const settledMs = projectionValues?.subagentTiming?.settledMs ?? 0;
  return catalog.length > 0 && settledMs === 0 && catalog.some((e) => e?.mode === "continuable");
}

/**
 * 挂起的 human 问询（应答通道检测面，#50 chain3 实测形态：`tool/call`
 * `ask_user_question` 是事件流最后一条实质事件，其后无新 `turn/start`——turn 挂在
 * 等输入上，连 `turn/end` 都不来）。历史已应答的 ask（其后有更大 seq 的
 * `turn/start`）不误报。返回 `{ text, seq }` 或 null。
 */
export function pendingHumanQuestion(page) {
  const records = (page?.records ?? []).map((r) => r.event ?? r);
  let askSeq = -1;
  let askArgs = null;
  for (const e of records) {
    if (e?.type === "tool/call" && e?.data?.name === "ask_user_question") {
      askSeq = e.seq ?? -1;
      askArgs = e.data.arguments;
    }
  }
  if (askSeq < 0) return null;
  for (const e of records) {
    if (e?.type === "turn/start" && (e.seq ?? -1) > askSeq) return null; // 已被应答续跑
  }
  return { text: renderQuestionText(askArgs), seq: askSeq };
}

/** ask_user_question 的 arguments（JSON 字符串或对象）→ 可转达的问题文本。 */
function renderQuestionText(args) {
  let parsed = args;
  if (typeof args === "string") {
    try { parsed = JSON.parse(args); } catch { parsed = null; }
  }
  const questions = parsed?.questions ?? (Array.isArray(parsed) ? parsed : []);
  const texts = questions.map((q) => (typeof q?.question === "string" ? q.question : "")).filter(Boolean);
  if (texts.length > 0) return texts.join(" / ");
  return typeof args === "string" ? args : JSON.stringify(args ?? {});
}

// ── 交付就绪判据（#50 口径三形态；nudge 只覆盖这些面）────────────────────────

/** `git rev-list --count <seed>..HEAD` 非 0 → 有新提交。 */
export function commitsSince(cwd, seed) {
  const r = spawnSync("git", ["rev-list", "--count", `${seed}..HEAD`], { cwd, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() !== "0";
}

/**
 * 交付就绪判据（票面①「判据口径照 #50」；#50 复审【判断项】口径：只查提交偏宽）：
 * - `aGroup`：A 组 = 提交 + evidence/green.txt + .eval/{delivery-comment,decision-gate}.md
 * - `relayHop1`：接力 hop1 = 交接文档在盘（docPath 由调用方传，评测沙箱 = .eval/handoff-A.md）
 * - `relayHop2`：接力 hop2 = 有新提交
 */
export const DELIVERABLE_CRITERIA = {
  aGroup: (cwd, seed) =>
    commitsSince(cwd, seed) &&
    existsSync(join(cwd, "evidence", "green.txt")) &&
    existsSync(join(cwd, ".eval", "delivery-comment.md")) &&
    existsSync(join(cwd, ".eval", "decision-gate.md")),
  relayHop1: (cwd, docPath) => existsSync(docPath),
  relayHop2: (cwd, seed) => commitsSince(cwd, seed),
};

// ── 唤醒循环（编排核心；依赖注入式——poll/sendPrompt 由消费方接 RPC 面）──────

/**
 * 唤醒循环（票面①+②）。调用方先发完初始任务 prompt 再进本循环；本循环负责：
 * 等 turn / 子代理在飞 hold（不判闲置）/ 宽限 / 1 次 nudge / ask 问询转达与代答。
 *
 * @param {object} opts
 * - `poll: async () => ({ page, projections })`——每 tick 取事件流 + 投影
 *   （projections 为 RPC 返回对象，本模块读 `projections.values`）。
 * - `sendPrompt: async (text) => void`——发 prompt（nudge / 代答应答）。
 * - `deliverableReady: () => boolean`——交付就绪判据（见 DELIVERABLE_CRITERIA）。
 * - `onAwaitingHuman: async (question) => string | null`——应答通道：转达挂起的
 *   问询；返回应答文本（代答，计量 humanRelays）或 null（无法应答 → 停在
 *   awaiting-human，问题全文随结论携带）。缺省 = 恒 null（无人值守编排的最小形态）。
 * - `log: (msg) => void`——进度日志（缺省 noop）。
 * - `policy`——覆盖 WAKE_POLICY（测试注入小值加速）。
 * @returns 爲 `{ status, nudges, humanRelays, subagentHolds, ticks, lastQuestion }`：
 * status ∈ delivered（交付就绪收场）/ idle-after-nudge（nudge 用尽仍闲置，如实停）/
 * timeout（总超时兜底）/ awaiting-human（问询挂起且无应答，转达后停）。
 */
export async function runWakeLoop({
  poll,
  sendPrompt,
  deliverableReady,
  onAwaitingHuman,
  log = () => {},
  policy = WAKE_POLICY,
}) {
  const meter = { nudges: 0, humanRelays: 0, subagentHolds: 0, ticks: 0 };
  let lastQuestion = null;
  const finish = (status) => ({ status, ...meter, lastQuestion });
  const deadline = Date.now() + policy.TURN_TIMEOUT_MS;
  let idleSince = 0;
  let relayedSeq = -1; // 已代答过的挂起问询 seq：应答注入后、新 turn/start 出现前，同一挂起不得重复转达（防注入风暴——prompt 已 queue 但 turn 未起的窗口期，事件流末尾仍是旧 ask）
  for (;;) {
    await new Promise((r) => setTimeout(r, policy.POLL_MS));
    meter.ticks += 1;
    if (Date.now() > deadline) return finish("timeout");
    const snapshot = await poll();
    const page = snapshot?.page ?? null;
    const projectionValues = snapshot?.projections?.values ?? {};

    // 应答通道优先于 turn 状态：ask 挂起时 turn 可能连 end 都没有（chain3 实测）。
    const question = pendingHumanQuestion(page);
    if (question !== null) {
      lastQuestion = question;
      if (question.seq === relayedSeq) continue; // 本次挂起已代答，等新 turn/start 生效
      const answer = onAwaitingHuman === undefined ? null : await onAwaitingHuman(question);
      if (answer == null || answer === "") return finish("awaiting-human");
      await sendPrompt(answer);
      meter.humanRelays += 1;
      relayedSeq = question.seq;
      idleSince = 0; // 代答注入后重新等 turn 起来
      continue;
    }

    if (turnState(page) === "running") {
      idleSince = 0; // turn 在跑（或新 turn 已开）
      continue;
    }
    // turn 已 end：先看子代理（票面①——轮询 subagentCatalog，turn 不提前死亡）
    if (subagentsInFlight(projectionValues)) {
      meter.subagentHolds += 1;
      if (deliverableReady()) {
        // 交付已齐 + 子代理在飞（run163 实测形态：交付先落盘、评审子代理 continuable
        // 不落定）：给自动续跑留一个宽限窗口（评审聚合可能还有收尾 turn），超宽限即
        // delivered 收场——hold 是兜「交付未齐的提前死亡」，不是无限白等（真跑实测
        // 不加此分支会把已齐的交付拖到 45 分钟总超时，收场读数从 delivered 劣化为
        // timeout）。
        if (idleSince === 0) { idleSince = Date.now(); continue; }
        if (Date.now() - idleSince > policy.TURN_END_GRACE_MS) return finish("delivered");
        continue;
      }
      idleSince = 0; // 交付未齐：等「落定 → 运行时自动续跑」，不进 nudge 计时（nudge 的
      // 设计场景是「子代理已落定但没有新 turn」，NUDGE_TEXT 同口径——在飞期间不戳）
      continue;
    }
    if (idleSince === 0) {
      idleSince = Date.now(); // 闲置首次记时刻
      continue;
    }
    if (Date.now() - idleSince <= policy.TURN_END_GRACE_MS) continue; // 宽限内
    // 闲置超宽限：交付就绪 → 收场；未就绪 → 1 次 nudge；用尽 → 如实停
    if (deliverableReady()) return finish("delivered");
    if (meter.nudges >= policy.MAX_NUDGE) return finish("idle-after-nudge");
    meter.nudges += 1;
    log(`交付未齐且闲置超宽限 → nudge #${meter.nudges}`);
    await sendPrompt(policy.NUDGE_TEXT);
    idleSince = 0;
  }
}

// ── 失真复核与批末审计读数（票面③）────────────────────────────────────────────

/**
 * 交接文档产物清单机械复核（#50 runner `checkManifest` 沉淀；失真率 ground
 * truth——A 侧失真 = claimed vs actual sha256）。纯函数：落盘由消费方负责。
 * 行形态：`` `<相对路径> sha256:<64位十六进制>` ``（反引号装饰可剥——#50 runner
 * 缺陷 ②：不剥反引号会把 3 条清单判成 0 条）；`<!-- … -->` 注释行不算清单。
 */
export function verifyManifest(handoffPath, rootDir) {
  const doc = readFileSync(handoffPath, "utf8");
  const lines = doc.split("\n").filter((l) => /sha256:[0-9a-f]{64}/.test(l) && !l.trim().startsWith("<!--"));
  const entries = [];
  for (const line of lines) {
    const m = line.match(/`?([^\s`*]+)`?\s+sha256:([0-9a-f]{64})/);
    if (!m) continue;
    const [, rel, claimed] = m;
    let actual = null;
    try {
      actual = createHash("sha256").update(readFileSync(join(rootDir, rel))).digest("hex");
    } catch { /* 文件缺失 → actual 保持 null（≠ claimed，判失真） */ }
    entries.push({ path: rel, claimed, actual, match: actual === claimed });
  }
  return {
    entries: entries.length,
    mismatches: entries.filter((e) => !e.match).length,
    detail: entries,
  };
}

/**
 * 批末异步审计读数行（票面③；格式唯一事实源——正文 `workflow-body.txt`
 * AUTONOMY DIGEST 条与 `docs/batch-state.md` 引用本函数的输出形态，不另抄字面）。
 * 与 #49 的越界率行是**不同读数**、互不替代（#135 L3 承接的是 ⚠ 段，不是本行）。
 *
 * @param hops 逐跳读数：`{ hop, manifestEntries, mismatches, nudges, humanRelays }[]`
 * @returns digest 行（无跳的批返回 null——没有 auto-handoff 跳就不记空行）。
 * 形态：`失真 <Σmismatch>/<Σentries> · <N> 跳 · nudge <Σnudge> · 代答 <Σrelay>`
 */
export function renderAuditReading(hops) {
  if (!Array.isArray(hops) || hops.length === 0) return null;
  const sum = (k) => hops.reduce((a, h) => a + (Number(h?.[k]) || 0), 0);
  return `失真 ${sum("mismatches")}/${sum("manifestEntries")} · ${hops.length} 跳 · nudge ${sum("nudges")} · 代答 ${sum("humanRelays")}`;
}
