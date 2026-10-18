/**
 * verify-review-brief-readonly.mjs —— 「复核者的写权限 = 无」固定段落的守卫（R1–R6）。issue #114。
 *
 * Why（票面事故，非假想）：#113 会话派出的两个复核子代理各自"恢复了工作树"——Standards 轴收尾语逐字为
 * "I left the working tree clean — the perturbation was reverted via `git checkout`"。
 * 后果：`workflow-enforcer.mjs`（part C 全部 171 行、**尚未提交**）被还原成 HEAD → 套件
 * `SyntaxError` 崩溃；`.scratch/perturb113/`（当时**唯一**的恢复副本）**也被清掉**；
 * AC4/AC5/AC6 证据全部作废，约 12 次工具调用用于恢复。
 *
 * 病根不是"解代理不听话"，而是**约束只活在派单者的记忆与逐跳传递的 handoff 正文里**：
 * `docs/code-review-brief.md` 原本有 §1/§2/§3/§3.1/§3.2/§5/§7/§8，**零「复核者只读」约束**
 * （全仓 grep `read-only|只读` 与复核相关的命中，**全部**是"复核轴退化成只读**码**"这一无关含义）。
 * 修法照本仓既有做法：那段禁令要像 §3.1/§3.2 一样**整段粘进 subagent prompt**（subagent 没有派单者
 * 的上下文），**不是**靠派单者临场默写。
 *
 * 判据（关键）：不是"brief 里出现过'只读'两个字"——那是**措辞检查**，改字就绿，属同义反复（D8）。
 * 本用例的**非空洞性由 R4 承担**：把 brief 复制到 `os.tmpdir()` 的副本上做三类扰动
 * （① 删掉整节 ② 改回"意图式"表述 ③ 抽掉单条禁令），对**副本**跑本用例自身，断言它**真红**；
 * 同时 R5 断言**真树逐字节未变**——本票的主题正是"别糟蹋工作树"，取证方式自己更不能犯。
 *
 * 全程只读真树 + 一次 `git ls-files`（同 verify-doc-pointers 的理由：`tests/node_modules` 是
 * junction 森林，递归遍历会满屏 ENOENT）。无网络、无环境变量依赖。
 *
 * 覆盖边界（显式声明，别当成它守住了）：本用例钉的是「**brief 模板里那段文本在场且形态正确**」，
 * 它**不**、也**不可能**证明"派单者真的把它粘进了 subagent prompt"——那一步在 `docs/code-review-brief.md`
 * §5 的操作口径里（"整段粘进"，与 §3.1/§3.2/§4 同一句要求），没有任何树内产物可断言。
 * 真正的结构性防线是**基线冻结**（先提交再复核）：fixed point 成为已存在且不再变动的 commit，
 * "复核期间树在动"这一根本问题**消失**——口径把它列为首选，R3 钉住这句在场。
 *
 * **本用例实施期自己抓到的一个真形态（写在这里，别删）**：R1/R2/R3 全是**关键词在场**断言，
 * 而"关键词在场"**不是**"禁令生效"。两轴复核各独立实测确认了同一个洞，形态是"**词面全在、语义全废**"：
 *   ① 把整节对冲成建议（"不必真的去 `git checkout`…；`.scratch/` 理论上不该删；扰动最好…"）
 *      —— R2 仍 **9/9 全绿**；
 *   ② 把整节降格成**历史叙事**（"历史背景：在 #113 里，一个复核子代理用了 `git checkout`…"）
 *      —— R2 9/9、R3 也绿，**整体 exit=0**：复核者读完只会"了解一段经过"，不知道**自己不许**做什么。
 * 这正是本仓 D13（用正则追写法而非钉结构）/ D11（匹配文本形态而非行为）——而 D14 恰恰把这两条
 * 登记在册。故补三条**结构面**判据（不是措辞判据）：
 *   R2b 该节必须处于**禁令语气**（禁令标记成规模 + 叙事框架语不得压过它）；
 *   R2c 该节**不得自我作废**（失效声明 / 豁免 / 宣布为参考 / 空洞作用域 / 全权授权）；
 *       R2c-2 是它的双向自检。
 *   R3b 禁令不得被**对冲成建议**；R3c 是 R3b 的**双向自检**（引号里的"提及"不误伤 +
 *       真对冲仍被抓），防"剥引用"剥过头把 R3b 变成恒真。
 * **九类扰动全部进 R4，各自红在"自己那条"判据上**（见运行读数）：
 *   删节 / 意图式 / 抽单禁令 / 对冲成建议 / 降格成叙事（Attack B）/ 声明失效（Attack C）
 *   / A5 全局豁免 / A6 宣布为参考 / A7 空洞作用域 / A8 全权授权。
 *
 * **为什么 R2c 是"否定式枚举"而不是又一条语气正则（这条设计取舍别改）**：
 * 语气与体裁是**开放集**——每加宽一版正则都能再绕一层。Attack B→C→A5–A8 的演进就是证据：
 * B 绕叙事比、C 绕词频比、A5–A8 换正式条款体裁。正是 #79 废掉子串匹配的理由。
 * 而"**自我作废**"是**有限且可枚举**的少数几种说法：**一份真禁令不会同时说"我不算数"，
 * 也不会附带"你可自行豁免"**。这是结构差别，不是措辞加宽。
 * **A7 尤其值得记住**：它的条件恰是本票场景（复核者尚未改动 ⇒ 禁令"永不生效"）——
 * 读起来像在讲道理，实则把整节架空。
 * 边界（显式声明，不装成守住了）：若有人发明全新的"叫停"体裁而不在下表，R2c 会漏 ——
 * 那属于开放集，交 R2b + **人判**（§5 的"整段粘贴" + 派单者判决）。
 *
 * 边界仍然明确：本用例判**文本**，判不了"派单者有没有真的粘进去"——那是人的判决。
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BRIEF_REL = 'docs/code-review-brief.md'
/** **镜像根**：R4 用它把 brief 换成扰动副本（默认 = 真仓根）。
 *  口径：`DSH_MATT_REVIEWBRIEF_ROOT` 指向一个**只含 `docs/code-review-brief.md` 的镜像目录**。
 *  刻意只换 brief 这一份（而非整仓）：本用例除 brief 外只读自身与外层 `git ls-files`，
 *  无其它树依赖；把整仓拷进临时区既慢又没必要。 */
const ROOT = process.env.DSH_MATT_REVIEWBRIEF_ROOT ?? REPO
const BRIEF = join(ROOT, BRIEF_REL)
const MIRRORED = ROOT !== REPO
/** 本文件自己（R4 拿它跑副本上的对照）。 */
const SELF = fileURLToPath(import.meta.url)

/** 该固定段落的节标题（口径的唯一锚点：R4 删节扰动就是删掉这一行）。 */
const SECTION_TITLE = '复核者的写权限 = 无'

/**
 * **禁令清单**：每项 = 一个正则 + 一句人话。这是"关键禁令在场"的判据面。
 * 刻意钉**行为词**（`checkout`/`restore`/`stash`/`clean`、`.scratch/`、`os.tmpdir()`）而非措辞风格：
 * 措辞可以改，禁令覆盖的**动作面**不能缺。抽掉任一条 → R2 红（R4 的第③类扰动即此）。
 */
const BANS = [
  { id: 'git-checkout', re: /git\s+checkout/, why: '`git checkout` —— 当次事故的直接工具（还原成 HEAD）' },
  { id: 'git-restore', re: /git\s+restore/, why: '`git restore` —— 同效的还原命令' },
  { id: 'git-stash', re: /git\s+stash/, why: '`git stash` —— 会重置 index 并按 autocrlf 改行尾（brief §2 硬约束②已实测）' },
  { id: 'git-clean', re: /git\s+clean/, why: '`git clean` —— 会删掉未被跟踪的证据副本（正是 `.scratch/perturb113/` 的死因）' },
  { id: 'scratch', re: /\.scratch\//, why: '`.scratch/` 明文 —— 当次事故正删掉了那里的唯一恢复副本' },
  { id: 'tmpdir', re: /os\.tmpdir\(\)/, why: '临时件落点 `os.tmpdir()` —— 不落仓内，才不会与实现者的工作树互相踩' },
  { id: 'mirror', re: /镜像副本|副本/, why: '扰动只在**副本**上做 —— 真树永不作扰动态' },
  { id: 'freeze', re: /先提交再复核/, why: '基线冻结首选形态 —— 结构性根治，不只是列禁止项' },
  { id: 'fixed-point', re: /移动靶/, why: '"做不到就显式声明移动靶" —— 冻结的**兜底**分支，缺了它禁令只有一半' },
]

const briefText = readFileSync(BRIEF, 'utf8')
/** 跑本用例，`rootDir` 为镜像根；返回 { status, out, red }（red = 变红的断言编号）。 */
function runSelfOnMirror(rootDir) {
  const env = { ...process.env, DSH_MATT_REVIEWBRIEF_ROOT: rootDir }
  const r = spawnSync(process.execPath, [SELF], { cwd: REPO, encoding: 'utf8', env })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { status: r.status, out, red: [...out.matchAll(/✗\s+(R\d\w*)\./g)].map(m => m[1]) }
}

/**
 * **剥掉"提及"、只留"表态"**（D11 落点 Y7「先剥注释再匹配」的同手法）。
 * 去 markdown 加粗片段与 `"…"` / `""` 两种引号内容 —— 那些位置写的是**引用**（如
 * `**这不是"尽量别用"**`，引对冲语来否定它），不是**表态**；不剥就会把"禁写"变成"禁说"。
 * **单一定义**（Standards 轴第 2 轮指出：R3b/R3c 各写一份是 D6「判定点重复」的轻量形态）。
 */
function stripMentions(s) {
  return s
    .replace(/\*\*[^*]*\*\*/g, ' ')   // 加粗片段（引用式否定都写在这种位置）
    .replace(/[""][^""]*[""]/g, ' ') // 中文引号
    .replace(/"[^"]*"/g, ' ')        // 直角引号
}

/** 只取某节文本（从标题行到下一个**同级或更高级**的 `## `）—— 别节的同名词不能"代答"本节断言。 */
function sectionOf(text, title) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => l.includes(title))
  if (start === -1) return ''
  const rest = lines.slice(start)
  const end = rest.slice(1).findIndex(l => /^##\s/.test(l))
  return (end === -1 ? rest : rest.slice(0, end + 1)).join('\n')
}
/** §5「两轴 brief 模板」的正文（到 §6 为止）。**本节的落点必须在 §5 之内** ——
 *  票面明文"照 §3.1/§3.2 那样整段粘进两轴 brief"，落在别节就粘不进去。
 *  第 1 版直接全文 find，`SECTION_TITLE` 出现在 §5 之外也照样绿（假绿），故收窄到 §5 内。 */
const sec5 = sectionOf(briefText, '## 5. 两轴 brief 模板')
const sec = sectionOf(sec5, SECTION_TITLE)

// ── R1：§5 模板含该节 ─────────────────────────────────────────────────────────
// 注：`sec` 由 `sectionOf(sec5, …)` 得出，故 `sec !== ''` 蕴含 `sec5 !== ''` ——
// 中间的 `else if (sec !== '')` 分支是**永假的**（§8 D12 形态，Standards 轴 2026-10-18 实测指出）。
// 已删：R1 只剩两个真分支（节在 §5 内 / 节不存于 §5）。"节存在于 §5 之外"这个命题
// 由 `sec` 的定义方式直接排除（我们只在 §5 正文里找它），不需要第三个分支。
if (sec !== '') {
  ok('R1. §5 模板含固定段落「复核者的写权限 = 无」', `${BRIEF_REL} §5`)
} else {
  bad('R1. brief §5 缺该固定段落（约束只活在派单者记忆里 —— #113 的病根）',
    `在 ${BRIEF_REL} §5 中未找到「${SECTION_TITLE}」`)
}

// ── R2：关键禁令逐条在场 ─────────────────────────────────────────────────────
{
  const missing = BANS.filter(b => !b.re.test(sec))
  if (sec !== '' && missing.length === 0) {
    ok('R2. 关键禁令逐条在场（行为词面，非措辞面）', `${BANS.length}/${BANS.length}`)
  } else {
    bad('R2. 固定段落缺禁令', missing.length === 0
      ? `节缺席（R1 已报）`
      : missing.map(b => `${b.id}（${b.why}）`).join(' | '))
  }
}

// ── R2b：禁令处于**禁令语气**，不是被降格成"历史叙事"─────────────────────────
// **为什么需要这一条（Standards 轴复核实测的 Attack B，必删不得）**：R2 只断言**词面在场**，
// 而"词面在场"连"这句话在下命令"都不保证。复核实测构造：
//   "历史背景：在 #113 里，一个复核子代理用了 `git checkout`、`git restore`、`git stash`、
//    `git clean`，顺手把 `.scratch/` 下的副本也清掉了；当时临时件放 `os.tmpdir()`，扰动在
//    副本上做。那次基线冻结没做好（当时也说了「先提交再复核」是首选）…"
// ——**九个 BAN 词全在、R2 9/9、R3/R3b/R3c 全绿、exit=0**，而这一节**一条禁令都没有**，
// 复核者读完只会"了解一段经过"，不会知道**自己不许**做任何事。正是本仓 D13（追写法非钉结构）
// 与 D11（匹配文本形态非行为）的形态。
// 判据：要求本节**同时**具备 ① **禁令标记**（禁/禁止/不得/一律不/无例外/永不/不允许）
// 且 ② 这些标记**成规模**（叙事化文本里偶然出现一个"不得"骗不过去），并且 ③ **叙事框架语**
// 不得占主导。三条都是**结构面**判据，不是措辞判据——措辞可以换，"在下命令"这件事换不掉。
{
  const PROHIBITIVE = /禁止|严禁|不得|一律不|一概不|无例外|永不|不允许|绝不允许|不许/g
  const NARRATIVE = /历史背景|当时|那一次|发生过|后来的|曾经的|背景是|事故经过|所以后来/g
  const prohibitiveCount = (sec.match(PROHIBITIVE) ?? []).length
  const narrativeCount = (sec.match(NARRATIVE) ?? []).length
  // 阈值口径：真实本节实测 ≈10 个禁令标记；叙事化 Attack B ≈0。取 ≥4（同一节至少要下 4 道
  // 命令才谈得上"逐条禁令"——与 §5 要求的 git 写命令族 + `.scratch/` + `os.tmpdir()` 相当）。
  const PROHIBITIVE_MIN = 4
  const moodOk = prohibitiveCount >= PROHIBITIVE_MIN
  // 叙事面：允许它存在（本节**确实**要讲事故背景，否则读者不懂为什么有这条禁令），
  // 但**不得压过**禁令面——否则读起来是一篇回顾而不是一道命令。
  const narrativeDominates = narrativeCount > prohibitiveCount
  if (sec === '') {
    bad('R2b. 无法判（节缺席，R1 已报）', '')
  } else if (moodOk && !narrativeDominates) {
    ok('R2b. 禁令处于禁令语气（禁令标记成规模、未被叙事框架压过）',
      `禁令标记 ${prohibitiveCount}（≥${PROHIBITIVE_MIN}）/ 叙事语 ${narrativeCount}`)
  } else {
    bad('R2b. 该节被降格成"历史叙事"（词面在场但无人在下命令 —— D13/D11 形态）',
      `禁令标记 ${prohibitiveCount}（需 ≥${PROHIBITIVE_MIN}）| 叙事语 ${narrativeCount}` +
      ` | 叙事压过禁令=${narrativeDominates}`)
  }
}

// ── R2c：该节**不得自我作废**（声明失效 / 豁免 / 全权授权 / 空洞作用域）───────────
// **为什么需要（两轴第 2 轮各自实测，必删不得）**：R2b 判的是**词频比**，R3b 判的是**降级词**
// —— 两者都是**开放集**，换个体裁就绕过。复核构造了四种"**词面全在、语义全废**"的版本，
// 全部对旧判据 `exit=0` 全绿：
//   A5 全局豁免："以上各条仅适用于你有空且愿意遵守的场合…不遵守也不构成违规…可自行豁免"
//   A6 宣布为参考："仅供参考，不作为强制要求"
//   A7 空洞作用域："仅在**你已经在真树上做过改动**时才生效"——**正是本票场景**：复核者尚未改动，
//      禁令**永不生效**（最阴的一种：它读起来像在讲道理）
//   A8 全权授权："如果你判断有必要，随时可以放手做任何操作"
// 它们都保留完整禁令词面与"先提交再复核/移动靶"，故 R2b/R3b/R3 全绿。**这与 AC3 点名的
// "意图式表述"不是一回事**：它们是**更硬的降级**（正式条款式自我作废），恰恰能过。
//
// **判据形态刻意是"否定式枚举"而不是又一条语气正则（这条设计取舍别改）**：语气与体裁是开放集
// ——每加宽一版正则都能再绕一层（Attack B→C→A5–A8 的演进就是证据），正是 #79 废掉子串匹配的理由。
// 而"**自我作废**"是**有限且可枚举**的少数几种说法：**一份真禁令不会同时说"我不算数"、
// 也不会附带一条"你可自行豁免"**。抓有限集比追开放集扎实。本表按**类**而非逐句收，四类各留常用写法。
// 边界（显式声明，不装成守住了）：若有人发明全新的"叫停"体裁而不在下表，本条会漏 ——
// 那属于开放集，交 R2b + **人判**（§5 的"整段粘贴" + 派单者判决）。**不装成守住了。**
{
  const VOID_CLAUSES = [
    { re: /不具(强制力|约束力|效力)/, why: '声明无约束力' },
    { re: /(不是|并非|非)(规矩|禁令|规则|命令|约束)/, why: '否认自己的规范身份' },
    { re: /(仅|只)(作|是|为).{0,6}(说明|背景|资料|参考|介绍)/, why: '降格为资料' },
    { re: /(不得|不允许|禁止)被(当作|视为|理解|援引)/, why: '阻止被当成禁令执行' },
    { re: /永不(生效|执行)|不(予|再)执行/, why: '明示不生效' },
    // ── 以下三类按 A5–A8 补（豁免 / 参考 / 作用域 / 授权）────────────────────
    { re: /仅供参考|仅作参考|不作为(强制|硬性)?(要求|规定|约束)/, why: 'A6 宣布为参考（"不作为强制要求"）' },
    { re: /(不构成|不算|不视为)(违规|违反|问题)|(可|能|可以)自行(豁免|裁量|决定)/, why: 'A5 全局豁免 / 自裁量' },
    { re: /(仅|只)在.{0,12}(才|时)(生效|适用|算数)|另(行|当)处理/, why: 'A7 空洞作用域（条件永不满足 = 永不生效）' },
    { re: /随时可以(放手|随意|任意|自行)|(放手|随意)做任何(操作|事)|由(你|复核者)(自行)?(裁量|决定)/, why: 'A8 全权授权 / 交付裁量权' },
  ]
  const voids = VOID_CLAUSES.filter(v => v.re.test(sec))
  if (sec === '') {
    bad('R2c. 无法判（节缺席，R1 已报）', '')
  } else if (voids.length === 0) {
    ok('R2c. 该节未自我作废（无失效声明 / 豁免 / 空洞作用域 / 全权授权）')
  } else {
    bad('R2c. 该节**自我作废**（词面全在但明说自己不算数 —— Attack C/A5–A8 / D13 形态）',
      voids.map(v => `${v.re.source}（${v.why}）`).join(' | '))
  }

  // ── R2c-2：R2c 的**双向自检**（与 R3c 同手法：防"禁写变成禁说"）───────────────
  // 真实 §5 里到处是**否定**句（"这不是'尽量别用'"、"不需要恢复任何东西"、"从不…"），
  // 它们**必须不被**误判成"自我作废"——否则 R2c 会误伤自己的正文。
  // 另一个方向：真作废声明**仍须被抓**。两向一起钉，R2c 才不会退化成恒真/恒假。
  {
    const benignNegations = '这不是"尽量别用"：禁止 git 写命令。复核者从不需恢复任何东西。'
    const realVoid = '本节不具强制力，仅作说明，你可自行豁免。'
    const anyVoid = (s) => VOID_CLAUSES.some(v => v.re.test(s))
    const noFalsePositive = !anyVoid(benignNegations)
    const stillCatches = anyVoid(realVoid)
    if (noFalsePositive && stillCatches) {
      ok('R2c-2. 双向自检：合法否定句不误伤 + 真作废声明仍被抓（防 R2c 恒真/恒假）')
    } else {
      bad('R2c-2. R2c 双向自检失败',
        `合法否定不误伤=${noFalsePositive} | 真作废声明仍被抓=${stillCatches}`)
    }
  }
}

// ── R3：基线冻结前置声明（结构性缓解是首选，不只是列禁止项）────────────────
{
  const hasFreeze = /基线冻结|冻结/.test(sec)
  const hasPreferred = /先提交再复核/.test(sec)
  const hasFallback = /移动靶/.test(sec)
  if (hasFreeze && hasPreferred && hasFallback) {
    ok('R3. 含基线冻结前置声明（首选"先提交再复核" + 兜底"显式声明移动靶"）')
  } else {
    bad('R3. 基线冻结前置声明不完整', `冻结=${hasFreeze} | 首选=${hasPreferred} | 兜底=${hasFallback}`)
  }
}

// ── R3b：禁令**不是被对冲成建议**（"不必真的…"/"理论上不该…"/"最好…"）────────────
// **为什么需要这一条（本票实施期的自检实证，别删）**：R1/R2/R3 都是**关键词在场**断言，
// 而"关键词在场"**不是**"禁令生效"。实施期自检实测：把本节整段改写成
// "不必真的去 `git checkout` 或 `git restore`，也别 `git stash`、`git clean`；`.scratch/` 的东西
// 理论上不该删。临时文件放 `os.tmpdir()`，扰动最好在副本上做。" ——**R2 仍然 9/9 全绿**
// （每个禁令词都在），只有 R3 因"冻结"一词恰好缺席而红。这正是本仓 D13「用正则追写法而非
// 钉结构」+ D11「匹配文本形态而非行为」的形态：**对冲语把硬禁令降级成建议，而词面毫发无损**。
// 判据刻意**收窄**（只抓明确的降级词，不抓任何温和措辞）：宽泛的"语气检查"会误伤合法表述，
// 那比漏抓更贵。这条抓的是"**照做与不照做都不算错**"的那种句子 —— 而 §5 那一节的全部价值
// 就在于让"不照做 = 违规"。
{
  // **本条的自身陷阱（实施期实测踩到，见下）**：第 1 版对整节原文匹配，被自己的正文
  // `**这不是"尽量别用"**` **误伤** —— 那句话是**引用对冲语来否定它**，却因引号里含
  // "尽量别用" 而判红。这正是本仓 **D11**「负例守卫匹配了文本形态而非行为（禁'写'变成禁'说'）」
  // 的同一形态，上一票刚登记过。修法：**先剥掉被引号/加粗括起来的"提及"**，只对**生效面**
  // 匹配（与 D11 的落点 Y7「先剥注释再匹配」同手法）。剥法见 `stripMentions`（模块级，单一定义）。
  const operative = stripMentions(sec)
  const HEDGES = [
    { re: /不必真的|不用真的|无需真的/, why: '"不必真的 …" —— 把禁令降级成提示' },
    { re: /理论上(不该|不应|不应)/, why: '"理论上不该 …" —— 暗示实践上可以' },
    { re: /最好(不要|别|避免)|尽量(不要|别|避免)|建议(不要|别)/, why: '"最好/尽量/建议（别）…" —— 建议 ≠ 禁令' },
    { re: /如果(方便|可以)的话/, why: '"如果方便的话" —— 可选项化' },
  ]
  const hit = HEDGES.filter(h => h.re.test(operative))
  if (sec !== '' && hit.length === 0) {
    ok('R3b. 禁令未被对冲成建议（生效面无"不必真的/理论上不该/最好别"一类降级语）')
  } else if (sec === '') {
    bad('R3b. 无法判（节缺席，R1 已报）', '')
  } else {
    bad('R3b. 禁令被对冲成建议（词面在场但硬约束已降级 —— D13/D11 形态）',
      hit.map(h => `${h.re.source}（${h.why}）`).join(' | '))
  }

  // ── R3c：R3b 的**双向自检**（D11 落点 Y7c 的同手法：防"禁写变成禁说"）──────────
  // 只测一个方向是不够的：剥引用若剥得过多，真实的对冲语也会被剥掉 → R3b 退化成恒真。
  // 故两个方向一起钉：① 引用式否定（"这不是『尽量别用』"）**不误伤**；
  // ② 真正的生效面对冲语**仍被抓**。
  // （剥离函数已提到模块级 `stripMentions` —— Standards 轴第 2 轮指出它在 R3b/R3c 各写一份
  //   是 D6「判定点重复」的轻量形态，未来会漂。现在单一定义。）
  {
    const negatedMention = '**这不是"尽量别用"**：禁止 git 写命令。'
    const realHedge = '尽量不要用 git 写命令。'
    const hedgeRe = HEDGES[2].re
    const noFalsePositive = !hedgeRe.test(stripMentions(negatedMention))
    const stillCatches = hedgeRe.test(stripMentions(realHedge))
    if (noFalsePositive && stillCatches) {
      ok('R3c. 双向自检：引用式否定不误伤 + 真对冲仍被抓（防 R3b 剥过头变恒真）')
    } else {
      bad('R3c. R3b 双向自检失败', `引用式否定不误伤=${noFalsePositive} | 真对冲仍被抓=${stillCatches}`)
    }
  }
}

// ── R4：**非空洞** —— 三类扰动打在副本上，本用例对副本必须真红 ────────────────
// 这是本用例唯一承担"非空洞"的断言（R1–R3 是正面在场断言，R6 是措辞检查）。
// 三类扰动各自对应一个真实的退化路径：
//   ① 删掉整节        → 回到 #113 事故前的树（"约束没进仓"）
//   ② 改回意图式表述  → "请保持工作树干净"这类**没有动作面**的句子（改字即绿的形态，D8）
//   ③ 抽掉单条禁令    → 节还在、看着像守住了，但某条禁令悄悄消失（覆盖面半失效）
// 副本形态：**只复制 brief 一个文件**到 tmpdir 下的镜像目录，用 `DSH_MATT_REVIEWBRIEF_ROOT`
// 把本用例指过去（见文件头 ROOT 的说明）。
//
// `if (!MIRRORED)`：镜像跑**不做**递归扰动 —— 否则副本上的 R4 会再建一层副本、无限递归。
// 镜像上的判据 = R1–R3（该副本是否红），那正是我们要的读数。
if (!MIRRORED) {
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-reviewbrief-'))
  try {
    // 与非空洞取证前的 needle 自检（brief §2 硬约束①）：0 命中是**假证据**，不是"没漂移"。
    const needles = ['## 5. 两轴 brief 模板', SECTION_TITLE]
    const hits = needles.map(n => briefText.split(n).length - 1)
    if (hits.every(h => h > 0)) ok('R4a. needle 自检：镜像锚点命中数 > 0', hits.join(' / '))
    else bad('R4a. needle 未命中 = 假证据', `hits=${hits.join(' / ')}`)

    /** 把 §5 里本节的正文换成给定文本（从节标题到下一个 `## `）。删节/换措辞共用。 */
    const rewriteSection = (t, body) =>
      t.replace(/###\s*复核者的写权限 = 无[\s\S]*?(?=\n##\s)/, body)

    const perturbations = [
      {
        id: 'delete-section',
        label: '删掉整节',
        // 连标题一起删（含前置空行），回到"该约束不在仓里"的状态。
        mutate: t => t.replace(/\n###\s*复核者的写权限 = 无[\s\S]*?(?=\n##\s)/, '\n'),
      },
      {
        id: 'intent-only',
        label: '改回"意图式"表述（有态度、无动作面）',
        mutate: t => rewriteSection(t,
          '### 复核者的写权限 = 无\n\n请复核者保持工作树干净、尊重实现者的劳动成果，审阅期间不要打扰正在进行的工作。\n'),
      },
      {
        id: 'drop-one-ban',
        label: '抽掉单条禁令（`git clean`）',
        mutate: t => t.replace(/`git clean`/g, '某些清理命令'),
      },
      {
        // 第 ④ 类 = 实施期自检实证抓到的形态（见 R3b 的注释）：**词面全在**，但整段被
        // 对冲成建议。这一条暴露"关键词在场 ≠ 禁令生效"这条边界。
        id: 'hedged-advice',
        label: '全部禁令保留词面、但整段对冲成建议',
        mutate: t => rewriteSection(t,
          '### 复核者的写权限 = 无\n\n'
          + '不必真的去 `git checkout` 或 `git restore`，也别 `git stash`、`git clean`；'
          + '`.scratch/` 的东西理论上不该删。临时文件放 `os.tmpdir()`，扰动最好在副本上做。\n'),
      },
      {
        // 第 ⑤ 类 = **Standards 轴复核实测的 Attack B**：九个 BAN 词**全部在场**、R3/R3b/R3c 全绿，
        // 但整节只剩**历史叙事** —— 读的人只会"了解一段经过"，不知道**自己不许**做什么。
        // 补 R2b 后本类必红。
        id: 'narrative-only',
        label: '全部禁令词保留、但整节降格成历史叙事（Attack B）',
        mutate: t => rewriteSection(t,
          '### 复核者的写权限 = 无\n\n'
          + '历史背景：在 #113 里，一个复核子代理用了 `git checkout`、`git restore`、`git stash`、'
          + '`git clean`，顺手把 `.scratch/` 下的副本也清掉了；当时临时件放 `os.tmpdir()`，'
          + '扰动在副本上做。那次基线冻结没做好（当时也说了「先提交再复核」是首选），'
          + '结果就成了移动靶。所以后来的复核者会了解这段经过。\n'),
      },
      {
        // 第 ⑥ 类 = **Standards 轴第 2 轮实测的 Attack C**（补 R2c 的原因）：**刻意避开 R2b 的词频比**
        // —— 九词全在、禁令标记刷够 5 个、叙事语 0 —— 然后显式声明本节无约束力。
        // R2b 对它是绿（比值达标），只有 R2c 抓得住。这一类的存在证明"追语气正则"追不完。
        id: 'self-void',
        label: '词面全在 + 叙事语 0，但显式声明本节无约束力（Attack C）',
        mutate: t => rewriteSection(t,
          '### 复核者的写权限 = 无\n\n'
          + '**这一段不是给复核者读的规矩，而是一份说明文档。**\n'
          + '`git checkout` / `git restore` / `git stash` / `git clean` 与 `.scratch/`、`os.tmpdir()`、'
          + '「先提交再复核」「移动靶」「基线冻结」、副本 —— 都是本仓历史上出现过的概念。\n'
          + '本节不允许被当作禁令宣读，不得被任何人理解为约束，禁止援引它要求他人，'
          + '一律不具强制力，永不生效。\n'
          + '请把本节当作一份背景资料阅读，它记录的是概念，不是规矩。\n'),
      },
      // 第 ⑦ 类集群 = **Spec 轴第 2 轮实测的 A5–A8**（补 R2c 的枚举面）：禁令**逐条照写为真
      // 祈使句**，只在末尾追加一条"自我作废"条款 —— 故 R2b（语气）与 R3b（降级词）**全绿**，
      // 只有 R2c 抓得住。四种各自对应一种真实体裁：豁免 / 参考 / 作用域 / 授权。
      // **A7 最阴**：它的条件恰是本票场景（复核者尚未改动 ⇒ 禁令永不生效）。
      ...([
        { id: 'void-waiver', label: 'A5 全局豁免（"不构成违规，可自行豁免"）',
          tail: '以上各条仅适用于你有空且愿意遵守的场合，不遵守也不构成违规，本节任何一条均可自行豁免。' },
        { id: 'void-reference', label: 'A6 宣布为参考（"仅供参考，不作为强制要求"）',
          tail: '本节性质：以上为历史做法整理，仅供参考，不作为强制要求。' },
        { id: 'void-scope', label: 'A7 空洞作用域（"仅在已改动时才生效"——本票场景=永不生效）',
          tail: '上述禁令仅在你已经在真树上做过改动时才生效——若你尚未改动，则无需遵守。' },
        { id: 'void-authorize', label: 'A8 全权授权（"随时可以放手做任何操作"）',
          tail: '如果你判断有必要，随时可以放手做任何操作。' },
      ]).map(c => ({
        id: c.id,
        label: c.label,
        // 头保持**完整强度**（真祈使句 + 冻结 + 移动靶），只在末尾追加作废条款。
        mutate: t => rewriteSection(t,
          '### 复核者的写权限 = 无\n\n'
          + '**前置：基线冻结** —— 先提交再复核为首选；做不到就声明移动靶、只读快照。\n\n'
          + '**禁令（无例外）**：禁止任何 `git` 写命令（`git checkout` / `git restore` / `git stash` / `git clean`）。\n'
          + '禁止删改仓内任何文件，包括 `.scratch/`。临时件一律落 `os.tmpdir()`，不得落仓内。\n'
          + '只允许在镜像副本上扰动，永不碰真树。\n\n'
          + c.tail + '\n'),
      })),
    ]

    for (const p of perturbations) {
      const mutated = p.mutate(briefText)
      if (mutated === briefText) {
        // 扰动**未生效** = 假证据（brief §2 硬约束①的同一件事）：静默跳过会让本条看着"通过"。
        bad(`R4. 扰动「${p.label}」未生效（替换静默失败 = 假证据）`, 'mutated === 原文')
        continue
      }
      const root = join(sandbox, p.id)
      mkdirSync(join(root, 'docs'), { recursive: true })
      writeFileSync(join(root, BRIEF_REL), mutated)
      const r = runSelfOnMirror(root)
      if (r.status !== 0 && r.red.length > 0) {
        ok(`R4. 扰动「${p.label}」→ 副本真红（非空洞）`, `exit=${r.status} red=${r.red.join(',')}`)
      } else {
        bad(`R4. 扰动「${p.label}」跑不出红（假绿 = 守卫空转）`, `exit=${r.status} red=${r.red.join(',') || '—'}`)
      }
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 })
  }
}

// ── R5：真树逐字节未变（本票的主题是"别糟蹋工作树"，取证方式自己更不能犯）────
// **Standards 轴 2026-10-18 指出第 1 版是同义反复**（`now === briefText` 只证明"同一文件读了
// 两次、值相同"，既不覆盖 `.scratch/`、也不覆盖仓库其它文件）——判断项，但确实是弱形态。
// 加强为**两条独立判据**（R5 + R5b），且 R5b 是本票主题真正对症的那条。
// 注：**不**断言"git 工作树干净"——实现期间工作树本来就该是脏的（正在改代码），
// 拿它当判据会误伤，且它与"本用例有没有糟蹋树"无关。
//
// `if (!MIRRORED)`：R5/R5b 判的是**真树**。在镜像跑里它们读的是副本根、
// 会把"副本内容 ≠ 真树内容"误报成红（第 1 版实测：五类扰动全部多出一条 R5 噪声红）。
// 镜像上只该判 R1–R3c（"这份被扰动的文本是否触发断言"），真树卫生由真树那一跑负责。
if (!MIRRORED) {
  const now = readFileSync(BRIEF, 'utf8')
  if (now === briefText) ok('R5. 真树未被扰动污染（brief 逐字节与读入时一致）')
  else bad('R5. 真树被扰动污染', `${BRIEF_REL} 与读取时不一致`)
}

// ── R5b：扰动残骸不得留在仓内（`.scratch/` 或任何仓内目录）────────────────────
if (!MIRRORED) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean)
  // 本用例的临时目录前缀（`os.tmpdir()` 下建的那些）。
  const RESIDUE_PREFIX = 'dsh-reviewbrief-'
  const residualTracked = tracked.filter(f => f.includes(RESIDUE_PREFIX))
  // 仓内（含未跟踪面）也扫一遍：`.scratch/` 是 gitignore 的，**恰是**当次事故被清的地方，
  // 所以"残骸"必须同时扫跟踪面与未跟踪面。
  let residualUntracked = []
  try {
    const scratch = join(REPO, '.scratch')
    if (existsSync(scratch)) {
      residualUntracked = readdirSync(scratch).filter(f => f.includes(RESIDUE_PREFIX)).map(f => `.scratch/${f}`)
    }
  } catch { /* .scratch 不存在 → 无残骸 */ }
  const residue = [...residualTracked, ...residualUntracked]
  if (residue.length === 0) {
    ok('R5b. 仓内无扰动残骸（临时件只落 os.tmpdir()）', `扫描面：${tracked.length} 个跟踪文件 + .scratch/`)
  } else {
    bad('R5b. 仓内留有扰动残骸（§3.1 测试卫生 / D7）', residue.join(', '))
  }
}

// ── R6：与 §7 收敛纪律**不混**（防 D6「判定点重复」）────────────────────────
// §7 管的是"审几轮、复审哪一段"（**收敛**），本节管的是"复核者能写什么"（**写权**）。
// 两者若被合并成一节，改一处必漂一处——本仓 D6 已登记过这类。这里钉住"两节各自独立在场"。
{
  const hasSec7 = /##\s*7\.\s*收敛纪律/.test(briefText)
  const sec7 = sectionOf(briefText, '收敛纪律')
  const leaked = /写权限|只读/.test(sec7)
  if (hasSec7 && !leaked) ok('R6. §7 收敛纪律与本节分立（写权禁令未混入轮数纪律）')
  else bad('R6. 两节混同或 §7 缺席', `§7=${hasSec7} | §7 泄漏写权词=${leaked}`)
}

console.log('\n=== REVIEW-BRIEF READONLY VERIFY (R1–R6 · issue #114) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)