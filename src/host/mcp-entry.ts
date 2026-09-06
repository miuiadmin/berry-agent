/**
 * host/mcp-entry — `berry-agent mcp` 入口（07 §5 命令族·MCP server 包装形态）。
 *
 * 组合根形态承 serve-entry 同族：运行时组装 → conversation 栈 → 装配桥
 * （createServeBridge——三形态共用）→ runMcpFace（src/sdk/mcp 件承载：
 * 行帧 JSON-RPC 反向位 + 工具面收窄两件 `berry-agent`/`berry-agent-reply`）
 * → 后端注册（信封回流自动馈送）→ 终局走六步退出序。
 *
 * CLI 零旗标面（07 §5：`mcp` 不收 --debug 等——MCP stdio 面不落日志噪音）；
 * stdout = 协议线（一行一 JSON-RPC），诊断走 stderr。审批 v1 无应答通道
 * （工具面不含 decide）：ask 无订阅者 fail-closed cancel——04 §9 headless
 * 律不豁免（03 §10.6 批 13f 落码定形）。
 */
import type { Readable, Writable } from 'node:stream';
import { stdin, stdout, stderr } from 'node:process';

import { runMcpFace } from '../sdk/index.js';
import type { SandboxMode } from '../safety/index.js';
import { createLogger, LogLevelState } from '../context/index.js';
import type { Provider } from '../llm/index.js';

import { createConversationStack } from './conversation-stack.js';
import type { ConversationStack } from './conversation-stack.js';
import { createServeBridge } from './serve-entry.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';

/** mcp 入口选项（main 分派接线 + 测试注入面——承 ServeEntryOptions 同族，零旗标） */
export interface McpEntryOptions {
  /** 传输流对（缺省 process stdin/stdout——MCP stdio 形态本体） */
  readonly io?: { readonly input: Readable; readonly output: Writable };
  /** 新会话工作区根锚点（缺省 process.cwd()） */
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
  /** 已组运行时（测试注入；缺省现场组装） */
  readonly runtime?: HostRuntime;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** serverInfo 版本真值（缺省 0.0.0-unknown——main 接线传 readVersion()） */
  readonly version?: string;
}

/**
 * mcp 主入口。阻塞至调用方收线（stdin EOF = 对端 agent 退出）/ 信号（经
 * main 编舞 → runtime.shutdown → closer → face.dispose）/ 传输面坏死；
 * 返回进程退出码。
 */
export async function runMcpEntry(options: McpEntryOptions): Promise<number> {
  // —— 运行时组装（单活跃机 + 开库 fail-loud——serve-entry 同款）——
  let runtime: HostRuntime;
  try {
    runtime =
      options.runtime ??
      createHostRuntime({
        ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
        ...(options.memory === true ? { memory: true } : {}),
      });
  } catch (err) {
    stderr.write(`启动失败：${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  options.onRuntime?.(runtime);

  // 诊断日志走 stderr（stdout 是协议线——MCP 面不落日志噪音）
  const env = options.env ?? process.env;
  const logState = LogLevelState.fromEnv(env.BERRY_AGENT_LOG_LEVEL);
  const logger = createLogger('host', logState);

  let exitCode = 0;
  try {
    const stack: ConversationStack = createConversationStack({
      runtime,
      ...(options.providers !== undefined ? { providers: options.providers } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
      warn: (message) => logger.warn(message),
    });

    const bridge = createServeBridge(stack, runtime, { cwd: options.cwd ?? process.cwd() });
    const face = runMcpFace({
      io: options.io ?? { input: stdin, output: stdout },
      bridge,
      serverInfo: { name: 'berry-agent', version: options.version ?? '0.0.0-unknown' }, // 对外声明值位
      log: (message) => logger.warn(message),
    });
    stack.channels.addBackend(face.backend); // 信封回流自动馈送（conversation-stack onEvent → emit）

    // 信号路优雅档：六步退出序经 closer 收口 face（幂等）；EOF 路径 face 自决
    runtime.registerCloser({ label: 'mcp-face', fn: () => Promise.resolve(face.dispose()) });

    exitCode = await face.done; // EOF 0 / 传输面坏死 1
    await runtime.shutdown().catch(() => {}); // 六步退出序（closer 内已 dispose——幂等双保险）
  } catch (err) {
    runtime.writeCrashLog(err); // 崩溃取证先行（memory 形跳过——件内语义）
    stderr.write(`mcp 运行失败：${err instanceof Error ? err.message : String(err)}\n`);
    exitCode = 1;
  }
  return exitCode;
}
