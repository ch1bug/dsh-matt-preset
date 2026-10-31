# Preset roster 对齐：官方取证配方与登记差异（#117，方向 b）

四个 matt 模式的 roster 与官方对应模式的差异，拍板（2026-10-24 grill，#117）走
**方向 b 有据差异**：保留 matt 增量、不追平官方形态，但差异**逐模式逐行登记**
（多与少都要理由）并由机械守卫钉住。本文是**取证配方 + 版本锚现查口径**的落点；
差异表本身不在此抄——单一数据源见下。

## 官方取证配方（npm tarball，可复跑）

「官方 preset 不可读」是已证伪的认知：官方包发布在 npm，tarball 内
`package/presets/{standard,ptc,minimal,cordis}.patch.yml` **可读**。取证命令
（联网；测试套件本身不联网对账官方版本线——冻结快照即离线事实源）：

```bash
# 1) 版本锚现查：读**全部 dist-tags**做 semver 方向比较——不要用
#    `npm view … version`（只读 latest tag；实测 2026-10-25 读数
#    latest=0.0.1-rc.1 低于锚 0.2.1-rc.2，而更新的 0.2.1-rc.3 挂在 next 上，
#    该命令对两半都给错答案：永远误报「需重取」+ 漏报真更新）。
npm view @deepseek-ai/dsh-web-app dist-tags --json
# 任一 dist-tag 的版本 semver 高于快照锚（meta.sourceVersion）→ 拉该版 tarball
# 按下面 2)–3) 重取读数比对；preset 面无变更则只更新锚，有变更则连
# registeredDiff 一起重算。确认锚定版本仍可取（历史版本点名查询）：
npm view @deepseek-ai/dsh-web-app@0.2.1-rc.2 version

# 2) 拉 tarball 并解出官方四档 preset patch（Git Bash / POSIX shell）
npm pack @deepseek-ai/dsh-web-app@0.2.1-rc.2
# ⚠ npm pack 本地落盘名带 scope 前缀（deepseek-ai-dsh-web-app-…），与 registry
#   URL 的路径段（…/-/dsh-web-app-…tgz）不同——实测踩过，别按 URL 抄文件名。
tar -xzf deepseek-ai-dsh-web-app-0.2.1-rc.2.tgz package/presets
ls package/presets/   # standard / ptc / minimal / cordis 四份 .patch.yml

# 3) 行级读数（行 id 清单与行数——判据与守卫同一正则口径）
grep -o '^\s*- id: .*' package/presets/standard.patch.yml | sed 's/^\s*- id: //'
grep -c '^\s*- id: ' package/presets/{standard,ptc,minimal,cordis}.patch.yml
```

## 冻结快照与登记差异（单一数据源）

- **快照**：`tests/fixtures/official-presets-roster-v1.json` —— 官方四档全部
  `- id:` 行（任意缩进深度，含 `preset-<mode>` 声明行；比较时两侧统一排除
  `preset-*`——官方声明行不是缺口）+ 版本锚（`meta.sourceVersion`）。
- **登记差异面**：同文件 `registeredDiff`（每配对 added/omitted 逐行带
  `why` 理由键，理由文本在 `reasons` 表）——**独立手写的期望表**，不是实算回显。
- **守卫**：`tests/verify-roster-alignment.mjs` —— A2 断言每配对实算差异（与
  `tests/verify-preset-modes.mjs` M3c/M6c 的形态断言互补）
  **恰好等于**登记面（双向集合相等，多/少/漂移任一方向即红）；A3 钉
  `tool-plugin-market` 与官方同 name、紧邻 manager 之后（Z1）；A4 钉模式
  description 的承诺面为真（含 `matt-minimal`「能力面与标准档完全一致」的
  行集合全等断言）。`tool-plugin-market` 的 `disabled` 逐份跟 manager 同款
  （Z2）由 `tests/verify-bundle-sync.mjs` N11/N11c 钉（同族判据一处落点）。
- **现查读数**：`node tests/verify-roster-alignment.mjs`（输出四配对的
  新增与删除行计数（added、omitted）与承诺面核对，逐行明细在
  `tests/fixtures/` 下的 official-presets-roster-v1.json，行为断言见
  `tests/` 下的 verify-roster-alignment.mjs，载体合成事实源在 `lib/`；改动载体后按
  `scripts/` 下的 regen-bundle.mjs 重生成（四份载体在 `presets/`））

## 何时重取快照（有意重取，不是漂移）

官方版本线移动（`npm view … dist-tags --json` 里任一 tag semver 高于
`meta.sourceVersion`——见上面配方第 1 步的坑注）或上游 preset 面变更时：
按上面配方重取读数 → 更新 fixture 的 `official`/`meta`（版本锚与捕获日期）→
`registeredDiff` 随新读数重算（每条差异重写理由，含「官方新增行是否跟进」的
判断）→ 守卫全绿。随证据源有意重取适用 D48 先例（文本政策重取不是漂移）；
**手抄一份进文档/ADR = 第二份清单，禁止**。

## 差异理由的票据指针

理由文本（fixture `reasons`）引用的决策落点：ADR-0001（`time-context` /
`tool-schedule` 退役口径，#117 拍板不回补/不追平）、#116（`tool-presentation`
挂行——方向 A **已交付**：该行已进 matt-ptc 载体，官方 ptc 的差异表不再登记它）、
ADR-0015 §4（matt 特征面与按模式差异化 roster）、#92（`tool-ralph` 等常驻口径）、
SG10（`tests/verify-silence-guardrails.mjs` 对「承诺行未挂」的登记检测）。

## 边界

- 七门语义、编排/委派正文、persona 文案不在对齐面（#117 Out of scope）。
- 全量对齐（方向 a：`matt-minimal` 裁到官方极简能力面）留待将来产品判断。
- 官方四模式本身保留、不隐藏、不覆盖（ADR-0015 §3）。
