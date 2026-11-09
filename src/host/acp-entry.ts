/**
 * host/acp-entry — `berry acp` 入口（07 §5 命令族·ACP server 包装形态；
 * 03 §10.6 2026-11-09 ACP 形态批）。
 *
 * 组合根形态承 mcp-entry 同族：装配公共段（assembleHostStack——与 TUI 同一
 * 合成代码路径）→ 结构化注入面组装（AcpFaceDeps——host 闭包把 ConversationStack
 * 的会话/档位/模型面折成窄面；件不 import 宿主实现铁律不破例）→ runAcpFace
 * （plugins/sdk 件承载）→ 后端注册（信封回流自动馈送）→ 终局六步退出序。
 *
 * CLI 零旗标面（mcp 形同律）：stdout = 协议线（一行一 JSON-RPC），诊断走
 * stderr。审批有应答通道（session/request_permission——ACP 形与 mcp 形的
 * 分立点）；prompt 挂 run 终态回执（直播档——翻译与回执单源在件）。
 */
import type { Readable, Writable } from 'node:stream';
import { stdin, stdout, stderr } from 'node:process';

import { runAcpFace, type AcpFaceDeps } from '../../plugins/sdk/index.js';
import type { AcpSubmitOutcome } from '../../plugins/sdk/index.js';
import type { Provider } from '../llm/index.js';
import type { SandboxMode } from '../safety/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { setSessionMode, setSessionModel } from '../conversation/index.js';
import type { SubmitResult } from '../conversation/index.js';

import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import type { ConversationStack } from './conversation-stack.js';
import type { HostRuntime } from './runtime.js';

/** acp 入口选项（main 分派接线 + 测试注入面——承 McpEntryOptions 同族，零旗标） */
export interface AcpEntryOptions {
  /** 传输流对（缺省 process stdin/stdout——ACP stdio 形态本体） */
  readonly io?: { readonly input: Readable; readonly output: Writable };
  /** 新会话工作区根锚点（缺省 process.cwd()——canonical 化在注入面内执法） */
  readonly cwd?: string;
  /** 数据目录（缺省 resolveDataDir() 三级梯子） */
  readonly dataDir?: string;
  /** :memory: 同构形态（诊断测试） */
  readonly memory?: boolean;
  /** 初始 provider 集（测试注入 faux provider） */
  readonly providers?: readonly Provider[];
  /** 模型标识（组合根透传；缺省 BERRY_AGENT_MODEL 覆盖律） */
  readonly model?: string;
  /** 沙箱档位取值器（透传组合根——boot 解析值，set_mode 会话级切换在其上） */
  readonly sandboxMode?: () => SandboxMode;
  /** env 面（缺省 process.env；测试隔离） */
  readonly env?: Record<string, string | undefined>;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** agentInfo 版本真值（缺省 0.0.0-unknown——main 接线传 readVersion()） */
  readonly version?: string;
}

/**
 * 结构化注入面组装（host 闭包——件区窄面与栈实现之间唯一翻译层）：
 * - 会话腿：create = manager.create（工作区锚 canonical 化〔CL-A2〕）；
 *   open = manager.open 幂等续接（行缺席抛 SESSION_NOT_FOUND 注册码族）；
 * - prompt 腿：显式 open 落驱动后同步 submitText 直取 run 终态 Promise
 *   （serve 桥的让位一拍〔订阅竞态〕在 ACP 形不需要——信封经 addBackend
 *   恒达，无订阅时点竞态；SubmitResult 三分收窄为 AcpSubmitOutcome）；
 * - 档位/模型腿：durable 事件面直写（setSessionMode/setSessionModel——
 *   append 即切换、重放即恢复；模型 spec 语法校验 fail-loud 抛注册码）。
 */
function buildAcpDeps(stack: ConversationStack, anchors: { cwd: string }): AcpFaceDeps {
  const driverOf = (sessionId: string) => stack.driverOf(sessionId) ?? stack.manager.open(sessionId).driver;

  const toOutcome = (result: SubmitResult | undefined): AcpSubmitOutcome => {
    if (result === undefined) {
      // 无驱动投递（停摆会话 inject 路等）——「未起跑」如实回执。
      return { kind: 'ignored' };
    }
    if (result.status === 'injected' || result.status === 'wake-refused') {
      // inject（落账待下次启动）与唤醒拒收两档：ACP 无对应语义，按未起跑回执。
      return { kind: 'ignored' };
    }
    // run 终态三元组直投（崩溃路径 status 缺席不虚构——undefined 不在此分支）。
    return {
      kind: 'run',
      status: result.status,
      ...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
    };
  };

  return {
    createSession: () => {
      const session = stack.manager.create({ workspaceRoot: canonicalWorkspaceRoot(anchors.cwd) });
      return session.sessionId;
    },
    openSession: (sessionId) => {
      stack.manager.open(sessionId);
    },
    submitPrompt: async (input) => {
      driverOf(input.sessionId);
      const result = await stack.submitText(input.sessionId, input.content, { source: 'channel:sdk' });
      return toOutcome(result);
    },
    interruptSession: (sessionId) => {
      stack.interrupt(sessionId);
    },
    listSessions: () =>
      stack.manager.list().map((row) => ({
        id: row.id,
        title: row.title ?? row.firstQuestionSummary ?? null,
        lastActivityAt: row.updatedAt,
      })),
    setSandboxMode: (sessionId, mode) => {
      setSessionMode(driverOf(sessionId).session, mode);
    },
    setModelSpec: (sessionId, spec) => {
      setSessionModel(driverOf(sessionId).session, spec);
    },
    modelCatalog: () => stack.llm.listModels().map((model) => ({ id: model.id, name: model.name })),
    modelOf: (sessionId) => stack.sessionModelOf(sessionId),
  };
}

/**
 * acp 主入口。阻塞至调用方收线（stdin EOF = 对端 agent 退出）/ 信号（经
 * main 编舞 → runtime.shutdown → closer → face.dispose）/ 传输面坏死；
 * 返回进程退出码。
 */
export async function runAcpEntry(options: AcpEntryOptions): Promise<number> {
  // —— 装配公共段（与 TUI 同一合成代码路径；debug 恒 false：零旗标律）——
  const assembly = await assembleHostStack({
    runtime: {
      ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
      ...(options.memory === true ? { memory: true } : {}),
    },
    noPlugins: false,
    debug: false,
    version: options.version ?? '0.0.0-unknown',
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
  });
  if (!assembly.ok) {
    stderr.write(`${assembly.crashed ? `acp 运行失败：${assembly.message}` : assembly.message}\n`);
    return assembly.exitCode;
  }
  const { runtime, stack, logger }: AssemblySuccess = assembly;

  let exitCode = 0;
  try {
    const deps = buildAcpDeps(stack, { cwd: options.cwd ?? process.cwd() });
    const face = runAcpFace({
      io: options.io ?? { input: stdin, output: stdout },
      deps,
      serverInfo: { name: 'berry-agent', version: options.version ?? '0.0.0-unknown' }, // 对外声明值位
      log: (message) => logger.warn(message),
    });
    stack.channels.addBackend(face.backend); // 信封回流自动馈送（conversation-stack onEvent → emit）

    // 信号路优雅档：六步退出序经 closer 收口 face（幂等）；EOF 路径 face 自决
    runtime.registerCloser({ label: 'acp-face', fn: () => Promise.resolve(face.dispose()) });

    exitCode = await face.done; // EOF 0 / 传输面坏死 1
    await runtime.shutdown().catch(() => {}); // 六步退出序（closer 内已 dispose——幂等双保险）
  } catch (err) {
    runtime.writeCrashLog(err); // 崩溃取证先行（memory 形跳过——件内语义）
    stderr.write(`acp 运行失败：${err instanceof Error ? err.message : String(err)}\n`);
    exitCode = 1;
  }
  return exitCode;
}
