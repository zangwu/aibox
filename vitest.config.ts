import { defineConfig } from 'vitest/config';

/** 独立测试配置：避免加载 vite.config.ts 中的 ESM-only 插件 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
