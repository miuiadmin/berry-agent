/**
 * L2 tools — 三段 waterfall 管道（04 §7：schema → 守门 → 执行，工具执行唯一合法路径）。
 *
 * 结构（前三步是硬编舞、钩子是同词 waterfall 监听者——safety 守门行与插件
 * 钩子同链，监听者可追加；守门段由 safety 件占首位）：
 *
 *   0. schema 段（前置步，非钩子段）——typebox Value.Check 不过即拒
 *      TOOL_INVALID_ARGS（可纠正错误回执），不进守门/执行段；
 *   1. tools_pre_execute 守门段——决策词汇 allow / block{reason}（短路）/
 *      mutate{args}（就地改参）；监听器抛错 = fail-closed 视同 block
 *      （TOOL_GATE_FAILED——先落 gate/decision 再拒，审计链不断头）；
 *   2. tools_execute 执行段——around-dispatch（载荷 = 执行闭包，监听者包
 *      装后经 next 传播）；链尾缺省实现 = timeoutMs 预算竞速 + 调 execute
 *      （超时 TOOL_TIMEOUT——取消传播靠 signal，不强杀 promise）；
 *   3. tools_post_execute 后处理段——可就地改写 result（裁剪/isError 改写）；
 *      链尾固定步 = 输出护栏（64KiB 保尾截断 + 全文外溢临时文件——04 §7
 *      执行段细则：护栏是管道属性，全部工具受益；只钳文本 content）。
 *
 * 失败统一抛 BaseError（message 首缀 `[CODE]`——02 §5.3 #4：错误信息 =
 * code + 人读 message，durable 结果里码可见可序列化）；loop 工具批的
 * executeOne try/catch 把异常包装成 isError 结果（错误是数据面）。
 *
 * gate/decision durable 事件经注入 sink 落日志（装配根接 session.append；
 * tools 不依赖 session——DAG 单向，04 §7 段 2）。
 */
import { Value } from 'typebox/value';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { BaseError } from '../contracts/index.js';
import { redactToolResultExit } from '../contracts/index.js';
import { TOOL_EXECUTE_EVENT, TOOL_POST_EXECUTE_EVENT, TOOL_PRE_EXECUTE_EVENT } from '../contracts/index.js';
import type {
  AgentToolResult,
  ExecuteInput,
  GateDecisionSink,
  GateInput,
  PostExecuteInput,
  TextContent,
  ToolPipelineExecutor,
} from '../contracts/index.js';
import type { EventDispatch } from '../context/index.js';

/** 管道选项（createToolPipeline 一次性注入，装配根负责） */
export interface ToolPipelineOptions {
  /** gate/decision durable 落点（接线 session.append；缺省不记录——测试/无会话场景） */
  onGateDecision?: GateDecisionSink;
  /** 缺省执行预算毫秒（缺省 60s；def.timeoutMs 逐工具覆盖——04 §7 执行段） */
  defaultTimeoutMs?: number;
  /** 输出护栏字节帽（缺省 64KiB；测试面可注小值验证截断路径） */
  outputGuardBytes?: number;
  /**
   * 已知秘密活值 provider（出口治理③ 值基腿——04 §7 执行段 2026-09-08 落码
   * 定形）：装配侧 credentials 库 live 读闭包（每次调用现取——工具执行期间
   * 新入库的凭证同受覆盖）。缺省空 = 纯模式执法（降级诚实）。
   */
  sensitiveValues?: () => readonly string[];
}

/** 组装 `[CODE] message` 形态的错误文本（码随 message 进入工具结果——02 §5.3 #4） */
function codedMessage(code: string, message: string): string {
  return `[${code}] ${message}`;
}

/** 缺省输出护栏预算（64KiB——04 §7 执行段细则：输出护栏是管道属性） */
export const OUTPUT_GUARD_BYTES = 64 * 1024;

/** spill 文件序号（模块级自增——文件名在 tmpdir 内唯一即可） */
let spillSeq = 0;

/**
 * 取字节缓冲尾部至多 maxBytes 字节（UTF-8 安全：起点落在多字节字符中间则
 * 前移过续字节——不产 U+FFFD 乱码尾巴）。
 */
function tailBytes(buf: Buffer, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let start = Math.max(0, buf.length - maxBytes);
  while (start > 0 && start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString('utf8');
}

/**
 * 输出护栏（固定链尾步）：文本 content 合计超帽保尾截断 + 全文外溢写系统
 * 临时目录（spill 路径进截断注记——模型可循路径自取全文）。
 * - 只钳文本 content；图片等其余 content 原样保留（自有界）；
 * - spill 写失败降级为仅截断（不抛——护栏自身故障不该炸掉正常结果）；
 * - 后处理监听器若已改写 result，护栏对改写后结果同样执法（监听器先于固定步）。
 */
async function applyOutputGuard(result: AgentToolResult, toolCallId: string, guardBytes: number): Promise<void> {
  const textParts = result.content.filter((part): part is TextContent => part.type === 'text');
  const full = textParts.map((part) => part.text).join('\n');
  const totalBytes = Buffer.byteLength(full, 'utf8');
  if (totalBytes <= guardBytes) return;

  // spill 全文（尽力而为）：文件名只留安全字符，防 callId 形态未知的路径注入
  spillSeq += 1;
  const safeCallId = toolCallId.replace(/[^A-Za-z0-9_-]/g, '_');
  const spillPath = `${tmpdir()}/tool-output-${safeCallId}-${spillSeq}.txt`;
  let spilled = true;
  try {
    await writeFile(spillPath, full, 'utf8');
  } catch {
    spilled = false; // tmp 满等故障：截断照做，路径不承诺
  }
  const tail = tailBytes(Buffer.from(full, 'utf8'), guardBytes);
  const note = `\n\n[输出 ${totalBytes} 字节超 ${guardBytes} 字节上限，已保尾截断${spilled ? `；全文外溢至 ${spillPath}` : ''}]`;
  result.content = [...result.content.filter((part) => part.type !== 'text'), { type: 'text', text: `${tail}${note}` }];
}

/**
 * 创建工具执行管道（装配根一次性创建；注册表把每个 ToolDefinition 的执行
 * 接到本管道——toAgentTool 包装）。守门段 mutate 语义依赖「可变入参就地
 * 改写」：gateInput 对象对整条链固定，守门者改 gateInput.args 即改执行段
 * 所见参数（mutated 旗由改参者维护，落账 decision 判据）。
 */
export function createToolPipeline(dispatch: EventDispatch, opts: ToolPipelineOptions = {}): ToolPipelineExecutor {
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 60_000;
  const guardBytes = opts.outputGuardBytes ?? OUTPUT_GUARD_BYTES;
  const recordGate: GateDecisionSink = opts.onGateDecision ?? (() => {});
  const sensitiveValues = opts.sensitiveValues ?? (() => []);

  return async function runToolPipeline(def, toolCallId, args, signal, onUpdate, sessionId) {
    /* ---- 前置步：参数 schema 校验（typebox Value；不合法不进守门） ---- */
    if (!Value.Check(def.parameters as Parameters<typeof Value.Check>[0], args)) {
      const problems = [...Value.Errors(def.parameters as Parameters<typeof Value.Check>[0], args)]
        .slice(0, 5)
        .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
        .join('；');
      throw new BaseError(
        'TOOL_INVALID_ARGS',
        codedMessage('TOOL_INVALID_ARGS', `工具 ${def.name} 参数校验失败：${problems}`),
      );
    }

    /* ---- 第一段：守门（fail-closed；block 短路不进执行段） ---- */
    // sessionId 透传进守门载荷（04 §7 批 15d 补注——checkpoint 按会话判 per-run）
    const gateInput: GateInput = {
      tool: def,
      args,
      toolCallId,
      mutated: false,
      ...(signal !== undefined ? { signal } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    };
    let gated: GateInput;
    try {
      gated = await dispatch.waterfall<GateInput>(TOOL_PRE_EXECUTE_EVENT, gateInput);
    } catch (err) {
      // fail-closed：守门监听器自身异常 = 视为 block，绝不放行；先落决策再抛
      const message = err instanceof Error ? err.message : String(err);
      recordGate({ toolCallId, decision: 'block', reason: codedMessage('TOOL_GATE_FAILED', message) });
      throw new BaseError(
        'TOOL_GATE_FAILED',
        codedMessage('TOOL_GATE_FAILED', `守门检查失败（fail-closed 拒绝）：${message}`),
      );
    }
    if (gated.outcome?.action === 'block') {
      // block 短路：结构化拒绝（含 reason）经 throw 交 loop 编码 isError 结果返回模型
      recordGate({ toolCallId, decision: 'block', reason: gated.outcome.reason });
      throw new BaseError('TOOL_BLOCKED', codedMessage('TOOL_BLOCKED', gated.outcome.reason));
    }
    // 放行/改参：mutated 旗由改参的守门者维护，汇总进 durable 决策；allowReason
    // = 放行来源标注（策略表 allow 免问命中置 policy-allow:<条目序>——04 §9 命中审计）
    recordGate({ toolCallId, decision: gated.mutated ? 'mutate' : 'allow', reason: gated.allowReason ?? 'ok' });

    /* ---- 第二段：执行（around-dispatch；链尾缺省实现 = 超时预算 + execute） ---- */
    // 载荷 = 执行闭包：监听者包装闭包经 next 传播（超时预算/重试/指标类包装位）
    const timedExecute: ExecuteInput = async () => {
      const timeoutMs = def.timeoutMs ?? defaultTimeoutMs;
      const toolCtx = {
        toolCallId,
        ...(signal !== undefined ? { signal } : {}),
        ...(onUpdate !== undefined ? { onUpdate } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
      };
      const execOwned = () => def.execute(gated.args, toolCtx);
      // 预算竞速：超时先到即抛 TOOL_TIMEOUT（原 execute 继续跑但结果弃置——
      // loop 侧 accepting 护栏忽略其迟到 onUpdate；取消传播靠 signal，不强杀）
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BaseError(
                'TOOL_TIMEOUT',
                codedMessage('TOOL_TIMEOUT', `工具 ${def.name} 执行超时（>${timeoutMs}ms）`),
              ),
            ),
          timeoutMs,
        );
      });
      try {
        return await Promise.race([execOwned(), timeoutPromise]);
      } finally {
        clearTimeout(timer);
      }
    };
    const wrapped = await dispatch.waterfall<ExecuteInput>(TOOL_EXECUTE_EVENT, timedExecute);
    const result = await wrapped();

    /* ---- 第三段：后处理（可就地改写 result）+ 出口消毒 + 固定链尾输出护栏 ---- */
    const postInput: PostExecuteInput = { tool: def, args: gated.args, toolCallId, result };
    const posted = await dispatch.waterfall<PostExecuteInput>(TOOL_POST_EXECUTE_EVENT, postInput);
    // 出口治理③ 凭据消毒（04 §7 定形①：护栏之前一步——消毒先于截断，截断边界
    // 不劈秘密对；spill 外溢文件同持消毒产物）。provider 故障只降级值基腿
    // （模式腿恒在场——消毒是出口护栏非执法门，库坏不该炸掉正常结果）。
    let secretValues: readonly string[] = [];
    try {
      secretValues = sensitiveValues();
    } catch {
      /* provider 读取故障 → 空值表 = 纯模式执法（降级诚实） */
    }
    redactToolResultExit(posted.result, secretValues);
    await applyOutputGuard(posted.result, toolCallId, guardBytes);
    return posted.result;
  };
}
