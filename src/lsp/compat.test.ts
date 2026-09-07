/**
 * lsp 兼容性互证——词面独立律的回归锁（结构兼容真身）：
 * - 真 SpawnPipeline（node 真进程）直接结构赋 LspSpawnFace——spawnInteractive
 *   一法同形，实例零 exec import 可换真身；
 * - 真 node:fs/promises 直接结构赋 LspFsFace——盘真相面同形；
 * - 真 node .cjs 假 LSP 服务器（Content-Length 帧最小实现）端到端：spawn →
 *   initialize 握手 → didOpen 全文同步 → publishDiagnostics 回流（version
 *   对齐）→ documentSymbol 往返 → scope 回卷协议化关停（shutdown → exit →
 *   服务器真退）→ 登记簿同册出册。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpawnPipeline } from '../exec/index.js';
import { createLspService } from './service.js';
import type { LspEventsFace, LspFsFace, LspRegisterToolsFace, LspScopeFace, LspSpawnFace } from './types.js';
import type { ToolDefinition } from '../contracts/index.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-lsp-compat-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * 假 LSP 服务器（.cjs——Content-Length 帧最小实现）：initialize 应答 →
 * didOpen/didChange 回发对齐 version 的 publishDiagnostics → documentSymbol
 * 应答 → shutdown 应答 → exit 通知即退（协议化关停语义）。
 */
const SERVER_SCRIPT = `
let buf = Buffer.alloc(0);
const send = (obj) => {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  process.stdout.write(Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\\r\\n\\r\\n', 'ascii'), body]));
};
const handle = (msg) => {
  if (msg.method === 'initialize' && msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
  } else if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
    const td = msg.params.textDocument;
    const diags = msg.method === 'textDocument/didOpen'
      ? [{ severity: 1, message: '假诊断：' + td.languageId, range: { start: { line: 0, character: 0 } } }]
      : [];
    send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: td.uri, version: td.version, diagnostics: diags } });
  } else if (msg.method === 'textDocument/documentSymbol' && msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: [{ name: 'compatFn', kind: 12, range: { start: { line: 2, character: 4 } } }] });
  } else if (msg.method === 'shutdown' && msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: null });
  } else if (msg.method === 'exit') {
    process.exit(0);
  }
};
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\\r\\n\\r\\n');
    if (sep < 0) break;
    const m = /Content-Length:\\s*(\\d+)/i.exec(buf.subarray(0, sep).toString('ascii'));
    if (m === null) process.exit(1);
    const len = parseInt(m[1], 10);
    if (buf.length < sep + 4 + len) break;
    const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
    buf = buf.subarray(sep + 4 + len);
    handle(JSON.parse(body));
  }
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

/* 精简假件（registry/scope/events——spawn 与 fs 用真身） */
const registry = {
  registered: [] as ToolDefinition[],
  face: {
    register: (def: ToolDefinition) => {
      registry.registered.push(def);
      return () => {
        const i = registry.registered.indexOf(def);
        if (i >= 0) registry.registered.splice(i, 1);
      };
    },
  } as LspRegisterToolsFace,
};
const scope = {
  cleanups: [] as Array<() => void>,
  disposed: false,
  get face(): LspScopeFace {
    const self = scope;
    return {
      effect: (register: () => () => void) => {
        self.cleanups.push(register());
        return undefined;
      },
      get isDisposed(): boolean {
        return self.disposed;
      },
    };
  },
  dispose(): void {
    scope.disposed = true;
    for (const c of [...scope.cleanups]) c();
  },
};
const events = {
  map: new Map<string, Array<unknown>>(),
  get face(): LspEventsFace {
    return {
      onWaterfall: ((name: string, listener: unknown) => {
        const list = events.map.get(name) ?? [];
        list.push(listener);
        events.map.set(name, list);
        return () => undefined;
      }) as unknown as LspEventsFace['onWaterfall'],
    };
  },
};

describe('真 SpawnPipeline/真 fs ↔ LspSpawnFace/LspFsFace（结构兼容）', () => {
  it(
    '端到端：spawn → 握手 → didOpen 同步 → 诊断回流 → documentSymbol → 回卷真退 + 登记簿出册',
    { timeout: 15_000 },
    async () => {
      const serverPath = join(dir, 'fake-lsp.cjs');
      writeFileSync(serverPath, SERVER_SCRIPT);
      writeFileSync(join(dir, 'a.ts'), 'const a = 1;\n');

      const pipeline = createSpawnPipeline();
      const spawnFace: LspSpawnFace = pipeline; // 直接结构赋值——零适配零包装
      const fsFace: LspFsFace = fs; // 真 node:fs/promises 结构兼容（盘真相面）

      const service = createLspService({
        spawn: spawnFace,
        registry: registry.face,
        scope: scope.face,
        events: events.face,
        fs: fsFace,
        rootPath: dir, // tmpdir 即工作区根（realpath 物理根——真盘解析）
        closeGraceMs: 2_000,
      });
      service.apply({ servers: { demo: { command: execPath, args: [serverPath], languages: ['ts'] } } });

      // 诊断：didOpen（真盘读全文）→ publishDiagnostics 回流（version 对齐）
      const diag = await service.tools.diagnostics('a.ts');
      expect(diag.isError).toBeFalsy();
      const diagText = (diag.content[0] as { text: string }).text;
      expect(diagText).toContain('假诊断：typescript'); // languageId 派生经真路径
      expect(diagText).toContain('error ×1');

      // 符号往返（真进程真应答）
      const symbols = await service.tools.symbols('a.ts');
      expect((symbols.content[0] as { text: string }).text).toContain('compatFn（Function）L3');

      // 登记簿同册——owner 归属可见
      expect(pipeline.registry.list().some((e) => e.owner === 'lsp:demo')).toBe(true);

      // 回卷：协议化关停（shutdown → exit → 服务器真退）→ 登记簿出册
      scope.dispose();
      await until(() => pipeline.registry.list().length === 0, 5_000);
      expect(registry.registered).toHaveLength(0); // 工具注销
    },
  );
});
