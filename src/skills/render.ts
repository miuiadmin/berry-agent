/**
 * 渐进披露渲染层（06 §11.3 护栏③ + §11.5 激活包装）。
 *
 * 清单块（护栏③）：name+description+location「一技能一块」；字节帽 64KiB
 * 整件裁尾（半件截断会让模型读到残缺描述做错误选择——整件进出）；达限截断
 * 必须带块内注释就地披露（一切截断必须带作者侧反馈——禁静默）。
 *
 * 激活包装（§11.5(b)）：/skill:name 显式激活把全文包装为具名块注入（不走
 * FS）；包装形镜像 pi（name/location 属性 + 引用相对路径解析锚句 + 正文 +
 * 可选 args 尾段）；parseSkillInvocation 是包装的镜像解析（TUI 命令面展开
 * 与会话回放侧共用——具名块是往返可逆的）。
 */
import { SKILL_MANIFEST_BYTE_CAP } from './types.js';
import type { Skill } from './types.js';

/** XML 转义（属性与文本共用——& 先行防双转义） */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 描述折行归一（清单行单行化——换行/制表/连续空格折成一空格） */
function normalizeDescription(description: string): string {
  return description.replace(/\s+/g, ' ').trim();
}

/** 清单渲染产物 */
export interface RenderedSkillManifest {
  /** 清单块全文（无可列技能 = 空串——调用方以空串判无清单） */
  readonly text: string;
  /** 因字节帽整件未列计数（披露注释同源——作者侧反馈面） */
  readonly omitted: number;
  /** 是否触达字节帽（true = omitted > 0 的布尔投影——诊断面便捷位） */
  readonly truncated: boolean;
}

/** 清单渲染选项 */
export interface RenderSkillManifestOptions {
  /** 字节帽（缺省 64KiB——06 §11.3 护栏③；测试注入位） */
  readonly byteCap?: number;
}

/**
 * 渲染渐进披露清单块（一技能一块：name/description/location）。
 *
 * - disable-model-invocation 件滤除（模型自动路径不见——显式激活面仍可达）；
 * - 字节帽整件裁尾：逐件累加，装得下一件才列一件；装不下即停 + 块内注释
 *   披露未列件数（模型与作者两侧都看得见被裁的事实）；
 * - 描述折行归一空格（frontmatter 折行书写不破清单行结构）。
 */
export function renderAvailableSkills(
  skills: readonly Skill[],
  options: RenderSkillManifestOptions = {},
): RenderedSkillManifest {
  const byteCap = options.byteCap ?? SKILL_MANIFEST_BYTE_CAP;
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) {
    return { text: '', omitted: 0, truncated: false };
  }
  const header = [
    '以下技能为特定任务提供专门指令。',
    '当任务与某技能的描述匹配时，用 read 工具按 location 装载该技能全文。',
    '技能正文引用相对路径时，以技能目录（SKILL.md 父目录）为根解析为绝对路径后再使用。',
    '',
    '<available_skills>',
  ];
  const footer = '</available_skills>';
  const headerBytes = Buffer.byteLength(header.join('\n') + '\n', 'utf8');

  const blocks = visible.map((skill) =>
    [
      '  <skill>',
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(normalizeDescription(skill.description))}</description>`,
      `    <location>${escapeXml(skill.filePath)}</location>`,
      '  </skill>',
    ].join('\n'),
  );

  // 整件累加：固定头脚 + 已列块装得下下一件才列（半件不截）
  let used = headerBytes + Buffer.byteLength(footer, 'utf8');
  let listed = 0;
  for (const block of blocks) {
    const cost = Buffer.byteLength(block, 'utf8') + 1; // +1 = 块间换行
    if (used + cost > byteCap) break;
    used += cost;
    listed += 1;
  }
  const omitted = visible.length - listed;
  if (listed === 0) {
    // 头脚即超帽的极端形态：空清单 + 披露注释仍是完整反馈面
    const disclosure = `<!-- 清单超 ${byteCap} 字节帽——${visible.length} 件全部未列（精简低优先层或拆分技能） -->`;
    const text = [...header, disclosure, footer].join('\n');
    return { text, omitted, truncated: true };
  }
  if (omitted === 0) {
    return { text: [...header, ...blocks.slice(0, listed), footer].join('\n'), omitted: 0, truncated: false };
  }
  const disclosure = `<!-- 清单超 ${byteCap} 字节帽——另有 ${omitted} 件未列（read 对应 location 或精简低优先层） -->`;
  return {
    text: [...header, ...blocks.slice(0, listed), disclosure, footer].join('\n'),
    omitted,
    truncated: true,
  };
}

/** 激活包装产物（具名块——§11.5(b) 注入面） */
export interface SkillInvocation {
  readonly name: string;
  readonly location: string;
  readonly content: string;
  /** 调用参数尾段（/skill:name args… 的 args 原文；缺席 = 无参调用） */
  readonly args?: string;
}

/**
 * 显式激活包装（§11.5(b)）：全文包装为具名 user message 注入（不走 FS）。
 *
 * 引导句钉相对路径解析锚（baseDir）——模型 follow-up 引用 references/ 等
 * 相对路径时的解析约定（06 §11.3 细化②薄主文件范式的配套面）。
 */
export function formatSkillInvocation(skill: Skill, args?: string): string {
  const head = `<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`;
  const body = `引用相对路径以 ${skill.baseDir} 为根解析。\n\n${skill.content}`;
  const tail = args !== undefined && args.trim() !== '' ? `\n\n${args}` : '';
  return `${head}\n${body}\n</skill>${tail}`;
}

/**
 * 激活块镜像解析（formatSkillInvocation 的逆；形镜像 pi parseSkillBlock）。
 * 非激活块文本返回 null（判据形不匹配即非——不猜）。
 */
export function parseSkillInvocation(text: string): SkillInvocation | null {
  const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
  if (match === null) return null;
  const anchor = '引用相对路径以 ';
  const content = match[3] ?? '';
  if (!content.startsWith(anchor)) return null; // 包装头句是契约的一部分
  return {
    name: match[1] ?? '',
    location: match[2] ?? '',
    content,
    ...(match[4] !== undefined && match[4].trim() !== '' ? { args: match[4] } : {}),
  };
}
