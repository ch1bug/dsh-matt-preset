# Deck/视觉 Artifact 工具选型

本 preset 不对 deck/海报类视觉 artifact 的外部工具做选型绑定
（nexu-io/OpenDesign 与 ch1bug/deepseek-design 均不进默认路径）。

## Why this is out of scope

本仓的范围是 ask-matt 工作流的 preset 化与插件化（工作流本体、enforcer、
handoff、批次等组件）；视觉 artifact 生成是**使用时的外部工具选择**，不是
preset 行为的一部分——选哪家工具不改变任何 persona、插件或安装面。为工具
写绑定/指引会把 preset 与第三方工具的迭代节奏耦合，违背 D29（不堆机制）。

届时真需要工具指引，在使用发生的项目里记一条 AGENTS.md 即可（局部知识局部
沉淀），不需要仓级决策票。勘误留档（源自 #24 票面）：真实 iris =
mokuyoaxis/dsh-iris（媒体生成+视觉验证插件）；维护者名下的设计项目 =
ch1bug/deepseek-design（idesign/ippt/ivideo + Studio）。

## Prior requests

- #33: "决策（human）：deck/视觉 artifact 工具选型 OpenDesign vs deepseek-design"
- #24（已关，票面勘误来源）
