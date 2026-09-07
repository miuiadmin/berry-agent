/**
 * 页面上下文件（03 §10.3——per-session BrowserContext 隔离 + 十操作面）。
 *
 * 会话层编舞：Target.createBrowserContext（cookies/storage/缓存会话间隔离，
 * disposeOnDetach 兜底）→ createTarget（about:blank 挂入专属 context）→
 * attachToTarget（flatten:true 取 sessionId）→ Page/Runtime enable（console
 * 事件回流面）。事件按 sessionId 分流路由在 cdp 件，本件只筛本会话帧。
 *
 * a11y 快照 ref 模型：DOM.getDocument 全树行走采可交互节点，按文档序派
 * `@eN` 锚——ref 表 per-snapshot（每次快照重建，过期 ref 查表即拒不猜）；
 * click/type 查表后先 `DOM.scrollIntoViewIfNeeded` 滚入视口（折叠线外静默
 * 假成功防线）再取盒模型中心点派输入事件。
 *
 * 安全卫生（SSRF 红线）：navigate 入口 URL 先经 web 件同一卫生单源预检
 * （HEAD + consumer 'navigate'——第三消费位同一 execute 同一在飞门）；
 * BaseError（WEB_ 族拦截）直传 fail-closed，普通网络失败不拦——两载体
 * 网络面不同源，HEAD 不通不代表浏览器到不了。
 */
import { BaseError } from '../contracts/index.js';
import type { CdpConnection } from './cdp.js';
import {
  BROWSER_CONSOLE_RING_CAP,
  BROWSER_NAV_TIMEOUT_MS,
  BROWSER_SCREENSHOT_DIRNAME,
  BROWSER_SCREENSHOT_KEEP,
} from './types.js';
import type { BrowserFsFace, BrowserLoggerFace, BrowserWebFace } from './types.js';

/** console 环形缓冲条目（console 工具回执面） */
export interface BrowserConsoleEntry {
  /** 来源：console API 调用 / 未捕获异常 */
  readonly kind: 'console' | 'exception';
  /** 级别（consoleAPICalled.type——log/warn/error/…；exception 恒 'error'） */
  readonly level: string;
  /** 拼合文本（RemoteObject.value ?? description 折串） */
  readonly text: string;
  /** 事件时点（CDP timestamp——ms 域） */
  readonly timestamp: number;
}

/** 页面上下文公开面（service 经 toolCtx.sessionKey 路由到对应实例） */
export interface BrowserPage {
  /** 附着会话 id（事件分流路由位——本件只筛本会话帧） */
  readonly sessionId: string;
  /** 导航（卫生预检先行 → Page.navigate → loadEventFired → 终点 URL 从导航史读） */
  navigate(url: string): Promise<{ url: string }>;
  /** 后退一步（无前史 moved:false 诚实回执不报错） */
  back(): Promise<{ moved: boolean; url?: string }>;
  /** 前进一步（无后史 moved:false 诚实回执不报错） */
  forward(): Promise<{ moved: boolean; url?: string }>;
  /** a11y 快照（可交互节点 @eN 锚清单 + per-snapshot ref 表重建） */
  snapshot(): Promise<string>;
  /** 点击（ref 查表 → 滚入视口 → 盒模型中心点派鼠标事件） */
  click(ref: string): Promise<void>;
  /** 输入文本（ref 查表 → 滚入视口 → focus + insertText） */
  type(ref: string, text: string): Promise<void>;
  /** 按键（命名键词表 + 单字符直派） */
  press(key: string): Promise<void>;
  /** 滚动（视口中心 + yDistance 正下负上） */
  scroll(direction: 'up' | 'down', amountPx: number): Promise<void>;
  /** 截图（落数据目录可取阅位 + 滚动清理——图像字节永不进 durable） */
  screenshot(): Promise<{ path: string; bytes: number }>;
  /** console 回流读取（环形缓冲尾段） */
  consoleLog(limit: number): Promise<BrowserConsoleEntry[]>;
  /** 关停（closeTarget + disposeBrowserContext——引擎死态幂等吞错） */
  close(): Promise<void>;
}

/** 页面构造依赖 */
export interface BrowserPageDeps {
  readonly conn: CdpConnection;
  readonly fs: BrowserFsFace;
  readonly dataDir: string;
  readonly web: BrowserWebFace;
  readonly logger?: BrowserLoggerFace;
  /** 导航预算 ms（缺省 BROWSER_NAV_TIMEOUT_MS） */
  readonly navTimeoutMs?: number;
  /** 时钟注入（截图文件名/清理序可测；缺省 Date.now） */
  readonly clock?: () => number;
}

/** DOM.getDocument 节点形（行走所需子集） */
interface DomNode {
  nodeId?: number;
  backendNodeId?: number;
  nodeType?: number;
  nodeName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: DomNode[];
}

/** ref 表条目（快照时冻结的锚定节点） */
interface RefEntry {
  readonly backendNodeId: number;
  readonly label: string;
}

/** 可交互标签 → a11y 角色词（INPUT 按 type 分叉另判） */
const INTERACTIVE_ROLES: Record<string, string> = {
  A: 'link',
  BUTTON: 'button',
  SELECT: 'combobox',
  TEXTAREA: 'textbox',
  SUMMARY: 'button',
  OPTION: 'option',
};

/** INPUT type → 角色词（缺席/未知 type 折 textbox） */
const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  submit: 'button',
  button: 'button',
  reset: 'button',
};

/** 命名键定义（key/code/windowsVirtualKeyCode 三元组——Input.dispatchKeyEvent 派发用） */
const NAMED_KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
};

/** 标签文本截断帽（快照行宽纪律——超长文本截断加省略记号） */
const LABEL_CAP = 80;

/** 平铺属性数组取值（DOM attributes = [name, value, name, value, …]） */
function attrOf(attributes: string[] | undefined, name: string): string | undefined {
  if (attributes === undefined) return undefined;
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    if (attributes[i] === name) return attributes[i + 1];
  }
  return undefined;
}

/** 子树文本拼合（text 节点 nodeValue 连接——标签面取材） */
function textOf(node: DomNode, depth = 0): string {
  if (depth > 24) return ''; // 病态深树防爆栈
  let out = node.nodeName === '#text' ? (node.nodeValue ?? '') : '';
  for (const child of node.children ?? []) out += textOf(child, depth + 1);
  return out;
}

/** 标签截断（超帽截断加省略记号） */
function clampLabel(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > LABEL_CAP ? `${t.slice(0, LABEL_CAP)}…` : t;
}

/**
 * 组页面上下文（service 专用——不直接挂工具面）。失败即抛（引擎死态
 * BROWSER_CONNECT_FAILED 由调用方决定降级重试）。
 */
export async function createBrowserPage(deps: BrowserPageDeps): Promise<BrowserPage> {
  const logger = deps.logger;
  const navTimeoutMs = deps.navTimeoutMs ?? BROWSER_NAV_TIMEOUT_MS;
  const now = (): number => deps.clock?.() ?? Date.now();

  // 会话层编舞：专属 BrowserContext → 目标挂入 → flat 附着 → 域使能
  const browserContext = (await deps.conn.send('Target.createBrowserContext', { disposeOnDetach: true })) as {
    browserContextId: string;
  };
  const target = (await deps.conn.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId: browserContext.browserContextId,
  })) as { targetId: string };
  const attached = (await deps.conn.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })) as {
    sessionId: string;
  };
  const sessionId = attached.sessionId;
  const send = (method: string, params?: object, timeoutMs?: number): Promise<unknown> =>
    deps.conn.send(method, params, { sessionId, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });

  await send('Page.enable');
  await send('Runtime.enable');

  /* ---------------- console 回流（环形缓冲） ---------------- */
  const ring: BrowserConsoleEntry[] = [];
  const pushRing = (entry: BrowserConsoleEntry): void => {
    ring.push(entry);
    if (ring.length > BROWSER_CONSOLE_RING_CAP) ring.shift();
  };
  /** RemoteObject 折串（value 直取，缺席用 description/type 兜底） */
  const renderArg = (arg: unknown): string => {
    const a = arg as { value?: unknown; description?: string; type?: string };
    if (a?.value !== undefined && a.value !== null) {
      return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
    }
    return a?.description ?? `<${a?.type ?? 'unknown'}>`;
  };

  const unsubscribe = deps.conn.onEvent((event) => {
    if (event.sessionId !== sessionId) return; // 只筛本会话帧
    const params = event.params as {
      type?: string;
      timestamp?: number;
      args?: unknown[];
      exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } };
    };
    if (event.method === 'Runtime.consoleAPICalled') {
      pushRing({
        kind: 'console',
        level: params.type ?? 'log',
        text: (params.args ?? []).map(renderArg).join(' '),
        timestamp: params.timestamp ?? now(),
      });
    } else if (event.method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      const text =
        d?.exception?.description ??
        (d?.exception?.value !== undefined ? renderArg(d.exception) : (d?.text ?? '未知异常'));
      pushRing({ kind: 'exception', level: 'error', text, timestamp: now() });
    }
  });

  /* ---------------- ref 表（per-snapshot） ---------------- */
  let refTable = new Map<string, RefEntry>();
  let snapshotSeq = 0;

  /** ref 查表（快照过期/幽灵 ref 拒——不猜节点；模型误用面走普通错非码族） */
  const requireRef = (ref: string): RefEntry => {
    const entry = refTable.get(ref);
    if (entry === undefined) {
      throw new Error(`ref ${ref} 不在当前快照（快照过期或未取——先调 snapshot 再用其回执的 @eN 锚）`);
    }
    return entry;
  };

  /** 滚入视口（折叠线外静默假成功防线——交互前置统一动作） */
  const scrollIntoView = (backendNodeId: number): Promise<unknown> =>
    send('DOM.scrollIntoViewIfNeeded', { backendNodeId });

  /** 截图序号（同刻多截图不撞名） */
  let shotSeq = 0;

  const page: BrowserPage = {
    sessionId,

    async navigate(url) {
      // SSRF 卫生预检：web 件同一 execute 第三消费位（同在飞门同卫生件）
      try {
        await deps.web.fetch(url, { method: 'HEAD', consumer: 'navigate' });
      } catch (err) {
        if (err instanceof BaseError) throw err; // WEB_ 族拦截——fail-closed 直传
        logger?.debug?.(`导航预检普通失败（放行浏览器载体）：${err instanceof Error ? err.message : String(err)}`);
      }
      const waitLoad = deps.conn.waitEvent('Page.loadEventFired', sessionId, navTimeoutMs);
      await send('Page.navigate', { url }, navTimeoutMs);
      await waitLoad;
      // 终点 URL 从导航史读（服务端重定向落点——不信任请求原值）
      const hist = (await send('Page.getNavigationHistory')) as {
        currentIndex: number;
        entries: { url: string }[];
      };
      const entry = hist.entries[hist.currentIndex];
      return { url: entry?.url ?? url };
    },

    async back() {
      return goHistory(-1);
    },

    async forward() {
      return goHistory(1);
    },

    async snapshot() {
      const doc = (await send('DOM.getDocument', { depth: -1, pierce: true })) as { root?: DomNode };
      const next = new Map<string, RefEntry>();
      const lines: string[] = [];
      let counter = 0;
      /** 深度行走：可交互节点派锚（文档序）；病态深树防爆栈 */
      const walk = (node: DomNode, depth: number): void => {
        if (depth > 64) return;
        const tag = node.nodeName ?? '';
        let role: string | undefined;
        if (tag === 'INPUT') {
          const type = attrOf(node.attributes, 'type') ?? 'text';
          role = INPUT_ROLES[type] ?? 'textbox';
        } else {
          role = INTERACTIVE_ROLES[tag];
        }
        if (role !== undefined && typeof node.backendNodeId === 'number') {
          counter += 1;
          const ref = `@e${counter}`;
          const label = clampLabel(
            textOf(node) ||
              attrOf(node.attributes, 'aria-label') ||
              attrOf(node.attributes, 'placeholder') ||
              attrOf(node.attributes, 'value') ||
              '',
          );
          const extra: string[] = [];
          const href = attrOf(node.attributes, 'href');
          if (role === 'link' && href !== undefined) extra.push(clampLabel(href));
          const name = attrOf(node.attributes, 'name');
          if (name !== undefined) extra.push(`name=${clampLabel(name)}`);
          lines.push(
            `- ${role} ${JSON.stringify(label)}${extra.length > 0 ? `（${extra.join(' ')}）` : ''} [ref=${ref}]`,
          );
          next.set(ref, { backendNodeId: node.backendNodeId, label });
        }
        for (const child of node.children ?? []) walk(child, depth + 1);
      };
      if (doc.root !== undefined) walk(doc.root, 0);
      refTable = next; // per-snapshot 重建（旧锚全数作废——不混表）
      snapshotSeq += 1;
      return [`# 页面快照 ${snapshotSeq}（可交互节点 ${counter} 个——交互用 [ref=@eN] 锚）`, ...lines].join('\n');
    },

    async click(ref) {
      const entry = requireRef(ref);
      await scrollIntoView(entry.backendNodeId);
      const box = (await send('DOM.getBoxModel', { backendNodeId: entry.backendNodeId })) as {
        model?: { content?: number[] };
      };
      const quad = box.model?.content;
      if (quad === undefined || quad.length < 8) {
        throw new Error(`ref ${ref}（${entry.label}）取不到盒模型——节点不可见或已离树，重新 snapshot`);
      }
      // content 八角（x,y×4）取包围盒中心
      const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
      const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
      const x = (Math.min(...xs) + Math.max(...xs)) / 2;
      const y = (Math.min(...ys) + Math.max(...ys)) / 2;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },

    async type(ref, text) {
      const entry = requireRef(ref);
      await scrollIntoView(entry.backendNodeId);
      await send('DOM.focus', { backendNodeId: entry.backendNodeId });
      await send('Input.insertText', { text });
    },

    async press(key) {
      if (key.length === 1) {
        // 单字符：rawKeyDown（key/code 推导，VK 码取大写 ASCII——字母键惯例）→ char（text 面）→ keyUp
        const vk = key.toUpperCase().charCodeAt(0);
        const code = key === ' ' ? 'Space' : `Key${key.toUpperCase()}`;
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
        await send('Input.dispatchKeyEvent', { type: 'char', key, text: key });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
        return;
      }
      const def = NAMED_KEYS[key];
      if (def === undefined) {
        throw new Error(`不支持的按键 ${JSON.stringify(key)}——命名键词表或单字符`); // schema 已收词表——此为防御位
      }
      await send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key,
        code: def.code,
        windowsVirtualKeyCode: def.keyCode,
      });
      if (def.text !== undefined) await send('Input.dispatchKeyEvent', { type: 'char', key, text: def.text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: def.code, windowsVirtualKeyCode: def.keyCode });
    },

    async scroll(direction, amountPx) {
      const metrics = (await send('Page.getLayoutMetrics')) as {
        cssVisualViewport?: { width?: number; height?: number };
      };
      const vp = metrics.cssVisualViewport;
      const x = (vp?.width ?? 1280) / 2;
      const y = (vp?.height ?? 720) / 2;
      // yDistance 正数向下（Chrome 惯例——synthesizeScrollGesture 滚动量）
      await send('Input.synthesizeScrollGesture', {
        x,
        y,
        yDistance: direction === 'down' ? amountPx : -amountPx,
        speed: 800,
      });
    },

    async screenshot() {
      const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      const data = shot.data ?? '';
      const bytes = Buffer.byteLength(data, 'base64');
      const dir = `${deps.dataDir}/browser/${BROWSER_SCREENSHOT_DIRNAME}`;
      await deps.fs.mkdir(dir, { recursive: true });
      shotSeq += 1;
      const path = `${dir}/shot-${now()}-${shotSeq}.png`;
      await deps.fs.writeFile(path, Buffer.from(data, 'base64'));
      // 滚动清理：超保留量弃最旧（文件名时序序——字典序即时间序）
      const names = (await deps.fs.readdir(dir)).filter((n) => n.endsWith('.png')).sort();
      for (const victim of names.slice(0, Math.max(0, names.length - BROWSER_SCREENSHOT_KEEP))) {
        await deps.fs.unlink(`${dir}/${victim}`).catch(() => {}); // 清理失败不阻回执
      }
      logger?.debug?.(`browser 截图落盘（${bytes} 字节）：${path}`);
      return { path, bytes };
    },

    async consoleLog(limit) {
      return [...ring].slice(-limit);
    },

    async close() {
      unsubscribe();
      // 关停幂等吞错：引擎死态 send 快拒 BROWSER_CONNECT_FAILED——页面级
      // 收口不因引擎已死而炸调用方（引擎级降级归 service）
      await send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
      await deps.conn
        .send('Target.disposeBrowserContext', { browserContextId: browserContext.browserContextId })
        .catch(() => {});
    },
  };

  /** 导航史邻步（back/forward 共体——无邻步诚实 moved:false） */
  async function goHistory(delta: 1 | -1): Promise<{ moved: boolean; url?: string }> {
    const hist = (await send('Page.getNavigationHistory')) as {
      currentIndex: number;
      entries: { id: number; url: string }[];
    };
    const next = hist.entries[hist.currentIndex + delta];
    if (next === undefined) return { moved: false };
    const waitLoad = deps.conn.waitEvent('Page.loadEventFired', sessionId, navTimeoutMs);
    await send('Page.navigateToHistoryEntry', { entryId: next.id }, navTimeoutMs);
    await waitLoad;
    return { moved: true, url: next.url };
  }

  return page;
}
