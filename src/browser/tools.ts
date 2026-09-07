/**
 * browser 工具面十件（03 §10.3 工具面条款——navigate/back/forward/snapshot/
 * click/type/press/scroll/screenshot/console）。
 *
 * effect 分账：交互族七件 'write'（navigate/back/forward/click/type/press/
 * scroll——改变页面状态的世界动作，走三段管道审批 fail-closed）；读族三件
 * 'read'（snapshot/screenshot/console——只读观测）。
 *
 * 会话路由：toolCtx.sessionId 缺席折 'default'（无会话语境的调用方共一页
 * 面——诚实简化非隔离缺失）。
 *
 * 失败编码为 isError 数据面（03 §2.3）——BaseError 携码前置披露（判别收紧：
 * Node 系统错误也带 code 属性，只认注册码体系成员）。
 */
import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import { Type } from 'typebox';
import type { BrowserPage } from './page.js';

/** 工具面消费的 service 子面（会话路由后的页面取用） */
export interface BrowserToolPageSource {
  /** 会话路由取页面（惰性建——engine/context 编舞归 service） */
  pageFor(sessionKey: string): Promise<BrowserPage>;
}

/** 命名键词表（press 工具 schema 收词面——运行时词表在 page 件单源） */
const PRESS_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Space',
] as const;

/** toolCtx → 会话键（sessionId 缺席折 'default'） */
function sessionKeyOf(toolCtx: unknown): string {
  const sid = (toolCtx as { sessionId?: unknown } | undefined)?.sessionId;
  return typeof sid === 'string' && sid !== '' ? sid : 'default';
}

/** 结果编码两分：成功面拼模型可见文本；失败面 isError（携码前置） */
function ok(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] };
}
function fail(error: unknown): AgentToolResult {
  const code = error instanceof BaseError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: code ? `[${code}] ${message}` : message }], isError: true };
}

/** 参数窄化取串（schema 已校验——防御位） */
const str = (args: unknown, key: string): string => String((args as Record<string, unknown>)[key] ?? '');

/**
 * 组工具面十件（装载批由装配根经注册窄面挂入工具注册表）。
 * @param source 会话路由后的页面取用面（service 注入）
 */
export function buildBrowserTools(source: BrowserToolPageSource): ToolDefinition[] {
  /** 执行包装：会话路由 + 失败编码统一（fn 收页面与已校验参数） */
  const run = (
    fn: (page: BrowserPage, args: unknown) => Promise<string>,
  ): ((args: unknown, toolCtx: unknown) => Promise<AgentToolResult>) => {
    return async (args, toolCtx) => {
      try {
        const page = await source.pageFor(sessionKeyOf(toolCtx));
        return ok(await fn(page, args));
      } catch (error) {
        return fail(error);
      }
    };
  };

  return [
    {
      name: 'navigate',
      description:
        '导航当前页面到指定 URL（http/https）。入口 URL 先过安全卫生件（私网/环回' +
        '地址拒绝）；自动跟随服务端重定向，回执给最终 URL。页面加载完成（load 事件）后才返回。',
      parameters: Type.Object(
        { url: Type.String({ description: '完整 URL（须含 http:// 或 https://）' }) },
        { additionalProperties: false },
      ),
      effect: 'write',
      timeoutMs: 45_000,
      execute: run(async (page, args) => {
        const r = await page.navigate(str(args, 'url'));
        return `已导航到 ${r.url}`;
      }),
    },
    {
      name: 'back',
      description: '浏览器后退一步（导航史前一步）。无前史时回执「无前一步」不算错误。',
      parameters: Type.Object({}, { additionalProperties: false }),
      effect: 'write',
      timeoutMs: 45_000,
      execute: run(async (page) => {
        const r = await page.back();
        return r.moved ? `已后退到 ${r.url}` : '已在最早一页（无前一步可退）';
      }),
    },
    {
      name: 'forward',
      description: '浏览器前进一步（导航史后一步）。无后史时回执「无后一步」不算错误。',
      parameters: Type.Object({}, { additionalProperties: false }),
      effect: 'write',
      timeoutMs: 45_000,
      execute: run(async (page) => {
        const r = await page.forward();
        return r.moved ? `已前进到 ${r.url}` : '已在最新一页（无后一步可进）';
      }),
    },
    {
      name: 'snapshot',
      description:
        '取当前页面可交互元素清单（a11y 快照）——每个元素一行（角色 + 可见名 + ' +
        '可选 href/name），锚形如 [ref=@e1]。click/type 用回执中的 ref 锚定位元素；' +
        '每次快照重建锚表（旧锚作废）。页面结构变化后应重新快照。',
      parameters: Type.Object({}, { additionalProperties: false }),
      effect: 'read',
      timeoutMs: 30_000,
      execute: run(async (page) => page.snapshot()),
    },
    {
      name: 'click',
      description:
        '点击快照中的元素（ref 锚定位）。元素若在折叠线外会先自动滚入视口再点击。' +
        'ref 不在当前快照（过期/未取）即报错——先 snapshot。',
      parameters: Type.Object(
        { ref: Type.String({ description: 'snapshot 回执中的锚（形如 @e1）' }) },
        { additionalProperties: false },
      ),
      effect: 'write',
      timeoutMs: 30_000,
      execute: run(async (page, args) => {
        await page.click(str(args, 'ref'));
        return `已点击 ${str(args, 'ref')}`;
      }),
    },
    {
      name: 'type',
      description:
        '向快照中的输入框键入文本（ref 锚定位；整体插入不改写法——适合表单填充）。' + '目标会先自动滚入视口并获得焦点。',
      parameters: Type.Object(
        {
          ref: Type.String({ description: 'snapshot 回执中的锚（形如 @e1）' }),
          text: Type.String({ description: '要键入的文本' }),
        },
        { additionalProperties: false },
      ),
      effect: 'write',
      timeoutMs: 30_000,
      execute: run(async (page, args) => {
        await page.type(str(args, 'ref'), str(args, 'text'));
        return `已键入 ${str(args, 'text').length} 字符到 ${str(args, 'ref')}`;
      }),
    },
    {
      name: 'press',
      description:
        '按键（命名键词表：Enter/Tab/Escape/Backspace/Delete/方向键/Home/End/PageUp/PageDown/Space；或任意单字符）。',
      parameters: Type.Object(
        {
          key: Type.Union(
            [
              ...PRESS_KEYS.map((k) => Type.Literal(k)),
              Type.String({ pattern: '^[\\s\\S]$' }), // 单字符（含空格）
            ],
            { description: '命名键或单字符' },
          ),
        },
        { additionalProperties: false },
      ),
      effect: 'write',
      timeoutMs: 30_000,
      execute: run(async (page, args) => {
        await page.press(str(args, 'key'));
        return `已按键 ${str(args, 'key')}`;
      }),
    },
    {
      name: 'scroll',
      description: '滚动页面（缺省向下 600 像素）。direction 二值 up/down；amount 为像素量（1~10000）。',
      parameters: Type.Object(
        {
          direction: Type.Optional(
            Type.Union([Type.Literal('up'), Type.Literal('down')], { description: '方向（缺省 down）' }),
          ),
          amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000, description: '像素量（缺省 600）' })),
        },
        { additionalProperties: false },
      ),
      effect: 'write',
      timeoutMs: 30_000,
      execute: run(async (page, args) => {
        const raw = args as { direction?: unknown; amount?: unknown };
        const direction = raw.direction === 'up' ? 'up' : 'down';
        const amount = typeof raw.amount === 'number' ? raw.amount : 600;
        await page.scroll(direction, amount);
        return `已${direction === 'down' ? '向下' : '向上'}滚动 ${amount} 像素`;
      }),
    },
    {
      name: 'screenshot',
      description: '截取当前视口 PNG，落数据目录可取阅位（滚动保留最近 20 张），回执给文件路径与字节数。',
      parameters: Type.Object({}, { additionalProperties: false }),
      effect: 'read',
      timeoutMs: 30_000,
      execute: run(async (page) => {
        const r = await page.screenshot();
        return `截图已保存：${r.path}（${r.bytes} 字节）`;
      }),
    },
    {
      name: 'console',
      description: '读取页面 console 回流（log/warn/error 与未捕获异常，本页面上下文创建以来累积，环形上限 200 条）。',
      parameters: Type.Object(
        { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: '取最近 N 条（缺省 50）' })) },
        { additionalProperties: false },
      ),
      effect: 'read',
      timeoutMs: 15_000,
      execute: run(async (page, args) => {
        const raw = args as { limit?: unknown };
        const limit = typeof raw.limit === 'number' ? raw.limit : 50;
        const entries = await page.consoleLog(limit);
        if (entries.length === 0) return '（本页面上下文尚无 console 输出）';
        return entries.map((e) => `[${e.kind === 'exception' ? 'exception' : e.level}] ${e.text}`).join('\n');
      }),
    },
  ];
}
