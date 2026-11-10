/**
 * host/acp-entry — `berry acp` 入口（07 §5 命令族·ACP server 包装形态——
 * 03 §10.6 第四形态·CLI/SDK 进化批 A3 2026-11-09）。
 *
 * 组合根形态承 mcp-entry 同族：装配公共段（assembly——与 TUI 同一合成代码
 * 路径）→ 装配桥（createServeBridge——三形态共用）→ runAcpFace（plugins/sdk
 * acp 件承载：行帧 JSON-RPC v1 agent 位 + session/update 直播 + 审批双向）
 * → 后端注册（信封回流自动馈送）→ 终局走六步退出序。
 *
 * 与 mcp-entry 的两处分立：
 *  - **面亡执法（「sdk 禁 ⇒ 面亡」族第四入口——07 §5 族扩容注）**：装配后
 *    查 core:sdk plan 行（boot.report.activated——plugin-boot 判式同源语义），
 *    缺席/禁用即拒启退 2（daemon 形同码）；mcp-entry 第五入口同批补齐同
 *    判式（两 stdio 包装入口行为一致化——03 §10.6 MCP 形同批批注）。
 *  - **createSession 注入（session/new cwd 受理律）**：ACP 会话铸造位 =
 *    stack.manager.create + canonicalWorkspaceRoot 归一（与 run/tick cwdAnchor
 *    同族——A4 宿主项目上下文段的发现锚由此而来）。
 *
 * CLI 零旗标面（07 §5：`acp` 同 mcp 形——stdio 线不落日志噪音）；stdout =
 * 协议线（一行一 JSON-RPC），诊断走 stderr。
 */
import type { Readable, Writable } from 'node:stream';
import { stdin, stdout, stderr } from 'node:process';

import { runAcpFace } from '../../plugins/sdk/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { setSessionMode, setSessionModel } from '../conversation/index.js';
import type { SandboxMode } from '../safety/index.js';
import type { Provider } from '../llm/index.js';

import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import { createServeBridge } from './serve-entry.js';
import type { HostRuntime } from './runtime.js';

/** acp 入口选项（main 分派接线 + 测试注入面——承 McpEntryOptions 同族，零旗标） */
export interface AcpEntryOptions {
  /** 传输流对（缺省 process stdin/stdout——ACP stdio 形态本体） */
  readonly io?: { readonly input: Readable; readonly output: Writable };
  /** 缺省会话 cwd 锚（session/new 未显式 cwd 时的兜底——缺省 process.cwd()；经 canonical 归一） */
  readonly cwd?: string;
  /** 数据目录（缺省 resolveDataDir() 三级梯子） */
  readonly dataDir?: string;
  /** :memory: 同构形态（诊断测试） */
  readonly memory?: boolean;
  /** 初始 provider 集（测试注入 faux provider） */
  readonly providers?: readonly Provider[];
  /** 模型标识（组合根透传；缺省 BERRY_AGENT_MODEL 覆盖律） */
  readonly model?: string;
  /** 沙箱档位取值器（透传组合根） */
  readonly sandboxMode?: () => SandboxMode;
  /** env 面（缺省 process.env；测试隔离） */
  readonly env?: Record<string, string | undefined>;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** agentInfo 版本真值（缺省 0.0.0-unknown——main 接线传 readVersion()） */
  readonly version?: string;
}

/**
 * acp 主入口。阻塞至调用方收线（stdin EOF = 客户端退出）/ 信号（经 main
 * 编舞 → runtime.shutdown → closer → face.dispose）/ 传输面坏死；返回进程
 * 退出码。
 */
export async function runAcpEntry(options: AcpEntryOptions): Promise<number> {
  // —— 装配公共段（批 19a-3 迁 assembly 件——与 TUI 同一合成代码路径；
  // debug 恒 false：零旗标律〔07 §5〕，日志级只走 env）——
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

  // —— 面亡执法（「sdk 禁 ⇒ 面亡」族第四入口——03 §10.6 A3 条：core:sdk
  // plan 行缺席/禁用即拒启退 2，daemon 形同码。判式 = boot.report.activated
  // 含 core:sdk（plugin-boot 席位判式的 report 侧同源语义：装载失败形也在
  // activated 缺席中如实呈现——拒启文案覆盖禁用/失败两形）——
  const sdkSeatActive = assembly.boot.report.activated.some((row) => row.id === 'core:sdk');
  if (!sdkSeatActive) {
    stderr.write(
      'core:sdk 插件未装载（被禁用或装载失败）——ACP 面随件缺席（「sdk 禁 ⇒ 面亡」语义族：daemon/TCP/sock/stdio 包装入口同蒙）。恢复：从启用清单移除禁用行或排查装载失败后重试\n',
    );
    await runtime.shutdown().catch(() => {});
    return 2;
  }

  let exitCode = 0;
  try {
    // session/new 的会话铸造位（cwd 受理律——manager.create + canonical 归一，
    // run/tick cwdAnchor 同族；A4 宿主项目上下文段的发现锚由此而来）
    const fallbackCwd = options.cwd ?? process.cwd();
    const bridge = createServeBridge(stack, runtime, { cwd: fallbackCwd });
    const face = runAcpFace({
      io: options.io ?? { input: stdin, output: stdout },
      bridge,
      createSession: (cwd) => stack.manager.create({ workspaceRoot: canonicalWorkspaceRoot(cwd) }).sessionId,
      serverInfo: { name: 'berry-agent', version: options.version ?? '0.0.0-unknown' }, // 对外声明值位
      log: (message) => logger.warn(message),
      // hapi 契约四腿(2026-11-10 深度适配批):模型目录(凭证瘦身)/生效模型/
      // 会话级切模型/切沙箱——session/new 响应携 models 块 + configOptions、
      // session/set_config_option·set_model 走 durable 事件落账、
      // session/set_mode 走沙箱档轴(与 set_mode 轴同 DSH/Hermes 家族)
      modelCatalog: () =>
        stack.llm
          .listModels()
          .filter((model) => stack.modelCredentialStatus(model.id) === 'ready')
          .map((model) => ({ id: model.id, name: model.name })),
      modelOf: (sessionId) => stack.sessionModelOf(sessionId),
      setModelSpec: (sessionId, spec) => {
        setSessionModel((stack.driverOf(sessionId) ?? stack.manager.open(sessionId).driver).session, spec);
      },
      setSandboxMode: (sessionId, mode) => {
        setSessionMode((stack.driverOf(sessionId) ?? stack.manager.open(sessionId).driver).session, mode);
      },
      resumeSession: (sessionId) => {
        stack.manager.open(sessionId);
      },
      listSessions: () =>
        stack.manager.list().map((row) => ({
          id: row.id,
          title: row.title ?? row.firstQuestionSummary ?? null,
          lastActivityAt: row.updatedAt,
        })),
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
