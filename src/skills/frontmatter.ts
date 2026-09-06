/**
 * SKILL.md frontmatter 解析与校验（06 §11.2——向 agentskills.io 标准靠拢；
 * 装载层护栏：description 超 1024 截断装载 + invalid-metadata 警告注明「已截断」、
 * name 超长不截断仅警告——name 是身份键，截断会伪造碰撞）。
 *
 * 宽容度语义：校验失败一律警告 + 对应处置（截断/丢弃字段/跳过文件）不抛——
 * 坏文件不炸装载（与 berry 装载实证同律）；唯一拒载条件 = description 缺席
 * （清单行 = 模型选择依据，无描述即无渐进披露面）与 frontmatter 不可解析。
 */
import { basename, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, SKILL_PROVENANCE_MEMORIES_MAX } from './types.js';
import type { Skill, SkillDiagnostic, SkillSectionSkeleton } from './types.js';
import { splitSkillSections } from './sections.js';

/** frontmatter 解析产物（bodyStart 面向 patch 的替换域计算——归一化文本坐标） */
export interface SkillFrontmatterParse {
  /** 解析出的 frontmatter 映射（空文件 = 空映射） */
  readonly frontmatter: Record<string, unknown>;
  /** 正文（闭合 --- 之后，保留原始缩进不 trim——渲染/节切分自取所需） */
  readonly body: string;
  /** 正文在归一化全文中的起始偏移（patch 替换区间限 frontmatter 之后的执法锚） */
  readonly bodyStart: number;
}

/** 解析失败形态（人读原因——诊断面直接透传） */
export interface SkillFrontmatterError {
  readonly error: string;
}

/**
 * 解析 SKILL.md：剥 BOM、CRLF/CR 统一 LF、`---` 开闭行包裹的 YAML 头。
 *
 * 开闭行判定：首行恰 `---`（行尾空白容差）；闭合 = 后续首个恰 `---` 的行。
 * 无开行/无闭合行 → 错误（SKILL.md 的 description 必填，头缺失即无装载面）；
 * 空头（`---` 紧邻 `---`）与字面 null 按空映射续走——description 缺席判在装载层。
 */
export function parseSkillFrontmatter(raw: string): SkillFrontmatterParse | SkillFrontmatterError {
  // BOM 剥离（U+FEFF——编辑器写入时常见；charCode 判比字面量嵌入可检）
  const unbommed = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const normalized = unbommed.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const first = (lines[0] ?? '').trimEnd();
  if (first !== '---') {
    return { error: '缺 frontmatter 开行 ---' };
  }
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trimEnd() === '---') {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) {
    return { error: 'frontmatter 未闭合（缺 --- 闭合行）' };
  }
  const yamlText = lines.slice(1, closeIndex).join('\n');
  let parsed: unknown;
  if (yamlText.trim() !== '') {
    try {
      parsed = parseYaml(yamlText);
    } catch (error) {
      return { error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }
  // 空头/字面 null 按空映射续走（正文仍在——不可因头空丢正文）；数组/标量才拒
  let frontmatter: Record<string, unknown>;
  if (parsed === null || parsed === undefined) {
    frontmatter = {};
  } else if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'frontmatter 须为映射（键值对）' };
  } else {
    frontmatter = parsed as Record<string, unknown>;
  }
  const bodyStart = lines.slice(0, closeIndex + 1).join('\n').length + 1; // +1 = 跳过闭合行后的换行
  const body = normalized.slice(bodyStart);
  return { frontmatter, body, bodyStart };
}

/**
 * 技能名词法校验（agentskills.io 标准 + 06 §11.2：小写字母/数字/连字符）。
 * 返回违例清单（空 = 合法）——装载面与 skill_manage create 同一真源。
 */
export function validateSkillName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > SKILL_NAME_MAX) {
    errors.push(`name 超 ${SKILL_NAME_MAX} 字符（现 ${name.length}）`);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push('name 含非法字符（只许小写字母/数字/连字符）');
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push('name 首尾不得为连字符');
  }
  if (name.includes('--')) {
    errors.push('name 不得含连续连字符');
  }
  return errors;
}

/** 单文件装载产物 */
export interface LoadSkillResult {
  readonly skill?: Skill;
  readonly diagnostics: readonly SkillDiagnostic[];
}

/**
 * 从 SKILL.md 全文装载技能（校验 + 剥离 + 节骨架）。
 *
 * 处置逐条（06 §11.2/§11.3/§9.1 第 2 项）：
 *  - description 非字符串或空白 → 拒载（唯一硬条件）；
 *  - description > 1024 → 截断装载 + invalid-metadata「已截断」；
 *  - name 缺席 → 回落父目录基名；词法/长度/与父目录同名违例 → 警告（仍装载）；
 *  - provenance 形状非法（非对象/memories 非字符串数组/超 50）→ 警告 + 字段丢弃
 *    （宿主只读解析不校验记忆 id 存在性——跨面校验属审批/诊断面）；
 *  - metadata 非纯对象 → 警告 + 丢弃；
 *  - license/compatibility/allowed-tools 等未采用字段 → 静默忽略（非警告面）。
 */
export function loadSkillFromText(raw: string, context: { filePath: string; providerId: string }): LoadSkillResult {
  const diagnostics: SkillDiagnostic[] = [];
  const parsed = parseSkillFrontmatter(raw);
  if ('error' in parsed) {
    diagnostics.push({ type: 'invalid-metadata', message: parsed.error, path: context.filePath });
    return { diagnostics };
  }

  // description：必填（清单行 = 模型选择依据）
  const rawDescription = parsed.frontmatter['description'];
  if (typeof rawDescription !== 'string' || rawDescription.trim() === '') {
    diagnostics.push({
      type: 'invalid-metadata',
      message: 'description 缺席或为空（必填——渐进披露清单行的唯一依据）',
      path: context.filePath,
    });
    return { diagnostics };
  }
  let description = rawDescription;
  if (description.length > SKILL_DESCRIPTION_MAX) {
    description = description.slice(0, SKILL_DESCRIPTION_MAX);
    diagnostics.push({
      type: 'invalid-metadata',
      message: `description 超 ${SKILL_DESCRIPTION_MAX} 已截断装载（全文可经 read 读原文件）`,
      path: context.filePath,
    });
  }

  // name：缺席回落父目录基名；违例仅警告（name 是身份键不截断）
  const rawName = parsed.frontmatter['name'];
  const skillDir = dirname(context.filePath);
  const parentName = basename(skillDir);
  const name = typeof rawName === 'string' && rawName !== '' ? rawName : parentName;
  for (const error of validateSkillName(name)) {
    diagnostics.push({ type: 'invalid-metadata', message: error, path: context.filePath });
  }
  if (name !== parentName) {
    diagnostics.push({
      type: 'invalid-metadata',
      message: `name 与父目录不同名（${name} ≠ ${parentName}）——技能目录约定 = 同名目录承载同名技能`,
      path: context.filePath,
    });
  }

  // provenance：形状校验宽容丢弃（§9.1 第 2 项——不校验记忆存在性）
  let provenance: Skill['provenance'];
  const rawProvenance = parsed.frontmatter['provenance'];
  if (rawProvenance !== undefined) {
    const valid =
      typeof rawProvenance === 'object' &&
      rawProvenance !== null &&
      !Array.isArray(rawProvenance) &&
      Array.isArray((rawProvenance as { memories?: unknown }).memories) &&
      (rawProvenance as { memories: unknown[] }).memories.every((m) => typeof m === 'string') &&
      (rawProvenance as { memories: unknown[] }).memories.length <= SKILL_PROVENANCE_MEMORIES_MAX;
    if (valid) {
      provenance = { memories: (rawProvenance as { memories: string[] }).memories };
    } else {
      diagnostics.push({
        type: 'invalid-metadata',
        message: `provenance 形状非法须 { memories: [id, …] } 且 ≤ ${SKILL_PROVENANCE_MEMORIES_MAX}——字段丢弃`,
        path: context.filePath,
      });
    }
  }

  // metadata：客户端扩展槽——非纯对象丢弃
  let metadata: Skill['metadata'];
  const rawMetadata = parsed.frontmatter['metadata'];
  if (rawMetadata !== undefined) {
    if (typeof rawMetadata === 'object' && rawMetadata !== null && !Array.isArray(rawMetadata)) {
      metadata = rawMetadata as Record<string, unknown>;
    } else {
      diagnostics.push({ type: 'invalid-metadata', message: 'metadata 须为对象——字段丢弃', path: context.filePath });
    }
  }

  const content = parsed.body.trim();
  const sections: SkillSectionSkeleton[] = splitSkillSections(content).map((s) => ({
    path: s.path,
    level: s.level,
    startLine: s.startLine,
    endLine: s.endLine,
  }));

  const skill: Skill = {
    name,
    description,
    filePath: context.filePath,
    baseDir: skillDir,
    providerId: context.providerId,
    content,
    disableModelInvocation: parsed.frontmatter['disable-model-invocation'] === true,
    ...(provenance !== undefined ? { provenance } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    sections,
  };
  return { skill, diagnostics };
}
