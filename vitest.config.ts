import { defineConfig } from 'vitest/config';

/**
 * 测试配置（07 篇 §2.3 / §7.5）——批 18a-2 起 projects 双轨：
 * - **node 轨**（既有全量）：测试文件与被测模块同目录（src/<模块>/*.test.ts），
 *   只覆盖本模块与跨 contracts 的公开面；分层纪律：单元纯逻辑 → 组合根
 *   全栈（mock 只停模型层）。setupFiles 钉扎数据目录（tools/vitest-setup.mjs）：
 *   测试进程永不写真 ~/.berry-agent——纪律从第一天在场（承 berry 基建大扫
 *   #16 教训）。
 * - **webui-client 轨**（批 18a-2 起）：SPA 组件测试（jsdom +
 *   @testing-library/react）；include 收 *.test.tsx（扩展名即选轨——node 轨
 *   *.test.ts 模式天然不撞）；纯折叠器测试同轨共置（纯逻辑零 DOM 触）。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          // 工具件测试（check-api 十查红绿证等——spawn 全闸 + 纯函数单元锁；
          // release.mjs 注入谱——07 §8.3 演习完成判据）点名收进 node 轨：
          // include 显式列举，不开 tools/**/*.test.mjs 通配（否定条目/
          // 宽通配杀 coverage 面——承 berry 基建大扫教训，逐件点名扩）。
          // SDK 包测试（packages/berry-agent-sdk——批 13f-3 起）同轨收编：包内
          // 测试经相对导入吃主仓 src 契约，单轨即闭环。
          include: [
            'src/**/*.test.ts',
            'packages/berry-agent-sdk/src/**/*.test.ts',
            'tools/check-api.test.mjs',
            'tools/check-topology.test.mjs',
            'tools/release.test.mjs',
          ],
          environment: 'node',
          setupFiles: ['tools/vitest-setup.mjs'],
          // per-test 兜底时限（承 berry 壁钟教训：重载全栈用例并行下 5s 可超）；
          // 内层等待各自的窄帽先红，外层兜底不是常态路径。
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: 'webui-client',
          include: ['src/webui/client/**/*.test.tsx'],
          environment: 'jsdom',
          testTimeout: 15_000,
        },
      },
    ],
  },
});
