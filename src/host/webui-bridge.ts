/**
 * host/webui-bridge — `--port` webui 一次性开面装配桥（批 12f-2c；03 §10.4
 * host 接线义务：`--port <n>` 开面 + token 一次性披露 + 生命周期收口）。
 * 批 18a-2' 改形适配：webui 件零自持监听——本桥起 sdk HTTP 面承路由
 * （mountWebui 注册 face.register——面注册器直注）。
 *
 * **过渡期桥自持面（18a-3' 归一挂账）**：本桥为 webui 单开的面属过渡形——
 * daemon 常驻面归一（webui 路由注册进 daemon face + 三入口咬合）在 18a-3'
 * 兑现；届时本桥收编。过渡期本面同时活 /v1 SDK 六端点（bridge 走
 * createServeBridge 同 daemon——零第二套映射）与 webui 路由族。
 *
 * 职责（装配桥五面）：conversation 栈五动词 → WebuiDeps 三窄面映射（词面
 * 独立律的装配侧互证——18a 通报「compat 互证归 host 装配批」批 12f-2c 已
 * 兑现，改形后经 face.register 直注维持）+ staticDir 探测（dist/webui 共生
 * 形；缺席诚实 API-only 不虚报）+ token 一次性披露（stderr 缺省——监听 ⇒
 * 鉴权恒在场，令牌只此一次显示；token 生成归面）+ handle.backend 通道挂接
 * （UiBackend 第四实装 claim 桥——由调用方 addBackend，本桥只开面）+ stop
 * 进运行时退出序 closer（注册序在 plugin-unload 之后、tui-backend 之前——
 * 网络面先关再出屏）。
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
}

/** 开面回执（onWebuiOpen 结构化披露位——测试与 main 编舞消费） */
export interface WebuiOpenInfo {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

/** 装配桥产物（面 + webui mount 本体 + 桥真身——compat 互证面） */
export interface WebuiBridgeHandle {
  /** webui mount 本体（backend/detach——零监听零 start/stop） */
  readonly webui: WebuiMountHandle;
  /** 承载面（sdk HTTP 面——token/start/stop 生命周期与 /v1 过渡端点） */
  readonly face: SdkHttpFaceHandle;
  /** 桥真身（三窄面——compat 互证的消费位） */
  readonly deps: WebuiDeps;
  /** 收口（幂等）：webui detach + 面 stop——closer 与测试直调共用 */
  stop(): Promise<void>;
}

/**
 * webui 一次性开面（async——监听绑定）。开面即披露（token 只此一次）+
 * stop 挂退出序；handle.backend 的 addBackend 归调用方（与 TuiBackend
 * 并存扇出——多 backend 信封路由按 sessionId 各投各）。
 */
export async function openWebuiFace(
  options: WebuiBridgeOptions & { readonly onOpen?: (info: WebuiOpenInfo) => void },
): Promise<WebuiBridgeHandle> {
  const deps = bridgeDeps(options.stack, options.staticDir);
  // 过渡形：为 webui 单开 sdk 面（bridge 同 daemon——createServeBridge 零第二
  // 套映射；/v1 端点随之而活，18a-3' 归一时收编）
  const face = createSdkHttpFace({
    config: { tcp: { host: WEBUI_DEFAULT_HOST, port: options.port ?? WEBUI_DEFAULT_PORT } },
    bridge: createServeBridge(options.stack, options.runtime, { cwd: process.cwd() }),
  });
  // 面注册器直注（WebuiRouteDescriptor → SdkRouteDescriptor 方向性结构兼容）
  const webui = mountWebui({ ...deps, register: face.register });
  const info = await face.start();
  const { host, port } = info.tcp[0]!;
  const stop = async (): Promise<void> => {
    webui.detach(); // 幂等（全路由摘除 + 全流收口 + 审批清槽丢弃性）
    await face.stop(); // 幂等（全流收口 + 关监听）
  };
  const disclose = options.disclose ?? ((line) => process.stderr.write(`${line}\n`));
  disclose(`Web 界面已开面：http://${host}:${port}/`);
  disclose(`访问令牌（仅此一次显示）：${face.token}`);
  options.onOpen?.({ host, port, token: face.token });
  options.runtime.registerCloser({ label: 'webui-server', fn: () => stop() });
  return { webui, face, deps, stop };
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
