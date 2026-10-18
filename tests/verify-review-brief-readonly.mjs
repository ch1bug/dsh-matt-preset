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
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
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
if (sec !== '' && sec5 !== '') {
  ok('R1. §5 模板含固定段落「复核者的写权限 = 无」', `${BRIEF_REL} §5`)
} else if (sec !== '') {
  bad('R1. 该节存在但**不在 §5 之内**（票面要求粘进两轴 brief 模板）', `${BRIEF_REL}`)
} else {
  bad('R1. brief 缺该固定段落（约束只活在派单者记忆里 —— #113 的病根）',
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
// 只在真树上判：镜像跑改的就是副本，拿它当"真树未变"的证据是同义反复。
if (!MIRRORED) {
  const now = readFileSync(join(REPO, BRIEF_REL), 'utf8')
  if (now === briefText) ok('R5. 真树未被扰动污染（brief 逐字节与读入时一致）')
  else bad('R5. 真树被扰动污染', `${BRIEF_REL} 与读取时不一致`)
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