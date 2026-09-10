/**
 * host/tui-entry 组合根测试——TUI 主入口装配序（真盘真库 + faux provider +
 * 注入 TerminalIO——mock 只停在模型层）。
 *
 * 钉死：空框直退 0 / 提交流转全链（输入字节 → 编辑器 → 提交 → 驱动 → faux
 * 模型）/ 同 cwd 重启续接（resume 投影首画回读历史）/ 运行时组装失败退 1 /
 * `--port` webui 咬合（横幅走屏留痕面只带 URL、token 不入屏、退出收场面）。
 * 输入驱动走真 InputDecoder（'\r' 提交、'\x04' ctrl+d 空框退出）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { TerminalIO } from '../channels/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';
import { Persistence, resolveDatabasePathIn } from '../persist/index.js';

import { createHostRuntime, HOST_MIGRATION_TAIL } from './runtime.js';
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

  it('resumeSessionId 按 id 续接（批 20d——与按 cwd 取最新互补：异 cwd 亦达 + 打错 id 不造新会话）', async () => {
    const dataDir = rigDir('entry-rid-data-');
    const ws = rigDir('entry-rid-ws-');

    // 首启：一轮对话落库后退出
    const first = await rigEntry(dataDir, ws);
    first.io.send('指定 id 探针\r');
    await until(() => first.faux.state.callCount >= 1);
    await until(() => first.io.output.includes('ok'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);

    // 在册 id 反查（库面——该 cwd 唯一会话。装配面库文件锚定 dataDir〔显式
    // dataDir 锚定律——runtime 开库位与 probe 同解析〕——探针同锚定即同库；
    // workspaceRoot 过滤精确定位本测试会话，免疫库内邻例噪声）
    const probe = Persistence.open({
      dbPath: resolveDatabasePathIn(dataDir),
      dataDir,
      migrations: HOST_MIGRATION_TAIL,
    });
    const [row] = probe.store.listSessions({ workspaceRoot: canonicalWorkspaceRoot(ws) });
    await probe.close();
    expect(row).toBeDefined();
    const id = row!.id;

    // 二启：异 cwd（该 cwd 无会话——按 cwd 取最新应新建）+ 指定 id 续接：
    // 投影首画仍回读历史（id 选取键胜 cwd 选取键——07 §5 两键互补律）
    const faux = fauxProvider({ provider: 'faux-rid', models: [{ id: 'm1' }] });
    faux.setResponses([() => messageOf(), () => messageOf()]);
    const io2 = new FakeTerminalIO();
    const second = runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io: io2,
      cwd: rigDir('entry-rid-ws2-'), // 异 cwd——无会话
      version: 'test',
      dataDir,
      providers: [faux.provider],
      model: 'faux-rid/m1',
      env: {},
      resumeSessionId: id,
    });
    await io2.ready();
    await until(() => io2.output.includes('指定 id 探针')); // resume 历史回读（按 id 达）
    io2.send('\x04');
    expect(await second).toBe(0);

    // 打错 id：干净退 1（不造新会话——按该次启动唯一 cwd 作用域精确判：打错
    // id 若落入 cwd 取最新新建路径，会以该 cwd 锚建新会话，作用域计数即非零）
    const ws3 = rigDir('entry-rid-ws3-');
    const io3 = new FakeTerminalIO();
    const third = runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io: io3,
      cwd: ws3,
      version: 'test',
      dataDir,
      providers: [faux.provider],
      model: 'faux-rid/m1',
      env: {},
      resumeSessionId: 'no-such-id',
    });
    expect(await third).toBe(1);
    const after = Persistence.open({ migrations: HOST_MIGRATION_TAIL });
    const stray = after.store.listSessions({ workspaceRoot: canonicalWorkspaceRoot(ws3) });
    await after.close();
    expect(stray).toHaveLength(0);
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

  it("`--port` webui 咬合（18a-3'）：横幅走屏留痕面只带 URL，token 不入屏，ctrl+d 收场面", async () => {
    const faux = fauxProvider({ provider: 'faux-port', models: [{ id: 'm1' }] });
    const io = new FakeTerminalIO();
    let opened: { host: string; port: number; token: string } | undefined;
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false, port: 0 },
      io,
      cwd: rigDir('entry-ws4-'),
      version: 'test',
      dataDir: rigDir('entry-data-'),
      providers: [faux.provider],
      model: 'faux-port/m1',
      env: {},
      onWebuiOpen: (info) => {
        opened = info;
      },
    });
    await io.ready();
    await until(() => opened !== undefined); // 面起（onOpen 回执）
    try {
      // 横幅经 channels.notify 扇出上屏：URL 在场、token 不在（屏流可回滚——
      // 非披露通道；令牌仅 stderr 一次性）
      await until(() => io.output.includes('Web 界面已开面'));
      expect(io.output).toContain(`http://127.0.0.1:${opened!.port}/`);
      expect(io.output).not.toContain(opened!.token);
      // webui 探活位（open/liveness）无凭证可达——TUI 与 webui 双 backend 并存
      const health = await fetch(`http://127.0.0.1:${opened!.port}/api/health`);
      expect(health.status).toBe(200);
    } finally {
      io.send('\x04');
    }
    expect(await entry).toBe(0);
    // 退出即收面（closer 序：webui-server 在 tui-backend 之前——先网络后出屏）
    const gone = await fetch(`http://127.0.0.1:${opened!.port}/api/health`).catch(() => undefined);
    expect(gone).toBeUndefined();
  });
});
