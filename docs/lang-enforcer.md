# lang-enforcer — 语言知识包层

工作流（persona 七门 / workflow-enforcer）的**语言补充层**：项目说什么语言，
就把该语言的"知识指针"（该查哪个 skill）在正确的时机注入模型上下文。
只发知识指针，**永不发流程指令**——流程归七门，知识归语言包，职责物理隔离（D31）。

## 结构

```
lang-enforcer.mjs      # 通用引擎：检测 → 注入（与 workflow-enforcer 同一挂点）
lang-packs/*.yml       # 声明式语言包：加语言 = 加文件，引擎零改动
```

## 语言包格式

```yaml
language: rust
detect:                # 任一文件存在 → 项目说这门语言
  - Cargo.toml
baseline: |            # 会话级基线（每会话注入一次；config.baselineMode: every-turn 可改）
  LANG rust — …知识指向（rust-router / coding-guidelines / unsafe-checker / rust-learner）…
triggers:              # 正则匹配序列化 tool/call；每次匹配只注入一次（消费型）
  - surface: '\.rs\b'
    note: |
      ⚠ lang:rust — …
```

## 注入语义

- **挂点**：`system-prompt/assemble`（prepend），section 名 `lang:packs`，order 96
  —— 排在 workflow:gates（95）之后，知识从属于流程。
- **作用域**：与 workflow-enforcer 相同的 marker 守卫（默认 `ask-matt`），
  minimal/code 会话不受影响。
- **检测**：`detect` 文件在 `session.meta.cwd` 下命中即缓存（正结果缓存，
  负结果每轮重查——项目中途新增 Cargo.toml 也能被捕获）。
- **触发**：`session/event` 的 `tool/call` 记最近一次调用，下一次 assemble 消费
  （匹配与否都消费——同 workflow-enforcer 语义，绝不为同一次调用重复注入）。
- **净化**：注入文本经 `{{…}}` 中和处理（防 prompt 渲染炸裂）。

## 项目级覆盖

仓库根放 `lang-gates.yml`：

```yaml
disable: [rust]     # 本项目关闭 rust 包
baseline: "off"     # 只关基线，保留触发提醒
```

## 设计依据

- **D31**：skills 装好后"可发现 ≠ 会使用"；在 .rs 编辑 / cargo 运行 / 依赖变更
  这三个最需要 rust-skills 的瞬间精准提醒。
- **D27**：persona 零改动（系统提示词缓存不受影响）。
- **D29**：不做量化传感器，只做提醒注入；机制权重最小（数据驱动的包，不加代码分支）。

## 未来语言

加 `lang-packs/go.yml`（detect: go.mod）、`lang-packs/python.yml`
（detect: pyproject.toml / requirements.txt）即可，引擎按 detect 文件自动路由。
