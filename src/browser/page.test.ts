/**
 * page 件测试（脚本化 CdpConnection——协议帧序断言；零真浏览器）。
 *
 * 覆盖面：建页编舞五步 / navigate 卫生预检三分支 + 终点 URL 从导航史 /
 * back/forward 邻步 / snapshot 行走与 ref 表重建 / click 坐标推算 / type 链 /
 * press 三帧 / scroll 方向 / screenshot 落盘滚动清理 / console 环形与会话筛选 /
 * close 收口。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createBrowserPage } from './page.js';
import type { CdpConnection, CdpEvent } from './cdp.js';
import { BROWSER_SCREENSHOT_KEEP } from './types.js';
import type { BrowserFsFace, BrowserWebFace } from './types.js';

/* ---------------- 脚本化连接 ---------------- */

interface SendRecord {
  method: string;
  params: object;
  sessionId?: string;
}

/** 脚本路由器（按 method 派发结果；可副作用 emit 事件） */
type Router = (
  method: string,
  params: Record<string, unknown>,
  sessionId: string | undefined,
  emit: (method: string, params: object) => void,
) => unknown;

function makeConn(router: Router) {
  const sends: SendRecord[] = [];
  const listeners = new Set<(event: CdpEvent) => void>();
  const waiters = new Set<{ method: string; sessionId: string | undefined; resolve: (v: unknown) => void }>();
  /** 事件送达（监听者 + 配对 waiter——同步派发） */
  const emit = (method: string, params: object, sessionId?: string): void => {
    for (const l of listeners) l({ method, params, sessionId });
    for (const w of [...waiters]) {
      if (w.method === method && w.sessionId === sessionId) {
        waiters.delete(w);
        w.resolve(params);
      }
    }
  };
  const conn: CdpConnection = {
    isDead: false,
    send(method, params = {}, opts = {}) {
      sends.push({ method, params, sessionId: opts?.sessionId });
      return Promise.resolve(router(method, params as Record<string, unknown>, opts?.sessionId, emit));
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    waitEvent(method, sessionId, _timeoutMs) {
      return new Promise((resolve) => {
        waiters.add({ method, sessionId, resolve });
      });
    },
    onDown() {},
    close() {},
  };
  return { conn, sends, emit };
}

/** 建页编舞自动应答（后续自由路由） */
function choreo(then: Router = () => ({})): Router {
  return (method, params, sessionId, emit) => {
    switch (method) {
      case 'Target.createBrowserContext':
        return { browserContextId: 'BC1' };
      case 'Target.createTarget':
        return { targetId: 'T1' };
      case 'Target.attachToTarget':
        return { sessionId: 'S1' };
      case 'Page.enable':
      case 'Runtime.enable':
        return {};
      default:
        return then(method, params, sessionId, emit);
    }
  };
}

/** 内存 fs（mkdir/writeFile/readdir/unlink 记账） */
function makeFs(existing: string[] = []) {
  const files = new Map<string, string | Uint8Array>();
  const dirs = new Set<string>();
  const unlinked: string[] = [];
  const fs: BrowserFsFace = {
    access: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
    },
    readFile: async () => '',
    writeFile: async (p, data) => {
      files.set(p, data);
    },
    mkdir: async (p) => {
      dirs.add(p);
    },
    readdir: async (p) => {
      void p;
      return [...existing];
    },
    stat: async () => ({ isFile: () => true }),
    unlink: async (p) => {
      unlinked.push(p);
    },
  };
  return { fs, files, dirs, unlinked };
}

/** web 桩（预检调用记账；fail = 抛错面可配——成功返回最小应答形） */
function makeWeb(fail: 'none' | 'blocked' | 'network' = 'none') {
  const calls: Array<{ url: string; method?: string; consumer?: string }> = [];
  const web: BrowserWebFace = {
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method, consumer: init?.consumer });
      if (fail === 'blocked') throw new BaseError('WEB_PRIVATE_ADDRESS', '私网地址拒绝');
      if (fail === 'network') throw new Error('ENOTFOUND 预检不通');
      return { url, finalUrl: url, status: 200, contentType: '', body: '', truncated: false, bytes: 0, redirects: 0 };
    },
  };
  return { web, calls };
}

/** 快照 DOM 树（A + BUTTON + INPUT text + DIV 不可交互） */
const SAMPLE_DOM = {
  root: {
    nodeId: 1,
    nodeName: 'HTML',
    children: [
      {
        nodeId: 2,
        nodeName: 'DIV',
        children: [
          {
            nodeId: 3,
            nodeName: 'A',
            backendNodeId: 101,
            attributes: ['href', 'https://example.com/page', 'aria-label', '示例链接'],
            children: [{ nodeId: 4, nodeName: '#text', nodeValue: '  示例  ' }],
          },
          {
            nodeId: 5,
            nodeName: 'BUTTON',
            backendNodeId: 102,
            children: [{ nodeId: 6, nodeName: '#text', nodeValue: '提交表单' }],
          },
          { nodeId: 7, nodeName: 'INPUT', backendNodeId: 103, attributes: ['type', 'text', 'placeholder', '用户名'] },
          { nodeId: 8, nodeName: 'SPAN', children: [{ nodeId: 9, nodeName: '#text', nodeValue: '纯文本不派锚' }] },
        ],
      },
    ],
  },
};

describe('createBrowserPage', () => {
  it('建页编舞五步：专属 BrowserContext → 目标挂入 → flat 附着 → 双域使能', async () => {
    const { conn, sends } = makeConn(choreo());
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    expect(page.sessionId).toBe('S1');
    expect(sends.slice(0, 5).map((s) => s.method)).toEqual([
      'Target.createBrowserContext',
      'Target.createTarget',
      'Target.attachToTarget',
      'Page.enable',
      'Runtime.enable',
    ]);
    // 会话编舞参数：disposeOnDetach 兜底 / about:blank 挂入专属 context / flatten
    expect(sends[0]!.params).toEqual({ disposeOnDetach: true });
    expect(sends[1]!.params).toEqual({ url: 'about:blank', browserContextId: 'BC1' });
    expect(sends[2]!.params).toEqual({ targetId: 'T1', flatten: true });
    // 双域使能走 sessionId 路由
    expect(sends[3]!.sessionId).toBe('S1');
    expect(sends[4]!.sessionId).toBe('S1');
    await page.close();
  });

  it('navigate：卫生预检（HEAD + navigate）先行，终点 URL 从导航史读（不信任请求原值）', async () => {
    const { conn, sends, emit } = makeConn(
      choreo((method) => {
        if (method === 'Page.navigate') {
          emit('Page.loadEventFired', {}, 'S1'); // 发送即达（waiter 已先注册）
          return { frameId: 'F1' };
        }
        if (method === 'Page.getNavigationHistory') {
          return {
            currentIndex: 1,
            entries: [
              { id: 1, url: 'https://example.com/start' },
              { id: 2, url: 'https://example.com/ redirected-final' },
            ],
          };
        }
        return {};
      }),
    );
    const web = makeWeb();
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: web.web });
    const r = await page.navigate('https://example.com/start');
    expect(web.calls).toEqual([{ url: 'https://example.com/start', method: 'HEAD', consumer: 'navigate' }]);
    // 预检先于 Page.navigate 帧
    const navIdx = sends.findIndex((s) => s.method === 'Page.navigate');
    expect(navIdx).toBeGreaterThan(0);
    expect(r.url).toBe('https://example.com/ redirected-final'); // 服务端重定向落点
    await page.close();
  });

  it('navigate：WEB_ 族拦截 fail-closed 直传（Page.navigate 不发）', async () => {
    const { conn, sends } = makeConn(choreo());
    const web = makeWeb('blocked');
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: web.web });
    await expect(page.navigate('http://127.0.0.1:8080/')).rejects.toMatchObject({ code: 'WEB_PRIVATE_ADDRESS' });
    expect(sends.some((s) => s.method === 'Page.navigate')).toBe(false);
    await page.close();
  });

  it('navigate：预检普通网络失败放行浏览器载体（两载体网络面不同源）', async () => {
    const { conn, emit } = makeConn(
      choreo((method) => {
        if (method === 'Page.navigate') {
          emit('Page.loadEventFired', {}, 'S1');
          return {};
        }
        if (method === 'Page.getNavigationHistory') {
          return { currentIndex: 0, entries: [{ id: 1, url: 'https://example.com/x' }] };
        }
        return {};
      }),
    );
    const web = makeWeb('network');
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: web.web });
    const r = await page.navigate('https://example.com/x');
    expect(r.url).toBe('https://example.com/x');
    await page.close();
  });

  it('back：有前史走 navigateToHistoryEntry；forward：无后史 moved:false 不发帧', async () => {
    const { conn, sends, emit } = makeConn(
      choreo((method) => {
        if (method === 'Page.getNavigationHistory') {
          return {
            currentIndex: 1,
            entries: [
              { id: 11, url: 'https://a.example/' },
              { id: 22, url: 'https://b.example/' },
            ],
          };
        }
        if (method === 'Page.navigateToHistoryEntry') {
          emit('Page.loadEventFired', {}, 'S1');
          return {};
        }
        return {};
      }),
    );
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    const back = await page.back();
    expect(back).toEqual({ moved: true, url: 'https://a.example/' });
    const histCalls = sends.filter((s) => s.method === 'Page.navigateToHistoryEntry');
    expect(histCalls).toHaveLength(1);
    expect(histCalls[0]!.params).toEqual({ entryId: 11 }); // currentIndex 1 - 1
    // 前进：回执后 currentIndex 仍读同一史（路由器静态）——currentIndex 1 + 1 越界 → moved:false
    const before = sends.length;
    const fwd = await page.forward();
    expect(fwd).toEqual({ moved: false });
    expect(sends.slice(before).some((s) => s.method === 'Page.navigateToHistoryEntry')).toBe(false);
    await page.close();
  });

  it('snapshot：文档序派锚 + 角色词 + 标签折叠 + href 附注；DIV/SPAN 不派锚', async () => {
    const { conn } = makeConn(choreo((method) => (method === 'DOM.getDocument' ? SAMPLE_DOM : {})));
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    const text = await page.snapshot();
    const lines = text.split('\n');
    expect(lines[0]).toContain('可交互节点 3 个');
    expect(lines[1]).toContain('link');
    expect(lines[1]).toContain('示例'); // 文本子树折叠空白
    expect(lines[1]).toContain('https://example.com/page'); // 链接附注 href
    expect(lines[1]).toContain('[ref=@e1]');
    expect(lines[2]).toContain('button');
    expect(lines[2]).toContain('提交表单');
    expect(lines[3]).toContain('textbox');
    expect(lines[3]).toContain('用户名'); // 空文本时 placeholder 兜底
    expect(text).not.toContain('纯文本不派锚');
    await page.close();
  });

  it('ref 表 per-snapshot 重建：过期锚查表即拒（普通错非码族——模型误用面）', async () => {
    let dom: unknown = SAMPLE_DOM;
    const { conn } = makeConn(choreo((method) => (method === 'DOM.getDocument' ? dom : {})));
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await page.snapshot();
    // 第二次快照换成空树——旧锚全数作废
    dom = { root: { nodeName: 'HTML', children: [] } };
    await page.snapshot();
    await expect(page.click('@e1')).rejects.toThrow('不在当前快照');
    // 且非 BaseError（fail 编码无码前缀）
    const err = await page.click('@e1').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(BaseError);
    await page.close();
  });

  it('click：滚入视口先行 → 盒模型八角包围中心 → 按下/释放两帧', async () => {
    const { conn, sends } = makeConn(
      choreo((method) => {
        if (method === 'DOM.getDocument') return SAMPLE_DOM;
        if (method === 'DOM.getBoxModel') {
          // content 八角：x∈[100,200] y∈[50,90] → 中心 (150,70)
          return { model: { content: [100, 50, 200, 50, 200, 90, 100, 90] } };
        }
        return {};
      }),
    );
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await page.snapshot();
    await page.click('@e2');
    const scrollIdx = sends.findIndex((s) => s.method === 'DOM.scrollIntoViewIfNeeded');
    const boxIdx = sends.findIndex((s) => s.method === 'DOM.getBoxModel');
    const downIdx = sends.findIndex((s) => s.method === 'Input.dispatchMouseEvent');
    expect(scrollIdx).toBeGreaterThan(-1);
    expect(boxIdx).toBeGreaterThan(scrollIdx);
    expect(downIdx).toBeGreaterThan(boxIdx);
    const mouse = sends.filter((s) => s.method === 'Input.dispatchMouseEvent').map((s) => s.params);
    expect(mouse).toEqual([
      { type: 'mousePressed', x: 150, y: 70, button: 'left', clickCount: 1 },
      { type: 'mouseReleased', x: 150, y: 70, button: 'left', clickCount: 1 },
    ]);
    await page.close();
  });

  it('click：无盒模型响亮拒（节点不可见/离树）', async () => {
    const { conn } = makeConn(choreo((method) => (method === 'DOM.getDocument' ? SAMPLE_DOM : {})));
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await page.snapshot();
    await expect(page.click('@e1')).rejects.toThrow('取不到盒模型');
    await page.close();
  });

  it('type：滚入 → focus → insertText 整段插入', async () => {
    const { conn, sends } = makeConn(choreo((method) => (method === 'DOM.getDocument' ? SAMPLE_DOM : {})));
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await page.snapshot();
    await page.type('@e3', '你好 world');
    const tail = sends.slice(-3).map((s) => s.method);
    expect(tail).toEqual(['DOM.scrollIntoViewIfNeeded', 'DOM.focus', 'Input.insertText']);
    expect(sends.at(-1)!.params).toEqual({ text: '你好 world' });
    await page.close();
  });

  it('press：单字符三帧（VK 大写 ASCII + char 文本面）；Enter 走词表（keyCode 13 + \\r）', async () => {
    const { conn, sends } = makeConn(choreo());
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await page.press('a');
    const single = sends
      .filter((s) => s.method === 'Input.dispatchKeyEvent')
      .map((s) => s.params as Record<string, unknown>);
    expect(single).toEqual([
      { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 },
      { type: 'char', key: 'a', text: 'a' },
      { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 },
    ]);
    sends.length = 0;
    await page.press('Enter');
    const enter = sends
      .filter((s) => s.method === 'Input.dispatchKeyEvent')
      .map((s) => s.params as Record<string, unknown>);
    expect(enter).toEqual([
      { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      { type: 'char', key: 'Enter', text: '\r' },
      { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    ]);
    await page.close();
  });

  it('press：未知名响亮拒（防御位——schema 已收词表）', async () => {
    const { conn } = makeConn(choreo());
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await expect(page.press('Ctrl+A')).rejects.toThrow('不支持的按键');
    await page.close();
  });

  it('scroll：视口中心锚点 + yDistance 方向符号', async () => {
    const { conn, sends } = makeConn(
      choreo((method) =>
        method === 'Page.getLayoutMetrics' ? { cssVisualViewport: { width: 1000, height: 600 } } : {},
      ),
    );
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await page.scroll('down', 300);
    await page.scroll('up', 120);
    const gestures = sends.filter((s) => s.method === 'Input.synthesizeScrollGesture').map((s) => s.params);
    expect(gestures).toEqual([
      { x: 500, y: 300, yDistance: 300, speed: 800 },
      { x: 500, y: 300, yDistance: -120, speed: 800 },
    ]);
    await page.close();
  });

  it('screenshot：落数据目录 + 字节数回执 + 超保留量弃最旧（字典序即时间序）', async () => {
    const pngBase64 = Buffer.from('fakepng').toString('base64');
    const existing = ['shot-1-1.png', 'shot-2-1.png']; // 在场 2 张
    const fsEnv = makeFs(existing);
    const { conn } = makeConn(choreo((method) => (method === 'Page.captureScreenshot' ? { data: pngBase64 } : {})));
    const page = await createBrowserPage({
      conn,
      fs: fsEnv.fs,
      dataDir: '/data',
      web: makeWeb().web,
      clock: () => 42,
    });
    const r = await page.screenshot();
    expect(r.bytes).toBe(7);
    expect(r.path).toBe('/data/browser/screenshots/shot-42-1.png');
    expect(fsEnv.dirs.has('/data/browser/screenshots')).toBe(true);
    expect(fsEnv.files.get(r.path)).toEqual(Buffer.from('fakepng'));
    // 在场 2 + 新 1 = 3 ≤ KEEP 20 → 零清理
    expect(fsEnv.unlinked).toEqual([]);
    // 塞满到 KEEP+2 → 弃最旧 2（假 readdir 不见新写文件——静态账需 KEEP+2 才溢 2）
    fsEnv.files.clear();
    const crowd = Array.from({ length: BROWSER_SCREENSHOT_KEEP + 2 }, (_, i) => `shot-old-${i}.png`);
    const fsCrowd = makeFs(crowd);
    const conn2 = makeConn(choreo((method) => (method === 'Page.captureScreenshot' ? { data: pngBase64 } : {})));
    const page2 = await createBrowserPage({
      conn: conn2.conn,
      fs: fsCrowd.fs,
      dataDir: '/data',
      web: makeWeb().web,
      clock: () => 43,
    });
    await page2.screenshot(); // crowd 22 - KEEP 20 → 弃最旧 2
    expect(fsCrowd.unlinked).toHaveLength(2);
    expect(fsCrowd.unlinked[0]).toContain('shot-old-0.png');
    await page.close();
    await page2.close();
  });

  it('console：混合回流折串 + 未捕获异常 + 环形超帽弃最旧 + 异会话帧不收', async () => {
    const { conn, emit } = makeConn(choreo());
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    emit(
      'Runtime.consoleAPICalled',
      { type: 'warn', timestamp: 1, args: [{ value: 'a' }, { type: 'object', description: 'Obj{}' }] },
      'S1',
    );
    emit(
      'Runtime.exceptionThrown',
      { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: boom' } } },
      'S1',
    );
    emit('Runtime.consoleAPICalled', { type: 'log', timestamp: 2, args: [{ value: '别会话' }] }, 'OTHER'); // 非本会话
    let entries = await page.consoleLog(10);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'console', level: 'warn', text: 'a Obj{}' });
    expect(entries[1]).toMatchObject({ kind: 'exception', level: 'error', text: 'TypeError: boom' });
    // 环形帽 200：灌 205 弃最旧
    for (let i = 0; i < 205; i++) {
      emit('Runtime.consoleAPICalled', { type: 'log', timestamp: i, args: [{ value: `m${i}` }] }, 'S1');
    }
    entries = await page.consoleLog(200);
    expect(entries).toHaveLength(200);
    expect(entries[0]!.text).toBe('m5'); // 前 5 弃
    await page.close();
  });

  it('close：closeTarget + disposeBrowserContext 双收口', async () => {
    const { conn, sends } = makeConn(choreo());
    const page = await createBrowserPage({ conn, fs: makeFs().fs, dataDir: '/data', web: makeWeb().web });
    await page.close();
    const tail = sends.slice(-2).map((s) => ({ method: s.method, sessionId: s.sessionId }));
    expect(tail).toEqual([
      { method: 'Target.closeTarget', sessionId: 'S1' }, // 页面级命令走会话路由
      { method: 'Target.disposeBrowserContext', sessionId: undefined }, // context 级走浏览器级
    ]);
    expect(sends.at(-2)!.params).toEqual({ targetId: 'T1' });
    expect(sends.at(-1)!.params).toEqual({ browserContextId: 'BC1' });
  });
});
