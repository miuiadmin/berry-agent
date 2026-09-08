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
 * 诚实空）。completion 面 v1 不接（诚实缺席——补全族接线挂账后续批）。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { foldTodoTable } from '../conversation/index.js';
import { createSdkHttpFace } from '../sdk/index.js';
import type { SdkHttpFaceHandle } from '../sdk/index.js';
import { WEBUI_DEFAULT_HOST, WEBUI_DEFAULT_PORT, mountWebui } from '../webui/index.js';
import type { WebuiDeps, WebuiMountHandle } from '../webui/index.js';

import type { ConversationStack } from './conversation-stack.js';
import { createServeBridge } from './serve-entry.js';
import type { HostRuntime } from './runtime.js';

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
  /** 开面披露行（缺省 stderr——token 一次性显示面） */
  readonly disclose?: (line: string) => void;
  /**
   * webui 挂载 kit（批 19e——core:webui 件在场性消费位：scope tryGet
   * 'webui-face-mount' 产物）。在场 = 件装载（路由挂载走件 kit）；
   * 缺席 = 件禁用/零装载——面仍开（/v1/* 在场）而 /api/* 与 SPA 404，
   * 披露分档诚实不虚报（两件禁用语义族——03 §10.4/07 §4.2）。
   */
  readonly mountKit?: WebuiMountKit;
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
    bridge: createServeBridge(options.stack, options.runtime, { cwd: process.cwd() }),
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
  const stop = async (): Promise<void> => {
    mount?.detach(); // 幂等（backend 摘除 + 全路由摘除 + 全流收口 + 审批清槽丢弃性）
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
  const deps = bridgeDeps(options.stack, options.staticDir);
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
function bridgeDeps(stack: ConversationStack, staticDirOverride?: string): WebuiDeps {
  return {
    sessions: {
      createSession: () => stack.manager.create().sessionId,
      listSessions: () =>
        stack.manager.list().map((row) => ({
          id: row.id,
          title: row.title ?? null, // 无标题会话 null（不造占位串）
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
    },
    // completion 面 v1 不接（可选面缺席合法——服务端诚实回空）
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
