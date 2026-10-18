/**
 * verify-installer-guards.mjs — 安装器路径安全守卫（2026-10-18 事故硬化）。
 *
 * 事故（docs/dev-environment.md §1 记了现场）：agent shell 里 `DSH_HOME` 已被桌面端导出为
 * **真实** home；一轮安装/清理把 `$env:DSH_HOME` 当删除目标展开，整片删了 `~/.dsh`
 * （会话日志 → 追加写 ENOENT → 宿主退出 → App 用空 home 重建 = 「重置」）。事后取证：
 * 同一窗口的 `bin/install.mjs install --profile desktop` 是在
 * `DSH_HOME=C:\Users\<user>`（profile 根，不是 `…\.dsh`）下跑的——旧安装器零校验。
 *
 * 本用例钉住 `lib/safe-target.mjs` 的判定 + 安装器 CLI 的实际行为：
 *   G1 DSH_HOME 形态：等于用户 profile / 它的祖先 / 盘根 → 红；`<profile>/.dsh`、
 *      `<profile>/dsh-matt-home`（合法第二 home）、临时目录 → 绿
 *   G2 store 根 / target 形态：store 根 = profile、目标名不是 `matt`、目标越出 store 根 → 红
 *   G3 CLI：`DSH_HOME=<profile>` → 非零退出，且**没有**在那里写任何东西
 *   G4 CLI：`--root` 缺值（旧实现静默回落真实 home）→ 非零退出
 *   G5 CLI：`<store>/matt` 是**别人的非空目录** → 拒绝覆盖/删除，文件原样
 *   G6 CLI：正常 `--root` 安装 + uninstall 闭环不被守卫误伤
 *
 * 非空洞（扰动纪律，2026-10-17）：把 `homeRootProblem` 改成恒 null → G1d?（不，G1a/b/c 红）
 * 与 G3 红；把 uninstall 的归属标记检查去掉 → G5 红。
 *
 * 隔离：G3 用**伪造的 `USERPROFILE`**（Node 的 `os.homedir()` 在 Windows 读它）——即使守卫
 * 失效、安装器真的写，也只落在临时目录里；其余用例全在 `os.tmpdir()` 下。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homeRootProblem, storeRootProblem, targetProblem } from '../lib/safe-target.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(REPO, 'bin', 'install.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'dsh-matt-guards-'))

let passed = 0
const test = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok - ${name}`)
  } catch (e) {
    console.error(`  FAIL - ${name}\n${e?.stack ?? e}`)
    process.exitCode = 1
  }
}

/** 跑安装器 CLI。`env` 覆盖父进程环境（G3 在这里伪造 `USERPROFILE`）。 */
const run = (args, env = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

const FAKE_PROFILE = join(tmp, 'fake-profile')
/** 环境前提：`homedir()` 在 Windows 读 `USERPROFILE`（Node 文档），G3 依赖这一点。 */
const profileOpts = { userProfile: FAKE_PROFILE }

test('G1a. home = 用户 profile 本身 → 红', () => {
  assert.match(String(homeRootProblem(FAKE_PROFILE, profileOpts)), /user profile/)
})
test('G1b. home = 用户 profile 的祖先 → 红', () => {
  assert.ok(homeRootProblem(dirname(FAKE_PROFILE), profileOpts), 'ancestor of profile must be refused')
})
test('G1c. home = 盘根 → 红', () => {
  assert.ok(homeRootProblem(parse(FAKE_PROFILE).root, profileOpts), 'filesystem root must be refused')
})
test('G1d. home = <profile>/.dsh（正常桌面 home）→ 绿', () => {
  assert.equal(homeRootProblem(join(FAKE_PROFILE, '.dsh'), profileOpts), null)
})
test('G1e. home = <profile>/dsh-matt-home（合法第二 home）→ 绿', () => {
  assert.equal(homeRootProblem(join(FAKE_PROFILE, 'dsh-matt-home'), profileOpts), null)
})
test('G1f. home = 系统临时目录下的隔离 home → 绿', () => {
  assert.equal(homeRootProblem(join(tmp, 'isolated-home'), profileOpts), null)
})

test('G2a. store 根 = 用户 profile 本身 → 红（<profile>/matt 不是我们的 store）', () => {
  assert.match(String(storeRootProblem(FAKE_PROFILE, profileOpts)), /user profile/)
  assert.ok(targetProblem(join(FAKE_PROFILE, 'matt'), FAKE_PROFILE, profileOpts), 'target under profile refused')
})
test('G2b. 合法 store 根下的 matt → 绿', () => {
  assert.equal(targetProblem(join(tmp, 'custom', 'matt'), join(tmp, 'custom'), profileOpts), null)
})
test('G2c. 目标名不是 matt → 红', () => {
  assert.match(String(targetProblem(join(tmp, 'custom', 'other'), join(tmp, 'custom'), profileOpts)), /'matt'/)
})
test('G2d. 目标越出 store 根 → 红', () => {
  assert.ok(targetProblem(join(tmp, 'elsewhere', 'matt'), join(tmp, 'custom'), profileOpts))
})

test('G3. CLI 拒绝 DSH_HOME=用户 profile，且一个文件都不写', () => {
  const fake = join(tmp, 'cli-profile')
  mkdirSync(fake, { recursive: true })
  const r = run(['install', '--profile', 'web'], { DSH_HOME: fake, USERPROFILE: fake })
  assert.notEqual(r.status, 0, `expected non-zero, got ${r.status}: ${r.stderr}`)
  assert.match(`${r.stdout ?? ''}${r.stderr ?? ''}`, /user profile|ancestor|refusing/i)
  assert.deepEqual(readdirSync(fake), [], 'installer wrote into the user-profile-shaped home')
})

test('G4. CLI 拒绝 --root 缺值（旧实现静默回落真实 home）', () => {
  const r = run(['install', '--root'], { DSH_HOME: join(tmp, 'unused-home'), USERPROFILE: FAKE_PROFILE })
  assert.notEqual(r.status, 0, `expected non-zero, got ${r.status}`)
  assert.match(`${r.stdout ?? ''}${r.stderr ?? ''}`, /requires a value/i)
})

test('G5. CLI 拒绝覆盖/删除别人的非空 <store>/matt，文件原样', () => {
  const store = join(tmp, 'foreign-store')
  const target = join(store, 'matt')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'keep.txt'), 'keep')
  const env = { DSH_HOME: join(tmp, 'unused-home'), USERPROFILE: FAKE_PROFILE }
  const forced = run(['install', '--profile', 'web', '--force', '--root', store], env)
  assert.notEqual(forced.status, 0, 'install --force must refuse a foreign target')
  assert.match(`${forced.stdout ?? ''}${forced.stderr ?? ''}`, /refusing to wipe|does not look like/i)
  assert.ok(existsSync(join(target, 'keep.txt')), 'foreign file was deleted by install --force')
  const uninstall = run(['uninstall', '--root', store], env)
  assert.notEqual(uninstall.status, 0, 'uninstall must refuse a foreign target')
  assert.match(`${uninstall.stdout ?? ''}${uninstall.stderr ?? ''}`, /refusing to delete|does not look like/i)
  assert.ok(existsSync(join(target, 'keep.txt')), 'foreign file was deleted by uninstall')
})

test('G6. 正常 --root 安装 + uninstall 闭环不被守卫误伤', () => {
  const store = join(tmp, 'ok-store')
  const env = { DSH_HOME: join(tmp, 'unused-home'), USERPROFILE: FAKE_PROFILE }
  const install = run(['install', '--root', store], env)
  assert.equal(install.status, 0, `install failed: ${install.stderr}`)
  assert.ok(existsSync(join(store, 'matt', 'VERSION.json')), 'store stamp missing after install')
  const uninstall = run(['uninstall', '--root', store], env)
  assert.equal(uninstall.status, 0, `uninstall failed: ${uninstall.stderr}`)
  assert.ok(!existsSync(join(store, 'matt')), 'store survived uninstall')
})

console.log(`\n${process.exitCode ? 'FAILED' : `all ${passed} tests passed`}`)
if (process.exitCode) console.log(`tmp kept: ${tmp}`)
else rmSync(tmp, { recursive: true, force: true })
