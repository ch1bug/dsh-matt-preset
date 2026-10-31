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
import { fixtureEnv } from "./isolated-git.mjs";

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
// #30：旧 shim 经 system()→cmd 解析裸 "bash"（PATH 漂移到 WSL 即挂）且
// cmd /c 引号剥离规则脆弱。改为 CreateProcessA 直启已解析的 msys bash，
// -l（login shell）注入 /usr/bin 标准路径；gh.exe 路径剥扩展名指向同目录
// gh 脚本，归一正斜杠（msys 兼容，dirname "$0" 才正确）。
const ghC = (bashPath) => {
  const b = bashPath.replace(/\//g, "\\\\"); // C 源码字面量：/ → \\（转义反斜杠）
  return `#include <windows.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
  char self[2048]; GetModuleFileNameA(NULL, self, sizeof self);
  char *s; for (s = self; *s; s++) if (*s == '\\\\') *s = '/';
  char *dot = strrchr(self, '.');
  if (dot && _stricmp(dot, ".exe") == 0) *dot = 0; /* gh.exe → 同目录 gh 脚本 */
  char cmd[8192];
  int n = snprintf(cmd, sizeof cmd, "\\"${b}\\" -l \\"%s\\"", self);
  for (int i = 1; i < argc && n > 0 && n < (int)sizeof cmd; i++)
    n += snprintf(cmd + n, sizeof cmd - n, " %s", argv[i]);
  STARTUPINFOA si = { .cb = sizeof si };
  PROCESS_INFORMATION pi;
  if (!CreateProcessA("${b}", cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) return 127;
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 1; GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
  return (int)code;
}
`;
};

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
// #30：Windows PATH 上 bash 可能漂移到 WSL bash（无 /c、无 gcc）或 Git bash
// （无 gcc）；e2e 需要 msys 工具链（setup.sh 的 gh.exe shim 依赖 gcc，
// /ucrt64/bin fallback 属 msys2）。显式解析一个「gcc 可达」的 bash，
// 探针判别，找不到则报可行动错误——绝不带病跑完在断言处 ENOENT。
const BASH_CANDIDATES = [
  process.env.SANDCASTLE_E2E_BASH, // env 覆盖优先
  "bash",                          // PATH（当前会话若已正确前置）
  "C:/msys64/usr/bin/bash.exe",    // msys2 标准安装点（/ucrt64/bin 有 gcc；#120 ④ 单独确认保留）
  // #120 口径 B：Git bash 的字面安装路径（Program Files 一族）不写死——该位候选已删；
  // 机器上 bash 不在标准点时设 SANDCASTLE_E2E_BASH（键说明见 .env.example）。
].filter(Boolean);
// 能力探针：gcc 在 PATH 上，或 msys2 fallback /ucrt64/bin/gcc.exe 存在。
const bashCapable = (bash) =>
  spawnSync(bash, ["-c", "command -v gcc >/dev/null 2>&1 || test -x /ucrt64/bin/gcc.exe"],
    { encoding: "utf8" }).status === 0;
function findBash() {
  for (const c of BASH_CANDIDATES) {
    if (bashCapable(c)) return c;
  }
  console.error(
    "✗ 未找到可用的 msys 工具链 bash（需 gcc 直达或 msys2 /ucrt64/bin/gcc）。\n" +
    "  修复方式之一：设 SANDCASTLE_E2E_BASH=<msys2 bash 路径> 后重跑，\n" +
    "  例如：SANDCASTLE_E2E_BASH=C:/msys64/usr/bin/bash.exe node tests/sandcastle-e2e.mjs",
  );
  process.exit(1);
}
const BASH = findBash();
const DRIVER = join(W, "drv.sh");
// #30：非 login 启动的 msys bash 继承的 Windows PATH 不含其 /usr/bin，
// `npx`（shebang `#!/usr/bin/env bash`）、uname、dirname 等全部不可执行。
// 前置 bash 自身所在目录，让 bash 启动时转换出的 PATH 覆盖 /usr/bin。
const BASH_BIN = dirname(BASH);
// bash 的脚本入口用正斜杠；参数 W 保留原生形态：drv.sh 会把它拼进 PATH，
// 把 W 改成 C:/... 会让冒号成为 PATH 分隔符，Node 找不到假 gh 而误调真实 gh。
const bashPath = (p) => p.replace(/\\/g, "/");
const runBash = (script, args, opts = {}) => {
  const r = spawnSync(BASH, [bashPath(script), ...args], {
    encoding: "utf8",
    ...opts,
    env: fixtureEnv({ ...opts.env, PATH: `${BASH_BIN};${process.env.PATH}` }),
  });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

// ============================================================
// 搭台
// ============================================================
{
  mkdirSync(join(W, "bin"), { recursive: true });
  mkdirSync(join(W, ".sandcastle"), { recursive: true });
  // 模板拷进假仓（同目录携带 lib.ts，#13 相对导入契约）
  for (const f of ["audit-ticket.mts", "night-run.mts", "lib.ts", "run-ticket.mts", "dsh.ts", "dsh-config.ts"]) {
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
  writeFileSync(join(W, "bin", "gh.c"), ghC(BASH));
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
  // #30：搭台失败立即中止——后续所有断言都依赖 shim 产物，
  // 带病跑完只会在 readFileSync ENOENT 处崩溃并误导诊断。
  if (fail > 0) {
    console.error(`\n搭台失败（setup.sh exit=${s.status}），保留现场：${W}\n${s.out}`);
    process.exit(1);
  }
}

const tsx = (args) => runBash(DRIVER, [W, ...args]);

// 临时消费者没有 node_modules；Node 原生 TS 去类型，不能靠宿主依赖掩盖静态引用。
{
  const files = ["run-ticket.mts", "night-run.mts", "dsh.ts", "dsh-config.ts", "lib.ts"];
  const probe = files.map(f => `await import(${JSON.stringify(pathToFileURL(join(W, ".sandcastle", f)).href)});`).join("\n");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", cwd: W });
  check("纯函数与 provider 模板在无任何 sandcastle 依赖的消费者中导入成功", r.status === 0);
  if (r.status !== 0) console.error(r.stderr || r.error);
}

// ============================================================
// 1. 单票审计 ×3：exit 0 + audits/N.json 落盘 verdict=launch + touchSet[]
// ============================================================
for (const n of [101, 102, 103]) {
  const r = tsx([".sandcastle/audit-ticket.mts", "--issue", String(n)]);
  check(`audit #${n} exit 0 (launch)`, r.status === 0);
  if (r.status !== 0) {
    console.error(r.out);
    process.exit(1);
  }
  const rec = readJ(".sandcastle", "audits", `${n}.json`);
  check(
    `audit #${n} record verdict=launch + touchSet[]`,
    rec.verdict === "launch" && Array.isArray(rec.touchSet) && rec.touchSet.length > 0,
  );
}

// —— 1.5 模型车道（#16）：机械分级 + 编排者覆盖 + 路由纯函数 ——
{
  const b101 = readJ(".sandcastle", "audits", "101.json");
  const b103 = readJ(".sandcastle", "audits", "103.json");
  check(
    "audit modelLane 机械分级：101→B / 103→C(docs-only)，source=mechanical",
    b101.modelLane?.lane === "B" && b101.modelLane?.source === "mechanical"
      && b103.modelLane?.lane === "C" && b103.modelLane?.source === "mechanical",
  );
  const r = tsx([".sandcastle/audit-ticket.mts", "--issue", "103", "--lane", "A"]);
  const ovr = readJ(".sandcastle", "audits", "103.json");
  check(
    "audit --lane A 覆盖：lane=A / source=orchestrator / suggested 保留 C",
    r.status === 0 && ovr.modelLane?.lane === "A" && ovr.modelLane?.source === "orchestrator" && ovr.modelLane?.suggested === "C",
  );
  const rt = await import(pathToFileURL(join(TPL, "run-ticket.mts")).href);
  check(
    "modelRouteDecision：cli > lane 映射 > default",
    rt.modelRouteDecision(undefined, "p/m", undefined).route === "cli"
      && rt.modelRouteDecision({ modelLane: { lane: "C" } }, undefined, { C: "p/mini" }).model === "p/mini"
      && rt.modelRouteDecision({ modelLane: { lane: "A" } }, undefined, undefined).route === "default",
  );
  const dsh = await import(pathToFileURL(join(TPL, "dsh.ts")).href);
  const ready = "mkdir -p ~/.dsh && cp /host-dsh/.credentials.yaml /host-dsh/settings.yaml ~/.dsh/ && chmod 600 ~/.dsh/.credentials.yaml";
  check("dshHomeReadyCommand：无模型与原内联命令逐字节等价（含 chmod 600）",
    dsh.dshHomeReadyCommand() === ready + " && echo dsh-home-ready");
  check("dshHomeReadyCommand：模型路由追加 patch 后才报告 ready",
    dsh.dshHomeReadyCommand("prov/model-name") === ready + " && " + rt.patchAgentDefaultModelCmd("prov/model-name") + " && echo dsh-home-ready");
  check("dshSandboxOptions：保留镜像、uid/gid 与只读宿主挂载",
    JSON.stringify(dsh.dshSandboxOptions("localhost/demo:dsh")) === JSON.stringify({
      imageName: "localhost/demo:dsh", containerUid: 1000, containerGid: 1000,
      mounts: [{ hostPath: "~/.dsh", sandboxPath: "/host-dsh", readonly: true }],
    }));
  const provider = dsh.dshHeadless();
  check("dshHeadless：保持非流式 provider 契约与 POSIX prompt 转义",
    provider.name === "dsh-headless" && Object.keys(provider.env).length === 0
      && provider.captureSessions === false && provider.parseStreamLine("anything").length === 0
      && provider.buildPrintCommand({ prompt: "it's $HOME\nnext" }).command === String.raw`dsh --profile headless 'it'\''s $HOME` + "\nnext'"
      && dsh.sh("") === "''");
  const sed = rt.patchAgentDefaultModelCmd("prov/model-name");
  check(
    "patchAgentDefaultModelCmd：替换 agent-default-model 块（provider+model 两行）",
    sed.includes("/^agent-default-model:/,+2c") && sed.includes("provider: prov") && sed.includes("model: model-name") && sed.includes("settings.yaml"),
  );
  check(
    "patchAgentDefaultModelCmd：grep 回执（防静默失效）+ 非法字符守卫",
    sed.includes("&& grep -qx") && (() => {
      try { rt.patchAgentDefaultModelCmd("no-slash"); return false; } catch { /* 期望抛 */ }
      try { rt.patchAgentDefaultModelCmd('p/m"evil'); return false; } catch { /* 期望抛 */ }
      return true;
    })(),
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
import { writeFileSync, mkdirSync } from "node:fs";
import { fixtureEnv, gitIn } from ${JSON.stringify(pathToFileURL(join(HERE, "isolated-git.mjs")).href)};

// 真 git 仓库：master 上造 >800 行 diff 的分支（cwd = 假仓 W）
const G = gitIn(${JSON.stringify(W)}, fixtureEnv());
const g = (...a) => {
  const r = G(...a);
  if (r.status !== 0) throw new Error("smoke git failed: " + a.join(" ") + "\\n" + r.stderr);
};
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
