// pass^k 冒烟 runner（#38）：建 sandbox 仓 → dsh headless 跑一次 implement 小票 → 留档
// 用法：node evals/passk-implement/smoke.mjs <run-label> [dsh-args…]
// 产物：.scratch/passk-runs/<run-label>/{transcript.txt, headless-stderr.log, final.diff, meta.json}
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const label = basename(process.argv[2] ?? ""); // 归一：防 label 拼进 outDir 写出仓外
if (!label) {
  console.error("usage: node smoke.mjs <run-label> [extra dsh args…]");
  process.exit(2);
}
const extraArgs = process.argv.slice(3);

const TASK = [
  "使用 /implement 技能流程完成以下小票（自包含票面，无 issue tracker）：",
  "在本仓实现 utils/slug.js 的 slugify(text)：转小写；空白与连续非字母数字字符折叠为单个 '-'；",
  "去首尾 '-'。用 node:test（node --test）写单测，必须先写测试并展示失败（红），再实现转绿。",
  "完成后 git commit（信息以 feat: 开头）。不要 push，不要做任务外的任何修改。",
].join(" ");

const outDir = join(process.cwd(), ".scratch", "passk-runs", label);
const sandbox = mkdtempSync(join(tmpdir(), "passk-"));
run("git", ["init", "-q"]);
writeFileSync(join(sandbox, ".gitignore"), "node_modules\n");
writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "passk-sandbox", private: true, type: "module" }, null, 2));
run("git", ["add", "-A"]);
run("git", ["-c", "user.name=passk", "-c", "user.email=passk@local", "commit", "-qm", "chore: sandbox seed"]);
const seed = run("git", ["rev-parse", "HEAD"]).trim();

mkdirSync(outDir, { recursive: true });
// Windows：dsh 是 npm 的 .cmd shim，spawnSync 无 shell 找不到（ENOENT）；任务走 stdin（`-`）规避引号。
// 注意：shell:true 时 Node 的 timeout 不杀子进程树，超时会泄漏 dsh 会话——评测脚本可容忍，人工清理。
const r = spawnSync("dsh", ["headless", ...extraArgs, "-"], {
  cwd: sandbox, encoding: "utf8", shell: true, input: TASK,
  maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000,
});
writeFileSync(join(outDir, "transcript.txt"), r.stdout ?? "");
writeFileSync(join(outDir, "headless-stderr.log"), r.stderr ?? "");
// 子会话通常已 commit：抓 seed..HEAD 全量（未提交的工作树 diff 一并附上）
writeFileSync(
  join(outDir, "final.diff"),
  run("git", ["log", "-p", "--stat", `${seed}..HEAD`]) + run("git", ["diff"]),
);
const dshVersion = spawnSync("dsh", ["--version"], { encoding: "utf8", shell: true }).stdout?.trim() ?? "";
writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify(
    { label, sandbox, status: r.status, signal: r.signal, error: String(r.error ?? ""), dshVersion, profile: "headless", extraArgs },
    null, 2,
  ),
);
console.log(`[passk] run=${label} exit=${r.status} sandbox=${sandbox} out=${outDir}`);
rmSync(sandbox, { recursive: true, force: true });

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: sandbox, encoding: "utf8" });
}
