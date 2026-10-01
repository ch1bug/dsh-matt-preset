#!/usr/bin/env node
/**
 * sandcastle-e2e.mjs — sandcastle 三命令端到端冒场测试（#15）。
 *
 * 由 .scratch/e2e-sandcastle.sh（bash 版，15/15 PASS）提升为 node 版：
 * node 负责编排、artifact 断言与清理；bash 只作 msys 现实（git/gcc/PATH）
 * 的驱动器。断言全部在 node 侧，可重复执行（mktemp + 失败保留现场）。
 *
 * 覆盖（原有 15 条口径 + simplify 门抽测）：
 *   1. 单票审计 ×3：exit 0 + audits/N.json 落盘 verdict=launch + touchSet[]
 *   2. touch-overlap：serial 组 [101,102]（重叠 src/b.ts）+ singleton 103
 *   3. touch-overlap 负路径：缺 touchSet → exit 1（硬失败）
 *   4. night-run 第一轮：digest 波次提示 + needs-simplify(103) + state 落盘
 *   5. night-run 第二轮：幂等全跳过（stub 改为被调用即败）
 *   6. simplify 门（#12/#13 后的纯函数，真 git 仓库）：judgeSimplify 阈值/
 *      --no-simplify 豁免 / countDiffLines 真统计与失败告警路径 / EXIT_STATUS=7
 *
 * 边界（如实标注，不得谎称端到端）：run-ticket 的沙箱段（podman/
 * @ai-hero/sandcastle）在本环境不可达——night-run 侧用 stub run-ticket
 * 子进程验证 exit/state 契约（含 exit 7 → needs-simplify 状态映射），
 * run-ticket 真实 simplify 门以纯函数直测（沙箱依赖为动态导入，导入安全）。
 *
 * 用法：node tests/sandcastle-e2e.mjs
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, writeFileSync, mkdirSync, readFileSync,
  readdirSync, rmSync, cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TPL = join(ROOT, "sandcastle", "templates");
const W = mkdtempSync(join(tmpdir(), "sandcastle-e2e-"));

let pass = 0, fail = 0;
function check(desc, cond) {
  console.log(`${cond ? "✓" : "✗"} ${desc}`);
  cond ? pass++ : fail++;
}
const readW = (...p) => readFileSync(join(W, ...p), "utf8");
const readJ = (...p) => JSON.parse(readW(...p));

// —— 假票正文（≥200 字符门槛 + AC 关键词 + 验证命令 + 文件集声明）——
const body = (n, files) =>
  `背景：端到端冒场测试用假票，正文长度撑过 200 字符门槛。${n} 这段文字的存在只是为了让 body 长度达标过二百字符门槛，包含验收关键词与验证命令，并进一步填充若干无信息量的说明文字以确保长度检查稳定通过。\n` +
  `验收标准（AC）：机械可判定，diff 落在预期文件集。\n` +
  `验证：node tests/x.test.mjs && cargo test -p demo --lib\n` +
  `文件：${files}`;
const ISSUES = {
  101: body(101, "src/a.ts, src/b.ts"),
  102: body(102, "src/b.ts"),
  103: body(103, "docs/x.md"),
};

// —— gh shim：bash 脚本 + gcc 编译的 .exe 透传包装器 ——
// （Windows 下 node spawnSync("gh") 只解析 .exe，bash shim 拦不住真 gh）
const GH_SHIM = `#!/usr/bin/env bash
# args: issue view N --json number,title,body,labels
N="$3"
F="$(dirname "$0")/issue-$N.json"
if [ -f "$F" ]; then cat "$F"; else echo "unknown issue" >&2; exit 1; fi
`;
const GH_C = `#include <stdlib.h>
#include <string.h>
#include <windows.h>
int main(int argc, char **argv) {
  char cmd[4096] = "bash \\""; char self[2048];
  GetModuleFileNameA(NULL, self, sizeof self); /* self = .../bin/gh.exe */
  char *slash = strrchr(self, '\\\\'); if (slash) *(slash) = 0;
  strcat(self, "\\\\gh\\"");
  strcat(cmd, self);
  for (int i = 1; i < argc; i++) { strcat(cmd, " "); strcat(cmd, argv[i]); }
  return system(cmd);
}
`;

// —— stub run-ticket：模拟 run-ticket 的 exit/state 契约（真实现见模板源）——
// night-run 从 ./run-ticket.mts 导入 EXIT_STATUS——stub 必须同名导出。
const STUB_RUN = (mode) => `// stub：端到端测试替身——模拟 run-ticket 的 exit/state 契约（真实现见模板源）
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const EXIT_STATUS = {
  MERGED: 0, OTHER: 1, VERIFY_FAILED: 3, CONFLICT: 4,
  TIMEOUT: 5, EMPTY: 6, NEEDS_SIMPLIFY: 7,
} as const;
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
${mode === "fail" ? `  console.error("STUB MUST NOT BE CALLED — idempotency broken");
  process.exit(99);
` : `  const issue = process.argv[process.argv.indexOf("--issue") + 1];
  const code = issue === "103" ? 7 : 0;
  mkdirSync(".sandcastle/state", { recursive: true });
  const status = code === 7 ? "needs-simplify" : "merged";
  writeFileSync(\`.sandcastle/state/\${issue}.json\`, JSON.stringify({ id: issue, status }), "utf8");
  console.log(\`stub run-ticket #\${issue} → \${status}\`);
  process.exit(code);
`}}
`;

// —— bash 驱动器：一条命令一次调用（PATH 注入只发生在 bash 内部）——
const DRIVER = join(W, "drv.sh");
const runBash = (script, args, opts = {}) => {
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", ...opts });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

// ============================================================
// 搭台
// ============================================================
{
  mkdirSync(join(W, "bin"), { recursive: true });
  mkdirSync(join(W, ".sandcastle"), { recursive: true });
  // 模板拷进假仓（同目录携带 lib.ts，#13 相对导入契约）
  for (const f of ["audit-ticket.mts", "night-run.mts", "lib.ts"]) {
    cpSync(join(TPL, f), join(W, ".sandcastle", f));
  }
  // gh shim：per-issue JSON（node 转义换行，绕开 bash 转义坑）
  writeFileSync(join(W, "bin", "gh"), GH_SHIM);
  for (const [n, b] of Object.entries(ISSUES)) {
    writeFileSync(
      join(W, "bin", `issue-${n}.json`),
      JSON.stringify({ number: Number(n), title: `fake #${n}`, body: b, labels: [{ name: "ready-for-agent" }] }),
    );
  }
  writeFileSync(join(W, "bin", "gh.c"), GH_C);
  // 队列
  writeFileSync(join(W, ".sandcastle", "night-queue.json"), JSON.stringify({ tickets: [101, 102, 103] }));
  // setup.sh：假仓 + gh.exe 编译
  writeFileSync(join(W, "setup.sh"), `#!/usr/bin/env bash
set -u
W="$1"; SRC="$2"
git -C "$W" init -q -b master
git -C "$W" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
command -v gcc >/dev/null 2>&1 || export PATH="/ucrt64/bin:$PATH"
gcc -o "$W/bin/gh.exe" "$W/bin/gh.c" || exit 1
`);
  // drv.sh：PATH 注入 + 在假仓内跑 npx tsx
  writeFileSync(DRIVER, `#!/usr/bin/env bash
set -u
W="$1"; shift
export PATH="$W/bin:$PATH"
cd "$W"
exec npx tsx "$@"
`);
  const s = runBash(join(W, "setup.sh"), [W, TPL.replace(/\\/g, "/")]);
  check("搭台：假仓 + gh.exe shim 编译成功", s.status === 0);
}

const tsx = (args) => runBash(DRIVER, [W, ...args]);

// ============================================================
// 1. 单票审计 ×3：exit 0 + audits/N.json 落盘 verdict=launch + touchSet[]
// ============================================================
for (const n of [101, 102, 103]) {
  const r = tsx([".sandcastle/audit-ticket.mts", "--issue", String(n)]);
  check(`audit #${n} exit 0 (launch)`, r.status === 0);
  const rec = readJ(".sandcastle", "audits", `${n}.json`);
  check(
    `audit #${n} record verdict=launch + touchSet[]`,
    rec.verdict === "launch" && Array.isArray(rec.touchSet) && rec.touchSet.length > 0,
  );
}

// ============================================================
// 2. touch-overlap：101/102 重叠（src/b.ts）串行组，103 独立
// ============================================================
{
  const r = tsx([".sandcastle/audit-ticket.mts", "--touch-overlap"]);
  check("touch-overlap exit 0", r.status === 0);
  const rep = readJ(".sandcastle", "audits", "touch-overlap.json");
  const g = (rep.groups ?? []).find((g) => g.tickets.includes(101) && g.tickets.includes(102));
  check(
    "touch-overlap serial 组 [101,102] + singleton 103",
    rep.serial === true && !!g && [...g.tickets].sort().join() === "101,102" && (rep.singletons ?? []).includes(103),
  );
}

// ============================================================
// 3. touch-overlap 负路径：缺 touchSet → exit 1
// ============================================================
{
  const p102 = join(W, ".sandcastle", "audits", "102.json");
  const bak = readFileSync(p102, "utf8");
  const mut = JSON.parse(bak);
  delete mut.touchSet;
  writeFileSync(p102, JSON.stringify(mut));
  const r = tsx([".sandcastle/audit-ticket.mts", "--touch-overlap"]);
  check("touch-overlap 缺 touchSet → exit 1", r.status === 1);
  writeFileSync(p102, bak); // 还原
}

// ============================================================
// 4. night-run e2e（stub run-ticket 子进程；night-run 本体全真）
//    stub：101/102 → exit 0（写 state merged）；103 → exit 7（needs-simplify）
// ============================================================
{
  writeFileSync(join(W, ".sandcastle", "run-ticket.mts"), STUB_RUN("normal"));
  const r = tsx([".sandcastle/night-run.mts", "--image", "localhost/fake:dsh"]);
  check("night-run 第一轮 exit 0", r.status === 0);
  const digests = readdirSync(join(W, ".sandcastle", "digest")).filter((f) => f.startsWith("night-"));
  check("第一轮 digest 落盘", digests.length === 1);
  const d1 = readW(".sandcastle", "digest", digests[0]);
  check("digest 记 needs-simplify(103) + 票号", d1.includes("needs-simplify") && d1.includes("#101"));
  check("digest 含波次合并提示段", d1.includes("波次合并提示"));
  const s103 = readJ(".sandcastle", "state", "103.json");
  check("state/103.json status=needs-simplify", s103.status === "needs-simplify");

  // —— 5. 幂等：第二轮全部跳过（stub 改为被调用即败）——
  writeFileSync(join(W, ".sandcastle", "run-ticket.mts"), STUB_RUN("fail"));
  const r2 = tsx([".sandcastle/night-run.mts", "--image", "localhost/fake:dsh"]);
  check("night-run 第二轮 exit 0（幂等）", r2.status === 0);
  const d2files = readdirSync(join(W, ".sandcastle", "digest")).filter((f) => f.startsWith("night-"));
  const d2 = readW(".sandcastle", "digest", d2files[d2files.length - 1]);
  check("第二轮 digest 全为跳过（3 票）", (d2.match(/跳过/g) ?? []).length >= 3);
}

// ============================================================
// 6. simplify 门抽测（run-ticket 纯函数直测：judgeSimplify / countDiffLines /
//    EXIT_STATUS；真 git 仓库统计 + mock 失败路径）
//    沙箱段（podman）不可达——exit 7 的进程路径已由上方 stub 契约覆盖，
//    此处覆盖判定与统计逻辑本身。不得谎称完整端到端。
// ============================================================
{
  const runTicketUrl = pathToFileURL(join(TPL, "run-ticket.mts")).href;
  const nightRunUrl = pathToFileURL(join(TPL, "night-run.mts")).href;
  const smoke = `
import { judgeSimplify, countDiffLines, EXIT_STATUS } from ${JSON.stringify(runTicketUrl)};
import { statusForExit, loadSerialGroups, mergeSerialGroups } from ${JSON.stringify(nightRunUrl)};
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

// 真 git 仓库：master 上造 >800 行 diff 的分支（cwd = 假仓 W）
const g = (...a) => spawnSync("git", a, { encoding: "utf8" }).status === 0;
g("checkout", "-q", "-b", "ticket-big");
const big = Array.from({ length: 900 }, (_, i) => "line " + i).join("\\n");
writeFileSync("big.txt", big);
g("add", "big.txt");
g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "big");
g("checkout", "-q", "master");

const real = countDiffLines("ticket-big");            // 真 git 统计
const failed = countDiffLines("ticket-big", "definitely-missing-git-cmd"); // mock 失败

// 跨报告 serial 组去重（#14）：两份报告各含一组、共享票 202 → 传递合并为一组
mkdirSync("audits2", { recursive: true });
writeFileSync("audits2/r1.json", JSON.stringify({ groups: [{ serial: true, tickets: [201, 202] }] }));
writeFileSync("audits2/r2.json", JSON.stringify({ groups: [{ serial: true, tickets: [202, 203] }] }));
writeFileSync("audits2/touch-overlap.json", JSON.stringify({ serial: false, groups: [], singletons: [] }));
const dedupeLoaded = loadSerialGroups("audits2");
const dedupeMerged = mergeSerialGroups([[201, 202], [202, 203]]);

const out = {
  exitNeedsSimplify: EXIT_STATUS.NEEDS_SIMPLIFY,
  statusForExit7: statusForExit(7),
  over: judgeSimplify(801),
  atThreshold: judgeSimplify(800),
  noSimplify: judgeSimplify(801, { noSimplify: true }),
  customThreshold: judgeSimplify(201, { threshold: 200 }),
  real, failed, dedupeLoaded, dedupeMerged,
};
writeFileSync("smoke.json", JSON.stringify(out), "utf8");
`;
  writeFileSync(join(W, "smoke.mts"), smoke);
  const r = tsx(["smoke.mts"]);
  check("simplify 抽测脚本 exit 0", r.status === 0);
  let s = null;
  try { s = readJ("smoke.json"); } catch { /* fallthrough to checks */ }
  check("EXIT_STATUS.NEEDS_SIMPLIFY = 7（单一事实源）", s?.exitNeedsSimplify === 7);
  check("statusForExit(7) = needs-simplify", s?.statusForExit7 === "needs-simplify");
  check("judgeSimplify(801) → needsSimplify（严格大于阈值）", s?.over?.needsSimplify === true && s?.over?.skipped === false);
  check("judgeSimplify(800) → 通过（=阈值不触发）", s?.atThreshold?.needsSimplify === false);
  check("judgeSimplify(801, --no-simplify) → 豁免 skipped", s?.noSimplify?.skipped === true && s?.noSimplify?.needsSimplify === false);
  check("judgeSimplify(201, threshold=200) → 自定义阈值生效", s?.customThreshold?.needsSimplify === true);
  check(
    "countDiffLines 真 git 统计：900 行文件 → diffLines>800 且 statFailed=false",
    s?.real?.diffLines > 800 && s?.real?.statFailed === false,
  );
  check(
    "countDiffLines mock git 失败 → statFailed=true（#12 告警+记录路径的判定面）",
    s?.failed?.statFailed === true && s?.failed?.diffLines === 0,
  );
  const asSet = (g) => [...new Set(g)].sort().join(",");
  check(
    "loadSerialGroups 跨报告传递合并（#14）：r1[201,202]+r2[202,203] → 一组 [201,202,203]",
    Array.isArray(s?.dedupeLoaded) && s.dedupeLoaded.length === 1 && asSet(s.dedupeLoaded[0]) === "201,202,203",
  );
  check(
    "mergeSerialGroups 纯函数同口径（#14）",
    Array.isArray(s?.dedupeMerged) && s.dedupeMerged.length === 1 && asSet(s.dedupeMerged[0]) === "201,202,203",
  );
}

// ============================================================
// 收尾
// ============================================================
console.log(`\nPASS=${pass} FAIL=${fail}  (workdir: ${W})`);
if (fail > 0) {
  console.log("KEEPING workdir for inspection");
  process.exit(1);
}
rmSync(W, { recursive: true, force: true });
