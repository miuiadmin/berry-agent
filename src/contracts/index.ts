/**
 * contracts 模块公开面（L0 公共契约——模块间唯一共边；02 篇 §4.1）。
 *
 * 再导出面 = 错误码注册表 + 事件词汇注册表 + 会话事件信封类型。
 * LLM 消息/流/角色与工具/插件/子代理/Job 类型随对应模块落码批进本面。
 */
export * from './errors.js';
export * from './events.js';
export * from './types.js';
