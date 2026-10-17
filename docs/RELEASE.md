# Release — 版本锚定与安装（#21）

## 版本锚定方案（family scheme `dsh-v<official>-<r|a><N>`，双通道，ADR-0008）

三段一一对应，同一 commit 上同时成立：

| 通道 | git tag | npm version（tag 去 `dsh-v` 前缀） | 例 |
|---|---|---|---|
| latest（跟 RC） | `dsh-v<official>-r<N>` | `<official>-r<N>` | `dsh-v0.2.1-rc.2-r1` ↔ `0.2.1-rc.2-r1` |
| next（跟 alpha） | `dsh-v<official>-a<N>` | `<official>-a<N>` | `dsh-v0.2.1-alpha.1-a1` ↔ `0.2.1-alpha.1-a1` |
| 打包产物 | `npm pack` → `dsh-matt-preset-<npm version>.tgz` | 同左 | `dsh-matt-preset-0.2.1-rc.2-r1.tgz` |

`<official>` 对齐 DSH 运行时版本（当前 0.2.1-rc.2）；同一 official 上的 preset
迭代递增 `<N>`。通道节奏参考上游 DSH 分发：latest 跟 RC（按需重锚，不做空转
bump），next 跟 alpha；next 版本不进 latest 升级路径。
安装副本的 `VERSION.json` 记录 npm version + 安装时间 + 来源（source/dir/tarball）。

## 发布流程

```bash
npm version <official>-r<N>   # 写 package.json
git tag dsh-v<official>-r<N>
git push --tags               # push 属外部操作，走批末/human 门
npm pack                      # 产物即安装源；npm publish 由 human 拍板（package.json 仍 private）
```

## 安装 / 升级 / 回滚 / 卸载（copy-installer，bin/install.mjs；#41 起本节为安装事实源）

```bash
npx --allow-git=all github:ch1bug/dsh-matt-preset install   # 新用户一条命令；npm 默认禁 git 源 fetch（EALLOWGIT，故需 allow-git；取值随 npm 版本而异，见 npm 文档），等价于以下任一形式
node bin/install.mjs install                 # 默认从本仓源码安装（包发布后可 npx .）
node bin/install.mjs install --from dsh-matt-preset-0.2.1-rc.2-r1.tgz   # 从 tarball
node bin/install.mjs install --from /path/to/checkout                   # 从源码目录
node bin/install.mjs install --root <dir>           # 默认 root = $DSH_HOME/.agent-presets
node bin/install.mjs install --profile <name>       # 默认挂到 profile web；layer 不存在时自动创建
node bin/install.mjs upgrade  [--from …]            # 原地替换（stale 文件清除，记录 previousVersion）
node bin/install.mjs uninstall
node bin/install.mjs --version
```

- **fresh install**：一条命令把 payload（preset.yml / agent.cordis.yml / 插件 *.mjs /
  skills/ / lang-packs/ / sandcastle/）+ 运行时依赖（node_modules/yaml，插件
  `import 'yaml'` 的解析锚点是插件文件自身）拷入 `<root>/matt/`，写 VERSION.json +
  manifest.json。
- **升级**：`upgrade` 原地替换；manifest 记录被替换的旧版本。
- **回滚**：重装旧版本包（旧 tag ↔ 旧 npm 版本一一对应）：
  `install --force --from dsh-matt-preset-<旧版本>.tgz`。
- 已知风险：install/upgrade 先清空目标再拷入，拷贝中途失败会破坏旧安装（无原子
  swap）；此时用 `install --force --from <旧版本>.tgz` 重装即可恢复。

## 与 profile 挂载的关系（两段式）

installer 只负责把文件放到位（preset root 侧）；把装好的 preset 挂进 dsh 会话属
profile 侧（ADR-0001 形态）：profile 的 package.json 以 `link:` 依赖指向安装目录
（`"dsh-matt-preset": "link:<root>/matt"`），经 `dsh.profile.bundles` 挂载
cordis.patch.yml。DSH 0.2.0-rc 起 preset 注册表**不做目录扫描**——放进
`.agent-presets/` 不会被自动发现（旧「自动发现」约定仅对 `dsh-agent-presets`
宿主有效），必须走 bundle patch 挂载。插件行 `dsh-matt-preset/x.mjs` 按包名经该
link 解析——包名 `dsh-matt-preset` 与插件命名空间刻意一致，勿改。

安装/升级后重启 `dsh --profile <p>`（或新开会话）生效，hero-chip 选择
"Matt 工作流"。

## 升级 runbook（link 面：日常驱动的"活面"）

上两节讲的是 **payload 面**（installer 拷贝 + 版本戳，适合发布/冻结版本）。
日常"驱动后续升级"用的是另一条路：**profile 直接 `link:` 指向权威检出**，于是
每次提交都成为候选版本，升级 = 让该面重新装载。2026-10-17 实测的两个 live 面：

| 项 | 值（机器本地状态记在 `<DSH_HOME>/profiles/<p>/REGISTRY.md`） |
| --- | --- |
| 面 | profile `matt-dev`（web，端口 19501；另有 `headless` 一个无 web 面的同款 link 面）|
| DSH_HOME | `~/dsh-matt-home`（msys 侧；与桌面端 `%USERPROFILE%\.dsh`、邻仓 home 完全隔离）|
| 挂载 | `"dsh-matt-preset": "link:<repo>"`（**直连权威检出，无副本 → 无漂移**）|
| 启动 | `<DSH_HOME>/start-matt-dev.sh`（构建脚本 `build-matt-dev.sh`；日志 `<DSH_HOME>/instance.{out,err}.log`）|
| 运行时 | msys 侧源码部署 `<src>`（`<src>/apps/cli/lib/bin.js`，tag 见 REGISTRY.md）|

**升级（link 面）**：权威树 `verify-all` + `privacy-scan` 绿（pre-commit 已强制）→ `git push` →
`<DSH_HOME>/start-matt-dev.sh` 重启该面 → 检查点：

```bash
DSH_HOME=~/dsh-matt-home node <src>/apps/cli/lib/bin.js --profile matt-dev --dump-config \
  | grep -n 'dsh-matt-preset'      # 期望见 `# == dsh-matt-preset` 与 `preset-dsh-matt-preset` 行
```

（`--dump-config` 是只读组合树 dump，实测 exit 0 / 1479 行、含 workflow-core 行即为装好。）

**回滚（link 面）**：把权威树切回上一个绿提交再重启该面。**注意**：权威树同时是 agent 的
工作树，切提交会打断正在写它的会话 —— 回滚要么在无会话写它时做，要么改用 payload 面
（上一节的 `install --force --from <旧版本>.tgz`）。

**桌面端（`desktop`）不能这样装**：profile 由 Electron 应用独占管理，CLI 直接拒绝 ——

```text
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

要在日常 GUI 里用 matt，须走**应用侧**（Plugins 页 / `plugin_manager` 工具的
`install_bundle` / `set_bundle`），形态与桌面既有的 `link:` 依赖一致；装完用应用自述确认活行
（Host Inspect 的 `Config.listConfigs`, `name: "dsh-matt-preset"`，`total: 0` = 没装上）。
那条路是**外部动作**（改的是日常 profile），且 bundle 形态若按 #76 拍板改变，需要重装一次。

**只让绿树成为 live**：link 面没有"安装"这道闸，权威树的任何状态都会直达该面。故约定
升级前跑唯一入口（`node scripts/verify-all.mjs`）与 `privacy-scan`——`.githooks/pre-commit`
已经把二者绑在提交上，绕过它（`SKIP_HOOKS=1`）就意味着把未验证的树推给 live 面。

## 桌面端（`desktop` profile）：迁移与回滚（#47 AC，2026-10-18 #99 落盘）

本节是桌面形态的**迁移 runbook**（此前只有上一节的"不能 CLI 装"一句，没有可执行步骤）。

### 形态事实（实测，勿再假设）

| 项 | 事实 |
| --- | --- |
| `--dump-config` | **不可用**：`dsh --profile desktop --dump-config` → `error: profile "desktop" is managed exclusively by the Electron application` |
| `dsh plugin --profile desktop add|rm` | **可用** —— 装载的写入路径不被独占；`bin/install.mjs` 走的正是这条 |
| profile 层 | `<DSH_HOME>/profiles/desktop/package.json`（`dependencies` + `dsh.profile.bundles`）|
| 稳定存储 | `<DSH_HOME>/.agent-presets/matt`（与 web/headless 面**同一路径**，已统一）|
| 认行 | 按 **`patchId: "preset-dsh-matt-preset"`** 认，**不要按 `name`** —— 该行 `name` 恒为 `@deepseek-ai/dsh-agent-preset`（与内置 preset 同包），按 `dsh-matt-preset` 查**恒返回 0**（实测踩过）|

### 迁移（一条命令）

```bash
node bin/install.mjs install --profile desktop            # fresh
node bin/install.mjs upgrade --profile desktop            # 已有安装，原地替换
```

装完**重启应用**（或新开会话）生效，在 hero-chip 选择模式。

> **#99 起 hero-chip 有 4 个 matt 模式**（`Matt 工作流` / `· PTC` / `· 精简` / `· Cordis`）——
> 一个插件（`dsh-matt-preset`）、四份 preset patch（`presets/*.patch.yml`），
> 装一次全有、卸一次全清（ADR-0015）。从 #99 之前的版本升级时，**必须用 `upgrade`
> 重装一次**：`dsh.bundle.patch` 由单文件变数组属**载体形态变化**，旧的 profile 层缓存
> 不会自己重新解析。

### 旧 store 分叉的迁移（#47 现场遗留）

#47 的现场症状是 **store 路径分叉**：桌面 profile 的 link 指向
`<DSH_HOME>/.agent-presets/dsh-matt-preset`，而 installer 写的是
`<DSH_HOME>/.agent-presets/matt` —— 两边不是同一个目录，于是
**installer 怎么升级都更新不到桌面端**。

**形态自 2026-10-17 起已统一**（两边都是 `.agent-presets/matt`），但**旧机器上那个分叉
store 目录不会自己消失**，且桌面 link 若仍指着它，`upgrade` 依旧写不进去。迁移动作：

```bash
# 1) 看桌面 link 到底指向哪边（分叉的判据）
node -e "const p=require(process.env.HOME+'/.dsh/profiles/desktop/package.json'); console.log(p.dependencies['dsh-matt-preset'])"
#    → 期望 link:<DSH_HOME>/.agent-presets/matt
#    → 若仍指向 .../.agent-presets/dsh-matt-preset，就是分叉现场

# 2) 重装（installer 会写正确路径并重挂 profile link）
node bin/install.mjs install --profile desktop --force

# 3) 确认 link 已改指，再删掉遗留目录（确认前不要删）
node bin/install.mjs --version
rm -rf <DSH_HOME>/.agent-presets/dsh-matt-preset   # 仅在第 1 步确认它不再被 link 之后
```

**判据**：第 1 步的输出变成 `link:<DSH_HOME>/.agent-presets/matt`，且重启后 hero-chip 出现
4 个 matt 模式。遗留目录的删除是**外部动作**（`rm -rf`），须人工确认后再执行。

### 回滚

1. **回滚到 #99 之前的形态**：`node bin/install.mjs install --force --from dsh-matt-preset-<旧版本>.tgz --profile desktop`
   （旧 tag ↔ 旧 npm 版本一一对应，见上文"升级/回滚"节）→ 重启应用。
2. **只回滚到上一个绿提交（payload 面）**：同上，换成该提交打的 tarball。
3. **完全卸下桌面端**（四模式同时消失、无残留）：

   ```bash
   node bin/install.mjs uninstall --profile desktop      # 摘 profile link + 清存储目录
   ```

   验收：`plugin_manager` / 插件视角**不再有** `dsh-matt-preset` 条目，roster 里**四个 matt 模式同时消失**；
   官方四个模式（`standard`/`ptc`/`minimal`/`cordis`）**仍在**（本 preset 从不改它们）。

### 桌面形态的机械断言

`tests/verify-installer.mjs` 有对应用例（`--profile desktop` 跑 install，断言 profile 的
`dependencies` 与 `dsh.profile.bundles` 都含 `dsh-matt-preset`）。该用例与其他 profile-link
断言共用 `#67` 的口径：**PATH 上没有 `dsh` 时响亮跳过**（`SKIP (loud)`，verify-all 记为 `PASS*`），
不硬崩、也不静默当通过。

## 版本条目（Changelog）模板（ADR-0007）

规范：每个版本条目只描述与上一个 tag 的 diff，收录标准 = **升级用户是否会注意
到**。正反例与批次模式一致性见 [adr/0007-changelog-release-convention.md](adr/0007-changelog-release-convention.md)。条目在打 tag 时写，不逐票更新。

```markdown
## dsh-v<official>-r<N>（<npm version>）

### 注意到（升级用户视角）
- <破坏性变化 + 迁移路径>（如有，必写并指向对应 RELEASE.md 节）
- <新增/删除的命令、插件行为、skill、安装方式变化>
- <persona/工作流门禁对会话行为的变化>

### 锚
tag `dsh-v<official>-r<N>` · npm `<official>-r<N>` · 产物 `dsh-matt-preset-<npm version>.tgz`
```

不写：分支迭代过程、重构史、已发布内容重写、未随本 tag 推送的工作。本仓暂无
CHANGELOG.md 文件——首个 tag（首次发版）时按本模板在仓库根创建。

## 验证（本票 AC 证据，2026-10-09）

- 单测：`node tests/verify-installer.mjs`（8 项：fresh/重复拒绝/--force/upgrade/
  未装 upgrade/卸载/--version/tarball）。
- 双环境活体（`node tests/verify-dual-env.mjs`）：**源码目录安装**与 **npm pack
  tarball 安装**各自完整走「安装 →（harness 真实 boot）启动 → 使用」——全量声明
  注册无 payload 错误（仅 harness 缺 host 服务的 waiting-for）、安装副本 persona
  注入 ask-matt、WORKFLOW GATES 基线在场、安装副本 workflow-enforcer 对
  `git push` 实弹触发一次性 ⚠。
