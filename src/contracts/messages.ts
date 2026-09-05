/**
 * L0 contracts — 消息模型与自定义角色注册（04 篇 §2「AgentMessage 与自定义角色」）。
 *
 * 消息模型 = 标准三角色（llm.ts Message）∪ 自定义角色（CustomMessage）。自定义
 * 角色经 registerMessageRole 注册（render/toLlm 双写映射 + hidden 位），域名前缀
 * 两段式强制（`memory/recall` 式——与 03 篇 §2.7 prompt slot 同构的域名纪律）。
 * 宿主不预注册任何自定义角色；conversation 按需注册（04 §2）。
 *
 * 单入口裁决（本仓 vs berry 蓝本差异①）：蓝本双入口（registerAppMessageRole /
 * registerHostMessageRole）不采纳——扩展单位既归一为插件，宿主件与插件同走
 * registerMessageRole 单入口、同守域名前缀纪律，无宿主单段自留地。
 */

import { BaseError } from './errors.js';
import type { Message } from './llm.js';

/**
 * 标准角色名闭集（convertToLlm 透传的标准半边；自定义角色撞此集任何一名即拒）。
 * 与 llm.ts Message 三角色判别位一一对应。
 */
export const STANDARD_MESSAGE_ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'toolResult']);

/**
 * 自定义域名前缀两段式判据（03 篇 §2.7 消息面行）：恰含一个 `/`、两段均
 * 小写字母数字连字符且段首为字母（`memory/recall` 合法；`Memory/recall`、
 * `memory`、`a/b/c` 均非法）。
 */
const CUSTOM_ROLE_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

/** 自定义角色消息（content 载荷形状由角色定义自裁——toLlm 映射的输入） */
export interface CustomMessage {
  /** 自定义角色名（域名两段式） */
  role: string;
  /** 载荷（角色定义自裁其形状） */
  content: unknown;
  /** Unix 毫秒时间戳 */
  timestamp: number;
}

/** 消息模型全集：标准三角色 ∪ 自定义角色（loop 与驱动侧的共同消息面） */
export type AgentMessage = Message | CustomMessage;

/** 呈现意图（render 映射的输出半边；hidden = 瞬态注入不进用户可见流） */
export interface MessageRoleRender {
  /** inline = 进对话流；status = 状态行；hidden = 不可见（模型可见但用户不可见的瞬态注入） */
  intent: 'inline' | 'status' | 'hidden';
  /** 呈现标签（UI 折行显示用） */
  label?: string;
}

/** 角色定义：toLlm 映射（进模型上下文的降写）+ render 呈现（用户可见面） */
export interface MessageRoleDefinition {
  /**
   * 自定义消息 → LLM 消息的转写：返回 Message（降写为标准角色）、Message[]
   * （一拆多）或 null（剥离——瞬态注入本轮用毕即隐）。
   */
  toLlm?: (message: CustomMessage) => Message | Message[] | null;
  /** 呈现映射（缺省无 render = 不可见） */
  render?: MessageRoleRender;
}

/** 角色注册表本体（role → 定义；进程级单表，宿主件与插件共用） */
const roleRegistry = new Map<string, MessageRoleDefinition>();

/**
 * 注册自定义消息角色（ctx.agent.registerMessageRole 的本体——单入口）。
 *
 * 拒绝式两码（03 篇 §2.7 消息面行）：撞标准角色名或在册角色 → AGENT_ROLE_EXISTS；
 * 域名前缀两段式违例 → AGENT_ROLE_INVALID。注册失败零记账（无半注册残留）。
 *
 * @param role 角色名（域名两段式，如 `memory/recall`）
 * @param definition 角色定义（toLlm/render 双写映射）
 * @returns disposer——仅当注册表内仍是**本定义**时移除（防误摘后来同名胜出者）
 */
export function registerMessageRole(role: string, definition: MessageRoleDefinition): () => void {
  // 撞名检查前置于格式检查：标准角色名（user 等单段）先撞此闸——「名字已被
  // 占用」比「格式违例」更指向根因（03 §2.7：撞标准角色或在册角色均 AGENT_ROLE_EXISTS）
  if (STANDARD_MESSAGE_ROLES.has(role) || roleRegistry.has(role)) {
    throw new BaseError('AGENT_ROLE_EXISTS', `消息角色 ${role} 已在册（标准角色或在册自定义角色），重影即消息转写分叉`);
  }
  if (!CUSTOM_ROLE_RE.test(role)) {
    throw new BaseError(
      'AGENT_ROLE_INVALID',
      `角色名 ${JSON.stringify(role)} 违域名前缀两段式纪律（恰含一个 /、两段均小写字母数字连字符，如 memory/recall）`,
    );
  }
  roleRegistry.set(role, definition);
  return () => {
    // 仅当仍是本定义时移除——后来者不可能同名胜出（拒绝式），此守卫防的是
    // disposer 持有过期时序下的误摘（先 dispose 后重注册再 dispose 的序列）
    if (roleRegistry.get(role) === definition) roleRegistry.delete(role);
  };
}

/** 查询角色定义（标准角色与未注册角色返回 undefined） */
export function getMessageRoleDefinition(role: string): MessageRoleDefinition | undefined {
  return roleRegistry.get(role);
}

/** 在册自定义角色名枚举（诊断/目录面） */
export function listMessageRoleNames(): string[] {
  return [...roleRegistry.keys()];
}

/** 标准消息窄化守卫（正向判窄化——自定义消息判别用 !isStandardMessage） */
export function isStandardMessage(message: AgentMessage): message is Message {
  return STANDARD_MESSAGE_ROLES.has(message.role);
}
