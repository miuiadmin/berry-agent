/**
 * skills 域类型与常量（06 篇 §11 全线——双层结构/渐进披露三层护栏/发现六位序列）。
 *
 * 词汇面（02 §4.1 席 13）：definition/provider 词汇族——Skill 是纯数据契约，
 * SkillsProvider 是发现层实现方；注册表按 provider 注册序（即优先序）合并。
 */

/** 技能名长度帽（agentskills.io 标准；06 §11.2） */
export const SKILL_NAME_MAX = 64;

/** 描述长度帽——装载层超限截断装载（全文仍可经 read 路径读原文件；06 §11.3 护栏①） */
export const SKILL_DESCRIPTION_MAX = 1024;

/** 注册表快照数帽——超帽裁尾 + capacity 诊断列被裁计数（06 §11.3 护栏②） */
export const SKILL_SNAPSHOT_CAP = 100;

/** 渐进披露清单块字节帽——达限截断 + 块内注释就地披露（06 §11.3 护栏③） */
export const SKILL_MANIFEST_BYTE_CAP = 64 * 1024;

/** provenance.memories 上限（06 §9.1 第 2 项——source_refs 50 同族） */
export const SKILL_PROVENANCE_MEMORIES_MAX = 50;

/**
 * 技能条目（装载态纯数据）。
 *
 * FS 假设钉死（06 §11.4）：filePath 必须真实存在且模型可 read——§11.5(a) 模型
 * 自动路径（清单 location → read 全文）的硬前提；远端/虚拟来源须自物化落盘再
 * 提供。content 的消费面 = §11.5(b) 显式激活（全文包装注入，不走 FS）。
 */
export interface Skill {
  /** 身份键（frontmatter name，缺席回落父目录基名；同名冲突判定与 get() 锚） */
  readonly name: string;
  /** 描述（装载层已按 1024 截断；清单渲染面） */
  readonly description: string;
  /** SKILL.md 绝对路径（渐进披露清单 location；read 路径锚点） */
  readonly filePath: string;
  /** 技能目录（filePath 的 dirname——正文相对路径的解析锚） */
  readonly baseDir: string;
  /** 来源 provider id（层身份——skills_change 载荷成员/patch 域判定锚） */
  readonly providerId: string;
  /** 正文（frontmatter 闭合 --- 之后的全文——显式激活注入面） */
  readonly content: string;
  /** 隐藏于模型清单、仅显式调用（06 §11.2 可选字段，CC 自有扩展） */
  readonly disableModelInvocation: boolean;
  /** 溯源声明（§9.1 第 2 项晋升桥；宿主只读解析不校验存在性；形状非法装载时丢弃） */
  readonly provenance?: { readonly memories: readonly string[] };
  /** 客户端扩展槽（§11.2 metadata 纪律——配置类字段归此不私造顶层） */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** 正文节骨架（装载时按标题建——渐进披露第三层节级寻址，06 §11.3 细化①） */
  readonly sections: readonly SkillSectionSkeleton[];
}

/** 节骨架条目（不含正文——正文在 content 上按行号区间可还原） */
export interface SkillSectionSkeleton {
  /** 祖先路径（'Mode 3 > Workflow' 式——节级寻址的寻址键） */
  readonly path: string;
  /** 标题级别 1-6 */
  readonly level: number;
  /** 标题行号（1 起，正文坐标系） */
  readonly startLine: number;
  /** 节末行号（含；到下一同级或更高级标题前） */
  readonly endLine: number;
}

/** 诊断类型词汇（06 §11.3 硬规则 2：一切清单预算/截断机制必须带作者侧反馈） */
export type SkillDiagnosticType = 'invalid-metadata' | 'collision' | 'capacity' | 'warning';

/** 装载/合并诊断（作者侧反馈面——警告不炸装载，坏文件跳过） */
export interface SkillDiagnostic {
  readonly type: SkillDiagnosticType;
  readonly message: string;
  /** 关联文件/目录（可缺席——capacity 类诊断面向整层） */
  readonly path?: string;
}

/** 单 provider 扫描产物 */
export interface ProviderScan {
  readonly skills: readonly Skill[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

/**
 * 技能发现层（06 §11.4 六位序列的落码形态——位 5 CLI/动态注入不纳入 v1）。
 *
 * provider 注册序即优先序（06 §11.3 护栏②）——装配按 project > user > 跨库 >
 * 插件 > 出厂 的全序依次注册；同名 first-wins 由扫描序表达。
 */
export interface SkillsProvider {
  /** 层身份（skills_change 事件载荷成员；project/user/cross-repo/factory/插件自定义） */
  readonly id: string;
  /** 扫描根绝对路径集（skill_manage 同名盘上判据与诊断面） */
  readonly roots: readonly string[];
  /** 可改写层标记（v1 仅 project 层 true——skill_manage patch 域判定，06 §12.1） */
  readonly writable?: boolean;
  /** 信任锚标记（project 层需目录信任——false 时跳过扫描带诊断，04 目录信任条） */
  readonly trusted?: boolean;
  /** 扫描（refresh 时调用；缺省实现 = 逐 root 目录扫描） */
  readonly scan: () => Promise<ProviderScan>;
}

/** registry.refresh() 产物（诊断反馈 + 计数面） */
export interface SkillsRefreshReport {
  /** 参与扫描的 provider 数 */
  readonly providers: number;
  /** 入册技能总数（帽后） */
  readonly total: number;
  /** 快照帽裁尾计数（capacity 诊断同源） */
  readonly droppedByCap: number;
  /** 同名 first-wins 冲突计数（collision 诊断同源） */
  readonly collisions: number;
}
