/**
 * context 模块公开面（L1 运行时基座——02 §2.2；一切件在其上）。
 *
 * 本批落码：作用域（effect LIFO 回卷/fork 级联/stale 护栏）+ 事件分派四模式
 * + provide/get 服务注册表 + 自写 logger + canonical 工作区根。
 * jiti 加载原语与目录信任判定随 host 装载批定形（消费面 = 插件装载器——
 * 契约先于实现的纵切序），02 §2.2 职责清单不变。
 */
import './codes.js';

export { Scope, SCOPE_EFFECT_CAPACITY } from './scope.js';
export type { Disposer } from './scope.js';
export { EventDispatch } from './events.js';
export type { NotifyListener, WaterfallListener, ListenerErrorReporter } from './events.js';
export { LogLevelState, createLogger, childLogger } from './logger.js';
export type { LogLevel, LogSink, Logger } from './logger.js';
export { canonicalWorkspaceRoot, clearWorkspaceRootCache } from './workspace.js';
