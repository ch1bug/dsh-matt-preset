/**
 * isolated-git.mjs —— **夹具子进程的 git 隔离挂具**（#110 的结构性防线）。
 *
 * ── 为什么需要它（本票实测，不是推的）──────────────────────────────────────────
 * `git commit` 会以 **pre-commit 钩子**的身份跑 `scripts/verify-all.mjs`，而钩子上下文里
 * git 会导出一组指向**调用方仓库**的变量。实测（真 linked worktree 的钩子里 dump，
 * `.scratch/p110-hookenv2.mjs`）：
 *
 *   GIT_DIR        = <base>/.git/worktrees/<name>    ← worktree 专属 gitdir，**不是** <repo>/.git
 *   GIT_INDEX_FILE = <base>/.git/worktrees/<name>/index
 *   GIT_WORK_TREE  = unset
 *   PWD            = /tmp/...                        ← POSIX 形态（与 Node 的 os.tmpdir() 不同形）
 *
 * 夹具若**原样继承**这些变量，它内部的 `git init` / `git config` / `git commit` 就会**打到调用方
 * 仓库上**。已实测的破坏（`.scratch/p110-canary.mjs`，把下面这份清理拆掉即可复现）：
 *
 *   夹具的 `git init` 带着外层 `GIT_DIR` → **共享 `.git/config` 的 `core.bare` 被写成 `true`**
 *   → 同仓的**其它检出**此后 `git status` 报 `fatal: this operation must be run in a work tree`。
 *   隐蔽点：`log` / `show` 仍可用，只有 `status` / `add` / `commit` 报错，极易误判成"工具坏了"。
 *
 * ── 本挂具之前的状态（病灶）────────────────────────────────────────────────────
 * 这份清理此前是**逐文件手写**的，4 个文件各写一份（`verify-all-entry.mjs` /
 * `verify-precommit-hook.mjs` / `verify-batch-state.mjs` / `verify-restore-discipline.mjs`），
 * 且**没有任何断言**在看它 —— 新写一个夹具的人漏掉这一行，全程静默，直到有人 `git status` 报错。
 * 本挂具把"怎么写"收敛成一处，"写没写"由 `tests/verify-isolated-git.mjs` 的 `I2` 结构断言守住。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *   import { fixtureEnv, gitIn } from './isolated-git.mjs'
 *
 *   // ① 夹具子进程的 env：脱离父 git 环境，并把 git 配置面指向夹具自己的空文件
 *   const env = fixtureEnv({ GIT_CONFIG_GLOBAL: join(tmp, '.gitconfig') })
 *   spawnSync('git', ['-C', tmp, 'init', '-q', ...], { env })
 *
 *   // ② 更省事：直接拿一个绑定好 env 的 `git -C <dir>` 调用器
 *   const G = gitIn(tmp, env)
 *   G('init', '-q', '-b', 'main')
 *
 * ⚠ **一律用 `git -C <dir>`，不要用 spawn 的 `cwd:` 选项**（本机 `startup` 脚本族会在每次子进程
 *   启动时把 cwd 复位到 Windows 用户目录，`cwd:` **静默失效** → 夹具命令全打在调用方仓库上；
 *   这正是 #110 的另一条同族通路）。`-C` 是 git 自己的参数，宿主改不了它。
 * ⚠ **配置面（`GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM`）由调用方显式覆盖**：本函数按
 *   `GIT_` 前缀**无条件全删**（含这两个），因为"漏了某个新变量"正是本票要防的漂移。
 *   删除是对的，但**只删不覆盖**会让夹具回落到 git 的默认链（读本机 `~/.gitconfig`），
 *   于是身份与 `core.autocrlf` 变成机器相关量 —— 故自建仓的用例应当传
 *   `fixtureEnv({ GIT_CONFIG_GLOBAL: <夹具自己的空文件> })`，见 `fixtureEnv` 的参数。
 */
import { spawnSync } from 'node:child_process'

/** 会被 git 导出给钩子、且会把夹具命令**指回调用方仓库**的变量。 */
export const CALLER_GIT_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
]

/**
 * 夹具子进程的 env：**删掉全部 `GIT_*`**（不只是上面那张表 —— 任何 `GIT_` 前缀的继承值都可能
 * 改变夹具里 git 的行为，而"漏了某个新变量"正是本票要防的漂移），再叠加调用方给的覆盖。
 *
 * @param {Record<string, string|undefined>} [overrides] 覆盖项（如把 `GIT_CONFIG_GLOBAL` 指向夹具空文件）
 * @returns {Record<string, string|undefined>}
 */
export function fixtureEnv(overrides = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  return { ...env, ...overrides }
}

/**
 * 绑定好「隔离 env + `git -C <dir>`」的调用器。
 *
 * @param {string} dir 夹具仓目录（绝对路径）
 * @param {Record<string, string|undefined>} [env] 已经过 `fixtureEnv` 的 env；缺省时现算一份
 * @returns {(...args: string[]) => import('node:child_process').SpawnSyncReturns<string>}
 */
export function gitIn(dir, env = fixtureEnv()) {
  return (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env, windowsHide: true })
}