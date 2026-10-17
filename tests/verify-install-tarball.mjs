/**
 * verify-install-tarball.mjs — tarball 解包的**越界**契约（T1–T4）。
 *
 * Why: `bin/install.mjs` 的 `extractTarball` 只为 `--from <tarball>` 用，但 `--from` 也接受
 * **外部** tgz（不是只有自家 `npm pack` 的产物）。原过滤 `!full.split('/').includes('..')`
 * 只认 `/` 分隔：伪造归档把名字写成 `..\..\x` 时，Windows 上 `join(dest, '..\\..\\x')`
 * 会规整**逃出 dest**（同族机械面见邻仓 #91：只过滤 ''/'.'/'..' 是不够的）。本仓还缺
 * 「规整后仍在 dest 内」的兜底校验。
 *
 *   T1 良性条目照常解出（加固不得把正常归档弄坏）
 *   T2 反斜杠 `..` 条目**不得**在 dest 之外落文件 —— 修前红（实测会写出去）
 *   T3 `/` 形式 `..` 条目同样不落（已有行为的 pin）
 *   T4 不变量：探测根下**所有**新建文件都在 dest 内
 *
 * 用手工构造的最小 tar（不依赖宿主 tar 方言）+ gzip，直接调导出的 `extractTarball`。
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { extractTarball } from '../bin/install.mjs'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

/** 最小 tar 条目：512B 头（含校验和）+ 数据 + 512 对齐填充。 */
const tarEntry = (name, text) => {
  const data = Buffer.from(text)
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8)
  header.write('0000000\0', 108, 8)
  header.write('0000000\0', 116, 8)
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12)
  header.write('00000000000\0', 136, 12)
  header.write('        ', 148, 8) // 校验和先占位
  header.write('0', 156, 1)
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([header, data, pad])
}

/** 探测根下除 `dest` 外新建了哪些文件（返回相对路径列表）。 */
const filesOutside = async (root, dest) => {
  const out = []
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { await walk(p); continue }
      const rel = relative(root, p)
      if (resolve(p) !== resolve(dest) && !resolve(p).startsWith(resolve(dest) + sep)) out.push(rel)
    }
  }
  await walk(root)
  return out
}

const root = await mkdtemp(join(tmpdir(), 'dsh-tarball-probe-'))
try {
  const tgz = join(root, 'evil.tgz')
  await writeFile(tgz, gzipSync(Buffer.concat([
    tarEntry('package/agent.cordis.yml', 'name: probe\n'),
    tarEntry('..\\..\\dsh-escape-bs.txt', 'pwn\n'),
    tarEntry('package/../../dsh-escape-slash.txt', 'pwn\n'),
    Buffer.alloc(1024), // 结束块
  ])))

  // dest 放在 root 下第三层：`..\..`（反斜杠）与 `package/../..`（斜杠）两种逃逸都会落在
  // root 之内、dest 之外 —— 这样越界文件对下面的巡检可见（若 dest 只有一层，逃逸会落到
  // root 之外，巡检反而看不见，测试就成了假绿）。
  const dest = join(root, 'store', 'work')
  await mkdir(dest, { recursive: true })
  await extractTarball(tgz, dest)

  // T1：良性条目照常解出。
  const benign = join(dest, 'package', 'agent.cordis.yml')
  if (existsSync(benign) && (await readFile(benign, 'utf8')).includes('probe')) {
    ok('T1. 良性条目照常解出（package/agent.cordis.yml）')
  } else {
    bad('T1. 良性条目丢失', benign)
  }

  const outside = await filesOutside(root, dest)
  const outsideReal = outside.filter(p => !p.startsWith('evil.tgz'))

  // T2：反斜杠 `..` 越界。（修前：`join(dest, '..\\..\\x')` 会规整逃出 dest）
  const bs = outsideReal.filter(p => p.includes('dsh-escape-bs.txt'))
  if (bs.length === 0) ok('T2. 反斜杠 `..` 条目未在 dest 之外落文件')
  else bad('T2. 反斜杠 `..` 逃出 dest', bs.join(', '))

  // T3：`/` 形式 `..`（pin 既有行为）。
  const sl = outsideReal.filter(p => p.includes('dsh-escape-slash.txt'))
  if (sl.length === 0) ok('T3. `/` 形式 `..` 条目未在 dest 之外落文件（既有行为 pin）')
  else bad('T3. `/` 形式 `..` 逃出 dest', sl.join(', '))

  // T4：不变量 —— 探测根下除输入 tgz 外，所有新建文件都在 dest 内。
  if (outsideReal.length === 0) ok('T4. 探测根下所有新建文件都在 dest 内')
  else bad('T4. dest 之外出现文件', outsideReal.join(', '))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('\n=== INSTALL TARBALL VERIFY (T1–T4) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)