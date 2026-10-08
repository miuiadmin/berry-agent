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
    // 覆盖率配置（2026-09-15 四问评估基建短板件——W1 落地）：
    // - provider v8（@vitest/coverage-v8 已入 devDependencies——CLI 走
    //   `npx vitest run --coverage` 即启用；不跑 coverage 的常规门禁零开销零改动）；
    // - reporter 双出口：text（job 日志内联表格）+ json-summary
    //   （coverage/coverage-summary.json——CI artifact 上传消费位，不接第三方服务）；
    // - 不设 include/exclude/thresholds：覆盖面 = 测试实际加载面（include 面
    //   保持既有项目定义不动），阈值门禁未拍板不入（先收集后立线）。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    projects: [
      {
        // v5 起内联 project 缺省继承根 test 块（extends 缺省翻 true——v4 时代
        // 不继承）；显式 extends: false 锁 v4 形轨隔离：根级未来加钩子
        // （setupFiles/globalSetup 等）不静默波及本轨——双轨各自显式自持
        // （批 18a-2 双轨分立设计意图书面化，sweep22 vitest5-inline-inherit）。
        extends: false,
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
            'tools/check-mock-targets.test.mjs',
            'tools/check-topology.test.mjs',
            'tools/check-vocab.test.mjs',
            'tools/install-scripts.test.mjs',
            'tools/release.test.mjs',
            'tools/soak-verdict.test.mjs',
          ],
          environment: 'node',
          setupFiles: ['tools/vitest-setup.mjs'],
          // v5 起 clearMocks 缺省翻 true（v4 为 false——套件在 v5 缺省下全绿
          // 实证）；显式钉扎同值：把「依赖缺省」升为拍板面，未来 major 再翻
          // 缺省时本轨语义不动（sweep22 vitest5-clearmocks-default）。
          clearMocks: true,
          // per-test 兜底时限（承 berry 壁钟教训：重载全栈用例并行下 5s 可超）；
          // 内层等待各自的窄帽先红，外层兜底不是常态路径。
          testTimeout: 15_000,
        },
      },
      {
        // 同 node 轨：extends: false 锁 v4 形轨隔离（v5 缺省继承翻转的显式
        // 拒绝——根 coverage 配置经 CLI --coverage 根级面生效，不依赖 project
        // 继承链）；clearMocks: true 同律钉扎。
        extends: false,
        test: {
          name: 'webui-client',
          include: ['src/webui/client/**/*.test.tsx'],
          environment: 'jsdom',
          testTimeout: 15_000,
          clearMocks: true,
        },
      },
    ],
  },
});
