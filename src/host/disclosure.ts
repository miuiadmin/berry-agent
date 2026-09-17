/**
 * host/disclosure — 环境披露段组装（04 篇 environment 披露段·六件；装配注入
 * 条款 2026-09-06 遗漏审计批挂账、批 12 兑现；2026-09-17 会话档位切换面批
 * F2 五件 → 六件化笔）。
 *
 * 六件：平台/OS、工作目录、日期、git 状态摘要、插件计数行「插件 N 个
 * （启用 M · 失败 F）」（失败数如实呈现——装载失败不是秘密）、沙箱档位行
 * 「`- 沙箱: <mode>`」（per-session 现值——同一时点两会话披露各表各档）。
 * 产出经 host 装配根闭包注入 conversation 回调面（
 * `environmentDisclosure?: (sessionId?) => string | null`）——conversation 在
 * transformContext 最后关口追加，**请求尾派生注入**语义（每请求重算、不落
 * 日志、随请求即弃）；快照取装配面原始值（transformContext 之前），披露段
 * 永不进 durable 快照。conversation 零 host/exec import（边表不破）。
 *
 * 数据源分职：平台/OS·工作目录·日期装配根自取（零依赖恒在场）；git 摘要在
 * exec/host 侧组装（真源接线随批 14a exec 件）；插件计数行在 host 装载面
 * （真源接线随批 12d 装载器笔）；沙箱行 = createSandboxDisclosureSource
 * （本文件——fold 复用 conversation foldSessionSandboxMode，零新 fold 实现）。
 */
import { foldSessionSandboxMode } from '../conversation/index.js';
import { BaseError } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { SandboxMode } from '../safety/index.js';

/** 披露段数据源（装配根每请求重算时采集——值形非快照） */
export interface DisclosureInputs {
  /** 平台/OS（如 `darwin 27.0.0`） */
  readonly platform?: string;
  /** 工作目录（绝对路径） */
  readonly cwd?: string;
  /** 日期（本地时区 YYYY-MM-DD） */
  readonly date?: string;
  /** git 状态摘要（分支/脏况一行；缺席行省略——exec 件批 14a 接线真源） */
  readonly gitSummary?: string | null;
  /** 插件装载计数（装载面——批 12d 接线真源；失败数如实呈现） */
  readonly plugins?: { readonly total: number; readonly enabled: number; readonly failed: number } | null;
  /**
   * 沙箱档位（第六件——F2）：per-session fold 现值；缺席/null 行省略
   * （boot 前装配形 / 坏词 warn 降级形）。
   */
  readonly sandbox?: string | null;
}

/** 六件全缺席 → null（无披露段——注入面零强求） */
export function renderEnvironmentDisclosure(inputs: DisclosureInputs): string | null {
  const lines: string[] = [];
  if (inputs.platform !== undefined) lines.push(`- 平台: ${inputs.platform}`);
  if (inputs.cwd !== undefined) lines.push(`- 工作目录: ${inputs.cwd}`);
  if (inputs.date !== undefined) lines.push(`- 日期: ${inputs.date}`);
  if (inputs.gitSummary != null && inputs.gitSummary.length > 0) lines.push(`- git: ${inputs.gitSummary}`);
  if (inputs.plugins != null) {
    // 插件计数行——04 §environment 披露段钉形「插件 N 个（启用 M · 失败 F）」
    lines.push(`- 插件: ${inputs.plugins.total} 个（启用 ${inputs.plugins.enabled} · 失败 ${inputs.plugins.failed}）`);
  }
  if (inputs.sandbox != null && inputs.sandbox.length > 0) lines.push(`- 沙箱: ${inputs.sandbox}`);
  if (lines.length === 0) return null;
  return ['<environment>', ...lines, '</environment>'].join('\n');
}

/** 平台/OS 行采集（darwin 27.0.0 形——process.platform + os.release） */
export function collectPlatform(osRelease: () => string, platform: NodeJS.Platform): string {
  return `${platform} ${osRelease()}`;
}

/** 日期行采集（本地时区 YYYY-MM-DD——每请求重算自然跨日刷新） */
export function collectDate(now: () => Date): string {
  const d = now();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/* 沙箱行源（第六件——F2）                                              */
/* ------------------------------------------------------------------ */

/** 沙箱行源选项（装配根注入：boot 解析值 + 会话事件读面 + warn 降级位） */
export interface SandboxDisclosureSourceOptions {
  /** boot 解析值（M2 fallback 真源：settings 显式 danger 属用户显式授权——恒显式传非缺省） */
  readonly boot: SandboxMode;
  /** 会话事件读面（per-session：装配根按 sessionId 取该会话 SessionLog） */
  readonly eventsOf: (sessionId?: string) => readonly SessionEvent[];
  /** warn 降级位（坏词 fold 抛的披露侧出口——logger.warn 注入） */
  readonly warn: (message: string) => void;
}

/**
 * 铸造沙箱行数据源：`source(sessionId)` → 三档现值或 undefined（坏词降级）。
 *
 * fold 复用 conversation foldSessionSandboxMode（内部即 safety
 * resolveEffectiveMode——零新 fold 实现）；fallback 恒 = boot 解析值（M2——
 * 显式授权语义不因「非 danger」缺省化漂移）。
 *
 * 坏词（sandbox/mode 事件载荷不在三档词汇）fold 抛 SANDBOX_MODE_INVALID——
 * 披露位 **warn 降级不炸请求**：省略沙箱行、请求照发（与工具位 fail-closed
 * 拒执行分位分职——同一坏词两处置面：披露是回显、执行是执法）。
 */
export function createSandboxDisclosureSource(
  opts: SandboxDisclosureSourceOptions,
): (sessionId?: string) => string | undefined {
  return (sessionId?: string): string | undefined => {
    try {
      return foldSessionSandboxMode(opts.eventsOf(sessionId), opts.boot);
    } catch (error) {
      // 降级路径：warn 携码（SANDBOX_MODE_INVALID）+ 人读因——日志可诊断
      const code = error instanceof BaseError ? error.code : 'SANDBOX_MODE_INVALID';
      const message = error instanceof Error ? error.message : String(error);
      opts.warn(`[${code}] 环境披露沙箱行降级省略（${message}）`);
      return undefined;
    }
  };
}
