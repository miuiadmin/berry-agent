/**
 * contracts 模块公开面（L0 公共契约——模块间唯一共边；02 篇 §4.1）。
 *
 * 再导出面 = 错误码注册表 + 事件词汇注册表 + 会话事件信封类型 + LLM 边界
 * 消息基础件（第五批）。工具/插件/子代理/Job 类型随对应模块落码批进本面。
 */
export * from './errors.js';
// AgentEvent 活体事件族 + UI 通道后端契约族（2026-09-08 U3 落码批归位——
// 插件侧类型可达路径定形：虚拟主键 `berry-agent` 面只达 contracts，registerUiBackend
// 的 backend 形〔UiBackend<never>〕与 onEnvelope 活体流词汇经此两件可达；
// agent/channels 两侧公开面 re-export 维持不变〔批 11b ApprovalAsk 同款先例〕）
export * from './agent-events.js';
export * from './ui.js';
/**
 * api.ts 分桶收面（03 篇 §8.3 internal 行 + §8.4 公开根分桶——API 治理批 2）：
 * api.ts 顶层导出分两桶，本处只转出**可见桶**六名（四型 + 两纯函数——插件作者
 * 可消费面）；internal 机制桶八符号（VIRTUAL_API_KEYS / SERVICE_CATALOG /
 * CAPABILITIES / API_ENFORCEMENT_IGNITED / adjudicateApiGate / ApiGateResult /
 * assertExperimentalDeclared / materializeHostFace）不进公开根——它们是宿主
 * 治理机制非插件 API，内核消费全深导 contracts/api.js。
 * 本桶面即插件虚拟模块 `berry-agent` 的运行时面（loader 注入物），分桶 =
 * 真实运行时收面（星出时代机制符号实测进面——内部重构将判伪 MAJOR）。
 * 分桶不变式由抽取器 assertApiBucketPartition fail-loud 执法：api.ts 新顶层
 * 导出未分桶即炸（白名单单点 tools/extract-api-surface.mjs INTERNAL_API_EXPORTS）。
 * 类型四名走 export type（verbatimModuleSyntax 纪律——值面只含两纯函数）。
 */
export type { ApiTier, ApiBlock, HostFace, HostFaceInput } from './api.js';
export { compareApiVersions, isValidApiVersion } from './api.js';
export * from './events.js';
export * from './types.js';
// 凭证 env 引用形词面单源（03 §10.9 注入腿——c-4）：exec 执法位与 credentials
// resolver 两方消费，放公开根使两方零新 DAG 边（三名律——跨模块走公开面）
export * from './env-ref.js';
// 出口治理③ 凭据消毒纯函数族（04 §7 执行段 2026-09-08 落码定形）：tools 管道
// 链尾（模式+值基两腿）与 agent 错误包装位（纯模式腿）两方消费，同律零新边
export * from './redact.js';
export * from './llm.js';
export * from './messages.js';
export * from './approval.js';
export * from './tools.js';
