/**
 * audit-ticket.mts — 票据审计（yolo 发射前的输入质量门，机械预检）。
 *
 * 用法：
 *   npx tsx .sandcastle/audit-ticket.mts --issue 449
 *   npx tsx .sandcastle/audit-ticket.mts --issue 449 --forbid "migrations/,money_path,governance"
 *
 * 输出：.sandcastle/audits/<issue>.json（审计记录，票据出口证据的一部分）
 * 退出码：0 = launch（可发射）  2 = demote（降级白天 batch 车道）  1 = 硬失败/信息不足需回炉
 *
 * 边界：这里只做机械检查；规格是否真的成立由编排会话（主会话）判断——
 * 机械检查通过 ≠ 票据合格，审计记录里必须留编排者的判词。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const issue = arg("issue");
if (!issue) throw new Error("提供 --issue N");
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
add("touch-set: 声明了预期改动文件集", Boolean(touch), touch ? (touch[1] ?? touch[2] ?? touch[3]) : "正文未声明文件集");
const hits = forbidden.filter(f => lower.includes(f.toLowerCase()));
add(
  `禁区扫描: [${forbidden.join(", ")}]`,
  hits.length === 0,
  hits.length ? `命中禁区词: ${hits.join(", ")} → 降级白天 batch 车道` : "clean",
);

const demote = hits.length > 0;
const hardFail = checks.some(c => !c.pass && !c.check.startsWith("禁区"));
const verdict = demote ? "demote" : hardFail ? "rework" : "launch";

mkdirSync(".sandcastle/audits", { recursive: true });
const record = {
  issue: Number(issue),
  title,
  verdict,
  checks,
  auditedAt: new Date().toISOString(),
  // 编排者判词（机械检查通过 ≠ 票据合格）——由主会话补写后 run-ticket 才接受
  orchestratorNote: "",
};
writeFileSync(`.sandcastle/audits/${issue}.json`, JSON.stringify(record, null, 2), "utf8");

for (const c of checks) console.log(`${c.pass ? "✓" : "✗"} ${c.check} — ${c.note}`);
console.log(`\nverdict: ${verdict.toUpperCase()}  →  .sandcastle/audits/${issue}.json`);
if (verdict === "launch")
  console.log("下一步：编排者补写 orchestratorNote 判词，然后 run-ticket.mts --yolo --audit 才会发射。");
process.exit(verdict === "launch" ? 0 : verdict === "demote" ? 2 : 1);
