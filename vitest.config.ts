import { defineConfig } from 'vitest/config'

// #180：票面证明命令 `node node_modules/vitest/vitest.mjs run tests/exports-audit.spec.ts
// --project unit` 需要一个名为 `unit` 的 project。本仓 spec 面 = tests/*.spec.ts；
// 判据核心在 tests/exports-audit.mjs（快集入口与其共享，见该文件头注）。
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/*.spec.ts'],
        },
      },
    ],
  },
})
