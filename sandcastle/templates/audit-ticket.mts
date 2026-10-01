/**
 * audit-ticket.mts — 票据审计（yolo 发射前的输入质量门，机械预检）。
 *
 * 用法：
 *   npx tsx .sandcastle/audit-ticket.mts --issue 449
 *   npx tsx .sandcastle/audit-ticket.mts --issue 449 --forbid "migrations/,money_path,governance"
 *   npx tsx .sandcastle/audit-ticket.mts --touch-overlap
 *
 * 输出：.sandcastle/audits/<issue>.json（审计记录，票据出口证据的一部分）
 *       --touch-overlap 模式额外写 .sandcastle/audits/touch-overlap.json（串行分组建议，
 *       供 night-run.mts 消费：有 serial:true 分组则按组串行，否则默认波次分组）
 * 退出码：0 = launch（可发射）/ 扫描成功（overlap 模式）
 *         2 = demote（降级白天 batch 车道）
 *         1 = 硬失败/信息不足需回炉
 *
 * 边界：这里只做机械检查；规格是否真的成立由编排会话（主会话）判断——
 * 机械检查通过 ≠ 票据合格，审计记录里必须留编排者的判词。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { arg } from "./lib.ts";

const AUDIT_DIR = join(".sandcastle", "audits");
const OVERLAP_REPORT = join(AUDIT_DIR, "touch-overlap.json");

/** touch-set 字符串 → 路径/前缀列表（逗号/顿号/分号/空白分隔） */
function parseTouchSet(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，、;；\n]+/)
    .map(s => s.trim().replace(/^[-*•\s]+/, ""))
    .filter(Boolean)
    .map(normalizePath);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").trim();
}

/** 两个 touch-set 条目是否写域相交：精确相等，或一方是另一方的前缀（目录声明） */
function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function setsOverlap(a: string[], b: string[]): string[] {
  return a.filter(x => b.some(y => pathsOverlap(x, y)));
}

if (process.argv.includes("--touch-overlap")) {
  // ── 跨票 touch-set 重叠扫描 ────────────────────────────────────────────
  // 读取全部审计记录的 touchSet 声明；写域有交集的票必须串行执行或合并。
  // 信息不足（目录不存在/记录缺 touchSet/JSON 损坏）→ exit 1 硬失败。
  if (!existsSync(AUDIT_DIR)) {
    console.error(`✗ ${AUDIT_DIR} 不存在——先对每张票跑 audit-ticket --issue 再扫描`);
    process.exit(1);
  }
  const files = readdirSync(AUDIT_DIR).filter(f => f.endsWith(".json") && f !== "touch-overlap.json");
  if (files.length === 0) {
    console.error(`✗ ${AUDIT_DIR} 下没有审计记录——信息不足`);
    process.exit(1);
  }
  const insufficient: string[] = [];
  const tickets: { issue: number; touchSet: string[] }[] = [];
  for (const f of files) {
    let rec: { issue?: number; touchSet?: string[] };
    try {
      rec = JSON.parse(readFileSync(join(AUDIT_DIR, f), "utf8"));
    } catch {
      insufficient.push(`${f}（JSON 损坏）`);
      continue;
    }
    const ts = (rec.touchSet ?? []).map(normalizePath).filter(Boolean);
    if (typeof rec.issue !== "number" || ts.length === 0) {
      insufficient.push(`${f}（缺 issue 或 touchSet）`);
      continue;
    }
    tickets.push({ issue: rec.issue, touchSet: ts });
  }
  if (insufficient.length) {
    for (const f of insufficient) console.error(`✗ 信息不足: ${f}`);
    console.error("→ 回炉：对缺 touchSet 的票重跑 audit-ticket --issue（正文需声明文件集）");
    process.exit(1);
  }

  // union-find 分组：有交集的票进同一组
  const parent = tickets.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => { parent[find(i)] = find(j); };
  const pairs: { i: number; j: number; shared: string[] }[] = [];
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const shared = setsOverlap(tickets[i].touchSet, tickets[j].touchSet);
      if (shared.length) {
        union(i, j);
        pairs.push({ i, j, shared });
      }
    }
  }
  const overlapFilesByRoot = new Map<number, Set<string>>();
  for (const { i, shared } of pairs) {
    const root = find(i);
    if (!overlapFilesByRoot.has(root)) overlapFilesByRoot.set(root, new Set());
    shared.forEach(f => overlapFilesByRoot.get(root)!.add(f));
  }
  const groupsByRoot = new Map<number, number[]>();
  tickets.forEach((_, i) => {
    const r = find(i);
    if (!groupsByRoot.has(r)) groupsByRoot.set(r, []);
    groupsByRoot.get(r)!.push(i);
  });
  const serialGroups = [...groupsByRoot.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => ({
      serial: true as const,
      tickets: members.map(i => tickets[i].issue),
      overlapFiles: [...(overlapFilesByRoot.get(root) ?? [])].sort(),
    }));
  const report = {
    serial: serialGroups.length > 0,
    generatedAt: new Date().toISOString(),
    groups: serialGroups,
    singletons: [...groupsByRoot.values()].filter(m => m.length === 1).map(m => tickets[m[0]].issue),
  };
  writeFileSync(OVERLAP_REPORT, JSON.stringify(report, null, 2), "utf8");

  if (serialGroups.length) {
    console.log(`⚠ 跨票写域重叠（必须串行执行或合并）：`);
    for (const g of serialGroups)
      console.log(`  serial: 票 [${g.tickets.join(", ")}] 重叠于 [${g.overlapFiles.join(", ")}]`);
  } else {
    console.log("✓ 无跨票写域重叠——全部票可并行（波次分组不受 touch-set 约束）");
  }
  console.log(`\n→  ${OVERLAP_REPORT}（night-run.mts 消费：serial 组内串行，其余默认波次）`);
  process.exit(0);
}

// ── 单票审计（原流程） ─────────────────────────────────────────────────
const issue = arg("issue");
if (!issue) throw new Error("提供 --issue N（或 --touch-overlap 做跨票扫描）");
const forbidden =
  (arg("forbid") ?? "migrations/,money_path,balance,governance,auth/").split(",").map(s => s.trim()).filter(Boolean);
const MIN_BODY = 200;

const gh = spawnSync(
  "gh",
  ["issue", "view", issue, "--json", "number,title,body,labels"],
  { encoding: "utf8" },
);
if (gh.status !== 0) throw new Error(gh.stderr || "gh issue view 失败");
const { title, body, labels } = JSON.parse(gh.stdout);
const text = String(body ?? "");
const lower = text.toLowerCase();

const checks: { check: string; pass: boolean; note: string }[] = [];
const add = (check: string, pass: boolean, note: string) => checks.push({ check, pass, note });

add(
  "label: ready-for-agent",
  labels?.some((l: { name: string }) => l.name === "ready-for-agent"),
  `labels = [${(labels ?? []).map((l: { name: string }) => l.name).join(", ")}]`,
);
add("body: 非空且 ≥200 字符", text.length >= MIN_BODY, `body ${text.length} chars`);
add(
  "AC: 含可判定的完成标准（验收/AC/完成标准/done when…）",
  /验收|acceptance|\bac\b|完成标准|done when|通过标准/i.test(text),
  "机械关键词匹配；措辞是否真的可判定由编排者判断",
);
add(
  "验证: 指明了证明手段（测试/lint 命令）",
  /(cargo\s+(test|clippy)|测试|test|lint|验证命令)/i.test(text),
  "审计要求精确到命令名（如 cargo test -p iris-api --lib）",
);
const touch = /文件[：:]\s*(.+)|touch-?set[：:]\s*(.+)|files?[：:]\s*(.+)/i.exec(text);
const touchSet = parseTouchSet(touch ? (touch[1] ?? touch[2] ?? touch[3]) : undefined);
add("touch-set: 声明了预期改动文件集", touchSet.length > 0, touchSet.join(", ") || "正文未声明文件集");
const hits = forbidden.filter(f => lower.includes(f.toLowerCase()));
add(
  `禁区扫描: [${forbidden.join(", ")}]`,
  hits.length === 0,
  hits.length ? `命中禁区词: ${hits.join(", ")} → 降级白天 batch 车道` : "clean",
);

const demote = hits.length > 0;
const hardFail = checks.some(c => !c.pass && !c.check.startsWith("禁区"));
const verdict = demote ? "demote" : hardFail ? "rework" : "launch";

mkdirSync(AUDIT_DIR, { recursive: true });
const record = {
  issue: Number(issue),
  title,
  verdict,
  touchSet, // --touch-overlap 跨票扫描的数据源
  checks,
  auditedAt: new Date().toISOString(),
  // 编排者判词（机械检查通过 ≠ 票据合格）——由主会话补写后 run-ticket 才接受
  orchestratorNote: "",
};
writeFileSync(join(AUDIT_DIR, `${issue}.json`), JSON.stringify(record, null, 2), "utf8");

for (const c of checks) console.log(`${c.pass ? "✓" : "✗"} ${c.check} — ${c.note}`);
console.log(`\nverdict: ${verdict.toUpperCase()}  →  ${join(AUDIT_DIR, `${issue}.json`)}`);
if (verdict === "launch")
  console.log("下一步：编排者补写 orchestratorNote 判词，然后 run-ticket.mts --yolo --audit 才会发射。");
process.exit(verdict === "launch" ? 0 : verdict === "demote" ? 2 : 1);
