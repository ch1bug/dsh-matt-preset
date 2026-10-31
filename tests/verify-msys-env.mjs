/**
 * verify-msys-env.mjs —— `scripts/msys-env.sh` 的**输入契约**守卫（M1–M6；#107）。
 *
 * 为什么存在：该脚本此前把**本机安装布局**写死在里面（`/c/<标准根>/nodejs` 一族——
 * 字面形态按 #120 口径 B 也不再复述；票面点名的四条 + 一条 triage 漏掉的厂商目录）
 * —— 本仓是 PUBLIC 仓，那些字面量**在 origin/main 上**
 * （#107 复验：远端文件与本地逐字节一致）。脱敏的形态是：安装根改为**可覆盖的输入契约**，
 * 缺输入时**响亮说明并跳过那一项**。但"脱敏"这个动作本身极容易**退化**：
 *   · 有人图省事把某一根重新写死（回到本票要治的形态）；
 *   · 或者把"响亮说明"删掉，于是缺输入变成**静默不生效**（D47：防线缺席必须响亮）。
 * 两种退化都**不会**让任何既有用例变红 —— 故需要本守卫。
 *
 * 判据（关键）：**真跑脚本**，不读措辞。`bash -n` 只证"能解析"，证不了语义（票面 AC2 的
 * "响亮"与"不静默用错路径"都在语义面）。故本用例在临时目录里**现搭假安装根**（真目录/真文件），
 * 用 `env` 清空继承面后 source 脚本，断言**可观测后果**（PATH 前缀 / GIT_CONFIG_SYSTEM / stderr）。
 *
 * 非空洞（**实测记录**，2026-10-18，探针 `.scratch/p107-msys-nonempty.mjs`）：
 *   ① 标准根重新写死 → **M1 真红**（红 M1/M2/M4）；
 *   ② 删掉一条响亮说明 → **M2 真红**（红 M2/M3/M4/M5）；
 *   ③ 缺输入时静默猜一条路径 → **M2 真红**（红 M2/M4）；
 *   ④ 非标准根不再拼进 PATH → **M3 真红**；⑤ 丢掉 `PROGRAMFILES` 形 → **M4 真红**；
 *   ⑥ 脚本改写 `HOME` → **M6 真红**。每条扰动后**副本回写**还原、复跑确认恢复绿。
 * 扰动只发生在 `os.tmpdir()` 的**副本**上，真树零改动；还原用**副本回写**（#108 纪律：
 * 禁用 `git checkout --` / `git restore` 作还原手段）。
 *
 * ⚠ **本用例自身的四个环境坑**（都实测踩过，写在这里是让改它的人别再踩）：
 *   ① `bash` 的**能力**比"存不存在"重要 —— `C:\Windows\System32\bash.exe` 是 WSL bash，
 *      丢弃继承 env、看不见 Windows 路径，用它跑会**静默全绿/全空**（D47 形态）。故做能力探测；
 *   ② 路径判据要**归一化分隔符**（`path.join` 给 `\`、脚本内拼接给 `/`，字面比较会假红）；
 *      且**不能** `split(':')` 无脑切 Windows 路径（`C:\` 里的冒号会被切碎）；
 *   ③ `ADDED` 必须以**哨兵**为界取前缀 —— `PATH%%<基 PATH>*` 要求逐字节相等，bash 会归一化 PATH，
 *      匹配不上就返回**整条 PATH**（钩子上下文实测到的假红）；
 *   ④ 期望路径要**让 bash 自己翻**（`cygpath`）：msys 下 `os.tmpdir()` 是 `C:\msys64\tmp\...`，
 *      而 cygpath 把它翻成 `/tmp/...` —— 两条拼写指同一目录，只按 Node 侧形态比必然假红。
 *      同理，**只数契约自己的说明行**：环境里"找不到 gh"一类警告与输入契约无关，凑数会假红/假绿。
 *
 * 依赖面：只用 `bash`（msys 系）。找不到合格 bash 时 **loud skip**（M1 静态面仍跑）
 * —— 不把"缺环境"装成"通过"（与套件既有 loud-skip 惯例一致）。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'msys-env.sh')
const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const skip = (name, why) => results.push('  ⤼ SKIP (loud) ' + name + ' — ' + why)

/**
 * 找一个**真正可用于本用例**的 bash。判据不是"PATH 上有 bash"这种**存在性**，而是三条**能力**：
 *   ① 读得到仓里的脚本（Windows 盘符路径，或 `/mnt/<盘符>/...` 翻译形）；
 *   ② 尊重**继承的 env**（本用例全靠注入 `MSYS_ENV_WIN_*` / `PROGRAMFILES` 判契约）；
 *   ③ 尊重**继承的 PATH**（M2/M3/M4 的判据是"脚本 prepend 了哪一截"）。
 *
 * ⚠ 本机实测的坑（本用例前两版连续栽在这，都是 D47 的静默通过形态）：
 *   · `C:\Windows\System32\bash.exe` 是 **WSL bash** —— 看不见 `D:\...`，且**整个丢弃继承 env**
 *     （实测 `FOO=bar` 传不进去、PATH 也被重置成 WSL 自己的）。用它跑，全部断言拿到空读数，
 *     而**退出码仍是 0**（`. <读不到的路径>` 只往 stderr 写一行、rc 仍为 0）；
 *   · 只给 `PATH=/usr/bin:/bin` 的"干净 env"则连 bash 自身都找不到（`status` 变 **null**，
 *     既不是 0 也不是非 0 —— 断言静默全崩）。
 * 故：**能力探测**逐个试候选；都不行 → **loud skip**，绝不装成通过。
 */
function probeBash(candidate) {
  const canary = 'p107-canary'
  const env = { ...process.env, HOME: '/home/probe', PATH: `/probe-bin:${process.env.PATH ?? '/usr/bin:/bin'}` }
  env.P107_CANARY = canary
  const r = spawnSync(candidate, ['-c', 'echo "ENV=${P107_CANARY:-<none>}"; echo "PATHRUN=${PATH%%:*}"'], { encoding: 'utf8', env })
  if (r.status !== 0 || r.error !== undefined) return false
  const out = String(r.stdout ?? '')
  if (!out.includes(`ENV=${canary}`)) return false // ② 尊重继承 env
  if (!out.includes('PATHRUN=/probe-bin')) return false // ③ 尊重继承 PATH
  // ① 可达性（Windows 形态 或 /mnt 翻译形，任一即可）
  const asIs = spawnSync(candidate, ['-c', `test -r '${SCRIPT}' && echo YES`], { encoding: 'utf8' })
  if (String(asIs.stdout ?? '').includes('YES')) return SCRIPT
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(SCRIPT)
  if (m !== null) {
    const translated = `/mnt/${m[1].toLowerCase()}/${m[2].replaceAll('\\', '/')}`
    const viaMount = spawnSync(candidate, ['-c', `test -r '${translated}' && echo YES`], { encoding: 'utf8' })
    if (String(viaMount.stdout ?? '').includes('YES')) return translated
  }
  return false
}

/** 候选顺序：msys2 标准安装点（本用例的目标环境）→ Git 自带 msys → PATH 上的 → WSL（多半不过）。 */
const BASH_CANDIDATES = [
  'C:\\msys64\\usr\\bin\\bash.exe',
  'C:\\Other_Program_Files\\Git\\usr\\bin\\bash.exe',
  'bash',
  'C:\\Windows\\System32\\bash.exe',
]
let BASH
let SCRIPT_REF
for (const candidate of BASH_CANDIDATES) {
  const ref = probeBash(candidate)
  if (ref !== false) { BASH = candidate; SCRIPT_REF = ref; break }
}

if (BASH === undefined) {
  console.log('\n=== MSYS-ENV VERIFY (M1–M6) ===')
  // M1 是纯静态面（读文件内容），与 bash 能力无关 —— 单独跑，别让它被 skip 拖走
  const scriptText = readFileSync(SCRIPT, 'utf8')
  const executable = scriptText.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  const execOffenders = ['Other_Program_Files', 'Cadence', 'Program Files'].filter(t => executable.includes(t))
  if (execOffenders.length === 0) ok('M1. 脚本里无本机安装布局字面量（含票面未列的厂商目录 / Other_Program_Files）')
  else bad('M1. 本机安装布局字面量回到脚本里', execOffenders.join(','))
  skip('M2–M6', '没有可用的 msys 系 bash（候选都过不了"尊重 env + 尊重 PATH + 读得到脚本"三条能力探测）—— 语义面未验证')
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}
// 探针与夹具共用同一个根（`root()`），此处只留解析与比较的公共小工具。

/**
 * 路径比较统一走**去分隔符差**后的形态。
 * ⚠ 本机实测：`path.join` 产出的 Windows 形态带 `\`，而**脚本内部拼接**（`"$ROOT/cmd"`）
 * 用的是 `/` —— 只看字面串会把"机制完全正确"判成红（本用例第三版实测的假红）。
 */
const normPath = (s) => String(s).replaceAll('\\', '/').replace(/\/+$/, '')
/**
 * `ADDED` 的解析：取**哨兵之前**那一截，按 `:` 切段。
 * ⚠ 两个坑（本用例连续踩过）：
 *   · `%%<base>*` 截出来的串末尾**可能仍带基 PATH**（bash 对自定义 PATH 的归一化不保证逐字），
 *     故必须以**哨兵**为界取前缀，而不是假定"截出来就是纯净的 prepend 段"；
 *   · Windows 路径自带 `C:` 冒号，**不能**用 `split(':')` 无脑切 —— 先前把 `C:\...` 切成了
 *     `["C", "/Users/..."]` 两段（实测），于是比较必然不等、把正确的机制判成红。
 *     故按 `:` 切但**把"单字母后紧跟分隔符"的段重新粘回去**（盘符判据）。
 */
function addedSegments(added) {
  const cut = String(added).indexOf(SENTINEL)
  const head = cut === -1 ? String(added) : String(added).slice(0, cut)
  const parts = head.split(':').filter(s => s !== '')
  const segs = []
  for (const p of parts) {
    // 上一段是单个字母（盘符）→ 与当前段之间那个冒号是盘符冒号，粘回去
    if (segs.length > 0 && /^[A-Za-z]$/.test(segs[segs.length - 1])) segs[segs.length - 1] += `:${p}`
    else segs.push(p)
  }
  return segs.map(normPath)
}
/** 假安装根：`std`（标准根）+ `gitroot`（非标准根，含 cmd/ 与 etc/gitconfig）。
 *  **在 `rootInBash` 下建**（见那段注：夹具实体必须落在 bash 侧坐标系里）。 */

/**
 * source 一次脚本，取可观测后果。
 * `env` 的构造是**本用例最易写错的一处**，两个方向都要防：
 *   · **别太干净** —— 只给 HOME/PATH 会让 bash 起不来（Windows 需要 `SystemRoot` 一族），
 *     `status` 变 **null**、断言静默全崩；
 *   · **别太脏** —— 真机导出的 `PROGRAMFILES` / `MSYS_ENV_WIN_*` 会漏进"缺输入"的场景里，
 *     让 M2 假绿（那正是 #107 要治的"默认值静默生效"）。
 * 故：继承 OS 面，但**显式剥掉**本脚本读的每一个变量（与 verify-all 清测试缝同一手法）。
 */
const STRIP = [
  'MSYS_ENV_WIN_PROGRAM_FILES', 'MSYS_ENV_WIN_NODE_DIR', 'MSYS_ENV_WIN_GIT_ROOT',
  'ProgramFiles', 'PROGRAMFILES', 'PROGRAMW6432', 'ProgramW6432', 'ProgramFiles(x86)',
  'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'GH_CONFIG_DIR', 'COREPACK_HOME',
]

/**
 * 干净基 PATH：**只含一个可辨识的哨兵目录**。判据 = "脚本 prepend 了哪一截"（见 `probe`）。
 * ⚠ 不能继承真机的 PATH —— 它本身含真实安装根（WSL 挂载形下的 `/mnt/<盘符>/<标准根>/nodejs` 一族），
 * 会让"加了前缀"与"本来就有"不可区分（本用例第二版实测的假红）。
 * ⚠ 也不能只留 `/usr/bin:/bin` —— Windows 上 bash 靠继承的 PATH 才找得到（会把 bash 自身弄丢）。
 * 故：把哨兵放在**继承 PATH 之前**，脚本 prepend 的段就落在 `%` 截断出来的那截里。
 */
const SENTINEL = '/p107-baseline-sentinel'
const BASELINE_PATH = `${SENTINEL}:${process.env.PATH ?? '/usr/bin:/bin'}`

/**
 * msys bash 自己的 `/usr/bin` —— 它那套 coreutils（`mktemp` / `mkdir` / `cygpath` …）都在这里。
 * ⚠ 实测：agent shell 继承来的 PATH **不含**这些工具（`mktemp` 直接 command-not-found），
 * 而本用例要建夹具、要 source 脚本，都依赖那套工具。`BASH` 形如 `C:\msys64\usr\bin\bash.exe`，
 * 故其所在目录即 `/usr/bin`。
 */
const MSYS_USR_BIN = dirname(BASH).replaceAll('\\', '/')

/**
 * 夹具根：**由 bash 自己创建并报出** —— "夹具在哪"与"脚本看到哪"于是**按构造是同一个事实**。
 *
 * ⚠ 这是本用例最后一个坑，也是"只在 pre-commit 钩子上下文里红"的那一层（M4）。夹具原本由
 * Node 在 `os.tmpdir()` 下建，而**脚本的 bash 会拿 cygpath 把它再翻一次**；钩子上下文里
 * `TEMP` 是 POSIX 形，Node 于是把夹具建在**当前盘 + 那条 POSIX 路径**拼出来的位置，
 * 而脚本的 bash 用**它自己的** cygpath 又翻一次 —— 两边指向同一个目录，只是**拼写差一层**，
 * 而我把"拼写是否相等"当成了判据（连续几版都栽在这，故改走结构性解法）。
 *
 * ⇒ 结构性解法：夹具由**同一环境配置下的 bash** 建出并报出路径（`mktemp -d` + `pwd`），
 * Node 侧只把这串名字当路径用；探针的 bash 用**同一份 env**（同一个 `PATH` 起点、
 * 同一个 `HOME`）去 source 脚本 —— 两边的 `/tmp`、`/c` 映射于是同源，翻译几层都不进入判据。
 */
const BASH_ENV = { ...process.env, PATH: `${MSYS_USR_BIN}:${process.env.PATH ?? ''}`, HOME: '/home/probe' }
const bashMkFixture = () => {
  const r = spawnSync(BASH, ['-c', 'd=$(mktemp -d "${TMPDIR:-/tmp}/dsh-msys-env-XXXXXX") && mkdir -p "$d/std/nodejs" "$d/std/GitHub CLI" "$d/gitroot/cmd" "$d/gitroot/etc" && : > "$d/gitroot/etc/gitconfig" && printf "%s" "$d"'], { encoding: 'utf8', env: BASH_ENV })
  const out = String(r.stdout ?? '').trim()
  if (out === '' || r.status !== 0) return undefined
  return out
}

/** 夹具根（bash 自己报出的形态）。 */
const W_IN_BASH = bashMkFixture() ?? undefined
if (W_IN_BASH === undefined) {
  console.log('\n=== MSYS-ENV VERIFY (M1–M6) ===')
  const scriptText0 = readFileSync(SCRIPT, 'utf8')
  const exec0 = scriptText0.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  const off0 = ['Other_Program_Files', 'Cadence', 'Program Files'].filter(t => exec0.includes(t))
  if (off0.length === 0) ok('M1. 脚本里无本机安装布局字面量（含票面未列的厂商目录 / Other_Program_Files）')
  else bad('M1. 本机安装布局字面量回到脚本里', off0.join(','))
  skip('M2–M6', `${BASH} 建不出夹具（mktemp/mkdir 失败）—— 语义面未验证`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}
/**
 * 夹具内路径。
 * ⚠ **不能用 `path.join`**：夹具根是 POSIX 形（`/tmp/...`），而 `path.join` 在 Windows 上
 * 按 Win32 语义把连接符写成 `\` → `\tmp\x\gitroot\cmd`，msys bash 认不出来（实测 `test -d`
 * 恒 NO）。于是 M3/M4 的 `[ -d ]` 全失败、安装根留空，而契约其实没问题 —— 本用例第七个坑。
 */
const root = (name) => `${(W_IN_BASH ?? '').replace(/\/+$/, '')}/${name.replaceAll('\\', '/')}`
/** 夹具与探针同坐标系，路径无需再翻译（保留函数名是为了让调用点的语义可读）。 */
const scriptSees = (p) => p
function probe(script, extraEnv = {}) {
  const env = { ...BASH_ENV }
  for (const k of STRIP) delete env[k]
  env.HOME = '/home/probe' // 头注承诺"不覆盖 HOME"：给一个可辨认的值，M6 才能判
  // ⚠ **PATH 判据的坑（本用例第二版栽在这）**：不能靠"掐掉 `:/usr/bin*` 之后看剩下什么"——
  // 本机 WSL bash 的**继承 PATH 本身**就含真实安装根（WSL 挂载形下的 `/mnt/<盘符>/<标准根>/…`），
  // 于是"脚本加了前缀"与"PATH 本来就有那段"
  // **产生同样的读数**，M3/M4 全部假红。判据改为**前缀差分**：给一个**可辨识的干净基 PATH**，
  // 只回显"基 PATH 之前那一截"（脚本 prepend 的部分）。
  env.PATH = `${MSYS_USR_BIN}:${BASELINE_PATH}`
  Object.assign(env, extraEnv)
  const payload = [
    `. '${script}'`,
    'echo "SOURCE_RC=$?"',
    // 截到**哨兵**为止：哨兵是基 PATH 的第一个段，故"哨兵之前"就是脚本 prepend 的那一截。
    // ⚠ 用哨兵锚定而不是 `%%<基 PATH>*` —— 后者要求 PATH **逐字节**等于基 PATH，
    // 而 bash 对 PATH 有归一化（实测：msys 会在前面补 `/ucrt64/bin` 之类的自有段），
    // 一旦不一致，`%%` 就匹配不上、返回**整条 PATH**，断言随即假红（钩子上下文实测到的失败）。
    `echo "ADDED=\${PATH%%${SENTINEL}*}"`,
    'echo "SYSTEM=${GIT_CONFIG_SYSTEM:-<unset>}"',
  ].join('\n')
  const r = spawnSync(BASH, ['-c', payload], { encoding: 'utf8', env })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const rc = (out.match(/^SOURCE_RC=(.*)$/m) ?? [, '<none>'])[1].trim()
  // ⚠ **source 失败不算命令失败**：`. <path>` 读不到时 bash 只往 stderr 写一行、**rc 仍是 0**
  // （上文的 WSL 可达性坑就是这么骗过第一版的）。故把 rc 当**一等读数**带出去，由各断言判它 ——
  // 少了这一项，"脚本压根没跑到"与"脚本跑了且符合预期"在读数上不可区分。
  return {
    status: r.status,
    rc,
    // 脚本**实际前缀上去**的那一截（基 PATH 之前的部分）；空串 = 没加任何段
    path: (out.match(/^ADDED=(.*)$/m) ?? [, ''])[1].trim(),
    system: (out.match(/^SYSTEM=(.*)$/m) ?? [, '<unset>'])[1].trim(),
    stderr: out.split('\n').filter(l => l.startsWith('msys-env:')).join('\n'),
  }
}

const scriptText = readFileSync(SCRIPT, 'utf8')

try {
  // —— M1 静态面：本机安装布局字面量不在文件里 ——
  // 这一条与票面 AC1 同判据（那个 grep 是 AC 明文），但**不手抄 AC 的 grep 串**：
  // 逐个查"本机专属安装根"的形态，且**必须**含 `Other_Program_Files` 与厂商目录名这两个
  // 本票实测到的真实形态（只查 `Program Files` 会漏掉它们 —— 票面 triage 就漏了一个）。
  {
    const offenders = ['Other_Program_Files', 'Cadence'].filter(t => scriptText.includes(t))
    // `Program Files` 允许出现在**注释**里（说明用），但不允许出现在**可执行行**里
    const executable = scriptText.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
    const execOffenders = ['Other_Program_Files', 'Cadence', 'Program Files'].filter(t => executable.includes(t))
    if (offenders.length === 0 && execOffenders.length === 0)
      ok('M1. 脚本里无本机安装布局字面量（含票面未列的厂商目录 / Other_Program_Files）')
    else bad('M1. 本机安装布局字面量回到脚本里', `非注释面=${execOffenders.join(',')} 任意面=${offenders.join(',')}`)
  }

  // —— M2 全缺输入：响亮说明 + 不用任何猜出来的路径 + 留空 ——
  {
    const r = probe(SCRIPT_REF)
    // 只数**契约自己的**说明行（"找不到 gh" 一类与输入契约无关，不能拿来凑数）
    const CONTRACT = /(未设 MSYS_ENV_WIN_GIT_ROOT|推不出 Windows 标准安装根)/
    const loudLines = r.stderr.split('\n').filter(l => CONTRACT.test(l)).length
    // 缺输入时脚本仍会拼 `/ucrt64/bin` 与 `$HOME/.corepack/bin`（那是**固定**的、与本票无关），
    // 但**不得**拼任何安装根：判据 = ADDED 里不出现 `nodejs` / `GitHub CLI` / `Other_Program_Files`。
    const added = addedSegments(r.path)
    const noRoots = !added.some(s => /(nodejs|GitHub CLI|Other_Program_Files|Cadence)/i.test(s))
    if (r.rc === '0' && r.status === 0 && loudLines >= 2 && noRoots && r.system === '<unset>')
      ok('M2. 全缺输入 → 两条契约说明 + PATH 不拼任何安装根 + GIT_CONFIG_SYSTEM 不设', `契约行 ${loudLines}；prepend=[${added.join(' | ')}]`)
    else bad('M2. 缺输入的处置不符（静默？或猜了路径？或脚本没跑到？）', JSON.stringify({ rc: r.rc, added, system: r.system, loud: loudLines }))
  }

  // —— M3 非标准根：给了就用（拼上 cmd/ 且 GIT_CONFIG_SYSTEM 指向其 etc/gitconfig）——
  {
    const r = probe(SCRIPT_REF, { MSYS_ENV_WIN_GIT_ROOT: root('gitroot') })
    // ADDED 是"脚本 prepend 的那一截"（形如 `<假根>/cmd` + 固定的 `/ucrt64/bin`），故用**包含**判，
    // 而不是全等 —— 脚本还会拼 `/ucrt64/bin` 与 `$HOME/.corepack/bin`（那两段与本票无关）。
    // ⚠ 期望值与输入**同源**（都用 Node 侧形态）：**别让 cygpath 参与比较** ——
    // 它翻不翻、翻成什么，取决于那个 bash 的挂载面（`/c/...` 与 `/tmp/...` 可能是同一目录的
    // 两条拼写），而判据是"脚本有没有用上这个目录"，不是"翻译是否落回原位"。
    // 之前把输入交给 cygpath 翻，等于把这个判据建在"翻译可逆"上 —— 钩子上下文里 M3/M4 因此假红。
    const accept = [normPath(scriptSees(root(join('gitroot', 'cmd'))))]
    const acceptSys = [normPath(scriptSees(root(join('gitroot', 'etc', 'gitconfig'))))]
    if (r.rc === '0' && accept.some(a => normPath(r.path).includes(a)) && acceptSys.includes(normPath(r.system)))
      ok('M3. 给了非标准 git 根 → 真的用上（PATH + GIT_CONFIG_SYSTEM）')
    else bad('M3. 非标准根未被采用', JSON.stringify({ rc: r.rc, path: normPath(r.path).slice(0, 140), system: normPath(r.system), accept }))
  }

  // —— M4 标准根的**两条**来源：覆盖变量 / `PROGRAMFILES`（`ProgramW6432` 是后备，本环境顶不上）——
  // ⚠ **只用真被读到的拼写**（本票复核抓到的 J1，实测钉死）：
  //   · `ProgramFiles` 这条**从不成立** —— msys bash 不按该拼写暴露它（注入 `ProgramFiles=A`
  //     后 bash 里读 `$ProgramFiles` 仍 unset，值出现在 `PROGRAMFILES` 名下）。POSIX shell
  //     区分大小写，故按它注入等于**没测**（"锁是空的"，D2）。
  //   · `PROGRAMFILES` 是本环境**唯一被读到**的那条；`ProgramW6432` 在别的一些 Windows 环境
  //     才是唯一导出形（本环境里 msys 把它镜像进 `PROGRAMFILES`，故它**不构成本用例可测的
  //     一条**——强压 `PROGRAMFILES` 为空时它才顶上，本用例不为它造那个场景）。
  // 早先版本按 `ProgramFiles` 注入并声称"三形都验过"，实际它是死项 —— 故这一条**改动过口径**，
  // 并在此写明：**那一版是错的，别改回去**。
  {
    const viaOverride = probe(SCRIPT_REF, { MSYS_ENV_WIN_PROGRAM_FILES: root('std') })
    const viaUpper = probe(SCRIPT_REF, { PROGRAMFILES: root('std') })
    // ⚠ **不测 `ProgramW6432` 作后备**：本机实测它**顶不上**（去掉 `PROGRAMFILES` 后 M4 变红），
    // 因为 msys 把 Windows 的 `ProgramW6432` 值映射到 `PROGRAMFILES` 名下 —— 在本环境里
    // 直接注入 `ProgramW6432` 只有**同时**带上 `PROGRAMFILES` 才可见。它写在脚本里是**别的
    // Windows 环境**（只导出 `ProgramW6432` 的那些）的后备，本用例**没有条件为它造出
    // "主力缺席"的可控场景**，故**不声称测过它**（假取证比缺一条更坏，D1）。
    // 判据落点：覆盖变量与 `PROGRAMFILES` 两条**逐条删掉都真红**（探针 `.scratch/p107-j1-nonempty.mjs`
    // R1/R2），两条全删也真红（R3b）—— "整组非空洞"由 R3b 承担。
    const want = [join('std', 'nodejs'), join('std', 'GitHub CLI')].map(n => normPath(scriptSees(root(n))))
    const srcs = [['覆盖变量', viaOverride], ['PROGRAMFILES', viaUpper]]
    // **可达性自检**（把"比较"钉在事实上，而不是钉在两条拼写相等上）：期望的每一段都必须
    // 真的能被脚本那条 bash `-d` 到。这条不成立时，下面的相等比较就毫无意义（比较两个空壳）。
    const reachable = want.every((w) => String(spawnSync(BASH, ['-c', `test -d '${w}' && echo YES`], { encoding: 'utf8' }).stdout ?? '').includes('YES'))
    const notRun = srcs.filter(([, r]) => r.rc !== '0')
    const got = (r) => addedSegments(r.path).slice(0, 2)
    const bad_ = srcs.filter(([, r]) => r.rc === '0' && JSON.stringify(got(r)) !== JSON.stringify(want))
    if (notRun.length > 0) bad('M4. 脚本没跑到（source 失败）', notRun.map(([n, r]) => `${n}:rc=${r.rc}`).join(' | '))
    else if (!reachable) bad('M4. 探针自伤：期望路径在脚本的坐标系里不可达（比较无意义）', JSON.stringify(want))
    else if (bad_.length === 0) ok('M4. 标准根两条来源（覆盖变量 / PROGRAMFILES）都生效', want.join(' + ').replaceAll(normPath(scriptSees(W_IN_BASH)), '<tmp>'))
    else bad('M4. 某条来源未生效（默认值静默失效）', bad_.map(([n, r]) => `${n}=${JSON.stringify(got(r))} raw=${JSON.stringify(normPath(r.path).slice(0, 90))} rc=${r.rc}`).join(' | '))
  }

  // —— M5 响亮说明**非空洞**：删掉那两段 → 说明消失（反向对照，同一脚本的副本上做）——
  {
    const perturbed = root('perturbed.sh')
    const lines = scriptText.split('\n')
    const kept = []
    for (let i = 0; i < lines.length; i++) {
      // 删掉"响亮说明"的两个 if 块（从 if 到其配对的 fi）
      if (/^if \[ -z "\$\{MSYS_ENV_WIN_GIT_ROOT/.test(lines[i]) || /^if \[ -z "\$WIN_PROGRAM_FILES" \]/.test(lines[i])) {
        while (i < lines.length && lines[i] !== 'fi') i++
        continue
      }
      kept.push(lines[i])
    }
    mkdirSync(dirname(perturbed), { recursive: true })
    // ⚠ **必须由 bash 写**：Node 的 `writeFileSync('/tmp/x')` 会落到**当前盘**的 `\tmp\x`，
    // 而 bash 的 `/tmp` 是另一处（msys 自己的临时面）—— 实测：Node 写完 `existsSync` 为真，
    // 同一条 bash `test -r` 却 BASH_NO。于是 M5 的 `probe` 读不到扰动副本、rc≠0，假红。
    // 用 bash 自己的写入把"文件落在哪"与"谁能读到它"统一到同一坐标系（与夹具同理）。
    const writeR = spawnSync(BASH, ['-c', `cat > '${perturbed}' && printf WROTE`], {
      encoding: 'utf8', env: BASH_ENV, input: kept.join('\n'),
    })
    if (!String(writeR.stdout ?? '').includes('WROTE')) {
      bad('M5. 扰动副本写入失败（探针自伤）', `rc=${writeR.status} ${String(writeR.stderr ?? '').slice(0, 80)}`)
    }
    const perturbedRef = perturbed // 夹具与探针同坐标系，无需翻译
    const r = probe(perturbedRef)
    const r2 = probe(SCRIPT_REF)
    // ⚠ 只比**契约自己的**两行说明，不比整条 stderr：环境里还可能有"找不到 gh"这类
    // **与本契约无关**的警告（msys 下实测就有），把它算进来会让 M5 假红 / 假绿。
    const CONTRACT = /(未设 MSYS_ENV_WIN_GIT_ROOT|推不出 Windows 标准安装根)/
    const contractLines = (s) => s.split('\n').filter(l => CONTRACT.test(l)).length
    if (r.rc === '0' && r2.rc === '0' && contractLines(r.stderr) === 0 && contractLines(r2.stderr) > 0)
      ok('M5. 响亮说明非空洞（删掉后不再出现；原脚本仍在说）', `原=${contractLines(r2.stderr)} 行`)
    else bad('M5. 反向对照不符', `扰动后 rc=${r.rc} 契约行=${contractLines(r.stderr)} / 原 rc=${r2.rc} 契约行=${contractLines(r2.stderr)}`)
  }

  // —— M6 零副作用：脚本**不覆盖 HOME**（头注承诺；改了会波及 msys 其它工具）——
  {
    // 同 probe 的构造：剥掉脚本读的变量，避免继承面干扰；HOME 用一个可辨认的探针值。
    const env = { ...BASH_ENV }
    for (const k of STRIP) delete env[k]
    env.HOME = '/home/probe'
    const r = spawnSync(BASH, ['-c', `. '${SCRIPT_REF}'; echo "HOME_SET=\${HOME}"`], { encoding: 'utf8', env })
    const home = (String(r.stdout ?? '').match(/^HOME_SET=(.*)$/m) ?? [, ''])[1].trim()
    // ⚠ WSL bash 会把 HOME 重写成 `/home/<winuser>` —— 那是**bash 自己**干的，不是脚本。
    // 故判据不是"HOME == 探针值"（在 WSL 下恒假），而是**脚本没有把它改到 Windows 用户目录**：
    // 真正要防的是"脚本把 HOME 指向 Windows profile"（那会波及 msys 其它工具）。
    // 探针值 `$(whoami)` 形态的正向证据由 M2 的 PATH 面承担，这里只判"没被脚本改写"。
    const rewritten = /^[A-Za-z]:|^\/c\/Users\//.test(home)
    if (home !== '' && !rewritten) ok('M6. 不覆盖 HOME（脚本未把 HOME 指向 Windows profile）', `bash 侧 HOME=${home}`)
    else bad('M6. HOME 被脚本改写', home)
  }
} finally {
  if (W_IN_BASH !== undefined) rmSync(W_IN_BASH, { recursive: true, force: true, maxRetries: 3 })
}

console.log('\n=== MSYS-ENV VERIFY (M1–M6) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)