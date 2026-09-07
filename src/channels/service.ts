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
  ApprovalAskAnswer,
  ApprovalAskRequest,
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
import { BaseError } from '../contracts/index.js';
import { CommandRegistry } from './commands.js';
import { AskQueue } from './ask-queue.js';
import { UiCore } from './ui-core.js';
import { SessionChannels } from './registry.js';
import type { Disposer } from '../context/index.js';

/** channels 通道核服务面（核级 API 一律显式 sessionId——ctx 级包装归 host 批） */
export interface ChannelsService<TProjection> {
  /** 命令面（注册/查询/解析/分发——后写胜出） */
  readonly commands: CommandRegistry;

  /** 后端管理（多后端扇出：notify 恒扇出、阻塞原语竞速、信封路由——宿主域装配独占） */
  addBackend(backend: UiBackend<TProjection>): void;
  removeBackend(id: string): void;
  /**
   * 插件域后端注册（03 §2.7 后端 id 分域律——U3 批 U3-3）：同 id 后写胜出
   * （upsert 原位顶替，扇出序稳定）；撞宿主域 id 拒 `CHANNEL_BACKEND_RESERVED`
   * （宿主后端结构性不可顶替——07 §4 兜底通道恒在场条款的执法承载）。
   * 返回 disposer 三律②——仅当仍是本后端时摘除（同 id 后写顶替后旧
   * disposer 调用为无操作）。与 addBackend 分域分立：插件面无 removeBackend，
   * 摘除只经 disposer。
   */
  registerPluginBackend(backend: UiBackend<never>): Disposer;
  /** 插件域在册后端 id 清单（所有权读面——观测/测试；宿主域 id 装配侧自明） */
  listPluginBackendIds(): readonly string[];

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
  /** 审批 ask（07 §4.3 提问队列条款——与阻塞三件同队；safety 侧经装配桥接） */
  askApproval(sessionId: string, request: ApprovalAskRequest, opts?: UiAskOptions): Promise<ApprovalAskAnswer>;
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
  // 插件域后端集合（03 §2.7 分域律——U3 批 U3-3）：upsert/撞名/disposer 全只
  // 在本域内匹配，宿主域结构性不可及。插件实装形 = UiBackend<never>——投影
  // 泛型宿主装配钉入，插件后端走信封驱动呈现、不参与投影重画（03 §2.2
  // registerUiBackend 定形注记；SDK/webui 后端同形先例）
  const pluginBackends: UiBackend<never>[] = [];
  // 全量扇出视图（宿主域在前、插件域在后——注册序内稳定）：插件域 never 形
  // 经方法双变结构兼容并入 TProjection 序列（onRepaint 等均方法语法声明）；
  // UiCore 持 never 形以保自身非泛型——边界处 as（单域时代同洞）
  const allBackends = (): readonly UiBackend<TProjection>[] => [...backends, ...pluginBackends];
  const backendsForCore = () => allBackends() as readonly UiBackend<never>[];

  const askQueue = new AskQueue();
  const uiCore = new UiCore(backendsForCore, askQueue, opts.onApprovalAlways);
  const commands = new CommandRegistry();
  const registry = new SessionChannels<TProjection>(opts.fetchProjection, (sessionId, projection) => {
    // repaint 扇出：带上该会话当前 widget 槽值（07 §4.3 单槽重放）——双域合流
    const widget = uiCore.widgetOf(sessionId);
    for (const b of allBackends()) b.onRepaint?.(sessionId, projection, widget);
  });

  // 件 8 /history 注册面（07 §4.1 条款：history() 注入在场即注册、缺席不注册
  // 不虚报——真源 = 聚焦会话 → 拉全量 durable 正文投影 → 扇出后端 openHistory；
  // 生产数据源接线归批 12 host 装配）
  if (opts.history !== undefined) {
    const fetchHistory = opts.history;
    commands.register(
      'history',
      async () => {
        const sessionId = registry.focusedId;
        if (sessionId === null) return; // 焦点空悬——无回看对象（静默返回不虚报）
        const messages = await fetchHistory(sessionId);
        for (const b of allBackends()) b.openHistory?.(sessionId, messages);
      },
      '全屏回看会话历史',
    );
  }

  return {
    commands,
    addBackend(backend) {
      backends.push(backend);
    },
    removeBackend(id) {
      const index = backends.findIndex((b) => b.id === id);
      if (index !== -1) backends.splice(index, 1);
    },
    registerPluginBackend(backend) {
      // 分域律执法（03 §2.7）：撞宿主域 id 顶替拒——比保留 id 名单更根治
      // （名单漏一项即穿，分域无此面；07 §4 宿主后端恒在场条款承载）
      if (backends.some((b) => b.id === backend.id)) {
        throw new BaseError(
          'CHANNEL_BACKEND_RESERVED',
          `后端 id「${backend.id}」是宿主域后端——插件结构性不可顶替（03 §2.7 分域律；07 §4 宿主后端恒在场），请换 id 注册`,
        );
      }
      // 插件域内按 id 后写胜出（upsert 原位顶替——扇出序稳定不移尾；同
      // registerCommand 换装哲学：同 id 顶替 = 显式换装后端正道）
      const index = pluginBackends.findIndex((b) => b.id === backend.id);
      if (index === -1) pluginBackends.push(backend);
      else pluginBackends[index] = backend;
      // disposer 三律②：仅当仍是本后端时摘除（indexOf 身份闸——同 id 后写
      // 顶替后旧 disposer 调用为无操作）
      return () => {
        const at = pluginBackends.indexOf(backend);
        if (at !== -1) pluginBackends.splice(at, 1);
      };
    },
    listPluginBackendIds() {
      return pluginBackends.map((b) => b.id);
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
      // 信封路由双域合流扇出（聚焦全渲染/非聚焦摘要行——形态归后端）
      for (const b of allBackends()) b.onEnvelope?.(env, focused);
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
    askApproval(sessionId, request, askOpts) {
      return uiCore.askApproval(sessionId, request, askOpts);
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
