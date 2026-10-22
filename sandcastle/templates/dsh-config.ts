/** 无运行时沙箱依赖的 DSH settings 命令，供模板纯函数面安全导入。 */

/** 替换容器内 agent-default-model 块；grep 回执防止 settings 漂移时静默失效。 */
export function patchAgentDefaultModelCmd(model: string): string {
  // 从 60693ec^ 恢复：sed 串拼接不接受引号/换行/空白。
  const MODEL_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
  if (!MODEL_RE.test(model))
    throw new Error(`model 需为 provider/model 形式（各段字符集 [A-Za-z0-9._-]）：${model}`);
  const slash = model.indexOf("/");
  const provider = model.slice(0, slash);
  const modelName = model.slice(slash + 1);
  return (
    `sed -i '/^agent-default-model:/,+2c\\agent-default-model:\\n` +
    `  provider: ${provider}\\n  model: ${modelName}' ~/.dsh/settings.yaml ` +
    `&& grep -qx '  model: ${modelName}' ~/.dsh/settings.yaml`
  );
}
