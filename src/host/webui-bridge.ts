/**
 * host/webui-bridge — `--port` webui 统一 HTTP 面装配桥（批 12f-2c 落、
 * 18a-3' 三入口咬合归一定形；03 §10.4 host 接线义务：`--port <n>` 开面 +
 * token 一次性披露 + 生命周期收口）。18a-2' 起件零自持监听——路由经 sdk
 * HTTP 面承載（mountWebui 注册 face.register——面注册器直注）。
 *
 * **三入口两段形（18a-3' 兑现——12f-2c 期「过渡期桥自持面」挂账注销）**：
 * - mountWebuiOnFace：**共用挂载段**——桥真身映射 + 路由注册进任意 sdk 面 +
 *   channels backend 挂接（信封扇出与审批腿接线——12f-2c 期注记「addBackend
 *   归调用方」而调用方缺席 = TUI 形真缺陷〔SSE 死流〕，本段收编修前必红
 *   例锁死）+ detach 摘挂（幂等——closer 归调用方接线）；
 * - openWebuiFace：**前台自持面开面**（TUI / serve 前台 `--port` 形）——
 *   自起统一 HTTP 面 TCP 人面（恒回环；SPA + /api/* + /v1/* 三族同面；
 *   bridge 走 createServeBridge 零第二套映射）+ 披露两行 + closer 整体
 *   收口；daemon 常驻面 `--port` 侧不起本面——serve-daemon 件内组态人面
 *   监听后走共用挂载段（面归 daemon 单源）。
 *
 * 批 19e 件在场分档：openWebuiFace 挂载改经 mountKit（core:webui 件
 * provide 'webui-face-mount' 的 kit——入口装配根 tryGet 后注入）；kit
 * 缺席 = 件禁用/零装载——面仍开（/v1/* 程序调用族在场）而 /api/* 与
 * SPA 404，披露分档诚实不虚报（sdk/webui 两件禁用语义族——03 §10.4）。
 *
 * 职责（装配桥五面）：conversation 栈五动词 → WebuiDeps 三窄面映射（词面
 * 独立律的装配侧互证——compat 互证 18a-3' 两方向例锁死，见测试件）+
 * staticDir 探测（dist/webui 共生形；缺席诚实 API-only 不虚报）+ token
 * 一次性披露（stderr 缺省——「监听 ⇒ 鉴权」面本体保证恒在场，令牌只此
 * 一次显示；token 生成归面）+ backend 通道挂接（UiBackend 第四实装 claim
 * 桥——共用挂载段接线）+ stop 进运行时退出序 closer（注册序在
 * plugin-unload 之后、tui-backend 之前——网络面先关再出屏）。
 *
 * 桥映射注记：createSession 走 manager.create 零 I/O（行随首事件落库——
 * 浏览器会话无 cwd 锚，workspaceRoot 缺省全局态）；sessionStateOf 三档
 * 判据 = isOpen 内存册（open）∪ 持久 list（closed）∪ 余（missing）；
 * submitPrompt 受理门前置（服务端已判 open——isOpen 真则驱动在册，
 * submitText 必达）；todoOf 无驱动回 undefined（服务端 `items ?? null`
 * 诚实空）。completion 面 workspaceFiles 已接——TUI 同源 FileMentionSource
 * 经 channels 公开面（@ 文件段补全；锚 = 挂载 cwd 缺省全局态，canonical 化
 * .git 上溯同 TUI mention 源律）；workspaceSymbols 诚实缺席——全仓零实现
 * 零消费、无规范语义，非欠账，有真实需求先立题再接线。
 * exportMarkdown = renderSessionMarkdown 第三消费位（2026-09-17 TUI 余量
 * 收官批②——exportSource seam 注入双事实源 + 行面元数据，拼装真源本件
 * 单源；缺席 seam = 端点 501 诚实缺席）。
 * tiers = 会话档位面桥真身（2026-09-18 webui 档位面受理批——GET tiers
 * 现值/行集 + 两 PUT 走 conversation append 单源；行文案/回执与 TUI 装配
 * 面同源〔session-tier-copy〕；成功尾 setStatus 扇出 CR-TIER-3 两向对称）。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileMentionSource } from '../channels/index.js';
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import {
  foldSessionSandboxMode,
  foldSessionThinkingLevel,
  foldTodoTable,
  setSessionMode,
  setSessionThinkingLevel,
  THINKING_LEVELS,
} from '../conversation/index.js';
import { sanitizeTitleText } from '../persist/index.js';
import { SANDBOX_MODES } from '../safety/index.js';
import { createSdkHttpFace } from '../sdk/index.js';
import type { SdkHttpFaceHandle } from '../sdk/index.js';
import { WEBUI_DEFAULT_HOST, WEBUI_DEFAULT_PORT, mountWebui } from '../webui/index.js';
import type { WebuiDeps, WebuiMountHandle } from '../webui/index.js';

import type { ConversationStack } from './conversation-stack.js';
import { createServeBridge } from './serve-entry.js';
import { renderSessionMarkdown } from './session-export.js';
import type { SessionExportRowLike } from './session-export.js';
import {
  SANDBOX_MODE_DETAILS,
  THINKING_LEVEL_DETAILS,
  sandboxModeReceipt,
  thinkingLevelReceipt,
} from './session-tier-copy.js';
import type { HostRuntime } from './runtime.js';
import type { PluginRouteRegistry } from '../sdk/index.js';

/** 开面选项（TUI 入口注入面——port 即 `--port` 旗标值） */
export interface WebuiBridgeOptions {
  /** 对话栈（桥真身的五动词源：manager/submitText/interrupt/projectionOf/driverOf） */
  readonly stack: ConversationStack;
  /** 宿主运行时（退出序 closer 注册位） */
  readonly runtime: HostRuntime;
  /** 监听端口（缺省 7860 恒回环——WEBUI_DEFAULT_PORT） */
  readonly port?: number;
  /** 静态面目录覆盖（测试注入；缺省探测 dist/webui——缺席 API-only） */
  readonly staticDir?: string;
  /**
   * 新会话工作区根锚点（缺省 process.cwd()）。CL-A2 补位：与 serve/mcp/
   * daemon 三入口的 cwd 注入面同形——测试可注入非 canonical 形锚（symlink
   * 别名等）；登记键 canonical 化在 createServeBridge 内单源执法（本件只
   * 透传 raw 锚，不自造 canonical 化）。注意本键**只锚会话登记键**——@
   * 补全列举锚不随本键、恒挂载缺省全局态（两锚分立律，见
   * WebuiFaceMountOptions.cwd 注；openWebuiFace 有意不向 mountKit.mountOnFace
   * 透传本键——分立律行为锁在测试件 CL-A2 describe）。
   */
  readonly cwd?: string;
  /** 开面披露行（缺省 stderr——token 一次性显示面） */
  readonly disclose?: (line: string) => void;
  /**
   * webui 挂载 kit（批 19e——core:webui 件在场性消费位：scope tryGet
   * 'webui-face-mount' 产物）。在场 = 件装载（路由挂载走件 kit）；
   * 缺席 = 件禁用/零装载——面仍开（/v1/* 在场）而 /api/* 与 SPA 404，
   * 披露分档诚实不虚报（两件禁用语义族——03 §10.4/07 §4.2）。
   */
  readonly mountKit?: WebuiMountKit;
  /**
   * 插件道路由受理器（U5-2——core:sdk 件 kit 透传位）：开面时 snapshot
   * 注入 routes 位（构造期 replay）+ start 后 attachFace（面开后受理走
   * face.register 晚注册位——/reload 换代重注册路）；stop 收口对称
   * detachFace。缺席 = 测试替身/诊断形（零插件道路由）。
   */
  readonly pluginRoutes?: PluginRouteRegistry;
}

/**
 * webui 挂载 kit 形（core:webui 件 provide 'webui-face-mount' 的结构——
 * 与 CorePluginHostDeps.webuiFaceMount 同签名，装配闭包真身 =
 * mountWebuiOnFace；返回挂载产物全量——webui/deps 供 compat 互证面消费）。
 */
export interface WebuiMountKit {
  mountOnFace(face: SdkHttpFaceHandle, options?: { staticDir?: string }): WebuiFaceMount;
}

/** 开面回执（onWebuiOpen 结构化披露位——测试与 main 编舞消费） */
export interface WebuiOpenInfo {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

/** 装配桥产物（面 + webui mount 本体 + 桥真身——compat 互证面） */
export interface WebuiBridgeHandle {
  /** webui mount 本体（backend/detach——零监听零 start/stop；件缺席 = 面开而无挂载，undefined 诚实） */
  readonly webui: WebuiMountHandle | undefined;
  /** 承载面（sdk HTTP 面——token/start/stop 生命周期与 /v1 过渡端点） */
  readonly face: SdkHttpFaceHandle;
  /** 桥真身（三窄面——compat 互证的消费位；件缺席形 undefined） */
  readonly deps: WebuiDeps | undefined;
  /** 收口（幂等）：webui detach（在场时）+ 面 stop——closer 与测试直调共用 */
  stop(): Promise<void>;
}

/**
 * 前台自持面开面（async——监听绑定；TUI / serve 前台 `--port` 形）。
 * 开面即披露（token 只此一次）+ stop 挂退出序；开面失败（如端口占用
 * EADDRINUSE）时先摘挂载再抛——不留半挂 backend。
 */
export async function openWebuiFace(
  options: WebuiBridgeOptions & { readonly onOpen?: (info: WebuiOpenInfo) => void },
): Promise<WebuiBridgeHandle> {
  const face = createSdkHttpFace({
    config: { tcp: { host: WEBUI_DEFAULT_HOST, port: options.port ?? WEBUI_DEFAULT_PORT } },
    // cwd 锚透传（CL-A2——缺省全局态 process.cwd 不变；raw 锚直传，canonical
    // 化归 createServeBridge 登记位单源，本面不自造第二套归一）
    bridge: createServeBridge(options.stack, options.runtime, { cwd: options.cwd ?? process.cwd() }),
    // U5-2 构造期 replay：装载序已受理的插件道路由快照注入 routes 位
    // （受理与挂载两时点解耦——03 §10.6 时序缝定形）
    ...(options.pluginRoutes !== undefined ? { routes: options.pluginRoutes.snapshot() } : {}),
  });
  // 件在场分档（批 19e）：kit 在场 → 挂载走件 kit（真身 = 共用挂载段）；
  // 缺席 → 面开而无 webui 路由（/api/* 404——件禁用语义族，诚实披露）
  const mount =
    options.mountKit !== undefined
      ? options.mountKit.mountOnFace(
          face,
          options.staticDir !== undefined ? { staticDir: options.staticDir } : undefined,
        )
      : undefined;
  let info: Awaited<ReturnType<SdkHttpFaceHandle['start']>>;
  try {
    info = await face.start();
  } catch (err) {
    mount?.detach(); // 监听未成——backend 与路由不留半挂
    throw err;
  }
  const { host, port } = info.tcp[0]!;
  // U5-2 晚注册路挂接：此后受理（/reload 换代重注册）走 face.register——
  // 构造期已注入 snapshot，此处不重放（双注册 throw 防线）
  options.pluginRoutes?.attachFace(face);
  const stop = async (): Promise<void> => {
    mount?.detach(); // 幂等（backend 摘除 + 全路由摘除 + 全流收口 + 审批清槽丢弃性）
    options.pluginRoutes?.detachFace(); // 受理账回 pending 态（活面解挂——收口对称）
    await face.stop(); // 幂等（全流收口 + 关监听）
  };
  const disclose = options.disclose ?? ((line) => process.stderr.write(`${line}\n`));
  if (mount !== undefined) {
    disclose(`Web 界面已开面：http://${host}:${port}/`);
  } else {
    disclose(
      `HTTP 面已开面（webui 件未装载——Web 界面与 /api/* 缺席，/v1/* 程序调用面仍在场）：http://${host}:${port}/`,
    );
  }
  disclose(`访问令牌（仅此一次显示）：${face.token}`);
  options.onOpen?.({ host, port, token: face.token });
  options.runtime.registerCloser({ label: 'webui-server', fn: () => stop() });
  return { webui: mount?.webui, face, deps: mount?.deps, stop };
}

/** 面挂载选项（共用挂载段——daemon 常驻面走本段，不起前台自持面） */
export interface WebuiFaceMountOptions {
  /** 对话栈（桥真身五动词源 + channels backend 挂接位） */
  readonly stack: ConversationStack;
  /** 承载面（sdk HTTP 面——路由经 face.register 直注；daemon 形即 daemon face） */
  readonly face: SdkHttpFaceHandle;
  /** 静态面目录覆盖（测试注入；缺省探测 dist/webui——缺席 API-only） */
  readonly staticDir?: string;
  /**
   * @ 文件段补全锚（缺省 process.cwd()——与浏览器会话 workspaceRoot 缺省
   * 全局态同锚，本件头注既述）。canonical 化 .git 上溯取仓库根（TUI mention
   * 源同律）；测试注入隔离工作区形。注意与 WebuiBridgeOptions.cwd（CL-A2
   * 会话登记键锚）分立——两锚各自缺省全局态，互不串流。
   */
  readonly cwd?: string;
  /**
   * 会话导出源 seam（2026-09-17 TUI 余量收官批②——/export 端点拼装注入位）：
   * 装配根注入双事实源取值器 + 行面元数据读（assembly webuiFaceMount 闭包
   * 同构）；桥真身据此调 renderSessionMarkdown（拼装真源 host 单源——
   * 第三消费位）。缺席 = exportMarkdown 键不注入（端点 501 诚实缺席——
   * API-only 形，WebuiCompletionFace? 缺席诚实空同精神）。
   */
  readonly exportSource?: WebuiExportSource;
}

/**
 * 会话导出源 seam（rowOf/eventsOf 两闭包 + 可选测试钟——shape 与 TUI /export
 * 命令的 SessionExportCommandDeps 同族；装配根从 persistence 真源投影）。
 */
export interface WebuiExportSource {
  /** 行面元数据读（SessionExportRowLike 结构子集——文档头行面投影） */
  rowOf(sessionId: string): SessionExportRowLike | undefined;
  /** 事件双事实源取值器（驱动活体优先〔write-behind 未 flush 也在场〕→ 库行回退 loadSession；undefined = 会话不在场 → 端点 404） */
  eventsOf(sessionId: string): readonly SessionEvent[] | undefined;
  /** 时钟（缺省 Date.now——测试确定性注入位） */
  now?(): number;
}

/** 面挂载产物（共用挂载段——closer 接线归调用方） */
export interface WebuiFaceMount {
  /** webui mount 本体（backend/detach——零监听零 start/stop） */
  readonly webui: WebuiMountHandle;
  /** 桥真身（三窄面——compat 互证的消费位） */
  readonly deps: WebuiDeps;
  /** 摘挂（幂等）：channels 摘 backend + webui detach（全路由摘除+流收口+审批清槽） */
  detach(): void;
}

/**
 * 共用挂载段（18a-3' 三入口咬合真源）：桥真身映射 + webui 路由族注册进
 * 承载面 + channels backend 挂接。TUI/serve 前台经 openWebuiFace 间接受益；
 * daemon 常驻面直调本段（面归 daemon 单源，零第二套映射）。挂载即活——
 * 信封扇出（SSE display/session 族）与审批腿（claim 桥）由 backend 挂接
 * 接线；closer 注册与 token 披露归调用方按入口形各自编排。
 */
export function mountWebuiOnFace(options: WebuiFaceMountOptions): WebuiFaceMount {
  const deps = bridgeDeps(options.stack, options.staticDir, options.exportSource, options.cwd);
  // 面注册器直注（WebuiRouteDescriptor → SdkRouteDescriptor 方向性结构兼容）
  const webui = mountWebui({ ...deps, register: options.face.register });
  // 通道挂接（UiBackend 第四实装 claim 桥）——12f-2c 期注记「addBackend 归
  // 调用方」而 TUI 调用方缺席 = SSE 死流真缺陷，本段收编（修前必红例锁死）
  options.stack.channels.addBackend(webui.backend);
  let detached = false;
  return {
    webui,
    deps,
    detach: () => {
      if (detached) return;
      detached = true;
      options.stack.channels.removeBackend(webui.backend.id); // 未注册位 no-op（件内幂等）
      webui.detach();
    },
  };
}

/**
 * 桥真身：conversation 栈五动词 → WebuiDeps 三窄面（词面独立律——本侧
 * 只做映射不造新词；结构兼容由 face.register 直注与 e2e 双向互证）。
 */
function bridgeDeps(
  stack: ConversationStack,
  staticDirOverride?: string,
  exportSource?: WebuiExportSource,
  cwd?: string,
): WebuiDeps {
  // @ 文件段补全源（挂载期单实例——锚随面恒定、源零状态、同步 IO 毫秒级；
  // TUI per-query 新铸是因其锚随聚焦会话变，此处锚恒定不必仿）
  const fileSource = new FileMentionSource({ basePath: canonicalWorkspaceRoot(cwd ?? process.cwd()) });
  return {
    sessions: {
      createSession: () => stack.manager.create().sessionId,
      listSessions: () =>
        stack.manager.list().map((row) => ({
          id: row.id,
          // 标题净化（第五役 G6 存量行双保险）：写路物化已源头净化，此面兜旧码
          // 落库的脏 title——剥控制字节/逃逸序列后再外发 webui JSON 面；净化
          // 归空（不可见形态）诚实退 null（不造占位串）
          title: row.title === undefined ? null : sanitizeTitleText(row.title) || null,
          lastActivityAt: row.updatedAt,
        })),
      sessionStateOf: (sessionId) => {
        if (stack.manager.isOpen(sessionId)) return 'open';
        // 持久册可见 = 已闭（open 态由内存册先判——零 I/O 承诺下新建未落库行
        // 也在内存册，不漏判）
        return stack.manager.list().some((row) => row.id === sessionId) ? 'closed' : 'missing';
      },
      submitPrompt: (input) => {
        void stack.submitText(input.sessionId, input.content); // fire-and-forget——回执经信封回流
        return { sessionId: input.sessionId };
      },
      interruptSession: (sessionId) => stack.interrupt(sessionId), // 未知 id 静默幂等（栈内建）
    },
    read: {
      fetchMessages: (sessionId) => stack.projectionOf(sessionId),
      // 无驱动（closed 会话）回 undefined——服务端 null 诚实空；fold 空事件得 []
      todoOf: (sessionId) => {
        const driver = stack.driverOf(sessionId);
        return driver === undefined ? undefined : foldTodoTable(driver.session.events());
      },
      // /export markdown 拼装真身（2026-09-17 TUI 余量收官批②——renderSessionMarkdown
      // 第三消费位：TUI /export 与 CLI berry sessions export 之外新增 web 直出腿；
      // 不落盘——web 面消费语义 = 浏览器/curl 直接取文）。缺席语义双档：
      // seam 缺席 = 键不注入（端点 501）；eventsOf undefined = 会话不在场
      // （端点 404 not_found）。已闭会话近史兜底（loadSession 回退）在 seam
      // 的 eventsOf 内——closed 照常返体（读面语义同 fetchMessages）。
      ...(exportSource !== undefined
        ? {
            exportMarkdown: (sessionId: string): string | undefined => {
              const events = exportSource.eventsOf(sessionId);
              if (events === undefined) return undefined; // 会话不在场——404 归端点判
              const row = exportSource.rowOf(sessionId);
              return renderSessionMarkdown({
                events,
                meta: {
                  sessionId,
                  // 行面元数据缺席不造行（零事件新会话同形——title 空串视为缺席）
                  ...(row?.title !== undefined && row.title !== '' ? { title: row.title } : {}),
                  ...(row?.workspaceRoot !== undefined ? { workspaceRoot: row.workspaceRoot } : {}),
                  ...(row?.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
                },
                now: exportSource.now?.() ?? Date.now(),
              });
            },
          }
        : {}),
    },
    // 会话档位面（2026-09-18 webui 档位面受理批——/thinking //sandbox webui
    // 受路）：WebuiSessionTierFace 桥真身（词面独立律的装配侧兑现）。写入
    // 单源 = conversation 件档位切换面 append（setSessionThinkingLevel /
    // setSessionMode——05 §1.1 两行单写者律，webui 侧零第二写入位）；行集 =
    // 词表单源（THINKING_LEVELS / SANDBOX_MODES）× host 档位文案表
    // （session-tier-copy——TUI picker 装配同源消费）；回执 = 单源拼装
    // helper（PUT 应答体 receipt 与 TUI setStatus 回执同文）。stack 恒在场
    // → 本面恒注入（501 缺席形只在件侧 deps 装配位产生，桥真身无缺席腿）。
    tiers: {
      tiersOf: (sessionId) => {
        // 行集恒全量（驱动在否不影响——SPA 词表/文案零硬编码的服务端真源；
        // 词序即 picker 行序）
        const thinkingLevels = THINKING_LEVELS.map((level) => ({ level, detail: THINKING_LEVEL_DETAILS[level] }));
        const sandboxModes = SANDBOX_MODES.map((mode) => ({ mode, detail: SANDBOX_MODE_DETAILS[mode] }));
        const driver = stack.driverOf(sessionId);
        if (driver === undefined) {
          // 缺席防御：现值退栈基线（thinking 可无锚 null / sandbox 恒 boot 锚
          // ——05 §1.1 落码注记同律）；会话存在性分账归服务端 404（open 态
          // 恒有驱动，此形 = 边界防御位）
          return {
            thinkingLevel: stack.thinkingLevel ?? null,
            sandboxMode: stack.sandboxMode,
            thinkingLevels,
            sandboxModes,
          };
        }
        // fold 坏词直接上抛（冷读 CR-TIER-2：GET 走面级 500——TUI 开屏
        // notify 降级形分立如实，此处不套 try/catch）；thinking 现值 =
        // fold ?? 栈基线 ?? null（两级缺席 = 诚实无锚）；sandbox 现值 =
        // fold（fallback 必填恒 boot 值——M2 裁决，tui-entry 同调用形）
        return {
          thinkingLevel: foldSessionThinkingLevel(driver.session.events()) ?? stack.thinkingLevel ?? null,
          sandboxMode: foldSessionSandboxMode(driver.session.events(), stack.sandboxMode),
          thinkingLevels,
          sandboxModes,
        };
      },
      setThinkingLevel: (sessionId, level) => {
        const driver = stack.driverOf(sessionId);
        if (driver === undefined) {
          // 会话不在场 fail-loud（服务端前置 404 分账之外的桥侧防御位——
          // 既有错误码族复用）
          throw new BaseError('SESSION_NOT_FOUND', `会话不在场（${sessionId}）——档位切换需要会话驱动在册`);
        }
        // 坏词 BaseError 自然上抛（THINKING_LEVEL_INVALID——服务端 400 码族
        // 词面呈现不吞码；校验在 append 之前坏词不入账）
        setSessionThinkingLevel(driver.session, level);
        const receipt = thinkingLevelReceipt(level);
        // 成功尾 setStatus 扇出（冷读 CR-TIER-3 裁决①：session-scoped SSE
        // status 帧达他通道观众——TUI 切档→webui 可见 / webui 切档→TUI 状态
        // 行可见，两向对称；发起方 SPA 同时收应答体 receipt 与 status 帧，
        // 两位呈现幂等）
        stack.channels.setStatus(sessionId, receipt);
        return receipt;
      },
      setSandboxMode: (sessionId, mode) => {
        const driver = stack.driverOf(sessionId);
        if (driver === undefined) {
          throw new BaseError('SESSION_NOT_FOUND', `会话不在场（${sessionId}）——档位切换需要会话驱动在册`);
        }
        // 坏词 SANDBOX_MODE_INVALID 同律上抛（append 面词法校验单源）
        setSessionMode(driver.session, mode);
        const receipt = sandboxModeReceipt(mode);
        // 成功尾扇出同 thinking 律（CR-TIER-3 两向对称）
        stack.channels.setStatus(sessionId, receipt);
        return receipt;
      },
    },
    // 补全族：workspaceFiles = TUI 同源 @ 文件段源（replacement 形直出——
    // 条目即完整 token 代换单位，含 @ 前缀与引号形，客户端零路径知识零引号
    // 知识）；workspaceSymbols 不注入（全仓零实现零消费——服务端 ?? [] 诚实空）
    completion: {
      workspaceFiles: (query) => fileSource.get(query).map((item) => item.replacement),
    },
    ...(staticDirOverride !== undefined ? { staticDir: staticDirOverride } : { staticDir: resolveStaticDir() }),
  };
}

/**
 * 静态面目录探测：构建共生形 dist/host → dist/webui（SPA index.html 在场
 * 才启用；缺席 = API-only 形——/ 与未知路径 404，诚实不虚报）。测试态
 * （tsx 直跑 src）src/webui 无 index.html 自动落 API-only。
 */
function resolveStaticDir(): string | undefined {
  const candidate = join(dirname(fileURLToPath(import.meta.url)), '..', 'webui');
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined;
}
