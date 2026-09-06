/**
 * host/disclosure — 环境披露段组装（04 篇 environment 披露段·五件；装配注入
 * 条款 2026-09-06 遗漏审计批挂账、批 12 兑现）。
 *
 * 五件：平台/OS、工作目录、日期、git 状态摘要、插件计数行「插件 N 个
 * （启用 M · 失败 F）」（失败数如实呈现——装载失败不是秘密）。产出经 host
 * 装配根闭包注入 conversation 回调面（`environmentDisclosure?: () => string |
 * null`）——conversation 在 transformContext 最后关口追加，**请求尾派生注入**
 * 语义（每请求重算、不落日志、随请求即弃）；快照取装配面原始值（transformContext
 * 之前），披露段永不进 durable 快照。conversation 零 host/exec import（边表
 * 不破）。
 *
 * 数据源分职：平台/OS·工作目录·日期装配根自取（零依赖恒在场）；git 摘要在
 * exec/host 侧组装（真源接线随批 14a exec 件）；插件计数行在 host 装载面
 * （真源接线随批 12d 装载器笔）——两者本笔以注入位承形（缺席行省略）。
 */
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
}

/** 五件全缺席 → null（无披露段——注入面零强求） */
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
