/**
 * skills 件公开面（02 §4.1 席 13：SKILL.md 双层结构 + 发现六位序列 + 注册表 +
 * 渐进披露三层护栏 + skill_manage——deps {contracts, context}）。
 *
 * 装载态集成归批 12 装载面后装配批：标准六位层经 createStandardLayers 构造、
 * registry.onChange 桥接 skills_change 事件（03 §6.1——载荷 = 现行 provider id
 * 清单）；清单重物化消费面（系统提示词拼装）归 conversation/host 消费批。
 * 出厂技能目录内容（三件样例含 plugins-quickstart）挂 07 出厂清单定名批。
 */
import './codes.js';

// 常量与类型
export {
  SKILL_DESCRIPTION_MAX,
  SKILL_MANIFEST_BYTE_CAP,
  SKILL_NAME_MAX,
  SKILL_PROVENANCE_MEMORIES_MAX,
  SKILL_SNAPSHOT_CAP,
} from './types.js';
export type {
  ProviderScan,
  Skill,
  SkillDiagnostic,
  SkillDiagnosticType,
  SkillSectionSkeleton,
  SkillsProvider,
  SkillsRefreshReport,
} from './types.js';

// frontmatter 解析与单文件装载
export { loadSkillFromText, parseSkillFrontmatter, validateSkillName } from './frontmatter.js';
export type { LoadSkillResult, SkillFrontmatterError, SkillFrontmatterParse } from './frontmatter.js';

// 渐进披露第三层细化（节级寻址/行级过滤）
export { filterSkillBody, findSkillSection, splitSkillSections } from './sections.js';
export type { FilterSkillBodyOptions, FindSkillSectionResult, SkillSection } from './sections.js';

// 发现六位序列（目录扫描 + 标准层构造）
export { createDirProvider, createStandardLayers, resolveFactorySkillsDir, scanSkillsDir } from './discovery.js';
export type { DirProviderOptions, StandardLayersOptions } from './discovery.js';

// 注册表
export { createSkillsRegistry } from './registry.js';
export type { SkillsRegistry, SkillsRegistryOptions } from './registry.js';

// 渐进披露渲染层（清单块 + 激活包装）
export { formatSkillInvocation, parseSkillInvocation, renderAvailableSkills } from './render.js';
export type { RenderedSkillManifest, RenderSkillManifestOptions, SkillInvocation } from './render.js';

// skill_manage 工具
export { createSkillManageTool } from './manage.js';
export type { SkillManageDeps } from './manage.js';
