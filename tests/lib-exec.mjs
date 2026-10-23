/** #134：测试工具的唯一可执行解析入口；不复用产品运行时探测语义。 */
import { existsSync } from 'node:fs'
import { win32, posix } from 'node:path'

export function testExecutable(tool, {
  npmPath,
  args = [],
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (tool === 'node') return { command: execPath, args: [...args], shell: false }
  if (tool !== 'npm') throw new Error(`Unsupported test executable: ${tool}`)
  const path = platform === 'win32' ? win32 : posix
  const nodeDir = path.dirname(execPath)
  const onPath = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(p => path.isAbsolute(p))
  const candidates = npmPath !== undefined ? [npmPath] : [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, platform === 'win32' ? 'npm.cmd' : 'npm'),
    ...onPath.map(p => path.join(p, platform === 'win32' ? 'npm.cmd' : 'npm')),
  ]
  const resolved = candidates.find(p => path.isAbsolute(p) && exists(p))
  if (!resolved) throw new Error(`Test executable npm not found${npmPath !== undefined ? ' at explicit path' : ' beside Node or on absolute PATH entries'}`)
  if (/\.[cm]?js$/i.test(resolved)) return { command: execPath, args: [resolved, ...args], shell: false }
  const shell = platform === 'win32' && /\.cmd$/i.test(resolved)
  // shell:true不会替调用者转义。CMD中的展开字符不尝试猜测转义，响亮拒绝；
  // 普通路径/参数整体加引号，空格与&等元字符不再拆分成命令。
  const quote = value => {
    if (/[\r\n"%!]/.test(value)) throw new Error('Unsafe CMD test executable argument')
    // Node/CRT把闭引号前的反斜杠按转义解释；成对保留，避免吞掉下一个argv。
    return `"${value.replace(/\\+$/, slashes => slashes + slashes)}"`
  }
  return { command: shell ? quote(resolved) : resolved, args: shell ? args.map(quote) : [...args], shell }
}
