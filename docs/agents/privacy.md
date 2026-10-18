# 脱敏 / 历史重写流程（privacy.md）

**本仓是 PUBLIC 仓**（`gh repo view --json visibility` 自查）——推上去就是公开。

判据的**机械守卫**是 `scripts/privacy-scan.mjs`：`tests/verify-privacy-scan.mjs` 在
`node scripts/verify-all.mjs` 里跑 → `.githooks/pre-commit` 自动带。口径与邻仓
`dsh-shell-host` 的同名脚本**对齐**（本机运行时身份 + 三种布局形态 + `DSH_HOME` 下的 denylist），
本仓多两块：**发布面全扫**（提交消息 / 提交身份 / ref / 拟提交消息）与 **tracker 面**（`--gh`）。

本文是**流程**的唯一来源；本仓这一次（2026-10-16）的现场事实记在
[dev-environment.md](../dev-environment.md) §0.0。

## 0. 先判「要不要重写」

| 情形 | 处置 |
| --- | --- |
| 只有**现树**有（历史干净） | 改占位符 → 提交；守卫挡复发 |
| **历史**里有（已推送） | §2–§4 的历史重写 |
| 只在 **issue / 评论**里 | §5 tracker 口径 |
| 只在**未跟踪**文件（`.scratch/`、临时目录、会话日志） | 直接删 —— 它没被推上去 |

先摸清落点，**别边找边改**。两条探针纪律（都是实测教训）：

```bash
node scripts/privacy-scan.mjs --verbose   # 现树：身份 + 布局 + denylist（大小写不敏感）
node scripts/privacy-scan.mjs --gh        # 加 tracker（issue 正文 / 评论；内部已 --paginate）
git log --all --format='%an <%ae> | %cn <%ce>' | sort -u    # 署名 / 邮箱
git log --all --format=%B | grep -inE '<类别词>'             # 提交信息
```

- **大小写**：探针一律 `-i`。字面量替换会漏**首字母大写 / 全大写 / 混合大小写**等变体
  （2026-10-16 实测：一次 tracker 打码漏掉了大写变体，靠守卫的结构规则才抓到）。
- **分页**：`gh api` 不带 `--paginate` 只给你第一页。实测"前 30 条评论全绿"是**假象**——
  第 100+ 条评论里还有个人路径。tracker 一律分页后再判。
- **复查只能用守卫，不要手写 grep**：自己拼的探针模式通常**比判据窄**。实测：tracker 打码后
  用"个人 token 模式"复查得 0，漏掉**一整类**布局命中（5 处 `<盘符>:\Work\…`，含一条自己的说明评论）；
  换 `node scripts/privacy-scan.mjs --gh` 才现形。**规则改了就先跑守卫。**

## 1. 一次枚举全部类别，再动手（一遍跑齐）

范围由 human 拍板（2026-10-16 那次 = **个人用户名 + 本机布局路径**）。一次枚举这几类，
**大小写两形**：

1. 机主用户名 / 呼号 / 别名；
2. 家目录（`X:\Users\<user>`、`/home/<user>`、`/c/msys64/home/<user>`）；
3. 检出与旧布局路径（`<盘符>:\dsh-*`、`/<盘符>/dsh-*`、`<盘符>:\Work\…`）；
4. 署名与邮箱（author + committer，含 tag tagger）；
5. 真机 host 名与内网 IP；
6. 其它环境指纹（临时目录名、内部端口、机器名）。

**一份规则文件、一遍重写。** 分几遍做的代价是重复：改哈希 → 重修引用 → 重新验收
（本仓 2026-10-16 实际分了三段：用户名 + 布局、提交身份、tracker；邻仓记录同一课约 100 次工具调用）。

## 2. 飞行前

- **工作树必须干净**（`git status --porcelain` 为空）：`filter-repo` 会 **reset 工作树**，
  未提交的改动会**丢**（要留下的先 `git commit`）。
- **退路**（缺了就不要动刀）：`git bundle create <备份>.bundle --all` + `.git` 全量副本
  （保留 reflog / packed-refs）+ 基线存证 `git rev-parse HEAD origin/main <tag>` 与提交数。
  实测：一次误用 `--path-glob` 把 94 个文件滤成 35，靠这两份退路完整回滚。
- 远端检查：`gh api repos/<o>/<r>/branches/main/protection`（是否保护）、
  `gh api repos/<o>/<r>/forks --jq length`（有 fork 就有副本）、`git ls-remote --heads --tags origin`
  （别忘侧分支与 tag）。
- **denylist**：`<DSH_HOME>/privacy-denylist.txt`（一行一个 token、`#` 注释，**永不进仓**），
  覆盖运行期推不出来的那类（呼号、旧机用户名、个人邮箱、内网 host/IP、旧布局根）。

## 3. 重写（一遍跑齐）

工具是 `python -m git_filter_repo`（本机 `git filter-repo` 子命令不在 PATH —— pip 装的是 user site）。

```bash
# 规则文件语法：pattern==>replacement —— **等号两侧不留空格**（留了会当成模式的一部分、静默不命中）
python -m git_filter_repo --dry-run --force \
  --prune-empty=never --prune-degenerate=never \
  --replace-text rules.txt --replace-message rules.txt --mailmap mailmap.txt
# 门禁：比对 .git/filter-repo/fast-export.original 与 .filtered 的 token 计数（全 0），
#       并核对 "Parsed N commits" 与提交数、替换前后文件数/文件名不变 —— 才跑正式那遍
python -m git_filter_repo --force \
  --prune-empty=never --prune-degenerate=never \
  --replace-text rules.txt --replace-message rules.txt --mailmap mailmap.txt
```

- `--replace-text` 管 blob 内容、`--replace-message` 管提交消息、`--mailmap` 管**提交身份**
  （author + committer；tag tagger 一起归一）；顺手把 `git config user.name/email` 也改成公开身份。
- `--prune-empty=never --prune-degenerate=never`：否则 tag / 退化提交会被顺手裁掉。
- **别用 `--path-glob` 去"限定替换范围"**：它的语义是**只保留**这些路径
  （`git filter-repo --help` 原文 "Glob of paths to include in filtered history"）。
  要按面区分（例如"脚本里的在用默认值保留、文档里占位符化"）→ 改文件本身，别用路径过滤。
- filter-repo 会**摘掉 `origin`**（防误推）→ 之后 `git remote add origin <url>` 补回。

## 4. 飞行后

1. **本地校验**：提交数 / 文件数不变、`git status` 干净、
   `git grep -l -i <token> $(git rev-list --all)` 为空、身份集合只剩公开身份。
2. **引用哈希重映射**：文档 / 注释 / **tracker** 里对旧提交的引用要落到终态。
   **别自己反推 filter-repo 的 commit-map**；稳妥做法是用备份镜像按提交主题对齐
   （`git --git-dir=<backup> log -1 --format='%H%x09%s' <旧令牌>` 取主题，再在现历史里找同一主题）。
3. 本地清账：`git reflog expire --expire=now --all && git gc --prune=now`。
4. **推送**：`main` + 侧分支 + tag 一起，**带 lease**：
   `git push --force-with-lease=main:<推送前远端 SHA> origin main`；tag 不是快进 → `git push --force origin refs/tags/<tag>`。
5. **从远端 refs 回读校验**（不看本地）：`git fetch origin --prune --force --tags`，
   再对 `origin/main`（含侧分支与各 tag）逐个 `git grep -i`；GitHub 侧抽查原始文件与代码搜索。
6. **部署 / 安装副本**：历史分叉，这一次**不能 `merge --ff-only`** →
   `git fetch origin` + 一次性 `git reset --hard origin/main`；之后恢复常规同步。
7. **更正 tracker 里引用的旧哈希**（评论 `gh api --method PATCH .../issues/comments/<id>`，
   正文 `gh issue edit <n> --body-file <file>`）。

## 5. Tracker 口径

两条都合规，差别在**动不动他人可见的原文**：

- **本仓 2026-10-16 的做法（human 拍板）**：把个人路径**打码**（4 个 issue 正文 + 6 条评论 →
  占位符），改前逐条**留原件**（GitHub 不保留旧版），改后回读复扫。
- 邻仓的做法：**不追改历史正文/评论**，只补一条隐私说明评论（处置 + 验证 + 未清面）。

要点：说明评论**不复述串本身**（复述等于再公开一次）；tracker 是权威表示，写坏没有第二份。

**平台侧边界**：被重写掉的旧提交在 GitHub 上**仍可按旧 SHA 直接访问**——force-push 不回收
对象 / 缓存。彻底抹除需向 GitHub Support 申请（有 fork 先处理 fork）。
本仓 2026-10-16 的决定是**不 purge**（GitHub 呼号本已公开绑定到人，脱敏属原则性收口，泄露面可控）。

## 6. 防复发（已就位）

- `scripts/privacy-scan.mjs`：
  ① 本机运行时身份（`userInfo().username` + `homedir()` 两形）；② 四种布局形态
  （`<盘符>:\dsh-*`、`/<盘符>/dsh-*`、`<盘符>:\Work\`、**本机安装布局** `<盘符>:/<目录>/<再一级>`；
  **标准安装点保留** —— `C:/msys64` 与 `Program Files` 一族都在豁免表里）；
  ③ `<DSH_HOME>/privacy-denylist.txt`；④ 发布面全扫（tracked 内容 / 全部提交消息 / 身份 / ref /
  拟提交消息），`--gh` 再加 issue 正文与评论。大小写不敏感，**整行打码**不回显 token。
  验收 = `tests/verify-privacy-scan.mjs`（F1–F18：夹具红/绿两面 + 真实仓常驻行），
  随 `node scripts/verify-all.mjs` 进 pre-commit；确属误报才在该行内联 `pii-allow` 并写理由
  （比整仓 `SKIP_HOOKS=1` 细一档，且例外留在 diff 里可 review）。
  - **② 的「本机安装布局」这一条（#107）为什么是"形状"而不是"词表"**：把 `Program Files`
    写进词表只能抓住标准根，而票面点名的四条里恰有两条是**同一台机器的自定义安装根**
    （`Other_Program_Files`、`Cadence`）——按词表追就是 D15 记的"无收敛军备竞赛"。
    故判据取**形状**：`<盘符>:/<目录>/<再一级>`，一级目录落进 `ALLOWED_INSTALL_ROOTS` 的不报。
  - **豁免面 `ALLOWED_INSTALL_ROOTS` 的判据 = "换台机器它还在不在"**：在（`Program Files` /
    `msys64` / `WINDOWS` / 占位符 `x`·`me`·`u`…）就不是身份；不在（`Other_Program_Files` /
    `Cadence` / `D:\Tools`）就是。它与 `ALLOWED_USERS` 同性质——**豁免面必须显式**，
    否则守卫会把自己与邻仓的合法写法判红。
- `AGENTS.md` 的硬规则 + 指针；`sync-skills.{ps1,sh}` 的上游目录改 `SYNC_SKILLS_UPSTREAM`
  **必填**（本机路径不再写死，缺失即响亮报错）。
- **跨仓口径**：邻仓同一脚本，改判据时两边一起看（`dsh-shell-host/docs/agents/privacy.md`）。
  - **共享占位符字形**（两边白名单要保持一致）：`<user>` / `<repo>` / `<work>` / `<盘符>` / `<src>` /
    `$HOME` / `%USERPROFILE%` / `$(whoami)` / `~`，以及邻仓既有的 `me` / `u` / `x` / `alice`。
    任一边引入新写法就同步补——否则跨仓跑守卫会互相报红（实测：我方曾因漏放行 `me`/`u`/`x`/`alice`
    把对方干净的仓报红 6 处）。
  - **待移植：引用哈希守卫**（邻仓 `dsh-shell-host/tests/doc-references.spec.ts` 第 3 条）。口径 = **白名单**
    `HASH_ALLOWLIST`（会话 id 也登记进去，注释写明"这是会话 id 不是提交"）+ `docs/adr/**` 整体排除；
    **不按"8 位 hex"之类的形状放宽**——那会连真实短 SHA 引用一起放过，而它们正是该守卫要抓的。