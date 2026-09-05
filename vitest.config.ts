import { defineConfig } from 'vitest/config';

/**
 * 测试配置（07 篇 §2.3 / §7.5）——v1 单 node 轨起步：
 * - 测试文件与被测模块同目录（src/<模块>/*.test.ts），只覆盖本模块与跨
 *   contracts 的公开面；分层纪律：单元纯逻辑 → 组合根全栈（mock 只停模型层）。
 * - client 轨（SPA 组件测试，jsdom + @testing-library/react）随 core:webui
 *   落码批接入——projects 双轨形态届时展开，本轨 exclude 先行占位语义。
 * - setupFiles 钉扎数据目录（tools/vitest-setup.mjs）：测试进程永不写真
 *   ~/.berry-agent——纪律从第一天在场（承 berry 基建大扫 #16 教训）。
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tools/vitest-setup.mjs'],
    // per-test 兜底时限（承 berry 壁钟教训：重载全栈用例并行下 5s 可超）；
    // 内层等待各自的窄帽先红，外层兜底不是常态路径。
    testTimeout: 15_000,
  },
});
