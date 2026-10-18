/**
 * with-temp-home.mjs —— 隔离跑助手：给一条命令一个**建在 `os.tmpdir()` 下**的临时 `DSH_HOME`
 * （2026-10-18 第三次 home 事故硬化，#113 A 面）。
 *
 * ## 它替代的是什么
 *
 * 事故的入口不是「某条命令写错了」，而是**默认形态要求人（agent）手写一段 PowerShell 来造
 * 沙箱 home**，而那段命令有一条**静默失败**路径（取证 stderr 逐字）：
 *
 * ```text
 *  8 |  $home = Join-Path $env:TEMP ("dh-"+[guid]::NewGuid()); New-Item -Item ...
 *   |  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 *   | 无法覆盖变量 HOME，因为它是只读变量或常量。
 * New-Item:
 * 具有指定名称 C:\Users\<user> 的项已经存在。
 * ```
 *
 * `$HOME` 是 PowerShell 的**只读自动变量**（`$home` / `$HOME` 不区分大小写），赋值是**非终止
 * 错误** —— 脚本继续跑，`$home` 仍是真实 profile；`New-Item` 因目标已存在而失败，于是**沙箱 home
 * 从未建出来**；`Join-Path $home '.dsh'` / `$env:DSH_HOME` 静默指向真实 home，收尾按环境变量
 * 展开的递归删除就删掉了真实 `~/.dsh`。
 *
 * 本助手的答案是把那段命令**从默认形态里去掉**：路径由 `fs.mkdtemp` 生成，判定走 Node 的纯路径
 * 关系，删除目标**只认 `mkdtemp` 自己返回的那个绝对路径**——不是任何环境变量的再解析。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/with-temp-home.mjs -- <cmd> [args...]
 * ```
 *
 * 子进程会拿到 `DSH_HOME=<临时 home 绝对路径>`；stdio 继承（交互式命令照常工作），退出码原样透传。
 * 助手在 stdout 上 echo 解析后的绝对路径（D47：响亮，不静默），收尾只删自己建的那一个目录。
 *
 * ## 它**不**做什么（诚实边界）
 *
 * 它挡不住 agent 手上随意书写的另一条 shell 命令——真正的物理拦截需要 harness 侧 pre-tool hook
 * （#113 边界，不在本票范围）。仓库侧能做的是把这条入口从默认形态里拿掉 + 让这类命令不再对提醒面
 * 隐形（`workflow-enforcer.mjs` 的 `HOME_DELETE_TRIGGER`）+ 把只读变量陷阱写成硬规则（AGENTS.md）。
 *
 * 测试：tests/verify-temp-home-guard.mjs（守卫纯函数 T1 + CLI 闭环 T2–T5）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAncestor, isFilesystemRoot, isWithin } from '../lib/safe-target.mjs'

/**
 * 判定：`target` 是否**严格位于** `root` 之内（不相等）。
 *
 * 这里**不**自己写第二份路径比较器 —— 本仓的 home 安全判定只有一个事实源：
 * `lib/safe-target.mjs`（安装器守卫，`tests/verify-installer-guards.mjs` 钉住）。它只用
 * `node:path`，**没有任何第三方依赖**，所以"救生圈要零依赖"这个理由并不成立：import 它不会
 * 引入任何需要安装的东西。自己再写一份的代价是真实的 —— 第一版用 `startsWith(root + sep)`
 * 判断，与 `isWithin` 的 `relative()` 口径并不等价：前缀比较**接受** `C:\Temp\..\..\Users`
 * 这类带 `..` 的字符串（`relative()` 会把它正确判为界外），且两者在 Windows 大小写语义上也
 * 不同。守卫是本文件**安全攸关的核心**，正是最不该出现第二份判定实现的地方。
 */
function isStrictlyWithin(target, root) {
  const t = resolve(target)
  const r = resolve(root)
  return t !== r && isWithin(t, r)
}

/**
 * 守卫（**纯判定**，不删不写不退出）：`target` 是否是一个合法的临时 home？
 *
 * 合法 = **严格位于 `os.tmpdir()` 之内** 且 **不是盘根** 且 **不是 `homedir()` 的祖先/等于它
 * 及其祖先**。判据全是**路径关系**（相等 / 祖先 / 盘根），一条都不按目录名猜——合法的第二 home
 * 可以叫 `~/dsh-matt-home`（`docs/dev-environment.md` §1），名字判据会误伤。
 *
 * 抛 `Error`（不是返回布尔）：调用方要么在**建目录之前**用它，要么在**删之前**再用一次；两次
 * 都必须是"不合法就别动"的硬失败，而不是一个可以被忽略的 `false`。类型不对（`undefined` /
 * 空串 / 非字符串）同样抛错——把"没有目标"静默当成"没什么要删"正是 D47 要禁的静默。
 *
 * @param {string} target 待判定的绝对/相对路径
 * @param {{ tmpRoot?: string, userHome?: string }} [opts] 仅供用例注入，默认取真实 `os.tmpdir()` / `os.homedir()`
 * @returns {string} `resolve(target)` —— 调用方**必须**用这个返回值，不要再自己拼一遍
 */
export function assertSafeTempHome(target, opts = {}) {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error(`with-temp-home: refusing a non-path safety target (${JSON.stringify(target)})`)
  }
  const tmpRoot = resolve(opts.tmpRoot ?? tmpdir())
  const userHome = resolve(opts.userHome ?? homedir())
  const t = resolve(target)

  if (isFilesystemRoot(t)) {
    throw new Error(`with-temp-home: refusing a filesystem root as a temp home (${t})`)
  }
  // 真实 home **及其祖先**（`C:\Users` / `C:\`）全都拒绝：`dirname(homedir())` 正是事故里
  // 被误当成沙箱 home 的那一层，只判"相等"会漏掉它。
  if (t === userHome) {
    throw new Error(`with-temp-home: refusing the real user home as a temp home (${t})`)
  }
  if (isStrictlyWithin(userHome, t)) {
    throw new Error(`with-temp-home: refusing an ancestor of the user home (${t} contains ${userHome})`)
  }
  if (!isStrictlyWithin(t, tmpRoot)) {
    throw new Error(`with-temp-home: temp home must sit strictly inside ${tmpRoot} (got ${t})`)
  }
  return t
}

/** 助手自己建的那些根（收尾只认这一份，不认任何环境变量）。 */
const createdRoots = []

/** 建临时 home。`mkdtemp` 一返回就**立刻**登记 + 断言——中间不留未受保护的窗口。 */
async function createTempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-temp-home-'))
  createdRoots.push(dir)
  assertSafeTempHome(dir)
  return dir
}

/** 收尾：只删 `mkdtemp` 返回过的那一个路径，删前**再断言一次**（守卫被改坏也删不动）。 */
async function removeTempHome(dir) {
  try {
    assertSafeTempHome(dir)
  } catch (error) {
    console.error(`with-temp-home: refusing to remove the temp home — ${error.message}`)
    return
  }
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (error) {
    console.error(`with-temp-home: temp home left behind (${dir}): ${error?.message ?? error}`)
  }
}

/** 等价的同步收尾（异常路径上用，Windows 上句柄延迟由 maxRetries 兜住）。 */
function removeTempHomeSync(dir) {
  try {
    assertSafeTempHome(dir)
  } catch (error) {
    console.error(`with-temp-home: refusing to remove the temp home — ${error.message}`)
    return
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  } catch (error) {
    console.error(`with-temp-home: temp home left behind (${dir}): ${error?.message ?? error}`)
  }
}

const USAGE = [
  'usage: node scripts/with-temp-home.mjs -- <cmd> [args...]',
  '',
  'Runs <cmd> with DSH_HOME pointing at a fresh directory under os.tmpdir(),',
  'removing exactly that directory afterwards. The `--` separator is REQUIRED.',
].join('\n')

/** 解析 `--` 之后的子命令；缺 `--` / 空命令 → 响亮失败（D47），返回 null。 */
export function parseArgs(argv) {
  const sep = argv.indexOf('--')
  if (sep === -1) {
    console.error(`with-temp-home: missing the required \`--\` separator.\n${USAGE}`)
    return null
  }
  const command = argv.slice(sep + 1)
  if (command.length === 0) {
    console.error(`with-temp-home: no command after \`--\`.\n${USAGE}`)
    return null
  }
  return command
}

/** CLI 主体（可被用例直接调用，但用例走的是真实 spawn —— 见测试头注释）。 */
async function main(argv) {
  const command = parseArgs(argv)
  if (command === null) return 2

  let home
  try {
    home = await createTempHome()
  } catch (error) {
    console.error(`with-temp-home: could not create a temp home — ${error?.message ?? error}`)
    return 1
  }

  // D47：把解析后的**绝对路径**喊出来，而不是让读者去猜环境变量展开成了什么。
  console.log(`DSH_HOME=${home}`)

  const [bin, ...args] = command
  const result = spawnSync(bin, args, {
    stdio: 'inherit',                                   // 交互式命令照常工作
    env: { ...process.env, DSH_HOME: home },            // 注入的是上面那个路径
  })

  // 收尾在**退出码透传之前**：无论子进程怎么退出（含信号/异常），临时 home 都必须走完收尾。
  await removeTempHome(home)

  if (result.error !== undefined) {
    console.error(`with-temp-home: could not run ${bin} — ${result.error.message}`)
    return result.error.code === 'ENOENT' ? 127 : 1
  }
  if (result.signal !== null && result.signal !== undefined) {
    // 子进程被信号杀掉：没有可透传的退出码，按惯例报 128+n（n 取信号词表里的未知位 1）。
    console.error(`with-temp-home: ${bin} was killed by ${result.signal}`)
    return 1
  }
  return result.status ?? 1
}

// 只有被当作 **CLI** 跑时才执行主体；被 import（用例取 `assertSafeTempHome`）时不做任何事。
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  // 异常路径也要把已建出来的临时 home 收掉 —— 否则一个 bug 会在 %TEMP% 里堆目录。
  process.on('exit', () => {
    for (const dir of createdRoots) removeTempHomeSync(dir)
  })
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`with-temp-home: unexpected failure — ${error?.stack ?? error}`)
      process.exit(1)
    })
}