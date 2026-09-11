/**
 * host/prompt-sections — 系统提示词段注册表（03 §2.5 提示词段与渐进披露；批 12f-2）。
 *
 * 钉死三条（§2.5/§2.7 逐动词冲突律）：
 *  - **slot 合法集 = 域前缀两段式**（恰含一个 `/`：域前缀/段名）——域前缀必须
 *    等于本插件 id（core: 件去前缀取 name 段比对）；无 `/` 单段系宿主自留地
 *    （预留位不占实例），插件注册面结构性不可达——非法 slot 拒
 *    `PLUGIN_PROMPT_SLOT_INVALID`。
 *  - **同 slot 重复注册拒**（`PLUGIN_PROMPT_SECTION_CONFLICT`）——两段同位即
 *    装配冲突，响亮失败不静默覆盖（词法身份面拒绝式）。
 *  - **物化序 = 两段律**（2026-09-11 cache 经济批 03 §2.5 勘正：原「slot 字典
 *    序」单律扩为两段律——稳定段先〔组内 slot 字典序〕、volatile 段后〔组内
 *    slot 字典序〕；`/reload` 稳定、与装载序解耦两性不变）。
 *
 * 节区稳定性纪律（03 §2.5 节区稳定性纪律与 volatile 逃生门条——2026-09-11
 * cache 经济批 ca-2 落码）：
 *  - **缺省 = 承诺会话内稳定**——物化时对承诺稳定段做内容 hash 对比（锚 =
 *    装载代内上次物化单链；注册集变更即清基线重立——装载面真变更不落 warn），
 *    漂移即经 onDrift 上报（性能纪律 fail-open——不拒不炸请求，warn 由装配位
 *    接日志，本件 lib 形态缺省零观测）；
 *  - **volatile 逃生门**——声明 `volatile: { reason }` 的段免漂移 warn（已声明
 *    即诚实）+ 物化位恒段区尾（最小前缀破坏位）；reason 强制非空（空串/缺
 *    字符串值拒，与 slot 形状违例同走 `PLUGIN_PROMPT_SLOT_INVALID` 码分流）。
 *
 * 消费位：conversation-stack 装配（systemPrompt 组装尾拼接——段集在下一次
 * 组装点重取，注册即生效面）；`prompts_change` 观测事件随装配批接线。
 */
import { createHash } from 'node:crypto';
import { BaseError } from '../contracts/index.js';

/**
 * 段构造器：返回段文本（物化时求值——运行时才能确定的清单禁入常驻区的执法位
 * 在消费侧裁剪）。可选 sessionId 参 = 会话上下文透传（cache 经济批——每会话
 * 懒冻结类段〔memory/core 归类基线②〕消费；arity-0 既有注册天然相容零改动）。
 */
export type PromptSectionBuilder = (sessionId?: string) => string;

/** registerSection 第三参（03 §2.5 节区稳定性纪律——volatile 逃生门声明面） */
export interface PromptSectionRegisterOptions {
  /** 声明本段内容跨请求可变：免漂移 warn + 物化位恒段区尾；reason 强制非空 */
  readonly volatile?: { readonly reason: string };
}

/** 段条目（物化序 = 两段律：稳定段字典序 → volatile 段字典序） */
export interface PromptSectionEntry {
  readonly slot: string;
  readonly owner: string;
  readonly builder: PromptSectionBuilder;
  /** 在场 = volatile 段（物化位恒段区尾 + 免漂移 warn） */
  readonly volatileReason?: string;
}

/** 漂移观测面（fail-open 性能纪律——装配位接 warn 日志，缺省零观测） */
export type PromptSectionDriftReporter = (info: { slot: string; owner: string }) => void;

/** 注册表构造选项 */
export interface PromptSectionRegistryOptions {
  /** 承诺稳定段的内容漂移上报（03 §2.5——性能事件非正确性事件，warn 承载） */
  readonly onDrift?: PromptSectionDriftReporter;
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
  /** slot → 段条目（物化序 = 两段律——Map 插入序不参序，物化时排序） */
  private readonly sections = new Map<string, PromptSectionEntry>();

  /** 漂移上报面（缺省零观测——性能事件 fail-open，lib 形态不强制装配） */
  private readonly onDrift?: PromptSectionDriftReporter;

  /**
   * 承诺稳定段的基线 hash（锚 = 装载代内上次物化单链；null = 基线未立
   * 〔首物化或注册集变更清基线后〕——下次物化重立不落 warn——03 §2.5
   * 既有宿主段归类基线①：装载面真变更不落 warn）。
   */
  private stableBaselines: ReadonlyMap<string, string> | null = null;

  constructor(options: PromptSectionRegistryOptions = {}) {
    this.onDrift = options.onDrift;
  }

  /**
   * 注册段（拒绝式三闸：slot 形状 → 域前缀 → 撞位；volatile 声明面附验）。
   * @returns 注销器（ctx 面 LIFO 记账用）
   */
  register(
    slot: string,
    owner: string,
    builder: PromptSectionBuilder,
    options?: PromptSectionRegisterOptions,
  ): () => void {
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
    // volatile 逃生门声明面：reason 强制非空字符串（空串/缺字符串值与 slot
    // 形状违例同走 PLUGIN_PROMPT_SLOT_INVALID 码分流——强制附 reason，已声明
    // 即诚实，03 §2.5）
    const volatileReason = options?.volatile?.reason;
    if (options?.volatile !== undefined && (typeof volatileReason !== 'string' || volatileReason.length === 0)) {
      throw new BaseError(
        'PLUGIN_PROMPT_SLOT_INVALID',
        `提示词段 ${slot} 声明 volatile 必须附非空 reason（空串/缺字符串值拒——明知伤缓存的段必须声明缘由）`,
      );
    }
    this.sections.set(slot, { slot, owner, builder, volatileReason });
    // 注册集变更 = 清基线重立（下次物化重立不落 warn——装载面真变更非漂移）
    this.stableBaselines = null;
    return () => {
      // 注销幂等：仅当在册条目仍属本注册时摘除（防后注册覆盖后误摘他人条目——
      // 当前语义拒绝式无覆盖，防御位保持）；真摘除同样清基线（注册集变更）
      if (this.sections.get(slot)?.owner === owner) {
        this.sections.delete(slot);
        this.stableBaselines = null;
      }
    };
  }

  /** 枚举现行段（slot 字典序——物化/`prompts_change` 观测共用） */
  list(): readonly PromptSectionEntry[] {
    return [...this.sections.values()].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  }

  /**
   * 物化全段（两段律：稳定段先、volatile 段后，组内 slot 字典序；零段 = 空串
   * ——消费侧免判空）。sessionId 可选透传 builder（每会话懒冻结类段〔归类
   * 基线② memory/core〕消费；arity-0 既有注册天然相容）。
   *
   * 漂移观测（fail-open 性能纪律）：承诺稳定段逐段 sha256 对比基线——漂移经
   * onDrift 上报后基线即取新值（同一漂移恰 warn 一次）；注册集变更已清基线
   * → 本次重立不落 warn。零观测面（onDrift 缺席）连 hash 也省——观测成本
   * 随装配位启用，lib 缺省零开销。
   */
  materialize(sessionId?: string): string {
    const entries = this.list();
    // 配对物化（entry 与文本同链——免索引别称）；两分区各按组内 slot 字典序
    const stableBuilt = entries
      .filter((entry) => entry.volatileReason === undefined)
      .map((entry) => ({ entry, text: entry.builder(sessionId) }));
    const volatileTexts = entries
      .filter((entry) => entry.volatileReason !== undefined)
      .map((entry) => entry.builder(sessionId));
    if (this.onDrift !== undefined) {
      const baselines = this.stableBaselines;
      const next = new Map<string, string>();
      for (const { entry, text } of stableBuilt) {
        const hash = createHash('sha256').update(text).digest('hex');
        const prev = baselines?.get(entry.slot);
        // 基线在场且不符 = 承诺面漂移——上报后基线取新值（不拒不炸请求）
        if (prev !== undefined && prev !== hash) {
          this.onDrift?.({ slot: entry.slot, owner: entry.owner });
        }
        next.set(entry.slot, hash);
      }
      this.stableBaselines = next;
    } else {
      this.stableBaselines = null;
    }
    // 两段律拼接：稳定段在前（缓存前缀主体）、volatile 段恒居尾（最小前缀破坏位）
    return [...stableBuilt.map((built) => built.text), ...volatileTexts].join('\n\n');
  }

  /** 现行段 id 清单（`prompts_change` 观测载荷——§2.4 生命周期组） */
  slotList(): readonly string[] {
    return this.list().map((entry) => entry.slot);
  }
}
