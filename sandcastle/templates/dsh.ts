/**
 * dsh.ts — 薄引用（#18）：DSH headless provider 正式化为独立 npm 包
 * `@ch1bug/sandcastle-dsh`（源仓 sandcastle-dsh，ADR-0003 方案 A），本模板
 * 只 re-export。目标项目安装：`npm install ./ch1bug-sandcastle-dsh-<ver>.tgz`
 * （或发布后 npm install @ch1bug/sandcastle-dsh）。
 *
 * 导出面（详情见包 README）：dshHeadless / sh / patchAgentDefaultModelCmd /
 * dshHomeReadyCommand / dshSandboxOptions / DOCKERFILE_SNIPPET。
 */
export {
  dshHeadless,
  sh,
  patchAgentDefaultModelCmd,
  dshHomeReadyCommand,
  dshSandboxOptions,
  DOCKERFILE_SNIPPET,
} from "@ch1bug/sandcastle-dsh";
