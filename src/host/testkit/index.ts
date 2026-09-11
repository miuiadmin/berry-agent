/**
 * `berry-agent/testkit` 主包子路径公开面（03 §9.5——生态启动批 eco-3c）。
 *
 * 消费位：插件作者的 devDep 测试文件（`import { proveLifecycleMatrix } from
 * 'berry-agent/testkit'`）——作者侧消费，非装载器 jiti 注入进插件沙箱
 * （故不入 VIRTUAL_API_KEYS 六键表——03 §8.2 第七真相源独立子路径域）。
 *
 * 首版导出面：
 * - proveLifecycleMatrix / formatMatrixReceipt —— 生命周期证明矩阵 + README 回执；
 * - createPluginHarness 及配套件 —— 矩阵底座（假宿主装配），作者自定义
 *   断言场景亦可直用（全部动词真身直调）。
 */
export {
  createPluginHarness,
  createCommandAccount,
  instrumentDispatchListeners,
  MemoryAuditSink,
  npmPackFiles,
  realStoreFs,
} from './harness.js';
export type {
  PluginHarness,
  PluginHarnessOptions,
  HarnessInstallOutcome,
  CommandAccount,
  DispatchListenerProbe,
} from './harness.js';
export { proveLifecycleMatrix, formatMatrixReceipt } from './matrix.js';
export type { MatrixOptions, MatrixRowResult, LifecycleMatrixReport } from './matrix.js';
