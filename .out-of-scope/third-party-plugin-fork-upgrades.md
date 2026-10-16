# 第三方插件的 fork 适配与上游 PR

本仓（dsh-matt-preset）**不承接**第三方 DSH 插件的 fork 维护、lane 适配与上游 PR。

## Why this is out of scope

本仓的范围是 ask-matt 工作流的 preset 化与插件化：工作流本体（workflow-core / profile 档位）、
enforcer、handoff、批次机制与安装器。第三方插件（deepseek-design / OpenDesign / 各家 LLM provider
适配这类）与宿主的 peer lane 兼容问题，属于**插件作者（上游）或使用它的项目**的兼容面：

- **发货面错位**：本仓的产物是 preset payload；替某个第三方插件做适配不会随 preset 发给用户，
  用户拿到的仍是那个第三方包。修在这里等于替别人维护，却没有交付通道。
- **发布节奏被绑定**：写进本仓就把 preset 的 tag/CI 节奏绑到第三方仓的版本线上。本仓跟随的是
  **宿主 rc 线**（ADR-0008），那条锚只约束本仓自己，不承诺生态内其它插件的 lane。
- **正确落点在发生地**：真需要时，在使用该插件的**项目**里记一条 AGENTS.md / README（局部知识
  局部沉淀），或维护该项目的 fork；要影响上游就直接向上游提 issue/PR——两条路都不经过本仓。

同类先例：deck/视觉 artifact 的外部工具选型（[deck-visual-tooling.md](deck-visual-tooling.md)）
也是按"选型/绑定属使用时的决策，不是 preset 行为"拒绝的。

## Prior requests

- #25: "fork-and-upgrade: adapt Devin-AXIS/deepseek-design to dsh 0.2.x, upstream the PR"
  （同一 lane 碰撞在相邻工作区也有记录，由各自项目跟踪）
- #20（关联背景，非本仓需求）: "dsh-llm-mimo: integration.test.mjs 3 例失败" —— 维护者补充，
  该工作区当时是"把多模态 LLM 接口从 pi(-ai) 委托切换成 MiMo"的规划，失败是切换中间态；
  规划已取消，票随之 `wontfix`。