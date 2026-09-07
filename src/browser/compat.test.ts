/**
 * browser 兼容性互证——词面独立律的回归锁（真栈端到端，零真外网）：
 * - 真 SpawnPipeline（node 真进程）直接结构赋 BrowserSpawnFace——
 *   spawnInteractive 一法同形，桥零 exec import 可换真身；
 * - 真全局 WebSocket（defaultWsFace 包装 undici 产物）连手写最小 RFC 6455
 *   假引擎（.cjs 带 shebang 直执行）：101 握手（Sec-WebSocket-Accept SHA-1
 *   公式）+ 客户端掩码帧解码 + 服务端明文文本帧编码；
 * - 全链编舞：launch（stderr 侦听行发现）→ Browser.getVersion 握手 →
 *   Target.createTarget → attachToTarget（flatten:true）→ 带 sessionId 命令
 *   → 事件按 sessionId 分流（flat 形）→ close 协议化告别 → 引擎自退 →
 *   登记簿出册。
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpawnPipeline } from '../exec/index.js';
import { defaultWsFace, launchBrowserEngine } from './index.js';
import type { BrowserFsFace, BrowserSpawnFace } from './types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-browser-compat-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 真 node:fs/promises 适配（BrowserFsFace 结构兼容互证） */
const realFs: BrowserFsFace = {
  access: (path) => nodeFs.promises.access(path),
  readFile: (path, encoding) => nodeFs.promises.readFile(path, encoding),
  writeFile: (path, data) => nodeFs.promises.writeFile(path, data),
  mkdir: (path, options) => nodeFs.promises.mkdir(path, options),
  readdir: (path) => nodeFs.promises.readdir(path) as Promise<readonly string[]>,
  stat: async (path) => {
    const s = await nodeFs.promises.stat(path);
    return { isFile: () => s.isFile() };
  },
  unlink: (path) => nodeFs.promises.unlink(path),
};

/**
 * 假 Chromium 引擎（.cjs——shebang 直执行，launchBrowserEngine 的 argv 三钉
 * 旗标以真子进程参数到达）：node:http /json/version 端点 + upgrade 上的手写
 * 最小 RFC 6455 ws 服务器 + stderr DevTools 侦听行 + CDP 命令应答（
 * getVersion/createTarget/attachToTarget〔flatten 校验〕/Page.enable〔
 * sessionId 路由位校验 + console 事件回放〕/Browser.close 告别退场）。
 */
const ENGINE_SCRIPT = `
const http = require('http');
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// argv 自检：引擎三钉旗标必须真到达子进程（缺席即速退——launch 会以
// BROWSER_CONNECT_FAILED 失败，测试即红）
if (!process.argv.includes('--headless=new') || !process.argv.includes('--remote-debugging-port=0')) {
  process.exit(3);
}

const server = http.createServer((req, res) => {
  if (req.url === '/json/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ Browser: 'fake-engine/1.0', 'Protocol-Version': '1.3' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\\r\\n' +
      'Upgrade: websocket\\r\\n' +
      'Connection: Upgrade\\r\\n' +
      'Sec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n',
  );

  let buf = Buffer.alloc(0);

  /** 服务端明文文本帧编码（len 7/16/64 三形） */
  const sendText = (text) => {
    const payload = Buffer.from(text, 'utf8');
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x81, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };

  /** CDP 命令应答（假引擎语义面） */
  const handleMsg = (msg) => {
    if (msg.id === undefined) return;
    if (msg.method === 'Browser.getVersion') {
      sendText(JSON.stringify({ id: msg.id, result: { protocolVersion: '1.3', product: 'fake-engine' } }));
    } else if (msg.method === 'Target.createTarget') {
      sendText(JSON.stringify({ id: msg.id, result: { targetId: 'T-e2e' } }));
    } else if (msg.method === 'Target.attachToTarget') {
      if (msg.params.flatten !== true) {
        sendText(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'flatten 缺席' } }));
        return;
      }
      sendText(JSON.stringify({ id: msg.id, result: { sessionId: 'S-e2e' } }));
    } else if (msg.method === 'Page.enable') {
      if (msg.sessionId !== 'S-e2e') {
        sendText(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'sessionId 路由位缺席' } }));
        return;
      }
      sendText(JSON.stringify({ id: msg.id, result: {} }));
      // flat 事件帧：带 sessionId 回放一条 console 事件（事件分流互证）
      sendText(JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'log', text: ['hello-e2e'] }, sessionId: 'S-e2e' }));
    } else if (msg.method === 'Browser.close') {
      sendText(JSON.stringify({ id: msg.id, result: {} }));
      socket.end();
      setTimeout(() => process.exit(0), 50);
    } else {
      sendText(JSON.stringify({ id: msg.id, result: {} }));
    }
  };

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) break;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < off + 2) break;
        len = buf.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (buf.length < off + 8) break;
        len = Number(buf.readBigUInt64BE(off));
        off += 8;
      }
      let maskKey = null;
      if (masked) {
        if (buf.length < off + 4) break;
        maskKey = buf.subarray(off, off + 4);
        off += 4;
      }
      if (buf.length < off + len) break;
      let payload = buf.subarray(off, off + len);
      if (maskKey) {
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
        payload = out;
      }
      buf = buf.subarray(off + len);
      if (opcode === 1) handleMsg(JSON.parse(payload.toString('utf8')));
      // opcode 8（close 帧）/9-10（ping-pong）：假引擎最小面——忽略
    }
  });
  socket.on('error', () => {});
});

server.on('error', () => process.exit(4));
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.stderr.write('DevTools listening on ws://127.0.0.1:' + port + '/devtools/browser/guid-e2e' + '\\n');
});
`;

/** 轮询直至谓词真 */
async function until(predicate: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect.unreachable('轮询超时');
}

describe('真 SpawnPipeline ↔ BrowserSpawnFace（结构兼容）', () => {
  it('端到端：launch → 握手 → flat 会话命令/事件分流 → close 自退 + 登记簿出册', { timeout: 20_000 }, async () => {
    const enginePath = join(dir, 'fake-engine.cjs');
    writeFileSync(enginePath, `#!${execPath}\n${ENGINE_SCRIPT}`);
    chmodSync(enginePath, 0o755); // shebang 直执行（launchBrowserEngine argv[0] = 引擎路径）
    const pipeline = createSpawnPipeline();
    const face: BrowserSpawnFace = pipeline; // 直接结构赋值——零适配零包装

    const handle = await launchBrowserEngine({
      spawn: face,
      ws: defaultWsFace(), // 真全局 WebSocket（undici）
      fs: realFs,
      readEnv: () => undefined,
      platform: process.platform,
      homeDir: homedir(),
      dataDir: dir,
      config: { executablePath: enginePath },
    });
    expect(handle.alive).toBe(true);
    expect(handle.discovered.source).toBe('config');
    // 登记簿同册——owner 归属可见
    expect(pipeline.registry.list().some((e) => e.owner === 'browser:engine')).toBe(true);

    // flat 会话：createTarget → attachToTarget（flatten）→ 带 sessionId 命令
    const target = (await handle.conn.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    expect(target.targetId).toBe('T-e2e');
    const attached = (await handle.conn.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })) as {
      sessionId: string;
    };
    expect(attached.sessionId).toBe('S-e2e');
    // 事件等待先行（事件在 enable 应答后随即回放——等待者注册先于发送防竞态）
    const evWaiting = handle.conn.waitEvent('Runtime.consoleAPICalled', attached.sessionId, 5_000);
    await handle.conn.send('Page.enable', {}, { sessionId: attached.sessionId });
    await expect(evWaiting).resolves.toEqual({ type: 'log', text: ['hello-e2e'] });

    // close：协议化告别（真帧往返）→ 假引擎应答即自退 → 宽限内结算
    await handle.close();
    await until(() => pipeline.registry.list().length === 0, 5_000);
    expect(handle.alive).toBe(false);
  });
});
