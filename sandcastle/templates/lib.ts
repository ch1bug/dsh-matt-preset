/**
 * lib.ts — sandcastle 模板共享小工具（单一事实源，防三份逐字复制）。
 *
 * 注意：模板会被整体拷进目标仓 `.sandcastle/`，本文件同目录携带——
 * 模板内一律相对导入 `./lib.ts`，不要引用仓库内其他路径。
 */
import { pathToFileURL } from "node:url";

/** 取 `--name value` 形式的命令行参数值；缺省 undefined。 */
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `--name` 布尔开关是否存在。 */
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * 主模块守卫：仅当本模块就是入口脚本时为 true——模板顶层用
 * `if (isMain(import.meta.url)) main()` 包住 CLI 主体，冒烟测试
 * import 纯函数时不触发副作用。
 */
export function isMain(moduleUrl: string): boolean {
  return process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;
}
