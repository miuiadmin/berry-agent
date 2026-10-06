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
  /**
   * 在册判定（ix-2——ctx.ui 锚时效真源）：未 registerSession 或已
   * unregisterSession = false。阻塞原语受理时检查——陈年锚晚到不悬死。
   */
  hasSession(sessionId: string): boolean;
  /** 焦点切换（清屏重画——拉投影经装配注入回调） */
  focus(sessionId: string): Promise<void>;
  /**
   * 命令完成尾强制重画（07 §4.1 ZCode TUI 对标批 B2 定形注挂账销账）：
   * 投影已变想即时可见的消费位调用（/compact 成功档、排队兑现档）——
   * 聚焦者清屏重画，非聚焦/焦点空悬 no-op（守卫归核双检——「投影已变
   * 想即时可见」的通用公开位，不散守卫到各调用点）。
   */
  refresh(sessionId: string): Promise<void>;
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
  dispatchCommand(input: string, sessionId?: string): Promise<boolean>;
  listCommands(): readonly CommandSpec[];
}

/** 未知异常折用户面串（与 checkpoint 命令面折面同形）：BaseError 码直呈
 * （用户可引用错误码——wf_db273e73 seam-P2 修前红：Error 腿只折 message 丢码），
 * 其余 Error 走 message（免 String 的「Error: 」前缀噪音），裸值保底 String。
 *
 * **单源导出**（wf_3c8b00b8 组α）：tui-backend 命令异常两 catch、tui-entry
 * /new focus 拒绝位、core-plugins onRestore 双保险四写位与 channels.test 真形
 * 锁全归本源（689e5ba 立规——用户面折面禁裸 String）；经 index.ts 公开面
 * 再导出供 host 域消费（跨模块只走公开面三名）。 */
export function foldErrorText(err: unknown): string {
  if (err instanceof BaseError) {
    // 码单写律（07 §4.1 V-0 注⑤）：前缀码 XOR 消息内码——message 已内嵌码形
    // （`[码]` 或 `码：`/`码:` 前缀位）则不再前缀，双写禁（`码：[码] …` 病灶）。
    // 判据锚**前缀位**非全文含（中段引用他码不误判）。
    if (
      err.message.startsWith(`[${err.code}]`) ||
      err.message.startsWith(`${err.code}：`) ||
      err.message.startsWith(`${err.code}:`)
    ) {
      return err.message;
    }
    return `${err.code}：${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
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

  // /memory 注册面（06 §7 形态定形注①——memory 注入在场即注册、缺席不注册
  // 不虚报；同 /history 注册面律）：管理面是全局面无会话归属，扇出后端
  // openMemory（零参——材料后端自持）；全体 falsy（后端不支持或件缺席）时
  // notify 降级提示（warn 档——不静默假装已开）；无观众后端时静默返回
  // （notify 扇出无人接帧——与焦点空悬同族的不虚报位）
  if (opts.memory !== undefined) {
    commands.register(
      'memory',
      async () => {
        let opened = false;
        for (const b of allBackends()) {
          if (b.openMemory?.() === true) opened = true; // 任一后端已开即成功（先开胜出）
        }
        if (!opened) {
          // notify 非阻塞不分会话呈现位（service.notify 同律——uiCore 直扇出）
          uiCore.notify('当前界面不支持记忆管理页（或 memory 插件未安装）', { level: 'warn' });
        }
      },
      '记忆管理页（冻结/忘掉/恢复/导出）',
    );
  }

  // /sessions 注册面（07 §4.1 R7 批 10k——sessions 注入在场即注册、缺席不
  // 注册不虚报；注册面律同 /history）：真源 = 拉会话清单 → 扇出后端
  // openSessions（返 boolean——任一 true 即成功）；选定回调核内铸 =
  // registry.focus() 既有权威路（未注册会话 focus 视同注册——焦点即活跃
  // 声明）；全体 falsy 时 notify 降级提示（不静默）
  // 〔2026-09-30 会话管理命令批批2选定回调升级：resumeSession 注入在场时
  // 选定回调 = open+focus（选定即续接可写——submitText 未开会话返
  // undefined 的「理论不达」防御位补上机器路；open 幂等使已开会话零成本
  // 直达）；注入缺席保持纯 focus 查看器（零行为变）〕
  if (opts.sessions !== undefined) {
    const fetchSessions = opts.sessions;
    const selectSession = (sessionId: string) => {
      if (opts.resumeSession !== undefined) {
        // 副屏 onSelect 是用户面不是异常面：注入闭包非 async（生产形在读面预检
        // 同步抛 PERSIST_DATA_CORRUPT）与异步 reject 都就地折 error notify——
        // 直穿会沿 onSelect→alt-screen→engine 成 uncaughtException 杀整个 TUI；
        // false 回执（会话不在场）焦点不动 + warn 诚实拒（true 才走 focus——
        // 与 /resume 文本路回执路由同律）；focus 本身拒绝（拉投影失败）同折
        // 「切焦失败」——void 弃接会让 rejection 逃出成 unhandledRejection
        try {
          void opts
            .resumeSession(sessionId)
            .then((ok) => {
              if (ok)
                void registry.focus(sessionId).catch((err: unknown) => {
                  uiCore.notify(`切换会话失败：${foldErrorText(err)}`, { level: 'error' });
                });
              else uiCore.notify(`会话不存在：${sessionId}——输入 /sessions 查看会话列表`, { level: 'warn' });
            })
            .catch((err: unknown) => {
              uiCore.notify(`续接失败：${foldErrorText(err)}`, { level: 'error' });
            });
        } catch (err) {
          uiCore.notify(`续接失败：${foldErrorText(err)}`, { level: 'error' });
        }
      } else
        void registry.focus(sessionId).catch((err: unknown) => {
          uiCore.notify(`切换会话失败：${foldErrorText(err)}`, { level: 'error' }); // 纯 focus 查看器路同防
        });
    };
    commands.register(
      'sessions',
      async () => {
        const sessions = await fetchSessions();
        // B2 截断披露：总数注入在场即取（超窗时切换器头行注记）；缺席回退
        // 清单长度（= 全量已呈现，头行原形）
        const total = (await opts.sessionsTotal?.()) ?? sessions.length;
        let opened = false;
        for (const b of allBackends()) {
          if (b.openSessions?.(sessions, selectSession, total) === true) opened = true;
        }
        if (!opened) {
          uiCore.notify('当前界面不支持会话切换', { level: 'warn' });
        }
      },
      '会话切换器（打开清单页——选定即切换）',
    );
  }

  // /rename 注册面（07 §4.1 2026-09-30 会话管理命令批——renameSession 注入
  // 在场即注册、缺席不注册不虚报；注册面律同 /sessions）：codex 双形态——
  // 带参 argv 重拼直通改名、无参走 uiCore.input 主屏输入框（空输入=取消不
  // 落库）；写面净化+200 帽不属核（核透传原始名——净化组合单源
  // clampTitleText 归注入侧），返值三态归核统一回执路由（ok 回执新名 /
  // empty warn 拒落库 / missing warn 诚实拒）；会话锚 = args.sessionId
  // 透传位 ?? registry.focusedId（CLI 面命令无会话语境的兜底）
  if (opts.renameSession !== undefined) {
    const renameSession = opts.renameSession;
    commands.register(
      'rename',
      async (args) => {
        const sessionId = args.sessionId ?? registry.focusedId ?? undefined;
        if (sessionId === undefined) {
          uiCore.notify('无聚焦会话——先选定会话再改名', { level: 'warn' });
          return;
        }
        let rawTitle = args.argv.join(' ').trim();
        if (rawTitle === '') {
          // 无参形态：input ask（codex 形——预填现名挂账批4，读现名需注入拉面）
          const answer = await uiCore.input(sessionId, '新会话名（留空回车=取消）');
          rawTitle = answer.trim();
          if (rawTitle === '') {
            uiCore.notify('已取消改名（未输入新名）');
            return;
          }
        }
        const result = await renameSession(sessionId, rawTitle);
        if (result.status === 'ok') {
          uiCore.notify(`已改名：${result.title}`);
        } else if (result.status === 'empty') {
          uiCore.notify('新名字只含不可见字符——换一个再试', { level: 'warn' });
        } else {
          uiCore.notify(`会话不存在：${sessionId}——改名未保存`, { level: 'warn' });
        }
      },
      '会话改名（无参弹输入框；带参 /rename <新名> 直通）',
    );
  }

  // /resume 注册面（07 §4.1 2026-09-30 会话管理命令批批2——resumeSession 注入
  // 在场即注册、缺席不注册不虚报；注册面律同上）：带参 = 首词即会话 id 直通
  // 注入（true → registry.focus 权威路切焦 + 回执；false → warn 诚实拒焦点
  // 不动）；无参 = 转发 /sessions 命令（选定回调已升级为 open+focus——选定
  // 即续接可写；dispatch 返 false 说明 sessions 注入缺席，降级提示直达形）
  if (opts.resumeSession !== undefined) {
    const resumeSession = opts.resumeSession;
    commands.register(
      'resume',
      async (args) => {
        const id = args.argv[0]?.trim() ?? '';
        if (id === '') {
          // 无参形态：复用 /sessions 扇出（选定即续接——codex 同款清单形）
          const handled = await commands.dispatch('/sessions');
          if (!handled) uiCore.notify('无会话清单可开——用 /resume <id> 直达续接', { level: 'warn' });
          return;
        }
        const resumed = await resumeSession(id);
        if (resumed) {
          // 切焦不打断——in-flight run 跨切焦继续；focus 拒绝（拉投影失败）折
          // error 回执：续接已成功但切焦失败须诚实告知，void 弃接会让 rejection
          // 逃出成 unhandledRejection 经崩溃编舞 exit(1)
          void registry.focus(id).catch((err: unknown) => {
            uiCore.notify(`切换会话失败：${foldErrorText(err)}`, { level: 'error' });
          });
          uiCore.notify(`已续接：${id}`);
        } else {
          uiCore.notify(`会话不存在：${id}——输入 /sessions 查看会话列表`, { level: 'warn' });
        }
      },
      '会话续接（无参开清单选定续接；带参 /resume <id> 直达）',
    );
  }

  // /usage 注册面（07 §4.1 R7 批 10k——usage 注入在场即注册；数据源 = 件 6
  // 同数据源但独立聚合——会话全 run 累计，非复用清账态）：真源 = 聚焦会话 →
  // 拉汇总 → 扇出后端 openUsage；焦点空悬静默返回（无汇总对象不虚报）；
  // 全体 falsy 时 notify 降级提示
  if (opts.usage !== undefined) {
    const fetchUsage = opts.usage;
    commands.register(
      'usage',
      async () => {
        const sessionId = registry.focusedId;
        if (sessionId === null) return; // 焦点空悬——无汇总对象（静默返回不虚报）
        const summary = await fetchUsage(sessionId);
        let opened = false;
        for (const b of allBackends()) {
          if (b.openUsage?.(sessionId, summary) === true) opened = true;
        }
        if (!opened) {
          uiCore.notify('当前界面不支持用量面板', { level: 'warn' });
        }
      },
      '会话用量面板（全 run 累计分表）',
    );
  }

  // /calls 注册面（07 §4.1 ZCode TUI 对标批 B3 定形注——calls 注入在场即
  // 注册、缺席不注册不虚报；注册面律同 /usage）：真源 = 聚焦会话 → 拉台账
  // （快照档 dispatch 现读——尾窗行集 + 全量计数）→ 扇出后端 openCalls
  // （entries/totalCount 透传——截断披露位）；焦点空悬静默返回（无台账
  // 对象不虚报）；全体 falsy 时 notify 降级提示
  if (opts.calls !== undefined) {
    const fetchCalls = opts.calls;
    commands.register(
      'calls',
      async () => {
        const sessionId = registry.focusedId;
        if (sessionId === null) return; // 焦点空悬——无台账对象（静默返回不虚报）
        const ledger = await fetchCalls(sessionId);
        let opened = false;
        for (const b of allBackends()) {
          if (b.openCalls?.(sessionId, ledger.entries, ledger.total) === true) opened = true;
        }
        if (!opened) {
          uiCore.notify('当前界面不支持调用台账', { level: 'warn' });
        }
      },
      '会话调用台账（模型调用明细·最近 50 条）',
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
          `后端 id「${backend.id}」是宿主保留的后端——插件不能顶替（03 §2.7 分域律），请换一个 id 注册`,
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
    hasSession(sessionId) {
      return registry.has(sessionId);
    },
    focus(sessionId) {
      return registry.focus(sessionId);
    },
    refresh(sessionId) {
      return registry.refresh(sessionId);
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
    dispatchCommand(input, sessionId) {
      return commands.dispatch(input, sessionId);
    },
    listCommands() {
      return commands.list();
    },
  };
}
