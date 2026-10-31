# 静默类失败判据表（S1–S4）

**这是什么**：2026-10-22 全景复盘（#157）把失败模式归为四族，其中「静默」是最大族
（7+ 张），且复发票（#113 ×3 等）证明**逐实例追补赶不上新洞产生**——故按「类」立判据，
一张表收 #140 与复发面。本表是 S1–S4 的**单一事实源**：每条判据配**首个消费者**（谁先
按它干活）与**机械检验方式**（能跑的检查，不是散文）。

**enforcer 规则面只留锚点**（与 D23「高危清单归插件」同构）：判据的细节不进
workflow-body.txt / workflow-enforcer.mjs 的注入正文——正文若需要提及，只写一行锚点
指回本表；第二份全文复述就是漂移种子。

## 判据表

| # | 判据 | 一句话 | 首个消费者 | 机械检验方式 | 反例票号 |
|---|---|---|---|---|---|
| **S1** | **缺席必响亮** | 防线依赖的本地配置 / 环境 / 文件缺席 = 响亮失败（要么失败、要么打印一行说明），**静默通过视为缺陷**（D47） | verify-all 的 SKIP / loud 纪律（D43 三件套，从本表派生） | `node scripts/verify-all.mjs`：汇总行带 `hooks=` 状态段，SLOW / SKIP 逐行显式计数；守卫用例 `node tests/verify-all-entry.mjs`（E 系列；断言细节以该用例为准） | #69（原文）；#113（沙箱 home 静默回落，三次复发）；#44（handoff 乐观返回） |
| **S2** | **追加型工件禁存在性判定** | 对 append-only 日志 / per-batch 文件，「存在」≠「有效」——判定必须读内容或按 batch 维度 | retro 聚合抑制者（**已兑现**：#140 per-batch 注册表判定） | `node tests/verify-enforcer.mjs`：V29b / V29h（当前批 id 有条目才抑制、别批条目不算）+ V29e（探针失败响亮，不扁平化成「无 marker」） | #140（与 #121 同链两半：素材落盘 vs 聚合抑制） |
| **S3** | **降级必显式声明** | 任何装载 / 运行降级必须在输出面**如实声明**（stdout 与事实一致；真话不得只住在 stderr） | installer / live 链输出断言（样板：`tests/verify-silence-guardrails.mjs` C 段，降级输出如实分岔） | `node tests/verify-silence-guardrails.mjs`：S3 组断言——降级分支输出如实分岔（不谎报挂载、降级显式声明上 stdout，断言细节以守卫用例为准）；成功分支文案归 `DSH_MATT_INSTALLER=1` 的 `tests/verify-installer.mjs` 环境面 | #80（降级仍声称已挂载） |
| **S4** | **复核委派必只读** | 评审 / 复核类委派的工作树权限 = 只读——产物只能进报告，不能进工作树 | 复核委派 spawn 面只读声明，**两仓**：preset 侧已落（#114：`docs/code-review-brief.md` §5「复核者的写权限 = 无」）；host 侧（dsh-shell-host）为 `docs/code-review-brief.md` §5 注记句 | `node tests/verify-review-brief-readonly.mjs`（R1–R6：只读节在场 + 禁令语气 + 九类扰动取证 + 真树不变）。host 侧注记句无机械守卫（只立注记不实现，#157 拍板） | #114（复核子代理 `git checkout` 抹掉未提交实现） |

## 义务条款（散点派生——不在 #157 重构）

「既有散点检查改为从判据表派生」是**义务条款**，留给各防线票，不在本票一次重构：

- #69 的 D43 三件套（`<DSH_HOME>` 运行时依赖指路 / 技能镜像响亮 / 端口与实例假设
  显式 `SKIP (loud)`）及后继防线，在各自的防线票里改为**引用本表 S1 判据号**派生口径，
  不再各写各的一句话——一条判据一个出处。
- 新防线票的验收面写「S1/S2/S3/S4 消费者」，而不是重新定义判据。

## 声明面 ⊆ 实现面一致性门

**守卫**：`tests/verify-silence-guardrails.mjs` B 段——注入正文 / persona 声称的工具
∈ 实挂 roster（roster 单一源 = `agent.cordis.yml`，机械读出、不手抄行表），或**显式登记
为未兑现**（带票号与期望 roster 行；防腐：期望行一旦真挂上、登记过时即红，逼人回来更新）。

**划界（勿双写）**：

- **#117** 钉「模式描述 ↔ 实挂 roster」的**对齐断言**（差异表方向 (b)）——描述文本与
  roster 能力面的一致性归它；
- **#116** 执行方向 A——**已交付**：`tool-presentation` 行已随 #116 进 roster
  （`lib/bundle-patch.mjs` 的 PTC_EXTRA_ROWS 注入 matt-ptc 载体），`run_code` 声称
  在 B 段已从 gap 登记升级为 provider；承诺的**兑现**归它（其让渡评论明写
  「承诺↔roster 机械守卫归 #157」，即本门）；
- **本门**只管「注入正文 / persona 声称的**工具面** ∈ roster ∪ 显式登记」——三张脸
  各守一段，谁也不重复实现谁。

**simulated / 判定层标注**（honesty gate，ruflo / knoxcoder 同族）：本门是**静态声明面
判定**（读正文文本 + roster 文本），不是运行时挂载判定——「门绿」**不等于**「工具运行时
可用」（#116 的 M7c 教训：断言注入文本含 `run_code` 就绿，被读成能力断言）。运行时可达性
归各工具的实测读数（如 #116 落地时的 `run_code` 真调用）。测试面凡用文本 / 模拟代替运行
时判定的，一律显式标注判定层（先例：`tests/verify-preset-modes.mjs` M6 的 officials 是
simulated，注释当场声明）。

## 相关

- 决策：[CONTEXT.md](../CONTEXT.md) D43（环境自检三件套）、D47（缺席必响亮）、D23
  （锚点同构先例）
- 复核只读（S4 的 preset 面）：[code-review-brief.md](code-review-brief.md) §5
- 分层验证口径：[dev-environment.md](dev-environment.md) §0.2 / §0.3
- 票：#157（本表）、#140（S2 首个消费者）、#80（S3 反例）、#114（S4 反例）、
  #69（S1 原文）、#113 / #121 / #44（复发与同链证据）、#116 / #117（划界两邻）
