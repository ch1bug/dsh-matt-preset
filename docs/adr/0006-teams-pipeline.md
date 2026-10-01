# ADR-0006: Teams × implement-spec 白天流水线（pilot 实证）

- 状态：草案（pilot 完成，待 human 复核后定稿）
- 日期：2026-10-01
- 关联：issue #11、ADR-0002（批末 push 门）、ADR-0005（/implement-spec 延期）、ADR-0003（sandcastle）

## 背景

ADR-0005 把上游 /implement-spec（spec→tickets→frontier 并行 implementer→串行
merge→整支 code-review）延期，理由是 D20 一票一会话优先。本 pilot 用 DSH 原生的
Agent Teams（任务板 blocked_by=任务图、2 个 durable teammates、send_message 稀疏
信号）在**同一会话内**复刻该流水线，验证它是否与 D20/批末 push 门兼容。

## pilot 形态（2026-10-01，载体 #11 sandcastle 机械支撑 T1–T4）

- Lead（本会话，fresh）：读 spec → 建 integration branch → 预建 4 个票分支
  worktree → 任务板建票（blocked_by 按 spec）→ spawn 2 implementer。
- 分工按依赖拓扑：impl-a 取 T1→T4，impl-b 取 T2→T3（T3 blocked_by T2，
  T4 blocked_by T1/T2/T3），frontier 始终有 2 张并行票。
- 每票：claim → worktree 内红→绿实现 → commit → merge integration tip →
  complete → 一行指针报 lead。Lead 为 merger：终审 diff → 串行 --no-ff 合入
  integration → 亲自复跑冒烟。
- 票全完：tests/ 9/9 不回归 → 双轴 code-review（并行子代理）→ 报告等 human
  确认 push（ADR-0002 门，本 pilot 未 push）。

## 实证数据

- 墙钟：≈10 分钟（09:21–09:31），5 张票（T1–T4 + 1 张飞行中发现的集成缝补票
  T2b）全部收口；两个 implementer 全程无空转等待超过一个 frontier 波。
- 写域踩踏：0 次（worktree + 单文件 write_scopes 隔离；任务板对 T2/T2b 的
  write-scope overlap 仅出 warning，实际串行执行无冲突）。
- 返工：1 次（T2b——T3 给 run-ticket 新增 exit 7，night-run 的 status map 未
  登记跨文件集成缝；implementer 主动上报、Lead 开补票、原作者认领，闭环约
  3 分钟）。另有 1 处合并顺序导致的文档时滞（T4 在 T2b 合入前写"映射随后补
  齐"），merger 一行修正。
- 通信：全程指针式（票号+分支+SHA+冒烟命令），无大段代码复制。
- 任务板 frontier 前移正确：blocked_by 解锁时点与 spec 依赖图一致；teammate
  序列末尾自然休止，需 Lead send_message 叫醒领下一张（task-4 就绪时 impl-a
  已 idle——这是 DSH teammates 的唤醒语义，不是缺陷，但编排者要记得推）。

## 结论

1. **适用规模/票型**：3–6 张机械票、依赖图浅（1–2 层）、写域可静态声明
   （write_scopes 单文件或不相交目录）的系列最适合。决策票、写域重叠票
   （须串行或合并）、需要长探索的单票不适用——后者留在 D20 单会话 grain。
2. **worktree 纪律成本**：Lead 预建 worktree（每票一分支一目录）基本消除踩
   踏；成本是编排前的 2 分钟机械 setup + 收尾 worktree 清理。值得。
3. **teammate 回收阈值**：序列末尾 teammate 立即休止不烧上下文；唤醒成本是一
   条 send_message。建议：批次结束（无后继票）即不再唤醒，让 teammate 自然
   回收；同批内尽量排满序列（本次 2+2/2+1 分配）减少唤醒次数。
4. **与 D20/批末 push 门兼容**：完全兼容——pilot 本身是"一个会话一条流水
   线"，票的 grain 从"会话"降到"teammate 任务"，但决策仍在 Lead/human
   （gate 3 未破）；push/关票仍走 human 确认门（本次未 push 未关票）。这不
   违反 ADR-0005 的精神：D20 防的是"跨票上下文污染"，worktree+fresh
   teammate+指针通信把每票上下文隔离得比 handoff 更彻底。
5. **与沙箱批跑（ADR-0003）的分工**：白天流水线（本 ADR）= 人在环、决策密、
   票少而重；沙箱批跑 = 人不在环、纯机械、票多而轻。二者互补不互替。

## 后果

- 后续 3–6 票机械系列默认走本流水线；单票/探索票仍走 /implement 单会话。
- ADR-0005 的"延期"可改判为"被 Teams 形态替代实现"（定稿时一并修订措辞）。
