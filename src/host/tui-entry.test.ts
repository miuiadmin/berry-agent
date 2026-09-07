/**
 * host/tui-entry 组合根测试——TUI 主入口装配序（真盘真库 + faux provider +
 * 注入 TerminalIO——mock 只停在模型层）。
 *
 * 钉死：空框直退 0 / 提交流转全链（输入字节 → 编辑器 → 提交 → 驱动 → faux
 * 模型）/ 同 cwd 重启续接（resume 投影首画回读历史）/ 运行时组装失败退 1。
 * 输入驱动走真 InputDecoder（'\r' 提交、'\x04' ctrl+d 空框退出）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { TerminalIO } from '../channels/index.js';
import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';

import { createHostRuntime } from './runtime.js';
import { runTuiEntry } from './tui-entry.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 响应脚本件（pi-ai 面形状——'ok' 文本终态） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 假终端（TerminalIO 最小实现——字节流收账 + 输入监听就绪门） */
class FakeTerminalIO implements TerminalIO {
  output = '';
  private listener: ((data: string) => void) | null = null;
  private readonly readyWaiters: Array<() => void> = [];
  private raw = false;

  write(data: string): void {
    this.output += data;
  }
  size(): { columns: number; rows: number } {
    return { columns: 100, rows: 24 };
  }
  setRawMode(enable: boolean): void {
    this.raw = enable;
  }
  isRaw(): boolean {
    return this.raw;
  }
  pause(): void {}
  resume(): void {}
  onInput(listener: (data: string) => void): () => void {
    this.listener = listener;
    for (const w of this.readyWaiters.splice(0)) w();
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
  onResize(): () => void {
    return () => {};
  }
  /** 等输入管线挂接（backend.start 订阅后） */
  async ready(): Promise<void> {
    if (this.listener !== null) return;
    await new Promise<void>((resolve) => this.readyWaiters.push(resolve));
    await tick();
  }
  /** 喂输入字节（经真 InputDecoder——键序全真） */
  send(data: string): void {
    this.listener?.(data);
  }
}

/** 微任务推进（write-behind 微任务节流的落账等待） */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 轮询至谓词真（有界——faux 调用计数/输出字节等待） */
async function until(predicate: () => boolean, budgetMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > budgetMs) throw new Error('轮询超时（装配序未达预期态）');
    await tick();
  }
}

/** 临时目录族（数据目录 × 工作区目录统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function rigDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** 入口速记（faux provider 预脚本 + 假终端；dataDir 注入——装配段在入口内自装） */
async function rigEntry(dataDir: string, cwd: string) {
  const faux = fauxProvider({ provider: 'faux-entry', models: [{ id: 'm1' }] });
  faux.setResponses([() => messageOf(), () => messageOf(), () => messageOf()]); // 多轮余量
  const io = new FakeTerminalIO();
  const providers: readonly Provider[] = [faux.provider];
  const entry = runTuiEntry({
    flags: { noPlugins: false, debug: false },
    io,
    cwd,
    version: 'test',
    dataDir, // 真装配面（12f-3 起 runtime 注入面已除——装配序公共段唯一真源）
    providers,
    model: 'faux-entry/m1', // faux-only 运行时必须点名模型（缺省解析 anthropic 档必失败）
    env: {},
  });
  await io.ready(); // 输入管线挂接（backend.start 已过）
  return { entry, io, faux };
}

describe('runTuiEntry 装配序', () => {
  it('空框 ctrl+d 直退 0（零模型调用）', async () => {
    const { entry, io, faux } = await rigEntry(rigDir('entry-data-'), rigDir('entry-ws-'));
    io.send('\x04'); // ctrl+d 空框——全局退出键
    const code = await entry;
    expect(code).toBe(0);
    expect(faux.state.callCount).toBe(0); // 未提交零模型调用
    expect(io.output).toContain('berry-agent'); // 起屏 title 基线（version 注入）
  });

  it('提交流转全链：输入字节 → 编辑器 → 提交 → 驱动 → faux 模型 → 应答上屏', async () => {
    const { entry, io, faux } = await rigEntry(rigDir('entry-data-'), rigDir('entry-ws-'));
    io.send('你好\r'); // 键入 + Enter 提交
    await until(() => faux.state.callCount >= 1); // 全链达模型
    await until(() => io.output.includes('ok')); // 应答文本上屏（transcript 定稿）
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('同 cwd 重启续接：resume 投影首画回读历史（首启文本再见屏）', async () => {
    const dataDir = rigDir('entry-resume-');
    const ws = rigDir('entry-ws2-');

    // 首启：一轮对话落库后退出
    const first = await rigEntry(dataDir, ws);
    first.io.send('重启后见\r');
    await until(() => first.faux.state.callCount >= 1);
    await until(() => first.io.output.includes('ok'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);

    // 重启：同 cwd 同数据目录——启动会话策略续接，投影首画含历史 user 文本
    const second = await rigEntry(dataDir, ws);
    await until(() => second.io.output.includes('重启后见')); // resume 历史回读（投影重画）
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });

  it('运行时组装失败退 1（数据目录被占——干净退出档不写 crash.log）', async () => {
    const dataDir = rigDir('entry-busy-');
    const rt = createHostRuntime({ dataDir }); // 占位在先
    const io = new FakeTerminalIO();
    const code = await runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io,
      cwd: rigDir('entry-ws3-'),
      dataDir, // 单活跃机拒入
      env: {},
    });
    expect(code).toBe(1);
    await rt.shutdown();
  });
});
