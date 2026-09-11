/**
 * 命令面注册表与分发（03 §2.2 registerCommand 签名定形 + §2.7 冲突律；
 * 2026-09-06 channels 纵切批）。
 *
 * 两律：①后写胜出——命令名是可换实现位（用户插件覆盖 core: 同名命令 =
 * 显式换装正道），撞名不拒、胜出即生效；②词法违例拒——命令名主段连字符式
 * + 可选冒号子段，非法名拒绝注册（CHANNEL_COMMAND_INVALID——与
 * AGENT_ROLE_INVALID 同构：撞名不拒、格式拒）。
 */

import { BaseError } from '../contracts/index.js';
import type { Disposer } from '../context/index.js';
import type { CommandArgs, CommandHandler, CommandSpec } from './types.js';

/** 命令名词法（03 §2.2 定形：^[a-z][a-z0-9-]*(:[a-z0-9-]+)?$——/memory-export 与 /skill:name 实况同形） */
const COMMAND_NAME_RE = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)?$/;

/** 注册条目内部形（token 用于 disposer 防误注：被后写覆盖的旧 disposer 是 no-op） */
interface RegistryEntry extends CommandSpec {
  readonly token: object;
}

/**
 * 命令面注册表。注册即生效（03 §2.1——下一次消费点重取，不待重启）；
 * 全部方法同步（注册/查询/解析零 I/O，分发是唯一异步面）。
 */
export class CommandRegistry {
  private readonly commands = new Map<string, RegistryEntry>();
  /** 注册代币发生器（每注册一枚新 token——disposer 校验「自己仍是现任」用） */
  private tokenSeed = 0;

  /**
   * 注册命令（后写胜出）。词法违例抛 CHANNEL_COMMAND_INVALID；撞名静默覆盖
   * （03 §2.7：胜出即生效无拒码）。
   *
   * @returns disposer——注销该命令；若已被后写覆盖则 no-op（不误注接任者）
   */
  register(name: string, handler: CommandHandler, description?: string): Disposer {
    if (!COMMAND_NAME_RE.test(name)) {
      throw new BaseError(
        'CHANNEL_COMMAND_INVALID',
        `命令名词法违例：${JSON.stringify(name)}（主段连字符式 + 可选冒号子段，小写）`,
      );
    }
    const token = { seed: this.tokenSeed++ };
    this.commands.set(name, { name, handler, description, token });
    return () => {
      // 只有现任可注（token 相等 = 未被后写覆盖）——后写的接任者不因旧 disposer 被误注
      const current = this.commands.get(name);
      if (current !== undefined && current.token === token) {
        this.commands.delete(name);
      }
    };
  }

  /** 命令清单（/help 与 @-mention 补全面的消费面——注册序） */
  list(): readonly CommandSpec[] {
    return [...this.commands.values()].map(({ token: _token, ...spec }) => spec);
  }

  /** 按名查询（分发前置——后写胜出者即现任） */
  get(name: string): CommandSpec | undefined {
    const entry = this.commands.get(name);
    return entry === undefined
      ? undefined
      : { name: entry.name, handler: entry.handler, description: entry.description };
  }

  /**
   * 解析输入行（同步纯函数面）：`/name rest...` → { name, args }；
   * 非 `/` 开头返回 null（普通消息路——去哪归驱动侧/conversation 裁决，
   * 命令面只报「不是命令」）。
   */
  parse(input: string): { name: string; args: CommandArgs } | null {
    if (!input.startsWith('/')) return null;
    // 首空白分割命令名与实参原文（命令名自身无空白——词法保证）
    const rest = input.slice(1);
    const sep = rest.search(/\s/);
    const name = sep === -1 ? rest : rest.slice(0, sep);
    const raw = sep === -1 ? '' : rest.slice(sep + 1).trim();
    if (!COMMAND_NAME_RE.test(name)) return null;
    return { name, args: { raw, argv: tokenize(raw) } };
  }

  /**
   * 分发输入行：命中注册命令 → 执行 handler 返回 true；未命中（非命令形或
   * 名不在册）返回 false——「未注册的 /词 怎么处置（提示未知命令 or 当普通
   * 消息进 run）」是驱动侧语义，归 conversation 件。
   *
   * sessionId 位（ix-2 新建）：发起会话透传进 CommandArgs（CLI 面缺席）——
   * 插件命令 handler 可显式携带（ctx.ui opts.sessionId 透传），ambient 自动
   * 锚另由 host 侧 ALS 承载（两轨并行——显式位是插件可见面、ALS 是零自觉面）。
   */
  async dispatch(input: string, sessionId?: string): Promise<boolean> {
    const parsed = this.parse(input);
    if (parsed === null) return false;
    const spec = this.commands.get(parsed.name);
    if (spec === undefined) return false;
    await spec.handler(sessionId !== undefined ? { ...parsed.args, sessionId } : parsed.args);
    return true;
  }
}

/**
 * 引号感知词切分（03 §2.2 定形：shell 词法的最小实现——不进 glob/变量展开）。
 * 规则：裸词按空白切；'单引号' 保字面（内部再无转义）；"双引号" 保内部空格；
 * 引号未闭合按行尾收口（宽容收场——终端输入无第二行可续）。
 */
export function tokenize(raw: string): string[] {
  const out: string[] = [];
  let current = '';
  let hasCurrent = false;
  let quote: '"' | "'" | null = null;

  for (const ch of raw) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null; // 引号闭合——段继续累积（拼接态 "ab'cd ef'" 保空格）
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasCurrent = true; // 空引号段 '' 也是一段（与裸词不同——显式空串）
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (hasCurrent) {
        out.push(current);
        current = '';
        hasCurrent = false;
      }
      continue;
    }
    current += ch;
    hasCurrent = true;
  }
  // 行尾：未闭合引号宽容收口（current 原样成段）；尾段在
  if (hasCurrent) out.push(current);
  return out;
}
