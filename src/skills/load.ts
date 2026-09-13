/**
 * load_skill 工具（06 §11.5(a) 按需拉取模——双模装载第二模）。
 *
 * 注册位：core:skills 件注册的全局工具（boot 全局层同 skill_manage 恒挂载）；
 * 只读无审批对（不写任何根——effect 显式声明 'read'：04 §9 定形块②缺省归一
 * exec 后「面空」即落 exec 档、审批对复活，显式声明是唯一正档法——06
 * §11.5(a) ⑤ 2026-09-14 勘正同源）。与 read 的分工：read 是 FS 通道
 * （模型自持路径语义）、本工具是具名通道（注册表解析 + 节级寻址/行级过滤
 * 两细化承载）——两通道等价合法。
 *
 * 错误面纪律：name 未命中复用 SKILLS_NOT_FOUND 词面（回执指路清单不内联）；
 * disable-model-invocation 件拒载并指路用户显式通道（清单滤除律配套执法）；
 * section/mode 错误 = 无码 guidance 文本（isError true）；一切错误走文本回执
 * 不 throw（模型可读可自纠——同 skill_manage 错误面形）。
 */
import { Type } from 'typebox';
import type { AgentToolResult, ToolDefinition } from '../contracts/index.js';
import type { SkillsRegistry } from './registry.js';
import { formatSkillBlock } from './render.js';
import { deriveModeVocabulary, filterSkillBody, findSkillSection } from './sections.js';
import type { SkillSection } from './sections.js';

/** 工厂依赖（装配注入——registry 与 skill_manage 同一注册表实例） */
export interface LoadSkillDeps {
  readonly registry: SkillsRegistry;
}

/** 错误结果工厂（数据面——[码] 人读信息；与 skill_manage 同形） */
function toolError(code: string, message: string): AgentToolResult {
  return { content: [{ type: 'text', text: `[${code}] ${message}` }], isError: true };
}

/** 无码 guidance 回执（section/mode 错误面——非注册表错，码册外指路文本） */
function toolGuidance(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** 成功结果工厂 */
function toolText(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * 按层级重建节标题串（06 §11.5 节级寻址——重建层号规则）。
 *
 * 祖先标题自 section.level−1 逐级递降、下限 1——重建是节档结构的确定性呈现
 * 非原文层号保真（SkillSection 只记自身层号，跳级标题下祖先层号以本规则赋值，
 * 两实现者同读法）。
 */
function rebuildSectionHeading(section: SkillSection): string {
  const ancestors = section.path.split(' > ');
  const own = ancestors[ancestors.length - 1] ?? section.title;
  const lines: string[] = [];
  const depth = ancestors.length - 1; // 祖先数（不含本节）
  for (let i = 0; i < depth; i++) {
    const level = Math.max(1, section.level - (depth - i));
    lines.push(`${'#'.repeat(level)} ${ancestors[i]}`);
  }
  lines.push(`${'#'.repeat(section.level)} ${own}`);
  return lines.join('\n');
}

/** 节回执内容 = 重建标题串 + 空行 + 节正文（正文不含标题行——splitSkillSections 契约） */
function sectionContent(section: SkillSection): string {
  return `${rebuildSectionHeading(section)}\n\n${section.body}`;
}

/** trim + 小写归一（与 filterSkillBody 比对同源） */
function normalizeModeLabel(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 创建 load_skill 工具定义（装配注册进工具表——03 §2.3 defineTool 形）。
 */
export function createLoadSkillTool(deps: LoadSkillDeps): ToolDefinition {
  return {
    name: 'load_skill',
    // 只读档显式声明（04 §9 定形块②缺省归一 exec——面空即落 exec 档审批对复活；
    // 2026-09-14 处置批补笔，修前 load_skill 实际落 exec：gate read 直通不命中、
    // headless 无人值守首调即被审批 fail-closed 拦死）
    effect: 'read',
    description:
      '按名装载技能内容（注册表具名通道——与 read 按 location 直读等价，另承节级寻址与' +
      '行级过滤两细化）：name 必填；section 缺省装载全文、给祖先路径（"A > B" 式）只装' +
      '命中节；mode 按双形词表行级过滤正文（词表由内容自身的强度表行与带引号示例行' +
      '交集推导）。回执为具名技能块。',
    parameters: Type.Object(
      {
        name: Type.String({ description: '技能名（<available_skills> 清单 name 位）' }),
        section: Type.Optional(Type.String({ description: '节祖先路径（"Mode 3 > Workflow" 式；缺省 = 全文）' })),
        mode: Type.Optional(Type.String({ description: '行级过滤模式名（缺省 = 不过滤）' })),
      },
      { additionalProperties: false },
    ),
    execute: async (args): Promise<AgentToolResult> => {
      // typebox 已在管道层验形——此处收窄仅满足 TS（非 string 形结构性不达）
      const name = typeof args.name === 'string' ? args.name : '';
      const section = typeof args.section === 'string' ? args.section : undefined;
      const mode = typeof args.mode === 'string' ? args.mode : undefined;
      const skill = deps.registry.get(name);
      if (skill === undefined) {
        return toolError(
          'SKILLS_NOT_FOUND',
          `技能「${name}」不在册——核对 <available_skills> 清单的 name 位（同名以高优先层为准）`,
        );
      }
      // 清单滤除律配套执法：隐藏件不在模型装载面，指路用户显式通道
      if (skill.disableModelInvocation) {
        return toolGuidance(
          `技能「${skill.name}」不对模型自动装载（disable-model-invocation）——` +
            `可请用户显式激活（/skill:${skill.name}）`,
        );
      }

      // 节级寻址：报错不猜（歧义带行号、未命中列全部可寻址 path——指路而非裸拒）
      let content = skill.content;
      if (section !== undefined) {
        const found = findSkillSection(skill.content, section);
        if (!found.ok) {
          if (found.reason === 'ambiguous') {
            return toolGuidance(
              `节「${section}」歧义（${found.candidates.length} 处同名）——候选：\n` +
                found.candidates.map((c) => `- ${c}`).join('\n'),
            );
          }
          return toolGuidance(
            `节「${section}」未命中——可寻址节：\n` +
              (found.candidates.length > 0
                ? found.candidates.map((c) => `- ${c}`).join('\n')
                : '（正文无可寻址节——不含任何标题）'),
          );
        }
        content = sectionContent(found.section);
      }

      // 行级过滤：词表推导域 = 待回执内容自身（节形即节内容——mode+section 组合时词表随节重推导）
      if (mode !== undefined && mode.trim() !== '') {
        const vocabulary = deriveModeVocabulary(content);
        if (vocabulary.length === 0) {
          // 词表空 = mode 无可作用行——原样回执 + 就地注明（诚实无操作，非静默忽略）
          return toolText(
            `注：该内容未推导出模式词表（无强度表行 ∩ 带引号示例行的双形标签），` +
              `mode「${mode}」未生效，按原样装载。\n\n${formatSkillBlock(skill, content)}`,
          );
        }
        const active = normalizeModeLabel(mode);
        if (!vocabulary.includes(active)) {
          return toolGuidance(`mode「${mode}」不在词表——可用模式：${vocabulary.join(' / ')}`);
        }
        content = filterSkillBody(content, { modes: vocabulary, active: mode });
      }

      return toolText(formatSkillBlock(skill, content));
    },
  };
}
