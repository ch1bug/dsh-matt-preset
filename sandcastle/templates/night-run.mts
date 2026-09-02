/**
 * night-run.mts — 夜间队列编排器（检查点续跑 + 配额熔断 + 清晨 digest）。
 *
 * 用法：
 *   npx tsx .sandcastle/night-run.mts --image localhost/<repo>:dsh \
 *     --verify "cargo test -p iris-api --lib" --max-minutes 60 \
 *     --queue .sandcastle/night-queue.json
 *
 * 队列格式（.sandcastle/night-queue.json，由编排会话或人工维护）：
 *   { "tickets": [449, 452, { "issue": 455, "verify": "cargo test -p iris-agent --lib" }] }
 *
 * 行为：
 *   - 逐票 spawn run-ticket.mts（进程级崩溃隔离，单票崩不伤队列）
 *   - 幂等续跑：检查点已 merged/pr 的票自动跳过——崩溃/中断后重跑同一命令即从断点继续
 *   - 配额熔断：provider 配额/认证错误是【停止信号】不是重试信号——持久化进度并退出
 *   - 结束写 digest（.sandcastle/digest/<stamp>.md）：逐票状态 + 收口提醒
 *     （ticket-audit 抽查 + 批末 push 走 summary gate）
 *
 * 退出码：0=全部处理完  2=配额熔断提前停止（队列可重跑续命）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const queueFile = arg("queue") ?? ".sandcastle/night-queue.json";
const image = arg("image");
if (!image) throw new Error("提供 --image localhost/<repo>:dsh");
const verify = arg("verify");
const maxMinutes = arg("max-minutes") ?? "60";

const queue = JSON.parse(readFileSync(queueFile, "utf8"));
const tickets: (number | { issue: number; verify?: string; branch?: string })[] = queue.tickets;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const digestPath = `.sandcastle/digest/night-${stamp}.md`;

const QUOTA = /quota|429|401|403|unauthorized|insufficient|invalid api key/i;
const results: { id: string; status: string; note: string }[] = [];
let stopped = false;

for (const t of tickets) {
  const issue = typeof t === "number" ? t : t.issue;
  const tVerify = (typeof t === "object" && t.verify) || verify;
  const tBranch = typeof t === "object" ? t.branch : undefined;
  const stateFile = `.sandcastle/state/${issue}.json`;

  // 幂等：检查点显示已收口 → 跳过（崩溃/中断后重跑即续命）
  if (existsSync(stateFile)) {
    const prev = JSON.parse(readFileSync(stateFile, "utf8"));
    if (prev.status === "merged" || prev.status === "pr") {
      results.push({ id: String(issue), status: prev.status, note: "checkpoint 已收口，跳过" });
      continue;
    }
    if (prev.status === "parked-verify" || prev.status === "parked-conflict") {
      results.push({ id: String(issue), status: prev.status, note: "上次已 park（未返工），跳过" });
      continue;
    }
  }

  console.log(`\n======== 票 #${issue} 发射 ========`);
  const args = [
    "tsx",
    ".sandcastle/run-ticket.mts",
    "--issue",
    String(issue),
    "--yolo",
    "--image",
    image,
    "--max-minutes",
    maxMinutes,
  ];
  if (tVerify) args.push("--verify", tVerify);
  if (tBranch) args.push("--branch", tBranch);
  const child = spawnSync("npx", args, { encoding: "utf8", shell: true });
  const output = (child.stdout || "") + "\n" + (child.stderr || "");

  if (QUOTA.test(output)) {
    results.push({ id: String(issue), status: "quota-stop", note: "配额/认证错误——整批停止，队列保留续跑" });
    stopped = true;
    break;
  }
  const map: Record<number, string> = { 0: "merged", 3: "parked-verify", 4: "parked-conflict", 5: "parked-timeout", 6: "parked-empty" };
  const status = map[child.status ?? 1] ?? `failed(${child.status})`;
  results.push({ id: String(issue), status, note: output.slice(-300) });
}

// —— 清晨 digest ——
mkdirSync(".sandcastle/digest", { recursive: true });
const count: Record<string, number> = {};
for (const r of results) count[r.status] = (count[r.status] ?? 0) + 1;
const digest = [
  `# 夜间批跑 digest ${new Date().toISOString()}`,
  "",
  `| 票 | 状态 | 说明 |`,
  `| --- | --- | --- |`,
  ...results.map((r) => `| #${r.id} | ${r.status} | ${r.note.replace(/\|/g, "/").slice(0, 120)} |`),
  "",
  `统计：${JSON.stringify(count)}`,
  "",
  "收口提醒：",
  "1. 对 merged 票按比例跑 `ticket-audit` 抽查（AC 覆盖/测试真实性/验证重放）",
  "2. 抽查通过 → 批末 push 走 summary gate（一次 push，远程 CI 全绿为完成）",
  "3. parked 票：verify/conflict → 同沙箱返工一次或降级白天 batch",
].join("\n");
writeFileSync(digestPath, digest, "utf8");
console.log(`\n${digest}\n\ndigest → ${digestPath}`);
process.exit(stopped ? 2 : 0);
