/**
 * skill_manage 工具（06 §12.1——技能的面内管理动词：list / create / patch）。
 *
 * - 恒 effect:'write'（list 也不例外——同工具三动词统一审批面，守门段管道执法）；
 * - create 恒 project 层 `<workspace>/.agents/skills/<名>/SKILL.md`；同名亮拒不
 *   覆写——判据 = 注册表在册名 ∪ 盘上文件在场（坏 frontmatter 文件对 get()
 *   隐身，只查在册名会静默毁文件）；
 * - patch 仅 project 层可改（user/package 层拒并指路人面）；find 串零/多匹配
 *   均拒（不猜改点）；替换区间限 frontmatter 闭合 --- 之后（正文域）；replace
 *   字面写出（split/join——防 $&/$` 展开家族）；校验域与替换域统一在 CRLF→LF
 *   归一化整文件；
 * - 写点前置可写根断言：物理写（含 mkdir）前走装配注入的 writableRoots 推导，
 *   read-only 档空根即拒（绕过 fence 的直写即缺陷）；
 * - 写后自动 registry.refresh()（技能面刷新 + 渐进披露清单重物化同径）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { Type } from 'typebox';
import type { AgentToolResult, ToolDefinition } from '../contracts/index.js';
import { parseSkillFrontmatter, validateSkillName } from './frontmatter.js';
import type { SkillsRegistry } from './registry.js';
import { SKILL_DESCRIPTION_MAX, SKILL_PROVENANCE_MEMORIES_MAX } from './types.js';

/** 工厂依赖（装配注入——workspaceRoot/writableRoots 闭包由批 12 host 装配根给定） */
export interface SkillManageDeps {
  readonly registry: SkillsRegistry;
  /** 工作区根（create 落点锚——canonical 工作区根由装配解析后注入） */
  readonly workspaceRoot: () => string;
  /** 可写根推导（read-only 档空数组——写点前置断言面） */
  readonly writableRoots: () => readonly string[];
}

/** 错误结果工厂（数据面——[码] 人读信息；与 exec 族同形） */
function toolError(code: string, message: string): AgentToolResult {
  return { content: [{ type: 'text', text: `[${code}] ${message}` }], isError: true };
}

/** 成功结果工厂 */
function toolText(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] };
}

/** 路径落在可写根集合内（resolve 归一 + 边界分隔符守卫——`/a` 不匹配 `/ab`） */
function isWithinRoots(path: string, roots: readonly string[]): boolean {
  const abs = resolve(path);
  return roots.some((root) => {
    const base = resolve(root);
    return abs === base || abs.startsWith(base + sep);
  });
}

/** 校验非空字符串参数（schema 之外的语义校验面——空串 trim 后拒） */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * 创建 skill_manage 工具定义（装配注册进工具表——03 §2.3 defineTool 形）。
 */
export function createSkillManageTool(deps: SkillManageDeps): ToolDefinition {
  return {
    name: 'skill_manage',
    description:
      '管理技能（渐进披露清单的来源文件）：list 列出在册技能（含来源层与溯源）；' +
      'create 在 project 层 .agents/skills/<名>/ 下新建 SKILL.md（同名亮拒不覆写）；' +
      'patch 对 project 层技能正文做单点 find-replace（零/多匹配均拒；user/出厂层' +
      '只读）。写后自动刷新技能面。',
    parameters: Type.Object(
      {
        action: Type.Union([Type.Literal('list'), Type.Literal('create'), Type.Literal('patch')], {
          description: '管理动词',
        }),
        name: Type.Optional(Type.String({ description: '技能名（create/patch 必填）' })),
        description: Type.Optional(
          Type.String({ description: `技能描述（create 必填，≤ ${SKILL_DESCRIPTION_MAX} 字符）` }),
        ),
        body: Type.Optional(Type.String({ description: '技能正文 Markdown（create 必填）' })),
        provenance_memories: Type.Optional(
          Type.Array(Type.String(), {
            description: `溯源记忆 id 清单（可选，≤ ${SKILL_PROVENANCE_MEMORIES_MAX} 条）`,
          }),
        ),
        find: Type.Optional(Type.String({ description: 'patch 查找串（正文域单点匹配）' })),
        replace: Type.Optional(Type.String({ description: 'patch 替换串（字面写出——$& 等不展开）' })),
      },
      { additionalProperties: false },
    ),
    // 三动词统一走写面审批（06 §12.1 恒 effect:'write'——守门段管道执法）
    effect: 'write',
    execute: async (args): Promise<AgentToolResult> => {
      const action = args.action;
      if (action === 'list') return executeList(deps);
      if (action === 'create') return executeCreate(deps, args);
      return executePatch(deps, args);
    },
  };
}

/** list：清单 + 来源层 + 溯源（含隐藏件——管理面见全量） */
function executeList(deps: SkillManageDeps): AgentToolResult {
  const skills = deps.registry.list();
  const diagnostics = deps.registry.diagnostics();
  if (skills.length === 0) {
    const diagNote =
      diagnostics.length > 0
        ? `\n诊断 ${diagnostics.length} 条：\n${diagnostics.map((d) => `- [${d.type}] ${d.message}`).join('\n')}`
        : '';
    return toolText(`在册技能 0 件。${diagNote}`);
  }
  const rows = skills.map((skill) => {
    const flags = [
      skill.disableModelInvocation ? '隐藏' : '',
      skill.provenance ? `溯源 ${skill.provenance.memories.length}` : '',
    ]
      .filter((f) => f !== '')
      .map((f) => `[${f}]`)
      .join(' ');
    return `- ${skill.name}（${skill.providerId} 层）${flags ? `${flags} ` : ''}${skill.filePath}`;
  });
  const diagNote =
    diagnostics.length > 0
      ? `\n诊断 ${diagnostics.length} 条：\n${diagnostics.map((d) => `- [${d.type}] ${d.message}`).join('\n')}`
      : '';
  return toolText(`在册技能 ${skills.length} 件：\n${rows.join('\n')}${diagNote}`);
}

/** create：project 层新建（校验链 → 同名亮拒 → 可写根断言 → 写盘 → 刷新） */
async function executeCreate(deps: SkillManageDeps, args: Record<string, unknown>): Promise<AgentToolResult> {
  const name = nonEmptyString(args.name);
  if (name === undefined) {
    return toolError('SKILLS_NAME_INVALID', 'create 须携带技能名（name）');
  }
  const nameErrors = validateSkillName(name);
  if (nameErrors.length > 0) {
    return toolError('SKILLS_NAME_INVALID', `技能名违例：${nameErrors.join('；')}`);
  }
  const description = nonEmptyString(args.description);
  if (description === undefined || description.length > SKILL_DESCRIPTION_MAX) {
    return toolError(
      'SKILLS_CONTENT_INVALID',
      `description 须非空且 ≤ ${SKILL_DESCRIPTION_MAX} 字符（现 ${typeof args.description === 'string' ? args.description.length : '缺席'}）`,
    );
  }
  const body = nonEmptyString(args.body);
  if (body === undefined) {
    return toolError('SKILLS_CONTENT_INVALID', '正文（body）须非空');
  }
  const rawMemories = args.provenance_memories;
  if (
    rawMemories !== undefined &&
    (!Array.isArray(rawMemories) ||
      !rawMemories.every((m) => typeof m === 'string') ||
      rawMemories.length > SKILL_PROVENANCE_MEMORIES_MAX)
  ) {
    return toolError(
      'SKILLS_CONTENT_INVALID',
      `provenance_memories 须字符串数组且 ≤ ${SKILL_PROVENANCE_MEMORIES_MAX} 条`,
    );
  }
  const memories = rawMemories as string[] | undefined;

  // 同名亮拒不覆写：在册名 ∪ 盘上文件在场（坏文件对 get() 隐身——只查在册名会静默毁文件）
  if (deps.registry.get(name) !== undefined) {
    return toolError(
      'SKILLS_NAME_EXISTS',
      `技能 ${name} 已在册（${deps.registry.get(name)?.providerId} 层）——create 不覆写，改内容走 patch 或先人面清理`,
    );
  }
  for (const root of deps.registry.scanRoots()) {
    if (existsSync(join(root, name, 'SKILL.md'))) {
      return toolError(
        'SKILLS_NAME_EXISTS',
        `盘上已有 ${join(root, name, 'SKILL.md')}（可能未入册——坏 frontmatter 文件同算占用）——create 不覆写`,
      );
    }
  }

  const target = join(deps.workspaceRoot(), '.agents', 'skills', name, 'SKILL.md');
  if (!isWithinRoots(target, deps.writableRoots())) {
    return toolError(
      'SKILLS_WRITE_ROOT_DENIED',
      `写点 ${target} 不在可写根内（read-only 档或根未授权）——技能创建需可写的工作区`,
    );
  }

  // frontmatter 物化（yaml stringify——描述含冒号/引号/换行均安全）
  const fm: Record<string, unknown> = { name, description };
  if (memories !== undefined && memories.length > 0) {
    fm['provenance'] = { memories };
  }
  const fileContent = `---\n${stringifyYaml(fm)}---\n\n${body}\n`;
  mkdirSync(join(deps.workspaceRoot(), '.agents', 'skills', name), { recursive: true });
  writeFileSync(target, fileContent, 'utf8');

  await deps.registry.refresh(); // 写后自动技能面刷新 + 清单重物化（同径）
  return toolText(
    `已创建技能 ${name}：${target}\n（project 层；技能面已刷新，在册 ${deps.registry.list().length} 件）`,
  );
}

/** patch：project 层正文单点 find-replace（域限定 + 单点匹配 + 字面替换 + 归一化） */
async function executePatch(deps: SkillManageDeps, args: Record<string, unknown>): Promise<AgentToolResult> {
  const name = nonEmptyString(args.name);
  const find = nonEmptyString(args.find);
  const replace = typeof args.replace === 'string' ? args.replace : undefined;
  if (name === undefined) return toolError('SKILLS_NOT_FOUND', 'patch 须携带技能名（name）');
  if (find === undefined || replace === undefined) {
    return toolError('SKILLS_PATCH_MATCH_INVALID', 'patch 须携带 find（非空）与 replace（可为空串=删除）');
  }

  const skill = deps.registry.get(name);
  if (skill === undefined) {
    return toolError(
      'SKILLS_NOT_FOUND',
      `技能 ${name} 不在册（先刷新；盘上坏 frontmatter 文件不入册者同报——修坏文件走人面）`,
    );
  }
  const provider = deps.registry.getProvider(skill.providerId);
  if (provider === undefined || provider.writable !== true) {
    return toolError(
      'SKILLS_LAYER_READONLY',
      `技能 ${name} 属 ${skill.providerId} 层——patch 仅 project 层可改（user/跨库/出厂层是用户自持面，走文件编辑器人面改）`,
    );
  }

  // 校验域与替换域统一：BOM 剥离 + CRLF/CR→LF 归一化整文件（写回归一化全文）
  let raw: string;
  try {
    raw = readFileSync(skill.filePath, 'utf8');
  } catch (error) {
    return toolError('SKILLS_NOT_FOUND', `技能文件读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const unbommed = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const normalized = unbommed.replace(/\r\n?/g, '\n');
  const parsed = parseSkillFrontmatter(normalized);
  if ('error' in parsed) {
    return toolError('SKILLS_CONTENT_INVALID', `技能文件不可解析：${parsed.error}`);
  }

  // 替换区间限 frontmatter 闭合 --- 之后（正文域——frontmatter 是结构面不走自由文本改）
  const domain = normalized.slice(parsed.bodyStart);
  const occurrences = domain.split(find).length - 1;
  if (occurrences === 0) {
    return toolError(
      'SKILLS_PATCH_MATCH_INVALID',
      `find 串在正文域零匹配（frontmatter 域不计入）——检查拼写或换 find 串`,
    );
  }
  if (occurrences > 1) {
    return toolError(
      'SKILLS_PATCH_MATCH_INVALID',
      `find 串在正文域 ${occurrences} 处匹配——patch 只做单点替换（不猜改点），加长 find 串到唯一`,
    );
  }

  if (!isWithinRoots(skill.filePath, deps.writableRoots())) {
    return toolError(
      'SKILLS_WRITE_ROOT_DENIED',
      `写点 ${skill.filePath} 不在可写根内（read-only 档或根未授权）——拒绝直写`,
    );
  }

  // 字面替换（split/join——String.replace 的 $&/$`/$' 展开家族不入场）
  const patched = normalized.slice(0, parsed.bodyStart) + domain.split(find).join(replace);
  writeFileSync(skill.filePath, patched, 'utf8');

  await deps.registry.refresh();
  return toolText(`已修改技能 ${name} 正文 1 处（${skill.filePath}；技能面已刷新）`);
}
