/**
 * contracts/llm 类型面源声明锁（2026-10-08 剪贴板附件批 Lane A——真源 03
 * §10.4 剪贴板附件批注⑤）。
 *
 * 锁位背景（types.test.ts 同律）：类型联合在运行时零痕迹（无运行时词表可对
 * 拍），content 块联合成员集的唯一可红锁位 = 声明源文本扫描（产品固定声明面
 * ——断言对象是本仓源码声明句非 AI 生成文本；正则锚声明句非行号锚——并行
 * 在飞不漂移）。类型层赋值断言（image-ref 字面量块可赋入 content 数组）与
 * 判别联合穷尽性由 typecheck 门禁执法（vitest esbuild 剥类型不红——两道门
 * 互补，本件把两腿都钉在同一测试文件里）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ImageContent, ImageRefContent, UserMessage } from './llm.js';

/** 被锁源文（同目录相对 URL 取件——cwd 无关） */
const source = readFileSync(new URL('./llm.ts', import.meta.url), 'utf8');

/**
 * 剥注释后的源文（接口体切片与字段解析的共用底座）：块注释与行注释双双剥除
 * ——JSDoc 内的花括（如形状示意 `{type:'image-ref', …}`）会干扰花括平衡计数，
 * 剥注释后计数只对真类型结构生效。
 */
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 剥源文中指定接口的体文本（花括平衡切片——嵌套对象字面量面型〔如 Usage.cost〕
 * 照常计入；接口缺席返回 null）。
 * @param name 接口名
 */
function interfaceBody(name: string): string | null {
  const opener = new RegExp(`export interface ${name} \\{`).exec(stripped);
  if (opener === null) return null;
  let depth = 1;
  let i = opener.index + opener[0].length;
  while (i < stripped.length && depth > 0) {
    const ch = stripped[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  // depth 归零 = 找到闭合花括——回退一位取体内文本；扫到 EOF 仍失衡 = 声明面坏形
  return depth === 0 ? stripped.slice(opener.index + opener[0].length, i - 1) : null;
}

/** 接口体的字段清单解析：`名[?]?: 类型;` 逐成员收 [{名, 可选, 类型}] */
function fieldsOf(body: string): Array<{ name: string; optional: boolean; type: string }> {
  const fields: Array<{ name: string; optional: boolean; type: string }> = [];
  for (const m of body.matchAll(/^\s*([A-Za-z]+)(\?)?:\s*([^;]+);/gm)) {
    fields.push({ name: m[1]!, optional: m[2] === '?', type: m[3]!.trim() });
  }
  return fields;
}

describe('UserMessage content 块联合（源声明锁）', () => {
  it('联合恰三员 text/image/image-ref——image-ref 引用块为独立成员（03 §10.4 批注⑤）', () => {
    const body = interfaceBody('UserMessage');
    expect(body).not.toBeNull();
    // string | (…块联合)[] 形锚定 UserMessage 的 content 行（Assistant/ToolResult
    // 的 content 无 string 前缀形——同文件内无撞形）
    const decl = body!.match(/content: string \| \(([^)]+)\)\[\]/);
    expect(decl).not.toBeNull();
    const members = decl![1]!.split('|').map((word) => word.trim());
    // 排序比消除成员序差异（排序后精确对拍闭集）
    expect([...members].sort()).toEqual(['ImageContent', 'ImageRefContent', 'TextContent']);
  });

  it('ImageRefContent 恰四字段全必填：type 字面量/ref/mimeType/bytes', () => {
    const body = interfaceBody('ImageRefContent');
    expect(body).not.toBeNull();
    const fields = fieldsOf(body!);
    // 全必填锁：任一字段拼成可选（?）即红——受理位铸块四要素缺一不可
    expect(fields).toEqual([
      { name: 'type', optional: false, type: "'image-ref'" },
      { name: 'ref', optional: false, type: 'string' },
      { name: 'mimeType', optional: false, type: 'string' },
      { name: 'bytes', optional: false, type: 'number' },
    ]);
  });

  it('独立成员律：ImageContent 不拼挂 ref/bytes 字段（拍板「独立 type 字面量成员非拼可选字段」）', () => {
    const body = interfaceBody('ImageContent');
    expect(body).not.toBeNull();
    const names = fieldsOf(body!).map((field) => field.name);
    // 既有内联图块形状锁死（data/mimeType/type 恰三员）——往既有块上胶合
    // ref?/bytes? 的走样实现当场红
    expect([...names].sort()).toEqual(['data', 'mimeType', 'type']);
  });
});

/** content 块数组元素型（string 形剔除——Extract 收数组半边） */
type UserContentBlock = Extract<UserMessage['content'], readonly unknown[]>[number];

/**
 * 判别联合穷尽守卫：type 判别字面量全覆盖窄化——default 臂 never 锚（联合再
 * 扩员时本 switch 编译红——穷尽性由 typecheck 门禁执法）。
 */
function blockKindOf(block: UserContentBlock): string {
  switch (block.type) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'image-ref':
      // 窄化后引用形字段可读：ref（内容寻址键）与 bytes（原始字节数）
      return `image-ref:${block.ref}:${block.bytes}`;
    default: {
      const exhaustive: never = block;
      return String(exhaustive);
    }
  }
}

describe('image-ref 块窄化守卫（判别联合 exhaustiveness）', () => {
  it('image-ref 字面量块可赋入 content 数组 + 判别窄化读出引用形字段', () => {
    // 受理位铸块形样例：ref = sha256: + 64 位十六进制（内容寻址键值形——03
    // §10.4 批注② 受理校验链产物）；satisfies 同时锁字面量块与接口形状一致
    const imageRefBlock = {
      type: 'image-ref',
      ref: `sha256:${'0f'.repeat(32)}`,
      mimeType: 'image/png',
      bytes: 4096,
    } satisfies ImageRefContent;
    // 类型层断言（typecheck 门禁执法腿）：字面量块赋入 content 数组
    const msg: UserMessage = {
      role: 'user',
      content: [{ type: 'text', text: '看这张图' }, imageRefBlock],
      timestamp: 0,
    };
    // 运行时腿：判别窄化逐块收 kind 串（对拍串是本测试自持 fixed 串——产品码）
    const kinds = typeof msg.content === 'string' ? [] : msg.content.map(blockKindOf);
    expect(kinds).toEqual(['text', `image-ref:sha256:${'0f'.repeat(32)}:4096`]);
    // 既有内联 image 块并存不扰（两条图路径分立：粘贴图引用形 / read 工具内联形）
    const mixed: UserMessage = {
      role: 'user',
      content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' } satisfies ImageContent, imageRefBlock],
      timestamp: 0,
    };
    const mixedKinds = typeof mixed.content === 'string' ? [] : mixed.content.map(blockKindOf);
    expect(mixedKinds).toEqual(['image', `image-ref:sha256:${'0f'.repeat(32)}:4096`]);
  });
});
