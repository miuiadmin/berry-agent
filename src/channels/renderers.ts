/**
 * 插件工具渲染器注册表（2026-09-17 TUI 余量收官批③——07 §4.1「插件工具
 * 渲染钩子签名钉位」条款落码）。
 *
 * - **签名窄面**：`ctx.ui.registerRenderer(toolName, renderer)`——renderer =
 *   `{ renderCall?, renderResult? }` 两可选钩子。渲染输入面 = 04 §2 活体事件
 *   十型的工具执行对：renderCall 收在飞期快照调用（tool_execution_start 面
 *   事实），renderResult 收定稿期调用（toolResult 消息面事实）；返回
 *   `readonly RendererLine[]`。行集是**呈现态非事实源**——消费位（三态卡
 *   卡体 / 件 5 面板行）每次渲染现调，不缓存、不落 durable、不进事件流
 *   （纯函数纪律：同输入同行集）。
 * - **tone 值域** = 批 10g 语义键子集五值：`text | accent | error | success |
 *   secondary`（'dim' 不设——批 10g 已裁中止态复用 secondary 专键不设、弱
 *   存在感恒 secondary、中性前景 text；对拍 theme/semantic.ts 16 键真值）。
 *   缺省 tone（未携带）= 'text' 中性前景档。
 * - **后写胜出**（03 §2.7 表行——呈现扩展位是可换面，宿主回落位恒在，覆盖
 *   只换呈现不换数据）：同名注册 Map 覆写；**含插件对宿主内建工具名注册
 *   （受理不拒——呈现增强属插件表达域，回落位兜底）**。disposer 现任守卫：
 *   旧 disposer 不误注接任者。
 * - **回落恒在律**：渲染器缺席 / 抛错 / 返回空行集 → 消费位宿主缺省形
 *   （插件渲染器结构性不可劣化呈现面——try/catch 在各消费缝单源）。
 * - 模块级单册：进程生命周期注册表（后写胜出换装 / disposer 撤注即回收；
 *   host 受理面 ctx.ui.registerRenderer 与 TUI 消费面 lookupToolRenderer
 *   同册两钉）。纯注册表零外部依赖——channels 边表不破。
 */
import type { Disposer } from '../context/index.js';

/**
 * 渲染段（一行内的着色原子——tone 缺省 = 'text' 中性前景档）。
 * tone 值域即 07 §4.1 钉位注五值闭集，消费位按键名对拍 ResolvedTheme 直取。
 */
export interface RendererSegment {
  readonly text: string;
  readonly tone?: 'text' | 'accent' | 'error' | 'success' | 'secondary';
}

/** 渲染行（段序列——空行 = 无段或单空段） */
export type RendererLine = readonly RendererSegment[];

/** renderCall 现调载荷（在飞期快照——04 §2 tool_execution_start 面事实） */
export interface ToolRenderCallInput {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: unknown;
}

/** renderResult 现调载荷（定稿期——04 §2 toolResult 消息面事实） */
export interface ToolRenderResultInput {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly content: unknown;
  readonly isError: boolean;
  readonly aborted: boolean;
}

/** 工具渲染器（两可选钩子——至少一钩即合法面；消费缝 try/catch 回落兜底） */
export interface ToolRenderer {
  /** 在飞期快照调用（消费缝 = 件 5 工具进度面板行建行/原位换行时——07 钉位注） */
  renderCall?(call: ToolRenderCallInput): readonly RendererLine[];
  /** 定稿期调用（消费缝 = 三态卡卡体渲染时——卡头宿主恒形不可覆写） */
  renderResult?(result: ToolRenderResultInput): readonly RendererLine[];
}

/** 注册表条目（token = 后写胜出的现任判据——disposer 守卫用） */
interface RegistryEntry {
  readonly renderer: ToolRenderer;
  readonly token: object;
}

/** 模块级注册表（进程单册——toolName → 现任 renderer） */
const registry = new Map<string, RegistryEntry>();

/** 注册代币发生器（每注册一枚新 token——disposer 校验「自己仍是现任」用） */
let tokenSeed = 0;

/**
 * 注册工具渲染器（后写胜出 Map 覆写——受理不拒：合法名 / 宿主内建工具名
 * 同律受理，无词法闸无拒码）。
 *
 * @returns disposer——撤注该渲染器；若已被后写覆盖则 no-op（不误注接任者）
 */
export function registerToolRenderer(toolName: string, renderer: ToolRenderer): Disposer {
  const token = { seed: tokenSeed++ };
  registry.set(toolName, { renderer, token });
  return () => {
    // 只有现任可注（token 相等 = 未被后写覆盖）——接任者不因旧 disposer 被误注
    const current = registry.get(toolName);
    if (current !== undefined && current.token === token) {
      registry.delete(toolName);
    }
  };
}

/** 按工具名查现任渲染器（只读面——未命中 undefined 即消费位回落判据） */
export function lookupToolRenderer(toolName: string): ToolRenderer | undefined {
  return registry.get(toolName)?.renderer;
}
