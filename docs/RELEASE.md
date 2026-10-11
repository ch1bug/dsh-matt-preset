# Release — 版本锚定与安装（#21）

## 版本锚定方案（family scheme `dsh-v<official>-r<N>`）

三段一一对应，同一 commit 上同时成立：

| 锚 | 形态 | 例 |
|---|---|---|
| git tag | `dsh-v<official>-r<N>` | `dsh-v0.2.0-rc.2-r1` |
| npm version | `<official>-r<N>`（tag 去 `dsh-v` 前缀） | `0.2.0-rc.2-r1` |
| 打包产物 | `npm pack` → `dsh-matt-preset-<npm version>.tgz` | `dsh-matt-preset-0.2.0-rc.2-r1.tgz` |

`<official>` 对齐 DSH 运行时版本（当前 0.2.0-rc.2）；同一 official 上的 preset 迭代递增 `<N>`。
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
node bin/install.mjs install --from dsh-matt-preset-0.2.0-rc.2-r1.tgz   # 从 tarball
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

## 验证（本票 AC 证据，2026-10-09）

- 单测：`node tests/verify-installer.mjs`（8 项：fresh/重复拒绝/--force/upgrade/
  未装 upgrade/卸载/--version/tarball）。
- 双环境活体（`node tests/verify-dual-env.mjs`）：**源码目录安装**与 **npm pack
  tarball 安装**各自完整走「安装 →（harness 真实 boot）启动 → 使用」——全量声明
  注册无 payload 错误（仅 harness 缺 host 服务的 waiting-for）、安装副本 persona
  注入 ask-matt、WORKFLOW GATES 基线在场、安装副本 workflow-enforcer 对
  `git push` 实弹触发一次性 ⚠。
