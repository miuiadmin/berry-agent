/**
 * host/session-tier-copy — 会话档位文案与回执单源（2026-09-18 webui 档位面
 * 受理批；承 2026-09-17 会话档位切换面批 F1/F2 落码时住 tui-entry 的两表迁出）。
 *
 * **单源律**：本件是档位呈现面文案的唯一宿主——两装配面（TUI picker 装配
 * 〔tui-entry openThinking/openSandbox 行集〕与 webui 桥〔webui-bridge
 * tiers 注入〕）同源消费，任何一面改文案先改本件（03 §10.4 2026-09-18
 * webui 档位面受理批注：detail 行文案单源服务端、SPA 零硬编码）。回执拼装
 * helper 同律——PUT 应答体 receipt 与 TUI setStatus 回执同文单源（07 §4.1
 * 会话档位切换面批 A4 按档分拆形的两消费位）。
 *
 * 词表单源在 conversation（THINKING_LEVELS）/ safety（SANDBOX_MODES）——
 * 本件只持呈现面文案（detail 行）与回执模板，不复制词表。
 */
import type { ThinkingLevel } from '../contracts/index.js';
import type { SandboxMode } from '../safety/index.js';

/**
 * 思考档位行说明（/thinking 副屏右段与 webui 档位浮层行集——2026-09-17 会话
 * 档位切换面批 F1；2026-09-18 webui 档位面受理批迁本单源）：七档词表单源
 * THINKING_LEVELS（conversation），本表只是呈现面文案；键集编译期锁七档全档
 * （Record<ThinkingLevel, string> 面上缺一键即红）。
 */
export const THINKING_LEVEL_DETAILS: Readonly<Record<ThinkingLevel, string>> = {
  off: '关闭思考',
  minimal: '极简思考',
  low: '低档思考',
  medium: '中档思考',
  high: '高档思考',
  xhigh: '超高档思考',
  max: '最大思考',
};

/**
 * 沙箱档位行说明（/sandbox 副屏右段与 webui 档位浮层行集——2026-09-17 会话
 * 档位切换面批 F2；2026-09-18 webui 档位面受理批迁本单源）：三档词表单源
 * SANDBOX_MODES（safety），本表只是呈现面文案；danger 行警示语规范钉死
 * （07 §4.1「danger 档行说明位文案钉死『无沙箱——任何命令直跑宿主』」——
 * 2026-09-18 冷读 F3/CR-TIER-1 补实锚：规范面为唯一引证源，第三档语义不粉
 * 饰）；键集编译期锁三档全档（Record<SandboxMode, string> 面上缺一键即红）。
 */
export const SANDBOX_MODE_DETAILS: Readonly<Record<SandboxMode, string>> = {
  'read-only': '只读——写与执行全拒',
  'workspace-write': '工作区可写——越界写须审批',
  danger: '无沙箱——任何命令直跑宿主',
};

/**
 * 思考档位短词（2026-09-21 TUI 三反馈批B——footer 常驻档位段呈现形）：七档
 * 统一「思考X」紧凑形（3-4 显示列——常驻段宽度预算）；与 detail 行分立——
 * detail 是选择器/浮层整行说明、短词是 footer 常驻段，同键集编译期锁七档
 * 全档（单源律同上——词表单源在 conversation，本表只持呈现短词）。
 */
export const THINKING_LEVEL_SHORT: Readonly<Record<ThinkingLevel, string>> = {
  off: '思考关',
  minimal: '思考极简',
  low: '思考低',
  medium: '思考中',
  high: '思考高',
  xhigh: '思考超高',
  max: '思考满',
};

/**
 * 沙箱档位短词（三反馈批B——footer 常驻档位段呈现形）：三档紧凑形，自描述
 * 不缩义（danger 档短词「无沙箱」保留警示义——与 detail 行「无沙箱——任何
 * 命令直跑宿主」同义压缩非粉饰）；键集编译期锁三档全档。
 */
export const SANDBOX_MODE_SHORT: Readonly<Record<SandboxMode, string>> = {
  'read-only': '只读',
  'workspace-write': '工作区写',
  danger: '无沙箱',
};

/**
 * 思考档位切换回执拼装（单源——TUI setStatus 回执与 webui PUT 应答体
 * receipt 同文）：按档分拆语义 thinking 半边 = 「下一 run 起生效」+ 随模型
 * 能力诚实句（provider 不支持 thinking 时静默无效不炸——07 §4.1 该批批注；
 * 04 §5「run 内不可变」律维持，档位消费单一位 = run 起）。
 */
export function thinkingLevelReceipt(level: string): string {
  return `思考档位：${level}（下一 run 起生效；档位是否生效随模型能力）`;
}

/**
 * 沙箱档位切换回执拼装（单源——两装配面同文消费）：按档分拆语义 sandbox
 * 半边 = 「即刻生效于后续工具调用」（执法闭包 per 工具调用现取 fold 现值，
 * 在飞 run 内下一工具调用起生效——收紧向提前生效无害，回执与生效粒度一致；
 * 07 §4.1 会话档位切换面批 A4 勘正注）。
 */
export function sandboxModeReceipt(mode: string): string {
  return `沙箱档位：${mode}（即刻生效于后续工具调用）`;
}
