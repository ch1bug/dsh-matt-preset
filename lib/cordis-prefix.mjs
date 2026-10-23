/**
 * 从仓内 composition 提取 persona prefix（inline 或六空格 block）。
 * 这是既有挂具的行式提取约定，不是通用 YAML 解析器；行尾统一为 LF。
 */
export function personaPrefix(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(line => /^\s*prefix:/.test(line))
  if (start < 0) throw new Error('composition has no `prefix:` block')
  const inline = lines[start].match(/^\s*prefix:\s*(.*)$/)?.[1]
  if (inline !== undefined && inline !== '|') return inline
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}
