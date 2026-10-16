/**
 * conversation 件档位切换面——model 半边（挖掘 52 轮件 B——05 §1.1
 * `session/model` 行「写入者 = conversation 件档位切换面」的兑现；档位族
 * 第三员——sandbox/mode·session/thinking-level 同形纪律）。
 *
 * 三面：
 *  - **append 面** setSessionModel：语法校验 fail-loud（assertModelSpec 内联
 *    判据——与 llm 域 parseModelSpec 同律〔conversation 边表不含 llm，02
 *    §4.1〕；错误码 = LLM_MODEL_SPEC_INVALID 同值复用不另铸；值域是开放串
 *    `provider/model` 非闭集词表——合法性即两段全形语法层），合法才 append
 *    durable 事件 `session/model {model}`（词汇闸只查注册不查 owner 域
 *    ——事件词已在册 contracts/events.ts owner=conversation）；
 *  - **fold 读面** foldSessionModel：**全量正扫**（任一位置坏形即抛
 *    LLM_MODEL_SPEC_INVALID——非倒扫：倒扫会静默取合法尾档违反 fail-loud，
 *    foldSessionThinkingLevel 同律先例）；无事件返 undefined（消费位回落
 *    栈基线）；
 *  - **collect 读面** collectModelChanges：全序列 [{seq, model}] 升序
 *    （transcript model-change 块重建腿数据形——seq 归位锚）；**坏形防御
 *    跳过**（呈现面 fail-open——validateTodoItems 同律：重建面收到干净
 *    子集不炸渲染，fail-loud 归 fold 消费位；遮蔽事件跳过——压缩窗口内
 *    切线随消息遮蔽消失，collectTodoSnapshots 同语义）。
 *
 * 目录级悬空校验**不在此面**（模型值域开放——「渠道已删」是目录态非语法
 * 态）：消费位（conversation-stack 装配闭包）resolveModel 失败 warn 回落
 * 栈基线，另测在 host 域。
 *
 * 单写者律（05 §1.1）：本面不注册 ctx.get 服务面——插件零写入位，宿主装配
 * （TUI /model 面板与 ctrl+p 双入口单源闭包）独占。冷启动恢复零独立存储：
 * resume 重放事件流 → fold 投影自然恢复（05 行「无独立配置存储」字面）。
 */
import { BaseError } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { occludedSeqs } from '../session/index.js';

/** `session/model` 事件载荷形（append 面 fold 面 collect 面共用） */
export interface SessionModelEventData {
  readonly model: string;
}

/**
 * 切线记录（collect 产物——transcript 重建腿归位锚）：seq = durable 事件
 * 位（loadProjection 逐消息前 flush 队首 seq < 消息 seq——FoldedApproval
 * Decision 同实现形）。
 */
export interface ModelChangeEntry {
  /** 归位锚（session/model 事件 durable seq——其后首条消息之前呈现） */
  readonly seq: number;
  readonly model: string;
}

/**
 * 模型标识语法判据（**与 llm 域 parseModelSpec 同律的内联形**——conversation
 * 边表不含 llm〔02 §4.1〕，语法两行内联；host conversation-stack liveBinding
 * 同形先例。律：首斜杠分割两段全形——provider 段与 id 段均须非空；id 段内
 * 再有斜杠合法〔openrouter 双段形〕）。错误码 = LLM_MODEL_SPEC_INVALID
 * （llm 域动态 BaseError 码同值——码面共享、判据内联两源同律注明）。
 */
function assertModelSpec(spec: string): void {
  const slash = spec.indexOf('/');
  if (slash <= 0 || slash >= spec.length - 1) {
    throw new BaseError(
      'LLM_MODEL_SPEC_INVALID',
      `模型标识格式非法："${spec}"——必须是 "provider/model-id" 形式（首斜杠分割，两段均非空）`,
    );
  }
}

/** 语法良形布尔判据（collect 防御位专用——吞错形；抛错形真源 = assertModelSpec） */
function isWellFormedModelSpec(spec: string): boolean {
  try {
    assertModelSpec(spec);
    return true;
  } catch {
    return false;
  }
}

/**
 * 折叠会话 session/model 事件序列 → 生效模型（最后一条胜出）。
 * 全量正扫：任一位置坏形即抛 LLM_MODEL_SPEC_INVALID——静默跳过坏事件会
 * 沿用旧档，是 fail-open（foldSessionThinkingLevel 同律）。无事件返
 * undefined（消费位 = run 起 driver 取 fold 现值 ?? 栈基线 + 悬空校验
 * 回落——thinkingLevel undefined 即回落栈基线同契约形）。
 */
export function foldSessionModel(events: readonly SessionEvent[]): string | undefined {
  let model: string | undefined;
  for (const event of events) {
    if (event.type !== 'session/model') continue;
    const data = event.data as Partial<SessionModelEventData> | null;
    const value = typeof data === 'object' && data !== null ? data.model : undefined;
    if (typeof value !== 'string') {
      // 异型载荷防御（手改库/异源写入形）——与字符串载荷的语法坏形同码
      throw new BaseError('LLM_MODEL_SPEC_INVALID', `session/model 事件的模型载荷无效：${JSON.stringify(value)}`);
    }
    assertModelSpec(value);
    model = value;
  }
  return model;
}

/**
 * 扫全部 session/model 切线（升序——fold 的全序列伴生读面）：坏形防御
 * 跳过（呈现面 fail-open）；遮蔽事件跳过（occludedSeqs 单源——压缩窗口
 * 内切线随消息遮蔽同语义消失）。
 */
export function collectModelChanges(events: readonly SessionEvent[]): readonly ModelChangeEntry[] {
  const occluded = occludedSeqs(events);
  const out: ModelChangeEntry[] = [];
  for (let seq = 0; seq < events.length; seq += 1) {
    if (occluded.has(seq)) continue;
    const event = events[seq]!;
    if (event.type !== 'session/model') continue;
    const data = event.data as Partial<SessionModelEventData> | null;
    const model = typeof data === 'object' && data !== null ? data.model : undefined;
    // 语法坏形与异型载荷同跳过（validateTodoItems 同律——呈现面不炸；
    // fail-loud 归 fold 消费位）
    if (typeof model !== 'string') continue;
    if (!isWellFormedModelSpec(model)) continue;
    out.push({ seq, model });
  }
  return out;
}

/**
 * 档位切换 append 面（单写者律：宿主装配独占——TUI /model 面板与 ctrl+p
 * 双入口单源闭包消费；不注册 ctx.get 服务面，插件结构性不可达）。语法
 * 校验 fail-loud 在 append **之前**——坏形不入账（parseModelSpec 抛
 * LLM_MODEL_SPEC_INVALID——首斜杠分割两段全形）；合法即 append
 * `session/model {model}` durable 事件（append 即切换、重放即恢复）。
 *
 * 生效时机 = 下一 run 起（thinkingLevel「run 内不可变」同律——run 起
 * driver 取 fold 现值；本面只落账不触任何在飞 run）。
 */
export function setSessionModel(session: SessionLog, spec: string): string {
  assertModelSpec(spec); // 坏形自抛 LLM_MODEL_SPEC_INVALID（语法律内联单源）
  session.append('session/model', { model: spec } satisfies SessionModelEventData);
  return spec;
}
