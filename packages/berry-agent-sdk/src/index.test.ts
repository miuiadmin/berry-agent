/**
 * index 桶导出面锁（2026-10-07 契约漂移镜头 L1 落码）。
 *
 * 背景：SDK 包的 npm 公共导出面（index.ts 桶）此前是四门禁共同盲区——
 * typecheck 绿（仓内无消费位 import 该桶）、test 绿（包内三测试件直连
 * 各模块不经 index）、lint:topology 绿（只执法 SDK 包相对导入落点，
 * 不管导出面）、check-api 绿（快照域 = src/contracts 桶）。误删一处
 * re-export 时外部 npm 消费者 `import { … } from 'berry-agent-sdk'` 得
 * undefined、运行时 TypeError——发布面漂移只能由外部消费者发现。
 *
 * 锁形双道（值/类型分治——TS 机制所限）：
 * - **值导出面**（运行时执法）：`import * as api` 命名空间键集与快照
 *   字面量恒等（本测试运行即红/绿）；
 * - **类型导出面**（编译期执法）：`export type` 形导出在运行时被擦除、
 *   keyof 不可见（实测：`keyof typeof import()` 只含值导出），故逐名以
 *   限定名入下方名册——桶内缺名即 TS2305 编译红，经 `npm run
 *   typecheck` 的 sdk 测试配置腿（tsc -p tsconfig.test.json）执法。
 *
 * **纪律：增删/改名任何导出须同笔改本文件两份名册**（发布面机检——
 * 对齐 WEBUI_ENDPOINTS 双表对拍锁惯例：承诺升为可执行锁）。
 */
import { describe, expect, it } from 'vitest';

import * as api from './index.js';
import type * as apiTypes from './index.js';

/**
 * 值导出面快照（运行时键集排序形——与 `Object.keys(api).sort()` 恒等；
 * 增删值导出须同笔改此表）。排序 = 默认字典序（大写先于小写——UTF-16
 * 码位序，与 `Array.prototype.sort` 缺省一致）。
 */
const EXPECTED_RUNTIME_EXPORTS = [
  'SDK_PROTOCOL_VERSION',
  'SdkError',
  'createSdkClient',
  'httpSdkTransport',
  'spawnServeTransport',
] as const;

/**
 * 类型导出面名册（编译期存在性锁——逐名引用桶符号，缺名即 TS2305；
 * 名册序随 index.ts 各 export 块声名序，同笔增删时并排可对读。export
 * 出位规避 noUnusedLocals；类型面完整性（多出未册名）TS 机制不可检，
 * 靠 index.ts「逐项过目」纪律 + 本名册存在性半边）。
 */
export type SdkIndexTypeSurface = [
  // —— types.ts 第一块（客户端面）——
  apiTypes.SdkFrameListener,
  apiTypes.SdkLiveHandle,
  apiTypes.SdkLiveParams,
  apiTypes.SdkTransport,
  apiTypes.SdkClient,
  apiTypes.SdkPromptInput,
  apiTypes.SdkEntriesInput,
  apiTypes.SdkSessionsResult,
  // —— types.ts 第二块（线协议/契约面）——
  apiTypes.AgentEvent,
  apiTypes.ApprovalAskAnswer,
  apiTypes.SdkRequest,
  apiTypes.SdkWireFrame,
  apiTypes.SdkAckFrame,
  apiTypes.SdkEntriesFrame,
  apiTypes.SdkSessionsFrame,
  apiTypes.SdkSessionSummary,
  apiTypes.SdkDurableEntry,
  apiTypes.SdkEventFrame,
  apiTypes.SdkHelloFrame,
  apiTypes.SdkErrorFrame,
  // —— stdio.ts ——
  apiTypes.SpawnServeOptions,
  apiTypes.SdkStdioTransport,
  // —— http.ts ——
  apiTypes.HttpSdkOptions,
];

describe('index 桶导出面锁', () => {
  it('值导出面：运行时键集与快照恒等（误删/改名 re-export 即红——四门禁盲区补位）', () => {
    expect(Object.keys(api).sort()).toEqual([...EXPECTED_RUNTIME_EXPORTS]);
  });
});
