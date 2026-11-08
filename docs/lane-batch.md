# 泳道批运行手册（DSH Team Lead 编排形态）

**定位**：本手册是泳道批的 **runbook**（操作细节）；产品靶心与权威叙述 = ADR-0018，
判据正文 = `workflow-component-lane.txt`（组件，`config.components` 控挂载、默认全开）。
组件正文承载**触发条件与判据语义**（声明泳道批时注入 Lead 会话）；本手册承载**怎么操作**
（检测怎么做、面怎么装、成本多大）。两处判据一致，机械钉在 `tests/verify-lane-component.mjs`；
手册不复述七门与批纪律（那是 workflow-core / batch 组件的本位）。

**读者**：Team Lead = 挂 matt preset 的 DSH 会话。lane implementer / merger = Lead 用
`spawn_teammate` 起的 teammate（fresh context）。

## 1. 能力前置检测与 loud 降级（D47）

开任何泳道批之前，Lead 先做**能力前置检测**：

- **查什么**：本会话的**工具面**——`spawn_teammate` 与 `create_worktree` 两个工具名
  是否可调（在工具目录里可见、可调用）。**判据是工具面在场，不是版本号或配置文件猜测**：
  experimental 面装没装，只有会话工具面说了算。
- **任一缺席** → 显式说出来（缺席哪个工具）、指向本手册 §2 的 forge-bundle 安装 runbook、
  然后**降级走既有串行 batch 模式**（D47：不静默、不假设在位）。降级后泳道组件的其余
  判据不再适用，串行 batch 的全部门与节奏照旧。
- **装不齐 = 顺延，不降级造假**：安装 experimental 面是外部动作（D21），需要 human
  确认；human 未确认安装时，lane batch 顺延——**绝不允许**用普通 subagent 模拟并行
  lane 交差。
- 这套语义与组件正文 `lane-batch` 节 CAPABILITY PRECHECK 条判据一致；组件承载「何时
  检测、缺席什么行为」，本节承载「检测的操作对象」。

## 2. experimental 面安装 runbook（源码 rc.1 装法）

**不采 npm 安装路径**：npm 上 dsh 只到 alpha.2，rc.1 源码未发——npm 装出来是版本错位面，
与 runtime 锚对不上。唯一采纳路径 = **上游检出源码**：

1. 上游 dsh 检出到本地目录（下称 `<runtime>`；须包含 `node_modules/@deepseek-ai/`），
   检出版本线与本仓 runtime 锚一致（本仓锚 = `scripts/runtime-anchor.mjs` 从
   `package.json` 派生；现锚 dsh-v0.2.2-rc.1 线）。
2. 在 DSH 里装 **forge-bundle**（experimental 装配面；票面勘察：cordis.patch.yml 含
   `worktree` + `tool-worktree` + forge 三件套 + panel）。安装动作走 DSH 的插件安装面
   （plugin add / Plugins 页）——**这是外部动作（D21），先报告等 human 确认再执行**。
3. 装完**重开 DSH 会话**，按 §1 重新检测：`spawn_teammate` / `create_worktree` 出现在
   会话工具面 = 前置满足；仍未出现 → 顺延，不造假。
4. 装齐是**首跑（AC5）的前置条件**；首跑本身由主会话在 DSH 侧收口（工作流外），并行度
   2 保守起步，只作编排试跑、不作竖切证据。

## 3. 排批与 lane 数收敛（#136）

- lane 资格判据 = 票面四字段（touch-set / 接口契约 / 影响面 / proving），格式见
  `docs/agents/issue-tracker.md`「泳道批票面」节；普通（非泳道）批不强制。
- 机械审计 = `node scripts/lane-audit.mjs`（消费 `frontier --json` + 票面字段）：输出
  两两相交矩阵与**串行分组建议**。**touch-set 相交即串行**（同 lane 排先后，或合并成
  一条 lane），绝不并行——这是排批维度判据，不是 ready 第四维（frontier 三维不动）。
- **lane 数 = 串行分组数**（由票审计结果决定，不由偏好决定）；**默认 3，硬上限 4**；
  超过上限的分组延后到下一批；不足默认数的批按真实大小跑。首跑并行度 2
  （touch-set 不相交的小-中票）。

## 4. 编排全流程（Lead 视角）

1. **宣告**：human 宣告泳道批（组件正文注入生效）。
2. **检测**：§1 能力前置检测；缺席 → 降级串行 batch，流程到此为止。
3. **exploration 一次**：exploration subagent 跑**一次**，notes 落**仓外**目录
   （workspace 级，不在任何 lane worktree 里）——后续所有 teammate 读同一份 notes，
   不各自重探。
4. **排批**：§3 lane-audit 收敛 lane 数；Lead 在 agent-team **任务板**建票条目——
   #136 四字段映射原生字段：touch-set → `writeScopes`、阻塞边 → `blockedBy`、就绪 →
   `ready`、认领 → `ownerName`、推进 → `status`。
5. **起 lane**：每 lane implementer = Lead `spawn_teammate`（**fresh context**，不带
   批历史）；teammate 在**自己会话内**调 `create_worktree` 起隔离工作树（branch +
   worktree 并切入）。checkout pool、自动命名、被删恢复全部由 DSH `worktree` 服务承载
   ——Lead **零手工** `git worktree`。红线：lane 之间**不共享构建产物目录**（Rust
   的 target 一类工作树本地产物都算）；唯一允许的跨 lane 共享 = 后端 / 内容寻址缓存。
6. **依赖补齐**：每条新 worktree 先跑 `scripts/link-runtime-deps.mjs`（§5）。
7. **动态 kick**：frontier 前移（一条 lane 完工释放槽位、或阻塞票转 ready）→ Lead 立即
   `spawn_teammate` 拉下一条 lane——不逐票叫醒、不等 human 派票。
8. **merger 专职**：lane 成果由专职 merger teammate 并线（owns 集成分支）；implementer
   不自并，Lead 只做终审。
9. **lane 收尾**：每条 lane 收口时跑磁盘软守卫（§6）；超阈值 → 该 lane 停手 + GC。
10. **收口 = 整批一 PR**：lane 分支汇成**一个 CR**（forge 语义，forge-github 驱动），
    绝不逐 lane 开 PR。与 ADR-0002 的关系（绑定句，组件正文同款）：ADR-0002 的「批末
    push 门」升级表述为「批末 PR 就绪门」——push 分支（非 force）与 `gh pr create` 在
    D21 pre-authorized 面内；**merge 恒为 human 门**（不在 pre-authorized 面）；首跑
    CR 开出不 merge。ADR-0002 文本本身不改。
11. **批末对账**：`node scripts/batch-reconcile.mjs`（#165）——任务板投影 × git ×
    任务清单三源交叉；票进度/停驻以任务板为权威，未推清单以 git 为权威。批末 wrap-up
    卡与 push checkpoint 照串行 batch 机制不变（batch 组件本位）。

## 5. worktree 依赖补齐与冷启动成本

本仓 `node_modules` 不入 git（D43），worktree 里没有依赖——**每条新 worktree 在首次
构建/测试前必须跑**：

```
node scripts/link-runtime-deps.mjs            # 或 DSH_RUNTIME=<runtime> 前缀
```

它从 `<runtime>`（上游 dsh 检出，含 `node_modules/@deepseek-ai/`）只建链接不复制，
补齐仓根 `node_modules/yaml` 与 `tests/node_modules/{yaml,@deepseek-ai}` 两处
（#88 起带重指与锚点核对，版本不符响亮 exit 1）。

**冷启动成本**（实测区间，单次值进证据文件 `.scratch/verify137/`，文档只写区间）：

- `link-runtime-deps.mjs` 在**链接已存在**态重跑：约 **1.8–2.2 s**（本机 3 次
  exit 0 实测，2026-11-08）；全新 worktree 首次建链更慢（含 lstat 全表），具体区间
  待 AC5 首跑记录，不在此编数。
- worktree 建树本身 = git checkout 成本（树大小决定）；首跑 verify-all 快集为分钟级
  （历批读数两位数秒到两百秒级，见各批进度行）。

**Lead 排期含义**：lane 起步的冷启动是**每 lane 一份**，4 条 lane ≈ 4 份冷启动并行发生
——这是泳道批用磁盘与 CPU 换墙钟时间的直接来源，也是 §6 存在的原因。

## 6. 磁盘软守卫（Windows 无目录级硬配额）

- **何时**：每条 lane 收尾时跑一次（组件正文 DISK SOFT GUARD 条判据）。
- **怎么跑**：

  ```
  node scripts/lane-disk-guard.mjs --pool <worktree-pool-dir>
  ```

  阈值解析链：`--threshold-gb`（CLI）→ `lane-gates.yml`（仓根，`thresholdGb:` 一键）
  → 默认 **20 GB**。**cwd 前提**：缺省的 `lane-gates.yml` 从**当前工作目录**解析——
  不在仓根跑这条命令时，仓里写好的覆写不会生效，必须 `--config <仓根>/lane-gates.yml`
  显式点名（落到默认档时 stderr 会点名「repo override NOT applied」，可事后归因）。
  本仓覆写示例：`lane-gates.yml` 写 `thresholdGb: 5`（票面：本仓
  5 GB 足够）。配置**在场但坏值** = 响亮 exit 2（写了就要写对）；**缺席** = 回落默认
  （正常形态）。
- **判据**：超阈值 → digest 一行 `⚠`（含路径、实测大小、阈值、停手 + GC 指令），
  退出码 1 = **该 lane 停手信号**——先 GC pool（删已收口的 worktree，走 DSH worktree
  服务 / Lead 会话动作；守卫脚本只量不删，删除属 D21 面）再重跑确认，然后才继续。
  未超 → digest 一行 `✓`，退出码 0。
- **测量口径**：递归累计文件字节；**符号链接 / junction 不跟随不累计**（du 口径——
  link-runtime-deps 建的依赖链接指向 `<runtime>`，不把同一份依赖按 lane 重复计）。
- **测试**：`tests/verify-lane-disk-guard.mjs`（G 纯函数 + C CLI 真跑：阈值覆写、
  超限路径 exit 1 + ⚠、junction 不计、用法错误响亮 exit 2）。

## 7. 边界与不做

- lane 隔离 = DSH `create_worktree` 服务（**非容器**）；lane 级长效沙箱不做（#138 专票）。
- 契约化票面与就绪判定归 #136（frontier 三维不动）；批末机械对账归 #165。
- 分工线照 ADR-0006 不改判：lane 是**白天车道**（人在环），夜间沙箱批（ADR-0003）另有
  载体。ZCode 侧 workflow 编排服务本仓开发、不迁移不废弃（ADR-0018 Consequences）。
