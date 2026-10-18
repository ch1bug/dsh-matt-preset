/**
 * safe-target.mjs — installer 的**破坏性目标**安全守卫（2026-10-18 事故硬化）。
 *
 * 事故（docs/dev-environment.md §1 记了现场）：某轮 agent 在 `DSH_HOME` 已导出为真实 home 的
 * shell 里做安装/清理，一条按 `$env:DSH_HOME` 展开的递归删除把 `~/.dsh` 的用户数据整片删掉
 * （会话日志 / 工作区 / 凭据 / 预设全没）。紧随其后的会话日志追加写撞 ENOENT、宿主退出、
 * App 用空 home 重建 = 用户看到的「重置」。事后取证：同一窗口里
 * `bin/install.mjs install --profile desktop` 是在 `DSH_HOME=C:\Users\<user>`（**用户 profile
 * 根**，不是 `…\.dsh`）下跑的——旧安装器对 home 形态**零校验**。
 *
 * 本模块只做**纯判定**（不删、不写、不退出），由调用方决定 die 还是继续：
 *   - homeRootProblem(DSH_HOME)    home 必须是用户 profile **之下**的目录，不得等于它、
 *                                  不得是它的祖先、不得是盘根；
 *   - storeRootProblem(storeRoot)  store 根同理（它下面才是 `matt/`）；
 *   - targetProblem(target, store) 删除目标必须是 `<store>/matt`，且 store 根合法。
 *
 * 全按**路径关系**判（相等 / 祖先 / 盘根），不按目录名猜——合法的第二 home 可以叫
 * `~/dsh-matt-home`（docs/RELEASE.md、docs/dev-environment.md §1），名字判据会误伤。
 *
 * 测试：tests/verify-installer-guards.mjs（纯函数单测 + CLI 行为）。
 */
import { homedir as osHomedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** child 是否等于 parent 或位于其下（resolve 后按路径段比较；大小写语义交给平台）。 */
export function isWithin(child, parent) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** a 是否为 b 的**严格祖先**（a 在 b 之上且不等于 b）。 */
export function isAncestor(a, b) {
  const rel = relative(resolve(a), resolve(b))
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

/** 盘根判定（`C:\`、`D:\`、`/`）：dirname(x) === x。 */
export function isFilesystemRoot(p) {
  const r = resolve(p)
  return dirname(r) === r
}

/** DSH_HOME 形态检查：返回问题描述（字符串）或 null（合法）。 */
export function homeRootProblem(home, { userProfile = osHomedir() } = {}) {
  const h = resolve(home)
  const profile = resolve(userProfile)
  if (h === profile) return `DSH_HOME resolves to the user profile itself (${h})`
  if (isAncestor(h, profile)) return `DSH_HOME is an ancestor of the user profile (${h})`
  if (isFilesystemRoot(h)) return `DSH_HOME is a filesystem root (${h})`
  return null
}

/** store 根形态检查：store 根可以任意（`<tmp>/custom-root` 也合法），但不得是
 *  用户 profile 本身 / 它的祖先 / 盘根——那意味着 `<store>/matt` 落在了用户目录里。 */
export function storeRootProblem(storeRoot, { userProfile = osHomedir() } = {}) {
  const s = resolve(storeRoot)
  const profile = resolve(userProfile)
  if (s === profile) return `preset store root is the user profile itself (${s})`
  if (isAncestor(s, profile)) return `preset store root is an ancestor of the user profile (${s})`
  if (isFilesystemRoot(s)) return `preset store root is a filesystem root (${s})`
  return null
}

/** 删除/覆盖目标检查：target 必须是 `<storeRoot>/matt`（且 store 根合法）。 */
export function targetProblem(target, storeRoot, { userProfile = osHomedir() } = {}) {
  const storeIssue = storeRootProblem(storeRoot, { userProfile })
  if (storeIssue !== null) return storeIssue
  const t = resolve(target)
  const s = resolve(storeRoot)
  if (basename(t) !== 'matt') return `target basename must be 'matt' (${t})`
  if (!isWithin(t, s)) return `target is outside the store root (${t} vs ${s})`
  const profile = resolve(userProfile)
  if (t === profile) return `target is the user profile (${t})`
  if (isAncestor(t, profile)) return `target is an ancestor of the user profile (${t})`
  if (isFilesystemRoot(t)) return `target is a filesystem root (${t})`
  return null
}
