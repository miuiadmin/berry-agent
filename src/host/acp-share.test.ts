/**
 * host/acp-share 单元测试——多连接复用两原语（真 unix socket 于临时目录；
 * 2026-11-09 ACP 多连接复用批——03 §10.6 撞锁代理形）。
 *
 * 钉死：listen+proxy 字节双管透传与干净收场 / 探测不通 null 回落（fail-loud
 * 判据素材）/ 陈旧 socket 文件 bind 前净除不拦新听者。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';

import { acpSocketPath, listenAcpShare, proxyAcpShare } from './acp-share.js';

/** 临时目录账（afterAll 清场） */
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** 轮询等待谓词成立（socket 时序——10ms 步进 4s 帽） */
async function until(pred: () => boolean): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (pred()) return;
    if (Date.now() - t0 > 4_000) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** fail-loud warn 桩（listen 失败必须炸出——不允许静默降级逃过断言） */
const warnBoom = (message: string) => {
  throw new Error(`unexpected warn: ${message}`);
};

describe('acp-share 多连接复用原语', () => {
  it('listen + proxy：字节双管透传，双端收线干净退 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-share-'));
    dirs.push(dir);
    // 回声听者（data 帧 echo: 前缀回写；对端收线即回关）
    const server = await listenAcpShare({
      dataDir: dir,
      onConnection: (socket) => {
        socket.on('data', (chunk: Buffer) => socket.write(`echo:${chunk.toString('utf8')}`));
        socket.on('end', () => socket.end());
      },
      warn: warnBoom,
    });
    expect(server).not.toBeNull();

    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding('utf8');
    const proxied = proxyAcpShare({ dataDir: dir, input, output, retryMs: 500, warn: warnBoom });

    input.write('hello\n');
    await until(() => (output.read() ?? '').includes('echo:hello'));
    // 双向多帧照透（代理零协议解析——纯字节）
    input.write('world\n');
    await until(() => (output.read() ?? '').includes('echo:world'));

    input.end(); // stdin EOF → 半关写向 → 听者回关 → 代理见 end 收场
    expect(await proxied).toBe(0);
    server?.close();
  });

  it('探测不通：重试窗耗尽 null 回落（fail-loud 判据素材）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-share-'));
    dirs.push(dir); // 无听者——socket 文件缺席
    const proxied = proxyAcpShare({
      dataDir: dir,
      input: new PassThrough(),
      output: new PassThrough(),
      retryMs: 200,
      warn: warnBoom,
    });
    expect(await proxied).toBeNull();
  });

  it('陈旧 socket 文件 bind 前净除：不拦新听者', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-share-'));
    dirs.push(dir);
    writeFileSync(acpSocketPath(dir), 'junk'); // 上一持有者残文件（无活听者）
    const server = await listenAcpShare({
      dataDir: dir,
      onConnection: () => {},
      warn: warnBoom,
    });
    expect(server).not.toBeNull();
    server?.close();
  });

  it('listen 失败降级 null：数据目录不存在（ENOENT 形——不阻断启动）', async () => {
    // 父目录缺席 → rmSync 静默（force）→ listen ENOENT 错误事件 → null + warn
    // （降级单连接形是 belt-and-braces——真实面 = 目录权限坏形等罕见态）
    const dir = join(tmpdir(), `acp-share-absent-${Date.now()}`);
    const warnings: string[] = [];
    const server = await listenAcpShare({
      dataDir: dir,
      onConnection: () => {},
      warn: (message) => warnings.push(message),
    });
    expect(server).toBeNull(); // 降级单连接形——启动不为此阻断
    expect(warnings.length).toBe(1);
  });
});
