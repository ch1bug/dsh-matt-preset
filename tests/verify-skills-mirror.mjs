/**
 * verify-skills-mirror.mjs —— 技能镜像完整性检查（#63 的本地守卫）。
 *
 * 背景：#63 实测 `scripts/sync-skills.ps1` 在 Windows PowerShell 5.1 下按 ANSI
 * 读写，把含非 ASCII 的技能写成**非法 UTF-8**，技能加载器随即拒绝该技能，模型侧
 * `skill` 工具报 `unknown or no longer available`（37 个里 11 个不可用，含
 * writing-for-agents / tdd / code-review / grilling）。本用例把该故障变成**本地可见**：
 * 镜像坏了就红，而不是等模型加载失败。
 *
 * 断言：
 *   M1 每个 <mirror>/<name>/SKILL.md 严格 UTF-8 可解码（无 `?` 置换 / ANSI 字节）
 *   M2 前言可被 YAML 解析、含 name + description、且 name 与目录名一致
 *   M3 回归守卫：sync-skills.ps1 不得再出现未指定编码的 Get-Content/Set-Content
 *
 * 门禁：镜像目录不存在时响亮跳过（默认取 $DSH_HOME/skills 或 ~/.dsh/skills）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mirror = process.env.DSH_SKILLS_MIRROR
  ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'skills')

const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

// M3 先做：不依赖镜像在场，是纯静态守卫（#63 的回归锁）
{
  const script = join(REPO, 'scripts', 'sync-skills.ps1')
  const text = readFileSync(script, 'utf8')
  const offenders = text
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /^(Get-Content|Set-Content|Out-File)\b/.test(line) && !/-Encoding\b/.test(line))
  if (offenders.length === 0) ok('M3. sync-skills.ps1 无未指定编码的 Get-Content/Set-Content（#63 回归锁）')
  else bad('M3. sync-skills.ps1 编码回归', offenders.map(o => `${o.n}: ${o.line}`).join(' | '))
}

if (!existsSync(mirror)) {
  console.warn(
    `  !! SKIP (loud) - 技能镜像不存在：${mirror}\n` +
      '     （设 DSH_SKILLS_MIRROR 或 DSH_HOME 指向实际镜像；无镜像时本用例不阻塞常规套件）',
  )
} else {
  const names = readdirSync(mirror).filter(n => existsSync(join(mirror, n, 'SKILL.md')))
  const decode = new TextDecoder('utf-8', { fatal: true })
  const badEncoding = []
  const badFrontmatter = []
  for (const name of names) {
    const file = join(mirror, name, 'SKILL.md')
    const bytes = readFileSync(file)
    let text
    try {
      text = decode.decode(bytes)
    } catch {
      // 给出可诊断的字节位置，而不是只说"不是 UTF-8"
      let at = -1
      for (let i = 0; i < bytes.length; i++) {
        try { decode.decode(bytes.subarray(i, i + 1)); continue } catch { at = i; break }
      }
      badEncoding.push(`${name}@byte ${at} (0x${bytes[Math.max(0, at)].toString(16)})`)
      continue
    }
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (m === null) { badFrontmatter.push(`${name}: 无前言`); continue }
    try {
      const head = parseYaml(m[1]) ?? {}
      if (head.name !== name) badFrontmatter.push(`${name}: name=${JSON.stringify(head.name)}`)
      else if (typeof head.description !== 'string' || head.description.trim() === '') badFrontmatter.push(`${name}: 缺 description`)
    } catch (error) {
      badFrontmatter.push(`${name}: yaml ${String(error.message).slice(0, 40)}`)
    }
  }
  if (names.length === 0) bad('M1. 镜像里没有可用技能', mirror)
  else if (badEncoding.length === 0) ok(`M1. ${names.length} 个 SKILL.md 全部严格 UTF-8 合法`)
  else bad('M1. 非法 UTF-8 技能（加载器会拒绝 → skill 工具报 unknown）', badEncoding.join(', '))
  if (badFrontmatter.length === 0) ok('M2. 前言全部可解析、name 与目录一致、含 description')
  else bad('M2. 前言问题', badFrontmatter.join(', '))
}

console.log('\n=== SKILLS MIRROR VERIFY ===')
console.log(`mirror: ${mirror}`)
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)