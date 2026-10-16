/**
 * verify-privacy-scan.mjs —— `scripts/privacy-scan.mjs` 守卫的非空洞验收
 * （#79 隐私回仓 retro 落地；口径与邻仓 `dsh-shell-host/tests/privacy-scan.spec.ts` 对齐）。
 *
 * 非空洞口径：每条断言都能说出红场景——F2–F8 与 F14–F15 是**植入夹具**的真 git 仓库
 * （把身份 / 布局 / denylist token 放进文件、提交消息、身份、ref 各面），F10 是**常驻守卫**：
 * 真实仓里一旦有人提交个人 / 本机环境串，这一行就红（本会话前车之鉴：77 个提交带个人路径，
 * 无人拦）。F14 用**运行时身份**（`homedir()` / `userInfo().username`）构造夹具，换台机器照样有效。
 *
 * 夹具是临时真仓库，用完即删（本仓有临时目录泄漏的教训 #77：不清理的挂具不写）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, denylistPath, denylistTokens, identityTokens, scanRepo, scanTrackerItems } from '../scripts/privacy-scan.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const fixtures = []
/** 造一个真 git 仓库夹具（一次提交；可选分支名/身份/消息）。 */
function fixture({ files = {}, message = 'fixture', name = 'Fixture Author', email = 'fixture@example.com', branch } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-privacy-'))
  fixtures.push(root)
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
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
} finally {
  disposeAll()
}

console.log('\n=== PRIVACY-SCAN VERIFY (F1–F15) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)