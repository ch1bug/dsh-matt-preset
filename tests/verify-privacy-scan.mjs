/**
 * verify-privacy-scan.mjs —— `scripts/privacy-scan.mjs` 守卫的非空洞验收
 * （#79 隐私回仓 retro 落地；口径与邻仓 `dsh-shell-host/tests/privacy-scan.spec.ts` 对齐）。
 *
 * 非空洞口径：每条断言都能说出红场景——F2–F8 与 F14–F18 是**植入夹具**的真 git 仓库
 * （把身份 / 布局 / denylist token 放进文件、提交消息、身份、ref 各面），F10 是**常驻守卫**：
 * 真实仓里一旦有人提交个人 / 本机环境串，这一行就红（本会话前车之鉴：77 个提交带个人路径，
 * 无人拦）。F14 用**运行时身份**（`homedir()` / `userInfo().username`）构造夹具，换台机器照样有效。
 * F16–F18 是 **#107 扩的那条规则**（本机安装布局）的三面：红场景（票面原字的形态，含带空格的
 * 目录段）/ 豁免面（标准安装点与占位符不被误伤）/ 边界（URL、相对路径、仅盘符根不误报）。
 *
 * 夹具是临时真仓库，用完即删（本仓有临时目录泄漏的教训 #77：不清理的挂具不写）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, denylistPath, denylistTokens, identityTokens, scanRepo, scanTrackerItems } from '../scripts/privacy-scan.mjs'
import { fixtureEnv } from './isolated-git.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const fixtures = []
/** 造一个真 git 仓库夹具（一次提交；可选分支名/身份/消息）。
 *  ⚠ git 调用走共享挂具 `tests/isolated-git.mjs`（#110）：本函数**自建仓**，若原样继承钩子导出的
 *  `GIT_DIR`，那句 `git init` 会打到**调用方仓**上、把共享 `.git/config` 的 `core.bare` 写成 `true`
 *  （实测 `.scratch/p110-privacy-canary.mjs`：`false → true`；这正是 #110 票面的病）。
 *  一律 `git -C <root>`、不用 `cwd:`（本机 startup 脚本族会把子进程 cwd 静默复位）。 */
function fixture({ files = {}, message = 'fixture', name = 'Fixture Author', email = 'fixture@example.com', branch } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-privacy-'))
  fixtures.push(root)
  const env = fixtureEnv()
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env })
  git(['init', '-q'])
  // git 不能提交空树：没有夹具文件时放一个中性文件（只测消息/身份/ref 面）
  const entries = Object.entries(files)
  if (entries.length === 0) entries.push(['README.md', 'fixture\n'])
  for (const [path, content] of entries) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git(['add', '-A'])
  git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', message])
  if (branch !== undefined) git(['branch', branch])
  return root
}
const kindsOf = (findings, surface) => findings.filter(f => f.surface === surface).map(f => f.kind)
const disposeAll = () => { for (const root of fixtures) rmSync(root, { recursive: true, force: true }) }
const term = (value, kind = KINDS.denylist) => ({ kind, value })

try {
  // F1 净夹具：占位符、白名单容器路径、运行期派生形态 → 无命中
  {
    const root = fixture({ files: {
      'docs/guide.md': '安装：`$HOME/dsh-matt-src`（msys 侧）或 `%USERPROFILE%\\.dsh`（Windows 侧）\n',
      'container/Dockerfile': 'WORKDIR /home/agent/workspace\n',
      'scripts/env.sh': 'WINHOME=/c/Users/$(whoami)\n',
    } })
    const { findings, surfaces } = scanRepo({ root, tokens: [] })
    if (findings.length === 0 && surfaces.files === 3) ok('F1. 占位符 / 白名单容器路径 / $(whoami) → clean', `files=${surfaces.files}`)
    else bad('F1. clean fixture', JSON.stringify(findings))
  }

  // F2 植入字面家目录 → 命中 + **整行打码**（不回显身份）
  {
    const root = fixture({ files: { 'docs/note.md': '部署副本在 /home/someone/dsh-src（旧机）\n' } }) // pii-allow: 守卫自身的红场景夹具
    const { findings } = scanRepo({ root, tokens: [] })
    if (findings.some(f => f.kind === KINDS.homePath)) ok('F2. 字面家目录 → 命中（kind=' + KINDS.homePath + '）')
    else bad('F2. 字面家目录未命中', JSON.stringify(findings))
    if (!JSON.stringify(findings).includes('someone')) ok('F2b. 命中输出已打码（不回显身份）')
    else bad('F2b. 输出泄露身份', JSON.stringify(findings))
  }

  // F3 Windows 字面家目录
  {
    const root = fixture({ files: { 'docs/win.md': '凭据：C:\\Users\\someone\\.dsh\\.credentials.yaml\n' } }) // pii-allow: 守卫自身的红场景夹具
    const { findings } = scanRepo({ root, tokens: [] })
    if (kindsOf(findings, 'file').includes(KINDS.homePath)) ok('F3. X:\\Users\\<user> → 命中')
    else bad('F3. X:\\Users 未命中', JSON.stringify(findings))
  }

  // F4 denylist（外置、大小写不敏感）→ 命中且打码：夹具体现"字面量替换漏大小写变体"的教训
  {
    const root = fixture({ files: { 'README.md': '作者呼号 SecretName 出现在这里\n' } })
    const { findings } = scanRepo({ root, tokens: [term('secretname')] })
    const hit = findings.find(f => f.kind === KINDS.denylist)
    if (hit !== undefined && hit.text.includes('<redacted>')) ok('F4. denylist 大小写不敏感（SecretName ↔ secretname）→ 命中且打码')
    else bad('F4. denylist 未命中', JSON.stringify(findings))
  }

  // F5 行内 `pii-allow` 显式豁免 → 该行跳过
  {
    const root = fixture({ files: { 'docs/legacy.md': '历史副本 /home/someone/dsh-src  pii-allow: 迁移记录，见 docs/agents/privacy.md\n' } }) // pii-allow: 守卫自身的红场景夹具
    const { findings } = scanRepo({ root, tokens: [] })
    if (findings.length === 0) ok('F5. 行内 pii-allow 豁免生效（显式、可 review）')
    else bad('F5. pii-allow 未生效', JSON.stringify(findings))
  }

  // F6 提交消息面（真实教训：`git commit -m "… $HOME …"` 被 pwsh 展开成真实家目录）
  {
    const root = fixture({ message: 'note: secretname 之后再 retro' })
    const { findings } = scanRepo({ root, tokens: [term('secretname')] })
    if (kindsOf(findings, 'message').includes(KINDS.denylist)) ok('F6. 提交消息里的 denylist token → message 面命中')
    else bad('F6. 消息面未命中', JSON.stringify(findings))
  }

  // F7 提交身份面（真实教训：旧机用户名覆盖 130 个提交的身份，--replace-text 碰不到）
  {
    const root = fixture({ name: 'SecretName', email: 'secretname@example.com' })
    const { findings } = scanRepo({ root, tokens: [term('secretname')] })
    if (kindsOf(findings, 'identity').includes(KINDS.denylist)) ok('F7. 提交身份里的 token → identity 面命中')
    else bad('F7. 身份面未命中', JSON.stringify(findings))
  }

  // F8 ref 名面
  {
    const root = fixture({ branch: 'secretname-wip' })
    const { findings } = scanRepo({ root, tokens: [term('secretname')] })
    if (kindsOf(findings, 'ref').includes(KINDS.denylist)) ok('F8. 分支名里的 token → ref 面命中')
    else bad('F8. ref 面未命中', JSON.stringify(findings))
  }

  // F9 denylist 解析：注释与空行不算 token
  {
    const root = mkdtempSync(join(tmpdir(), 'dsh-privacy-denylist-'))
    fixtures.push(root)
    const file = join(root, 'denylist.txt')
    writeFileSync(file, '# 注释行\n\nsecretname\n   spaced-token  \n')
    const { tokens, source } = denylistTokens(file)
    const values = tokens.map(t => t.value)
    if (source === file && values.length === 2 && values[0] === 'secretname' && values[1] === 'spaced-token')
      ok('F9. denylist 解析：注释/空行剔除、首尾空白裁剪', values.join(','))
    else bad('F9. denylist 解析', JSON.stringify(values))
  }

  // F10 常驻守卫：真实仓 + 真实 denylist + 运行时身份 → 必须 clean
  {
    const { tokens, source } = denylistTokens(denylistPath())
    const all = [...tokens, ...identityTokens()]
    const { findings, surfaces } = scanRepo({ root: REPO, tokens: all })
    if (findings.length === 0)
      ok('F10. 真实仓（发布面全扫）→ clean', `denylist=${source === null ? '缺席' : tokens.length} files=${surfaces.files} messages=${surfaces.messages} identities=${surfaces.identities} refs=${surfaces.refs}`)
    else bad('F10. 真实仓有命中', JSON.stringify(findings.slice(0, 5)))
  }

  // F11 CLI 端到端：植入夹具 → exit 1；净夹具 → exit 0
  {
    const dirty = fixture({ files: { 'docs/x.md': '副本 /home/someone/dsh-src\n' } }) // pii-allow: CLI 红场景夹具
    const clean = fixture({ files: { 'docs/x.md': '副本 $HOME/dsh-matt-src\n' } })
    const run = (root) => {
      try {
        execFileSync(process.execPath, [join(REPO, 'scripts', 'privacy-scan.mjs'), '--root', root, '--verbose'], { encoding: 'utf8' })
        return 0
      } catch (error) { return error.status ?? 1 }
    }
    const dirtyCode = run(dirty)
    const cleanCode = run(clean)
    if (dirtyCode === 1 && cleanCode === 0) ok('F11. CLI 退出码：有命中=1、净=0（--verbose 可用）')
    else bad('F11. CLI 退出码', `dirty=${dirtyCode} clean=${cleanCode}`)
  }

  // F12 轨迹面判定（**纯函数**，离线可测）：gh 只是取件薄壳
  {
    const hi = scanTrackerItems([
      { surface: 'issue', id: '#9', text: '旧机副本 /home/someone/dsh-src' }, // pii-allow: 守卫自身的红场景夹具
      { surface: 'comment', id: 'comment 1 (#9)', text: '正文里提到 secretname 就命中' },
    ], { tokens: [term('secretname')] })
    const kinds = hi.map(f => `${f.surface}:${f.kind}`).sort().join(',')
    if (kinds === `comment:${KINDS.denylist},issue:${KINDS.homePath}`) ok('F12. 轨迹面：issue 正文命中结构规则、评论命中 denylist', kinds)
    else bad('F12. 轨迹面判定', JSON.stringify(hi))
  }

  // F13 结构规则的假阳性面：省略号缩写与通用段不是身份（红场景＝真用户名，见 F2/F3）
  {
    const root = fixture({ files: {
      'docs/abbrev.md': '本体已无 `file:///C:/Users/...` 这类硬编码\nWindows 示例：C:\\Users\\name\\.dsh\n占位符写法：C:/Users/x、C:\\Users\\u、/home/me、/home/alice\n',
    } })
    const { findings } = scanRepo({ root, tokens: [] })
    if (findings.length === 0) ok('F13. `C:/Users/...`（省略号）、通用段与邻仓占位符（x/u/me/alice）→ clean')
    else bad('F13. 假阳性', JSON.stringify(findings))
  }

  // F14 **本机运行时身份**（对齐邻仓口径）：换台机器也有效——夹具用运行时取到的家目录/用户名
  {
    const home = homedir()
    const user = userInfo().username
    const root = fixture({ files: { 'docs/me.md': `本机 home: ${home}\n本机 user: ${user}\n` } })
    const { findings } = scanRepo({ root, tokens: identityTokens() })
    const kinds = new Set(findings.map(f => f.kind))
    if (kinds.has(KINDS.homeDir) && kinds.has(KINDS.userName)) ok('F14. 运行时身份（homedir + username）→ 命中（不写死名单）', [...kinds].join(','))
    else bad('F14. 运行时身份未命中', JSON.stringify(findings))
  }

  // F15 本机布局形态（对齐邻仓口径）：X:\dsh-* 与 /x/dsh-*
  {
    const root = fixture({ files: { 'docs/layout.md': '旧检出 D:\\dsh-old\\src 与 /c/dsh-old 都在历史里\n' } }) // pii-allow: 守卫自身的红场景夹具
    const { findings } = scanRepo({ root, tokens: [] })
    const kinds = new Set(findings.map(f => f.kind))
    if (kinds.has(KINDS.layoutWin) && kinds.has(KINDS.layoutPosix)) ok('F15. 布局形态 X:\\dsh-* 与 /x/dsh-* → 命中', [...kinds].join(','))
    else bad('F15. 布局形态未命中', JSON.stringify(findings))
  }

  // F16 **本机安装布局**（#107 扩的那条规则）：票面的真实形态逐条报红 + 整段打码。
  // 红场景就是票面本体（`scripts/msys-env.sh` 修掉的那 3 行）——把它们的**原始字面形态**
  // 放进夹具，规则若被删掉/收窄（如目录段不许空格）**这一条必红**。
  // ⚠ 夹具里**故意**同时放标准根与自定义根：这不是装饰，是**口径本身**（human 2026-10-18 拍 Q3=A）
  // —— 生态标准根（`Program Files`）**豁免**、本机自定义根（`Other_Program_Files`）**命中**。
  // 两者同处一个 fixture，F16 才同时钉住"规则活着"与"豁免面没被顺手删掉"。
  {
    const root = fixture({ files: { 'scripts/env.sh': [
      'PREFIX=""',
      'for d in \\',
      '  "/c/Program Files/nodejs" \\', // pii-allow: 守卫自身的红场景夹具（票面原字形态）
      '  "/c/Other_Program_Files/Git/cmd" \\', // pii-allow: 同上（本机自定义安装根）
      'do [ -d "$d" ] && PREFIX="$PREFIX$d:"; done',
    ].join('\n') + '\n' } })
    const { findings } = scanRepo({ root, tokens: [] })
    const hits = findings.filter(f => f.kind === KINDS.installRoot)
    // 自定义根那一行必须红；标准根那一行必须**不**红（同 fixture 内的双向判据）
    const hitLines = new Set(hits.map(h => h.line))
    if (hitLines.has(4) && !hitLines.has(3))
      ok('F16. 本机安装布局：自定义安装根命中 / 生态标准根（带空格目录段）豁免', `installRoot 命中行=${[...hitLines].join(',')}`)
    else bad('F16. 本机安装布局判据不符（规则被删？豁免面被删？目录段收窄到不含空格？）', JSON.stringify(findings))
    // ⚠ 上面那句**证明不了**"带空格的目录段仍被规则认得"：把目录段的字符类收窄到不含空格后，
    // `Program Files` 压根不再匹配——可它在豁免面里，于是**不红也不绿，两种原因都让 `has(3)===false`**
    // （本探针实测：P2 扰动下 F16 仍绿 —— 这正是 D2「锁是空的」）。故**另加一条直接判据**：
    // 让规则**只**在"真的匹配到了带空格目录段"时才可能命中：把同一形态放进**非豁免**的目录名变体
    // （`Program Files 2`），它必须命中。这一条能区分"匹配了但被豁免"与"根本没匹配"。
    {
      const probeRoot = fixture({ files: { 'docs/spaced.md': '安装根变体：C:\\Other Program Files 2\\bin\\x.exe\n' } }) // pii-allow: 守卫自身的红场景夹具（带空格且非豁免）
      const spaced = scanRepo({ root: probeRoot, tokens: [] }).findings.filter(f => f.kind === KINDS.installRoot)
      if (spaced.length > 0) ok('F16c. 目录段**允许空格**（非豁免的带空格形态 → 命中；区分"被豁免"与"没匹配")', spaced.length + ' 行')
      else bad('F16c. 带空格的目录段未被规则匹配（字符类丢了空格？）', '期望命中，实际 0 行')
    }
    // 打码判据：**不得**泄露安装根名的任何**前缀**。只查整串会漏掉"截尾"式的部分泄露
    // （实测：按尾段截的退化形态输出 `/c/Ot<redacted>it/cmd` —— 整串不在，前缀却在）。
    if (hits.length > 0 && !/Ot/.test(hits.map(h => h.text).join('\n'))) ok('F16b. 命中输出已整段打码（不泄露安装根名的任何前缀）')
    else bad('F16b. 输出泄露安装根名（前缀或整串）', JSON.stringify(hits))
  }

  // F17 扩规则的**豁免面**（不误伤）：标准安装点 / OS 面 / 占位符 / 安全反例 → clean。
  // ⚠ 这里**绝不能**给夹具行加 `pii-allow`：那会让整行被跳过，于是"clean"来自豁免标记而**不是**
  // 来自豁免面——本行就退化成同义反复（本仓 D2 的"锁是空的"）。它 clean 的唯一合法理由是
  // `ALLOWED_INSTALL_ROOTS` 真的放行了这些形态；拿掉表里任一项（如 `program files`）本行即红。
  {
    const root = fixture({ files: { 'docs/ports.md': [
      'msys2 标准点：C:/msys64/usr/bin/bash.exe 与 /c/msys64/home/<user>',
      '生态标准根：C:\\Program Files\\Git\\cmd（Windows 上人人都有这个）',
      'OS 面：C:\\WINDOWS\\system32\\bash.exe',
      '占位符：link:C:/x/matt',
      '安全反例（前缀比较会放过它）：C:\\Temp\\..\\..\\Users',
    ].join('\n') + '\n' } })
    const { findings } = scanRepo({ root, tokens: [] })
    if (findings.length === 0) ok('F17. 豁免面：标准安装点 / OS / 占位符 / 安全反例 → clean')
    else bad('F17. 豁免面被误伤', JSON.stringify(findings))
  }

  // F18 扩规则的**假阳性边界**：它不是"任何绝对路径"。URL / 相对路径 / 仅盘符根 / 正则字面量
  // → clean（守卫不能变成噪音源——噪音源的下场是本仓 D13 记的"加宽正则 → 绕一层就过"）。
  // 同 F17：**不加** `pii-allow`，否则 clean 是标记给的、不是判据给的。
  {
    const root = fixture({ files: { 'docs/edges.md': [
      'URL：https://example.com/a/b 与 ./scripts/msys-env.sh',
      '仅盘符根：C:\\',
      '正则字面量：/[A-Za-z]:[\\\\/]Users/g',
    ].join('\n') + '\n' } })
    const { findings } = scanRepo({ root, tokens: [] })
    const installHits = findings.filter(f => f.kind === KINDS.installRoot)
    if (installHits.length === 0) ok('F18. 边界：URL / 相对路径 / 仅盘符根 / 正则字面量 → 无 installRoot 命中')
    else bad('F18. 假阳性', JSON.stringify(installHits))
  }
} finally {
  disposeAll()
}

console.log('\n=== PRIVACY-SCAN VERIFY (F1–F18) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)