/**
 * host/prompt-sections — 系统提示词段注册表（03 §2.5 提示词段与渐进披露；批 12f-2）。
 *
 * 钉死三条（§2.5/§2.7 逐动词冲突律）：
 *  - **slot 合法集 = 域前缀两段式**（恰含一个 `/`：域前缀/段名）——域前缀必须
 *    等于本插件 id（core: 件去前缀取 name 段比对）；无 `/` 单段系宿主自留地
 *    （environment 披露段），插件注册面结构性不可达——非法 slot 拒
 *    `PLUGIN_PROMPT_SLOT_INVALID`。
 *  - **同 slot 重复注册拒**（`PLUGIN_PROMPT_SECTION_CONFLICT`）——两段同位即
 *    装配冲突，响亮失败不静默覆盖（词法身份面拒绝式）。
 *  - **物化序 = slot 字典序**（`/reload` 稳定、与装载序解耦）。
 *
 * 消费位：conversation-stack 装配（systemPrompt 组装尾拼接——段集在下一次
 * 组装点重取，注册即生效面）；`prompts_change` 观测事件随装配批接线。
 */
import { BaseError } from '../contracts/index.js';

/** 段构造器：无参调用返回段文本（物化时求值——运行时才能确定的清单禁入常驻区的执法位在消费侧裁剪） */
export type PromptSectionBuilder = () => string;

/** 段条目（slot 字典序枚举面） */
export interface PromptSectionEntry {
  readonly slot: string;
  readonly owner: string;
  readonly builder: PromptSectionBuilder;
}

/** slot 域前缀归一（core: 件去前缀取 name 段比对——§2.7 同律） */
function domainOf(pluginId: string): string {
  return pluginId.startsWith('core:') ? (pluginId.slice('core:'.length) ?? pluginId) : pluginId;
}

/**
 * 提示词段注册表（单实例随装配根创建；插件经 ctx.prompts.registerSection 间接
 * 消费——窗口/频率护栏在 ctx 面执法，本件只管 slot 语义与物化序）。
 */
export class PromptSectionRegistry {
  /** slot → 段条目（物化序 = slot 字典序——Map 插入序不参序，物化时排序） */
  private readonly sections = new Map<string, PromptSectionEntry>();

  /**
   * 注册段（拒绝式两闸：slot 形状 → 撞位）。
   * @returns 注销器（ctx 面 LIFO 记账用）
   */
  register(slot: string, owner: string, builder: PromptSectionBuilder): () => void {
    const slash = slot.indexOf('/');
    if (slash <= 0 || slash !== slot.lastIndexOf('/') || slash === slot.length - 1) {
      throw new BaseError(
        'PLUGIN_PROMPT_SLOT_INVALID',
        `提示词段 slot 非域前缀两段式（${slot}——恰含一个 / 且两段非空；无 / 单段系宿主自留地，插件注册面结构性不可达）`,
      );
    }
    if (slot.slice(0, slash) !== domainOf(owner)) {
      throw new BaseError(
        'PLUGIN_PROMPT_SLOT_INVALID',
        `提示词段 slot 域前缀不等于本插件 id（${slot} 的域前缀 ≠ ${owner}${owner.startsWith('core:') ? '（core: 件去前缀比对）' : ''}——防跨插件冒名同位）`,
      );
    }
    if (this.sections.has(slot)) {
      throw new BaseError(
        'PLUGIN_PROMPT_SECTION_CONFLICT',
        `提示词段 slot ${slot} 已由 ${this.sections.get(slot)?.owner} 注册——两段同位即装配冲突（词法身份面拒绝式，不静默覆盖）`,
      );
    }
    this.sections.set(slot, { slot, owner, builder });
    return () => {
      // 注销幂等：仅当在册条目仍属本注册时摘除（防后注册覆盖后误摘他人条目——
      // 当前语义拒绝式无覆盖，防御位保持）
      if (this.sections.get(slot)?.owner === owner) this.sections.delete(slot);
    };
  }

  /** 枚举现行段（slot 字典序——物化/`prompts_change` 观测共用） */
  list(): readonly PromptSectionEntry[] {
    return [...this.sections.values()].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  }

  /** 物化全段（slot 字典序拼接；零段 = 空串——消费侧免判空） */
  materialize(): string {
    return this.list()
      .map((entry) => entry.builder())
      .join('\n\n');
  }

  /** 现行段 id 清单（`prompts_change` 观测载荷——§2.4 生命周期组） */
  slotList(): readonly string[] {
    return this.list().map((entry) => entry.slot);
  }
}
