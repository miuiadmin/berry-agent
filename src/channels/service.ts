/**
 * channels 件聚合工厂（L4 宿主固定件——02 篇席 10；批 10a 通道核）。
 *
 * 组合四件：SessionChannels（多会话注册/焦点/重画）+ CommandRegistry（命令面）
 * + UiCore（七原语分发核）+ AskQueue（提问队列）。后端（UiBackend）经
 * addBackend 注入——TUI 实装批接线 pi-tui、webui 件同面接入；核零 pi-tui
 * import（件分两面定形——07 §4.1 channels 纵切批注记）。
 *
 * host 装配序（批 12）：createChannels → addBackend(tui) → registerSession/
 * focus（TUI 启动会话策略——07 §5）→ conversation 侧 per-run sink 汇入 emit。
 */

import type {
  AskKind,
  ChannelsOptions,
  CommandHandler,
  CommandSpec,
  NotifyLevel,
  SessionEnvelope,
  UiAskOptions,
  UiBackend,
  UiInputOptions,
  UiSelectChoice,
} from './types.js';
import { CommandRegistry } from './commands.js';
import { AskQueue } from './ask-queue.js';
import { UiCore } from './ui-core.js';
import { SessionChannels } from './registry.js';
import type { Disposer } from '../context/index.js';

/** channels 通道核服务面（核级 API 一律显式 sessionId——ctx 级包装归 host 批） */
export interface ChannelsService<TProjection> {
  /** 命令面（注册/查询/解析/分发——后写胜出） */
  readonly commands: CommandRegistry;

  /** 后端管理（多后端扇出：notify 恒扇出、阻塞原语竞速、信封路由） */
  addBackend(backend: UiBackend<TProjection>): void;
  removeBackend(id: string): void;

  /** 会话管理（unregisterSession 联动提问队列收口 + widget 槽清空） */
  registerSession(sessionId: string): void;
  unregisterSession(sessionId: string): void;
  /** 焦点切换（清屏重画——拉投影经装配注入回调） */
  focus(sessionId: string): Promise<void>;
  isFocused(sessionId: string): boolean;
  /** 当前聚焦会话（null = 焦点空悬） */
  readonly focusedId: string | null;

  /** 活体信封分流入口（conversation 驱动侧 per-run sink 汇入处——按聚焦位路由扇出） */
  emit(env: SessionEnvelope): void;

  // ---- ui 七原语（07 §4.3——核级 per-session 形） ----
  notify(sessionId: string, message: string, opts?: { level?: NotifyLevel }): void;
  confirm(sessionId: string, message: string, opts?: UiAskOptions): Promise<boolean>;
  select(sessionId: string, message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions): Promise<string>;
  input(sessionId: string, message: string, opts?: UiInputOptions): Promise<string>;
  setStatus(sessionId: string, status: string): void;
  setWidget(sessionId: string, node: unknown | null): void;
  hasAudience(): boolean;
  /** 提问队列观察面（诊断/测试） */
  pendingAsks(sessionId: string): readonly AskKind[];

  // ---- 命令面便捷透传（ctx.channels.registerCommand 同形——host 装配侧直挂） ----
  registerCommand(name: string, handler: CommandHandler, description?: string): Disposer;
  dispatchCommand(input: string): Promise<boolean>;
  listCommands(): readonly CommandSpec[];
}

/** 通道核工厂（投影类型 TProjection 由装配侧钉——不 import session 的边表执法） */
export function createChannels<TProjection>(opts: ChannelsOptions<TProjection> = {}): ChannelsService<TProjection> {
  const backends: UiBackend<TProjection>[] = [];
  // UiBackend<TProjection> → UiBackend<never> 经方法双变结构兼容（onRepaint 等
  // 均方法语法声明）；UiCore 持 never 形以保自身非泛型
  const backendsForCore = () => backends as readonly UiBackend<never>[];

  const askQueue = new AskQueue();
  const uiCore = new UiCore(backendsForCore, askQueue);
  const commands = new CommandRegistry();
  const registry = new SessionChannels<TProjection>(opts.fetchProjection, (sessionId, projection) => {
    // repaint 扇出：带上该会话当前 widget 槽值（07 §4.3 单槽重放）
    const widget = uiCore.widgetOf(sessionId);
    for (const b of backends) b.onRepaint?.(sessionId, projection, widget);
  });

  return {
    commands,
    addBackend(backend) {
      backends.push(backend);
    },
    removeBackend(id) {
      const index = backends.findIndex((b) => b.id === id);
      if (index !== -1) backends.splice(index, 1);
    },
    registerSession(sessionId) {
      registry.registerSession(sessionId);
    },
    unregisterSession(sessionId) {
      registry.unregisterSession(sessionId);
      uiCore.closeSession(sessionId);
    },
    focus(sessionId) {
      return registry.focus(sessionId);
    },
    isFocused(sessionId) {
      return registry.isFocused(sessionId);
    },
    get focusedId() {
      return registry.focusedId;
    },
    emit(env) {
      const focused = registry.isFocused(env.sessionId);
      for (const b of backends) b.onEnvelope?.(env, focused);
    },
    notify(sessionId, message, notifyOpts) {
      // notify 非阻塞不分会话呈现位——sessionId 位保留给呈现侧路由（后端自决）
      void sessionId;
      uiCore.notify(message, notifyOpts);
    },
    confirm(sessionId, message, askOpts) {
      return uiCore.confirm(sessionId, message, askOpts);
    },
    select(sessionId, message, choices, askOpts) {
      return uiCore.select(sessionId, message, choices, askOpts);
    },
    input(sessionId, message, askOpts) {
      return uiCore.input(sessionId, message, askOpts);
    },
    setStatus(sessionId, status) {
      uiCore.setStatus(sessionId, status);
    },
    setWidget(sessionId, node) {
      uiCore.setWidget(sessionId, node);
    },
    hasAudience() {
      return uiCore.hasAudience();
    },
    pendingAsks(sessionId) {
      return uiCore.pending(sessionId);
    },
    registerCommand(name, handler, description) {
      return commands.register(name, handler, description);
    },
    dispatchCommand(input) {
      return commands.dispatch(input);
    },
    listCommands() {
      return commands.list();
    },
  };
}
