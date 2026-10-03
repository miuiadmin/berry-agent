/**
 * host/tui-entry 组合根测试——TUI 主入口装配序（真盘真库 + faux provider +
 * 注入 TerminalIO——mock 只停在模型层）。
 *
 * 钉死：空框直退 0 / 提交流转全链（输入字节 → 编辑器 → 提交 → 驱动 → faux
 * 模型）/ 同 cwd 重启续接（resume 投影首画回读历史）/ 运行时组装失败退 1 /
 * `--port` webui 咬合（横幅走屏留痕面只带 URL、token 不入屏、退出收场面）/
 * `--no-plugins` 自救链入口腿（E14——坏插件现场锁死对照 + 安全模式起得来）。
 * 输入驱动走真 InputDecoder（'\r' 提交、'\x04' ctrl+d 空框退出）。
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { TerminalIO } from '../channels/index.js';
import { BaseError } from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';
import { Persistence, resolveDatabasePathIn } from '../persist/index.js';

import { createHostRuntime, HOST_MIGRATION_TAIL } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { readRawCustomProviders } from './settings-store.js';
import { sandboxModeReceipt, thinkingLevelReceipt } from './session-tier-copy.js';
import { exitCommandItems, commandArgumentItems } from './static-completions.js';
import { runTuiEntry, readSingleKeyFromIo, readLogTailLines } from './tui-entry.js';
import type { ConversationStack } from './conversation-stack.js';
import { runMarketplaceEntry } from './marketplace-cmd.js';

/* ---------------- 捕获缝：channels barrel passthrough（仅记录 todoFor 注入面） ---------------- */

/** 装配期捕获位（vi.hoisted——vi.mock 工厂提升到文件顶，捕获体必须同步可用） */
const todoForCapture = vi.hoisted(() => ({
  fn: undefined as
    | ((sessionId: string) => readonly { readonly status: string; readonly content: string }[] | null | undefined)
    | undefined,
}));

// passthrough 单点包裹（issue barrel 捕获先例同形——run-issue-verify.test.ts）：
// spread 全真导出 + TuiBackend 构造时记录注入的 todoFor 后原样转发——零行为
// 替身，捕获到的是 tui-entry 装配的生产闭包本体（todoFor 折叠 memo 行为锁
// 的直接观测缝——本文件运行时零依赖该 barrel，mock 只作用于 tui-entry 导入）
vi.mock('../channels/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../channels/index.js')>();
  const RealTuiBackend = actual.TuiBackend;
  class CapturingTuiBackend extends RealTuiBackend {
    constructor(
      io: ConstructorParameters<typeof RealTuiBackend>[0],
      options: ConstructorParameters<typeof RealTuiBackend>[1],
    ) {
      todoForCapture.fn = options?.todoFor;
      super(io, options);
    }
  }
  return { ...actual, TuiBackend: CapturingTuiBackend };
});

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

/** 带计量的 faux 响应件（今日段结算锚测试——usage 非零可断言段在场） */
function meteredEntryMessage(input: number, output: number): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 假终端（TerminalIO 最小实现——字节流收账 + 输入监听就绪门） */
class FakeTerminalIO implements TerminalIO {
  output = '';
  private listener: ((data: string) => void) | null = null;
  private readonly readyWaiters: Array<() => void> = [];
  private readonly resizeListeners = new Set<() => void>();
  private raw = false;
  /** 几何（测试可设——resize 场景直接改字段后 emitResize；MemoryTerminalIO 同形） */
  public columns = 100;
  public rows = 24;

  write(data: string): void {
    this.output += data;
  }
  size(): { columns: number; rows: number } {
    return { columns: this.columns, rows: this.rows };
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
  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }
  /** 测试注入：驱动全部 resize 监听器（几何已由测试侧先行改定——MemoryTerminalIO 同形） */
  emitResize(): void {
    for (const listener of [...this.resizeListeners]) listener();
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

/** ANSI 转义剥除（期望帧匹配用——界面美化役批⑦ user 块 '› ' 前缀段带样式，SGR 串隔断字面匹配） */
function stripAnsi(out: string): string {
  return out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
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

/** 入口速记（faux provider 预脚本 + 假终端；dataDir 注入——装配段在入口内自装；
 * overrides 选填覆盖面（批D——env 键合并其余直覆，补全注入不破既有两参调用点） */
async function rigEntry(dataDir: string, cwd: string, overrides: Partial<Parameters<typeof runTuiEntry>[0]> = {}) {
  const { env: extraEnv, ...rest } = overrides;
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
    // 启动版本检查关断（07 §8.5 第 6 条——单元测试零网络律；接线锁另有专测注桩）
    env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1', ...(extraEnv ?? {}) },
    ...rest,
  });
  await io.ready(); // 输入管线挂接（backend.start 已过）
  return { entry, io, faux };
}

describe('exitCommandItems 退出词补全源（07 §4.1 /exit 批）', () => {
  it('空 query 单词（/quit 已退役——三反馈批A）；前缀过滤；replacement/detail 形齐', () => {
    expect(exitCommandItems('')).toEqual([expect.objectContaining({ label: '/exit', replacement: '/exit' })]);
    expect(exitCommandItems('ex').map((item) => item.label)).toEqual(['/exit']);
    expect(exitCommandItems('qu')).toEqual([]); // /quit 已退役（三反馈批A）——补全面不再供给
    expect(exitCommandItems('zz')).toEqual([]); // 无关前缀零条目
  });
});

describe('commandArgumentItems 命令参数补全源（R6 批 10j）', () => {
  it('四命令首参子动词：全量 + 前缀/子序列过滤 + 带参者尾空格', () => {
    // approval 全量（priorArgs 空 = 首参位）
    const all = commandArgumentItems('approval', '', []);
    expect(all.map((i) => i.label)).toEqual(['status', 'entries', 'explain', 'preset']);
    // 无参动词无尾空格、带参动词尾空格（应用后直进下一 token 位）
    expect(all.find((i) => i.label === 'status')?.replacement).toBe('status');
    expect(all.find((i) => i.label === 'preset')?.replacement).toBe('preset ');
    // 前缀 + 子序列两档（'pl' → plugins 前缀命中集）
    expect(commandArgumentItems('plugins', 'li', []).map((i) => i.label)).toEqual(['list']);
    // 'p' 前缀 preview 置顶 + 子序列 help（尾 p）随后——前缀组在前 fuzzy 组在后
    expect(commandArgumentItems('rewind', 'p', []).map((i) => i.label)).toEqual(['preview', 'help']);
    expect(commandArgumentItems('doors', '', []).map((i) => i.label)).toEqual(['list', 'open', 'close']);
  });

  it('goal 首参子动词五枚（A-6 组γ——修前红位：goal 不在 SUBVERBS_BY_COMMAND 静态面零补全）', () => {
    const all = commandArgumentItems('goal', '', []);
    expect(all.map((i) => i.label)).toEqual(['create', 'list', 'show', 'wake', 'approve']);
    // 无参动词无尾空格、带参动词尾空格（create/show/wake/approve 带尾参）
    expect(all.find((i) => i.label === 'list')?.replacement).toBe('list');
    expect(all.find((i) => i.label === 'wake')?.replacement).toBe('wake ');
  });

  it('深位枚举：approval preset 预设名（safety 单源）；doors open 能力名', () => {
    const presets = commandArgumentItems('approval', '', ['preset']);
    expect(presets.map((i) => i.label)).toEqual(['conservative', 'balanced', 'open']); // safety 预设三档单源
    expect(presets[0]?.replacement).toBe('conservative '); // 枚举应用后尾空格
    expect(presets[0]?.detail).toBeTruthy(); // 描述随行（safety 单源文本）
    const caps = commandArgumentItems('doors', '', ['open']);
    expect(caps.length).toBeGreaterThan(0); // contracts 面目录派生（非空集）
    expect(caps.every((i) => i.replacement.endsWith(' '))).toBe(true);
    // 深位失配（preset 后第三位 / 非 open·close 的 doors 动词后）——零条目
    expect(commandArgumentItems('approval', 'x', ['preset', 'y'])).toEqual([]);
    expect(commandArgumentItems('doors', 'x', ['list'])).toEqual([]);
  });

  it('未知命令 / 非首参位（活体 id 值）→ 零条目', () => {
    expect(commandArgumentItems('model', '', [])).toEqual([]); // 静态面未接的命令
    expect(commandArgumentItems('plugins', 'id', ['mount'])).toEqual([]); // 插件 id = 活体值不在静态面
  });
});

describe('readLogTailLines /debug 尾窗读（行为等价锁——尾 50 行与全读 split 逐行相等）', () => {
  /** 等价基准（旧实现全读形）：readFileSync 全文 split + 尾换行伪行去一 + slice(-50) */
  const fullReadTail = (path: string): readonly string[] => {
    const lines = readFileSync(path, 'utf8').split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-50);
  };

  /** 写临时文件并回填路径（rigDir 入清账族） */
  const writeTempLog = (prefix: string, content: string): string => {
    const dir = rigDir(prefix);
    const path = join(dir, 'daemon.log');
    writeFileSync(path, content);
    return path;
  };

  it('大文件（> 初始 64KiB 窗）：尾 50 行与全读逐行相等——窗口跨残行首行丢弃', () => {
    // 2000 行 × 每行 ~40 字节 ≈ 80KiB（超 64KiB 初始窗——窗口必跨残行）
    const content = Array.from({ length: 2000 }, (_, i) => `2026-09-23 line-${i} 混排中文对齐宽\n`).join('');
    const path = writeTempLog('entry-tail-big-', content);
    expect(readLogTailLines(path, 50)).toEqual(fullReadTail(path));
  });

  it('行数不足 50（小文件）：全行相等', () => {
    const path = writeTempLog('entry-tail-small-', 'a\nb\nc\n');
    expect(readLogTailLines(path, 50)).toEqual(['a', 'b', 'c']);
    expect(readLogTailLines(path, 50)).toEqual(fullReadTail(path));
  });

  it('空文件 → 空行集（与全读形一致）', () => {
    const path = writeTempLog('entry-tail-empty-', '');
    expect(readLogTailLines(path, 50)).toEqual([]);
  });

  it('无尾换行文件：末行不丢（伪行去一只吃尾换形）', () => {
    const path = writeTempLog('entry-tail-noeol-', 'x\ny\nz（无尾换行）');
    expect(readLogTailLines(path, 50)).toEqual(['x', 'y', 'z（无尾换行）']);
  });

  it('小窗注入形（扩窗重读）：50 长行 × 窗 256B——多轮扩窗至文件头产出仍等价', () => {
    // 50 行 × 每行 ~60 字节 ≈ 3KB；初始窗 256B 只够 4 行 → 连续扩窗至全覆盖
    const lines = Array.from({ length: 50 }, (_, i) => `row-${String(i).padStart(3, '0')}——padding-padding\n`);
    const path = writeTempLog('entry-tail-grow-', lines.join(''));
    expect(readLogTailLines(path, 50, 256)).toEqual(lines.map((l) => l.slice(0, -1)));
    expect(readLogTailLines(path, 50, 256)).toEqual(fullReadTail(path));
  });

  it('小窗注入形（行数不足但窗已盖全文件）：首行完整不丢', () => {
    const path = writeTempLog('entry-tail-cover-', 'l1\nl2\nl3\n');
    // 窗 1024B > 文件——一次盖全，start === 0 首行完整保留
    expect(readLogTailLines(path, 50, 1024)).toEqual(['l1', 'l2', 'l3']);
  });

  it('文件不存在 → null（诚实缺席形——开屏同缺席呈现）', () => {
    expect(readLogTailLines(join(rigDir('entry-tail-miss-'), 'nope.log'))).toBeNull();
  });
});

/* ---------------- --port 开面失败分档（E3——run-entry :437 干净退出档同律） ---------------- */

/**
 * 占位 TCP 端口（run-entry.test.ts 同形公共手法）：node:http 真监听
 * 127.0.0.1 内核指派口并保持占用——对被测 `--port` 开面即确定性 EADDRINUSE
 * 拒形；调用方 finally 内 close 释放。
 */
async function occupyTcpPort(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        server.close();
        reject(new Error('address 非 TCP 形（占位端口基建异常）'));
        return;
      }
      resolve({ port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

describe('runTuiEntry --port 开面失败分档', () => {
  it('端口占用（EADDRINUSE）：干净退 1 + 呈报归一文案 + 不写 crash.log', async () => {
    const occupied = await occupyTcpPort();
    // stderr 收账（呈报走 process.stderr 直写——spy 收集后还原，零跨测试污染）
    const stderrChunks: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write);
    const dataDir = rigDir('entry-port-busy-');
    const faux = fauxProvider({ provider: 'faux-entry', models: [{ id: 'm1' }] });
    faux.setResponses([() => messageOf()]);
    const io = new FakeTerminalIO();
    // 不走 rigEntry 的 io.ready()——失败路 backend 不起屏（ready 永不 resolve）
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false, port: occupied.port },
      io,
      cwd: rigDir('entry-port-ws-'),
      version: 'test',
      dataDir,
      providers: [faux.provider],
      model: 'faux-entry/m1',
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
    });
    try {
      await expect(entry).resolves.toBe(1); // 干净退 1（非崩溃档退码同值——分档看下两断言）
      const stderrText = stderrChunks.join('');
      expect(stderrText).toContain('--port 开启失败'); // 呈报锚词（run-entry :440 同文分档）
      expect(stderrText).not.toContain('TUI 运行失败'); // 不落外层通用崩溃档文案
      expect(existsSync(join(dataDir, 'crash.log'))).toBe(false); // 预期内环境态零崩溃取证
    } finally {
      stderrSpy.mockRestore();
      await occupied.close();
    }
  });
});

describe('runTuiEntry 装配序', () => {
  it('空框 ctrl+d 直退 0（零模型调用）', async () => {
    const { entry, io, faux } = await rigEntry(rigDir('entry-data-'), rigDir('entry-ws-'));
    io.send('\x04'); // ctrl+d 空框——全局退出键
    const code = await entry;
    expect(code).toBe(0);
    expect(faux.state.callCount).toBe(0); // 未提交零模型调用
    expect(io.output).toContain('berry-agent'); // 起屏 title 基线（version 注入）
  });

  it('退出序落盘失败折非零（十六役补扫 N3）：flush 抛错 → ctrl+d 退 1 不再零码假绿', async () => {
    // 05 §6.3#6「flush 失败 = 退出非零码」——正常退出档零码只在落盘两步皆净
    // 时成立；onRuntime 注入位实例级遮蔽 flush（③⑥ 同失败——close 内含
    // this.flush()），修前 ctrl+d 恒 0 = 吞错假绿形
    const { entry, io } = await rigEntry(rigDir('entry-n3-'), rigDir('entry-ws-'), {
      onRuntime: (rt) => {
        (rt.persistence as { flush: () => Promise<void> }).flush = async () => {
          throw new Error('disk full');
        };
      },
    });
    io.send('\x04');
    await expect(entry).resolves.toBe(1);
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

  it('键位用户覆盖接线全链（批 10k 遗漏修装配位证）：settings keybindings editor.new-line=alt+j 提交文带换行', async () => {
    const dataDir = rigDir('entry-kb-');
    // settings.json keybindings 键（形校验在读侧——alt+j 合文法）：
    // editor.new-line 缺省册 ['shift+enter','ctrl+j'] 整组替换为 alt+j
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ keybindings: { 'editor.new-line': 'alt+j' } }));
    const { entry, io, faux } = await rigEntry(dataDir, rigDir('entry-ws-kb-'));
    // faux 工厂截获 context：末条 user 消息原文（覆盖生效则含 \n，未接线则
    // alt+j 无义被丢、两段并作一行）
    const userTexts: string[] = [];
    faux.setResponses([
      (context) => {
        // 全 user 消息截获（环境前导 user 消息与用户轮同上下文——只取末条会
        // 错拿环境前导，故全量入账）
        for (const m of context.messages) {
          if (m.role !== 'user') continue;
          const c = (m as { content?: unknown }).content;
          userTexts.push(
            typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? c
                    .map((b) =>
                      typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: unknown }).text) : '',
                    )
                    .join('')
                : '',
          );
        }
        return messageOf();
      },
    ]);
    io.send('a');
    io.send('\x1bj'); // alt+j（InputDecoder ESC+可打印即出 alt 修饰键事件）
    io.send('b');
    io.send('\r'); // Enter 提交——全链达 faux
    await until(() => userTexts.some((t) => t.startsWith('a'))); // 用户轮到位（环境前导轮先行的调用序免疫）
    io.send('\x04');
    expect(await entry).toBe(0);
    expect(userTexts).toContain('a\nb'); // 换行入文——覆盖经 tui-entry 装配位真接线的行为证据
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
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
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
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
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
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
    });
    expect(code).toBe(1);
    await rt.shutdown();
  });

  it('提交 run 结算锚：run 结算后 footer 收敛（全域清扫 G1-#1；V-4 注⑪⑨ 尾注让位——行1 尾注与仪表同帧并陈）', async () => {
    const { entry, io, faux } = await rigEntry(rigDir('entry-settle-data-'), rigDir('entry-settle-ws-'));
    faux.setResponses([() => meteredEntryMessage(30, 12)]);
    io.send('hello\r');
    await until(() => faux.state.callCount >= 1); // 全链达模型
    // 修前红：agent_end 信封同步扇出在桥接落账（结算微任务）之前——锚拉到的
    // 累计值不含本 run token；结算后 TUI 侧无刷新锚 → 零耗缩位持续驻留。
    // 修 = onSubmit 挂 settled promise（桥接落账后 resolve——promise 回调序
    // 结构性保证）刷 footer。V-4 注⑪⑨：run 收尾尾注（✓ 用量 N）右对齐与
    // 行1 仪表同帧并陈（挤占几何——不再整段掩蔽；累计段可见收敛面由
    // #1-full 后台道测锁——后台道不落尾注形）
    await until(() => io.output.includes('✓ 用量'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('后台道单发结算通知：非提交路落账后累计段即时呈现（#1-full 残窗——修前红：订阅面缺席零刷新锚）', async () => {
    const stacks: ConversationStack[] = [];
    const ws = rigDir('entry-ledger-sig-ws-');
    const { entry, io, faux } = await rigEntry(rigDir('entry-ledger-sig-data-'), ws, {
      onStack: (stack) => stacks.push(stack), // 注入面拿真装配栈
    });
    await until(() => io.output.includes('工作区写 · ')); // footer 首画在场（零耗——累计段缩位）
    // 零提交路直接发后台道 complete（与 scheduler/webui/issue 跨入口结算同栈
    // 同构）：修前红 = footer 无刷新锚（提交路 settled 锚不覆盖本路）→ 累计
    // 段永不现；修 = onSessionUsageLedgered 订阅通知刷 footer（V-4 注⑪⑥a
    // 会话累计刷新锚——sessionSpentOf 聚合读面）。会话面：openStartupSession
    // 活体面取回（新会话行首事件未落库——库读 list 不可见，走同 ws 归一根；
    // 累计段是聚焦会话聚合，落账会话即启动焦点）
    faux.setResponses([() => meteredEntryMessage(30, 12)]);
    const stack = stacks[0]!;
    // 归因会话 = 启动会话直取焦点 id（openStartupSession 走库读 list——启动
    // 会话行首事件未落库时 list 不可见会铸**新**会话，归因漂移到非焦点——
    // 累计段是聚焦会话聚合，归因必须钉焦点）
    const sid = stack.channels.focusedId!;
    await stack.llm.complete({
      messages: [{ role: 'user', content: '后台单发结算', timestamp: Date.now() }],
      priority: 'background',
      metering: { sessionId: sid },
    });
    await until(() => io.output.includes('累计 ')); // 零耗缩位 → 落账通知刷新后有值现段
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  // —— /status 今日行装配接线锁（lane-C 件2）：allLanesSpentToday 纯函数三形
  // 已锁（conversation-stack 域），但 openStatusPanel → todaySpent 注入腿零
  // e2e 锚——装配腿断垃圾值/绕读面全不红。本测经真装配锁两形：>0 今日行在场
  //（值 = allLanesSpentToday 现读）+ 零耗不推行（status-viewer 行集「>0 才显」
  // 契约的装配半边）。
  it('/status 今日行装配接线：metered 结算落账后开屏今日行在场 + 冷启动零耗不推行', async () => {
    // 腿1：metered faux 跑一笔结算落账（今日账 >0 形）→ /status 开屏
    const first = await rigEntry(rigDir('entry-status-t1-data-'), rigDir('entry-status-t1-ws-'));
    await until(() => first.io.output.includes('工作区写 · ')); // footer 就绪门
    first.faux.setResponses([() => meteredEntryMessage(30, 12)]);
    first.io.send('hello\r');
    await until(() => first.io.output.includes('✓ 用量')); // run 结算落账锚（今日账已含本笔）
    first.io.send('/status\r');
    await until(() => first.io.output.includes('◉ 状态汇总')); // 副屏开屏
    // 今日行整行锚（标签 + 值列数字——「今日」孤词防他文撞词）。值不可硬编：
    // faux 走 withUsageEstimate 覆写（按真实 prompt 估算——脚本消息 usage 字段
    // 被替换），断言「行在场 + 值列数字」即锁接线腿（allLanesSpentToday 现读
    // 注入——改注入腿返 0/垃圾即红，见判别性实证）
    expect(stripAnsi(first.io.output)).toMatch(/今日\s+[\d,]+/);
    first.io.send('q');
    await until(() => first.io.output.includes('\x1b[?1049l'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);

    // 腿2：冷启动零耗 → /status 今日行缺席（>0 才显——零耗不推行不虚报零行）
    const second = await rigEntry(rigDir('entry-status-t2-data-'), rigDir('entry-status-t2-ws-'));
    await until(() => second.io.output.includes('工作区写 · '));
    second.io.send('/status\r');
    await until(() => second.io.output.includes('◉ 状态汇总'));
    expect(stripAnsi(second.io.output)).not.toMatch(/今日\s+\d/); // 零耗 = 今日行缺席
    second.io.send('q');
    await until(() => second.io.output.includes('\x1b[?1049l'));
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });

  it('/status 轮次行 driver 缺席不虚报 0（缺席不推行，与 git/今日同律；修前红：fold 缺席假零）', async () => {
    const dataDir = rigDir('entry-status-turn-data-');
    const stacks1: ConversationStack[] = [];

    // 对照腿：driver 在场（启动焦点）——跑一轮后 /status 轮次行推行真值
    //（≥1：foldSessionUsage 现折——缺席是缺省语义不是行退役）
    const first = await rigEntry(dataDir, rigDir('entry-status-turn-ws1-'), {
      onStack: (stack) => stacks1.push(stack),
    });
    first.io.send('轮次探针\r');
    await until(() => first.faux.state.callCount >= 1);
    await until(() => first.io.output.includes('ok'));
    const s1 = stacks1[0]!.channels.focusedId!; // 一腿退出前取（栈拆后勿再读）
    first.io.send('/status\r');
    await until(() => first.io.output.includes('◉ 状态汇总')); // 副屏开屏
    expect(stripAnsi(first.io.output)).toMatch(/轮次\s+[1-9]/); // 真值 ≥1（一轮对话）
    first.io.send('q');
    await until(() => first.io.output.includes('\x1b[?1049l'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);

    // 二启：同 dataDir 异 cwd 开新会话（s2 焦位带驱动）→ 经 channels 公开面
    // focus(s1)（registry.focus 只投影不开驱动——/sessions 选定路走
    // resumeSession 已恒开驱动 conversation-stack.ts「切焦即续接」，故构造
    // 取本公开路）：s1 持久日志有真实轮次账而 driverOf(s1) === undefined →
    // /status：修前轮次行虚报 0（driver 缺席折假零——/usage 从持久日志折
    // 恒有数，相悖）；修后缺席不推行（轮次行整行省略——不可知非零值）
    const stacks2: ConversationStack[] = [];
    const second = await rigEntry(dataDir, rigDir('entry-status-turn-ws2-'), {
      onStack: (stack) => stacks2.push(stack),
    });
    await until(() => second.io.output.includes('工作区写 · ')); // footer 就绪门
    await stacks2[0]!.channels.focus(s1); // 只投影不开驱动（未注册视同注册）
    await until(() => stripAnsi(second.io.output).includes('› 轮次探针')); // s1 史回读落画
    second.io.send('/status\r');
    await until(() => second.io.output.includes('◉ 状态汇总'));
    // 修前红：`轮次     0`（假零）；修后：轮次行整行缺席（不虚报不可知值）
    expect(stripAnsi(second.io.output)).not.toMatch(/轮次\s+\d/);
    second.io.send('q');
    await until(() => second.io.output.includes('\x1b[?1049l'));
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });

  it('/help 副屏 + footer 常驻段（批 10k——R7 帮助面/R6 footer 落码装配位；V-4 注⑪②③ 三行栈形 + `?` 教学键）', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-help-data-'), rigDir('entry-help-ws-'));
    // footer 三行栈首画在场（V-4 注⑪）：行1 仪表（模式词栈基线 workspace-write
    // → MODE_SHORT「Auto」+ 模型短名回迁——ctrl+p 同源）+ 行2 环境（沙箱原词
    // 「工作区写」+ 教学提示 dim 段）
    await until(() => io.output.includes('工作区写 · '));
    expect(io.output).toContain('? 快捷键');
    expect(io.output).toContain(' · m1'); // 模型短名回迁锁（V-4 注⑪②——行1 仪表栈）
    expect(io.output).toContain('Auto'); // 模式词（MODE_SHORT 单源——装配投影）
    // `?` 闲态教学键（V-3 注⑦④——text 路分诊）：直开帮助副屏（与 /help
    // 命令同一开屏本体 openHelpPanel）
    io.send('?');
    await until(() => io.output.includes('◉ 命令与键位帮助'));
    io.send('q'); // q text 轨收副屏
    await until(() => io.output.includes('\x1b[?1049l'));
    // /help 命令 → 帮助副屏：命令册首帧可见段（键位册段在册尾视口外——双册
    // 全量已由 help-viewer.test 纯函数直锁，此处锁装配位真源）
    io.send('/help\r');
    // 头符 ❓→◉（界面美化役美学注④——emoji 弃用，期望帧随档）
    await until(() => io.output.includes('◉ 命令与键位帮助'));
    expect(io.output).toContain('── 命令 ──');
    expect(io.output).toContain('/sessions'); // 10k 会话切换器在册（channels 注册面真源）
    expect(io.output).toContain('/usage'); // 10k 用量面板在册
    io.send('q'); // q text 轨收副屏（独立 ESC 字节有序列等待窗——避并包歧义）
    await until(() => io.output.includes('\x1b[?1049l')); // ALT 收屏字节标记（回主屏）
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/guide 副屏模型配置段（P0 静默链修复批 + C-4 v2 文案——/setup 主路 + /model 选择器主路；env 手编路下沉 docs）', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-guide-data-'), rigDir('entry-guide-ws-'));
    await until(() => io.output.includes('工作区写 · '));
    io.send('/guide\r');
    // 模型配置段在场：段标题 + /setup 向导主路 + /model 选择器主路（env 供血
    // 与换模型键手编路下沉 docs/usage.md「模型配置」——UX 话术批 §五 23 条）
    await until(() => io.output.includes('── 模型配置 ──'));
    expect(io.output).toContain('/setup 向导');
    expect(io.output).toContain('/model 打开选择器');
    expect(io.output).toContain('docs/usage.md');
    io.send('q');
    await until(() => io.output.includes('\x1b[?1049l'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/marketplace 选装副屏全链（mp-5——03 §9.6 TUI 选装面）：/marketplace 开屏快照行集 → enter 真装机（服务面直装零绕过）→ 复开已装徽标 + 完成归因回执', async () => {
    const dataDir = rigDir('entry-market-data-');
    const ws = rigDir('entry-market-ws-');
    // 本地市场仓 fixture（marketplace-tui-face.test 同构——零网络 local 源）+
    // 真服务面 add 入册（源清单 + 缓存快照——面板 discover 纯读此缓存）
    const repo = join(ws, 'market-repo');
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'alpha',
        owner: { name: 'o' },
        plugins: [{ name: 'hello-plugin', source: './plugins/hello', description: '问好插件' }],
      }),
    );
    mkdirSync(join(repo, 'plugins', 'hello'), { recursive: true });
    writeFileSync(
      join(repo, 'plugins', 'hello', 'package.json'),
      `${JSON.stringify({ name: 'hello-plugin', version: '1.0.0', berryAgent: { id: 'hello-plugin', skills: ['greet'] } }, null, 2)}\n`,
    );
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, { dataDir, env: {} })).toBe(0);

    const { entry, io } = await rigEntry(dataDir, ws);
    await until(() => io.output.includes('工作区写 · '));
    // /marketplace 恰零参命中（本地拦截族第七件）→ 副屏开屏：快照行集首帧
    io.send('/marketplace\r');
    await until(() => io.output.includes('◆ 插件市场 · 1 条目（1 源）'));
    expect(io.output).toContain('› hello-plugin@alpha'); // 光标在首行（未装——无徽标）
    // enter 选装：先收副屏再回调 → 真服务面拷贝腿装机（busy 在主屏外飞——
    // 回主屏可 busy 行不可见，完成归因 notify 兜底）
    io.send('\r');
    await until(() => io.output.includes('marketplace install hello-plugin@alpha 完成'));
    expect(io.output).toContain('回执见 /marketplace 面板');
    // 复开：已装徽标在场（真账本 market 注记对拍——ledgerMarketKeys 现读；
    // 头行两处出现判据（split 三段）——io.output 累积，首次开屏同名段不可
    // 复用为达成信号）
    io.send('/marketplace\r');
    await until(() => io.output.split('◆ 插件市场 · 1 条目（1 源）').length === 3);
    expect(io.output).toContain('hello-plugin@alpha 已装');
    io.send('q');
    await until(() => io.output.includes('\x1b[?1049l'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/sessions 切焦补开驱动（批 10k 遗漏修——focus 只投影不开驱动，选定旧会话提交前补开）', async () => {
    const dataDir = rigDir('entry-sess-data-');
    const ws1 = rigDir('entry-sess-ws1-');

    // 首启：一轮对话落库退出（s1 在库、活驱动随进程拆解）
    const first = await rigEntry(dataDir, ws1);
    first.io.send('旧会话探针\r');
    await until(() => first.faux.state.callCount >= 1);
    await until(() => first.io.output.includes('ok'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);

    // 二启：同库异 cwd（该 cwd 无会话——新建 s2 焦位）；/sessions 副屏在册：
    // s2 零事件无库行（createSession 零 I/O、行首事件才落库——清单 = 库行真源），
    // 故清单恰 1 行 = s1，光标起位即在 s1
    const second = await rigEntry(dataDir, rigDir('entry-sess-ws2-'));
    await until(() => second.io.output.includes('工作区写 · ')); // footer 就绪门
    second.io.send('/sessions\r');
    await until(() => second.io.output.includes('⇄ 会话切换 · 1 会话'));
    // enter 切焦：registry.focus 只投影不开驱动 → repaint 回读 s1 历史
    // （user 块 '> ' 锚形与清单行标题形可区分）
    second.io.send('\r');
    await until(() => stripAnsi(second.io.output).includes('› 旧会话探针')); // 切焦重画（投影回读——'› ' 前缀锚与清单行标题形可区分）
    await until(() => second.io.output.includes('\x1b[?1049l')); // 副屏收面（回主屏）
    expect(second.faux.state.callCount).toBe(0); // 切焦不达模型（投影非 run）
    // 无驱动会话直接提交：onSubmit 补开（manager.open）→ submitText 真达模型
    // （submitText 对未开会话返 undefined——补开位缺席即提交静默丢，本断言即锁）
    second.io.send('续问探针\r');
    await until(() => second.faux.state.callCount >= 1); // 补开 + 提交全链达模型
    await until(() => second.io.output.includes('ok'));
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });

  it('/new 切焦全链（命令面增补批 C2——07 §4.1 逐件语义 1）：同 cwd 建新会话即切焦 + OSC title 短 id 更新 + 零事件不在 /sessions 清单', async () => {
    const dataDir = rigDir('entry-new-data-');
    const ws1 = rigDir('entry-new-ws1-');

    // 首启：一轮对话落库（s1 有库行）退出
    const first = await rigEntry(dataDir, ws1);
    first.io.send('旧会话探针\r');
    await until(() => first.faux.state.callCount >= 1);
    await until(() => first.io.output.includes('ok'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);

    // 二启：同 cwd 续接 s1（按 cwd 取最新）；带参形用法 fail-loud（/exit 律不穿透）
    const second = await rigEntry(dataDir, ws1);
    await until(() => stripAnsi(second.io.output).includes('› 旧会话探针')); // resume 历史回读（s1 在焦——'› ' 前缀锚形）
    second.io.send('/new extra\r');
    await until(() => second.io.output.includes('/new 不带参数')); // 用法 fail-loud（未切焦——零参命中才执行）
    // /new：同 cwd 建新会话即切焦（registry.focus 既有权威路——/sessions 选定
    // 同路）+ notify 回执一行（新会话短 id）
    second.io.send('/new\r');
    await until(() => second.io.output.includes('新会话：'));
    const short = /新会话：([0-9a-f]{8})/.exec(second.io.output)?.[1]; // 回执短 id（uuid v7 首 8 位）
    expect(short).toBeDefined();
    // 切焦可见位（V-3 注⑦②——footer 短 id 段退役）：OSC title 短 id 更新
    // （切焦 repaint 驱动——终端级外显位承接）
    await until(() => second.io.output.includes(` · ${short}`));
    // 零事件新会话不在 /sessions 清单——库行真源律已知边界（createSession 零
    // I/O、行随首事件落库——05 §1.2/§6.3 write-behind；OSC title 短 id 即其
    // 可见位，非缺陷）：清单恰 1 行 = s1（旧会话不动可回切）
    second.io.send('/sessions\r');
    await until(() => second.io.output.includes('⇄ 会话切换 · 1 会话'));
    second.io.send('q'); // q text 轨收副屏（独立 ESC 字节有序列等待窗——避并包歧义）
    await until(() => second.io.output.includes('\x1b[?1049l'));
    // 新会话可用（create 已开驱动——提交直达模型，首事件落库后清单即两行）
    second.io.send('新会话探针\r');
    await until(() => second.faux.state.callCount >= 1);
    await until(() => second.io.output.includes('ok'));
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });

  it('/plugins 尾参位活体补全（命令面增补批 C2——plugin-load-report 接线兑现）：活体 id 列弹层', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-pl-id-data-'), rigDir('entry-pl-id-ws-'));
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门
    const before = io.output.length;
    // 进 id 尾参位首字符（/plugins toggle c——tokenAtCursor 紧邻空白无 token，
    // 弹层只在真 token 上起查）：接线前 pluginReport 缺席归静态面（id 位无静
    // 态候选 = 零弹层）；接线后活体 id 列（activated ∪ skipped——装载面真源）
    // 经 20ms 防抖落层呈现
    io.send('/plugins toggle c');
    await until(() => io.output.slice(before).includes('core:'));
    io.send('\x15'); // ctrl+u 删至行首（弹层对带修饰键穿透——直达编辑器；清框后才过 ctrl+d 空框退出门；不用 escape——独立 ESC 字节在解码器有序列等待窗，会与后续字节并成 alt 形）
    io.send('\x04');
    expect(await entry).toBe(0);
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
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
      onWebuiOpen: (info) => {
        opened = info;
      },
    });
    await io.ready();
    await until(() => opened !== undefined); // 面起（onOpen 回执）
    try {
      // 横幅经 channels.notify 扇出上屏：URL 在场、token 不在（屏流可回滚——
      // 非披露通道；令牌仅 stderr 一次性）
      await until(() => io.output.includes('Web 界面已开启'));
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

  // —— 档位装配面单源锁（第九役遗漏扫描批 C1——2026-09-19）：两表迁
  // session-tier-copy 单源件后 webui 腿有三重对拍锁（webui-bridge.test 行集
  // toEqual × 单源表 + 回执 === helper），TUI 装配闭包腿零锁（tui-backend
  // 测试用本地自造夹具锁渲染器不锁装配、e2e 锚只到计数头 + 档位词 + 回执
  // 前缀——detail 列垃圾 / 回执绕 helper 内联两形全不红）。本两测经真装配
  // 闭包锁「行集 detail 列 + 回执全文」两形（03 §10.4「两装配面同源消费」
  // 单源律的 TUI 腿断言真空收口）。
  it('/thinking 装配单源锁：行集 detail 列单源表直出（关闭思考）+ 选定回执全文 = 单源 helper 逐字符', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-tier-t-data-'), rigDir('entry-tier-t-ws-'));
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门
    io.send('/thinking\r');
    await until(() => io.output.includes('深度思考 · 7 级')); // 副屏开屏（头行锚）
    // detail 列 = session-tier-copy 单源表直出（off 行独有词「关闭思考」——
    // 装配闭包传垃圾列 / 两表错配时此词缺席即红）
    expect(io.output).toContain('关闭思考');
    // End 一步跳尾档 max（'\x1b[4~' xterm 双形——input-keys TILDE_KEYS 收录）
    // + Enter 选定 → 回执全文上 footer 右段
    io.send('\x1b[4~');
    io.send('\r');
    // 回执全文逐字符 = 单源 helper（绕 helper 内联模板漂移尾句即红——全文
    // 只经 selectThinking → thinkingLevelReceipt 产出）
    await until(() => io.output.includes(thinkingLevelReceipt('max')));
    expect(io.output).toContain('思考级别：max（下一轮对话起生效；该级别是否生效随模型能力）');
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/sandbox 装配单源锁：danger 行警示语 07 §4.1 钉死句 + 选定回执全文 = 单源 helper 逐字符', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-tier-s-data-'), rigDir('entry-tier-s-ws-'));
    await until(() => io.output.includes('工作区写 · '));
    io.send('/sandbox\r');
    await until(() => io.output.includes('沙箱 · 3 级'));
    // danger 行警示语 = 07 §4.1 钦定措辞（07 §4.1 danger 档行说明位文案钉死
    // 「无沙箱——任何命令直跑宿主」——第三档语义不粉饰）
    expect(io.output).toContain('无沙箱——任何命令直跑宿主');
    io.send('\x1b[4~'); // End → 尾档 danger
    io.send('\r');
    await until(() => io.output.includes(sandboxModeReceipt('danger')));
    expect(io.output).toContain('沙箱模式：danger（即刻生效于后续工具调用）');
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  // —— footer 档位段装配锁（三反馈批B——2026-09-21）：tiers pull 闭包经本件
  // 装配注入——常驻段拼沙箱短词（栈基线 workspace-write → SANDBOX_MODE_SHORT
  // 单源「工作区写」）；thinking 无锚（tui-entry 不传档位 → stack.thinkingLevel
  // undefined——诚实缩位不虚报）；选定档位经 backend.refreshFooter() 公开刷新
  // 锚即时换段（拍板 #9：回执保留，footer 段即时收敛——两载体各司其职）。
  it('footer 档位段装配锁（批B）：沙箱短词常驻 + thinking 无锚缩位 + 选定即时换段', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-tier-b-data-'), rigDir('entry-tier-b-ws-'));
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门
    // 沙箱段 = 短词表单源直出（分隔形锚——装配闭包传垃圾词/两表错配即红）
    expect(io.output).toContain('工作区写 · '); // 沙箱段居首（界面美化役批6 段序——前无分隔符）
    // thinking 无锚缩位：七档短词「思考X」形零出现（footer 段位只可能来自
    // THINKING_LEVEL_SHORT——本测不开 /thinking 面无 detail 词族混入）
    expect(io.output).not.toContain('思考关');
    expect(io.output).not.toContain('思考高');
    // 选定切换即时刷：/sandbox → End(danger) → Enter → 回执落定 + footer 段
    // 翻「无沙箱」（' · ' 分隔形 = footer 段独有锚——面板 detail 行是「无沙箱
    // ——」连缀形不撞此锚）
    io.send('/sandbox\r');
    await until(() => io.output.includes('沙箱 · 3 级'));
    io.send('\x1b[4~');
    io.send('\r');
    await until(() => io.output.includes(sandboxModeReceipt('danger')));
    await until(() => io.output.includes('无沙箱 · ')); // 沙箱段居首形（换档后同位）
    // 行1 换词（MODE_SHORT danger → YOLO）经真装配锁（lane-C 件3——此前
    // danger 换词零真映射锚、测试自注入绕换词表，改 MODE_SHORT danger 值不红）；
    // 与上行行2 原词（无沙箱）同帧 = 两表示一致性（07 §4.1 注⑪③ 用户拍板
    //「两行都保留原词」——换词/原词两表分职的装配面双锚）
    expect(io.output).toContain('YOLO');
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  // —— 启动动画接线锁（三反馈批D——2026-09-21）：先行件2 供数面（onBootStage/
  // onPluginLoadStart——assembly emitBootStage）经本件装配位接 BootAnimation；
  // 进屏序 = cooked 窗动画行（零 CSI/OSC 纯文本）→ raw 窗屏本体（footer）——
  // 两窗序由「io 先于装配构造 + 动画行直写 io」结构性保证（07 :204 射程分立）。
  it('启动动画接线锁（批D）：阶段行先于 footer 进屏（cooked→raw 两窗序）', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-boot-a-data-'), rigDir('entry-boot-a-ws-'));
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门（raw 窗首帧）
    const out = io.output;
    expect(out).toContain('berry-agent vtest'); // 头行（版本 = 入口 options.version 透传）
    expect(out).toContain('✓ 就绪'); // 六阶段收尾行
    expect(out).toContain('› 加载 '); // 插件装载行（noPlugins:false——core 件在册）
    // 两窗序：动画行全部先于 footer（raw 窗屏本体）
    expect(out.indexOf('berry-agent vtest')).toBeLessThan(out.indexOf('工作区写 · '));
    expect(out.indexOf('✓ 就绪')).toBeLessThan(out.indexOf('工作区写 · '));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('BERRY_AGENT_TIMING 打点门接线锁（批D）：门开 sink 收段汇总；门关零写出', async () => {
    // 门开：env 置 '1' + bootTimingSink 注入面收账（测试零 stderr 污染）；
    // finish 在装配返回点即收尾——footer 就绪时汇总已落 sink
    const on: string[] = [];
    const first = await rigEntry(rigDir('entry-boot-t1-data-'), rigDir('entry-boot-t1-ws-'), {
      env: { BERRY_AGENT_TIMING: '1' },
      bootTimingSink: (text) => on.push(text),
    });
    await until(() => first.io.output.includes('工作区写 · '));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);
    const diag = on.join('');
    expect(diag).toContain('--- 启动计时 ---');
    expect(diag).toContain('TOTAL: ');
    // 门关（缺省 rig env 无 TIMING 键）：注入面在场也零写出（env 门 = 唯一开关）
    const off: string[] = [];
    const second = await rigEntry(rigDir('entry-boot-t2-data-'), rigDir('entry-boot-t2-ws-'), {
      bootTimingSink: (text) => off.push(text),
    });
    await until(() => second.io.output.includes('工作区写 · '));
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
    expect(off).toEqual([]);
  });

  // —— TUI 切档跨通道回执扇出锁（第九役遗漏扫描批 C2——2026-09-19）：
  // CR-TIER-3 裁决①「TUI 切档→webui 可见 / webui 切档→TUI 状态行可见，
  // 两向对称」（03 §10.4 webui 档位面受理批注）；修前 TUI selectThinking/
  // selectSandbox 走 backend.setStatus 单通道直达（TuiBackend 状态行独收），
  // webui 半边落空——双开形态下 webui SSE 观众永无 status 帧。修 = 改走
  // stack.channels.setStatus（通道核扇出全部 capable 后端——TUI 状态行照常
  // + webui SSE 观众同收）。修前红实证：本测 untilFrame 超时收不到 status 帧。
  it('TUI 切档跨通道回执：webui 双开形态下 /thinking 选定 → SSE status 帧达 webui 观众（CR-TIER-3 两向对称 TUI→webui 半边）', async () => {
    const faux = fauxProvider({ provider: 'faux-tier-fanout', models: [{ id: 'm1' }] });
    faux.setResponses([() => messageOf()]);
    const io = new FakeTerminalIO();
    let opened: { host: string; port: number; token: string } | undefined;
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false, port: 0 },
      io,
      cwd: rigDir('entry-tier-f-ws-'),
      version: 'test',
      dataDir: rigDir('entry-tier-f-data-'),
      providers: [faux.provider],
      model: 'faux-tier-fanout/m1',
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
      onWebuiOpen: (info) => {
        opened = info;
      },
    });
    await io.ready();
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪（webui 已开面）
    expect(opened).toBeDefined();
    // 首事件落库（会话行进 /api/sessions 清单——SSE 订阅位取全量 id；
    // footer 短 id 是 uuid 前 8 位非全量，故走清单端点取真源）
    io.send('档位扇出探针\r');
    await until(() => io.output.includes('ok'));
    // 取全量会话 id（footer 短 id 是 uuid 前 8 位非全量——走清单端点取真源；
    // 本文件 until 只收同步谓词，异步轮询手写有界循环）
    let sessionId = '';
    const listDeadline = Date.now() + 2000;
    while (sessionId === '') {
      if (Date.now() > listDeadline) throw new Error('sessions 清单未达（首事件落库超时）');
      const res = await fetch(`http://127.0.0.1:${opened!.port}/api/sessions`, {
        headers: { authorization: `Bearer ${opened!.token}` },
      });
      const body = (await res.json()) as { sessions: Array<{ id: string }> };
      sessionId = body.sessions[0]?.id ?? '';
      if (sessionId === '') await tick();
    }
    // SSE 开流在切档前（首帧不漏）；档位事件是 SessionEvent 不走信封族——
    // 切档后流上唯一新帧即 status 帧（扇出半边的判据帧）
    const controller = new AbortController();
    const sseRes = await fetch(`http://127.0.0.1:${opened!.port}/api/sessions/${sessionId}/events`, {
      headers: { authorization: `Bearer ${opened!.token}` },
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);
    // TUI 侧切档（真装配闭包全链：/thinking 开副屏 → End 跳尾档 max →
    // Enter 选定 → selectThinking → setStatus 扇出）
    io.send('/thinking\r');
    await until(() => io.output.includes('深度思考 · 7 级'));
    io.send('\x1b[4~');
    io.send('\r');
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    // 帧流读至 status 帧（有界 5s——修前单通道直达形在此超时红：流上永无
    // status 帧；read 与 200ms 心跳 race 防无帧期挂死）
    const deadline = Date.now() + 5000;
    let statusPayload: string | undefined;
    while (statusPayload === undefined) {
      if (Date.now() > deadline) throw new Error('SSE 未达 status 帧（TUI→webui 跨通道扇出缺席）');
      const chunk = await Promise.race([
        reader.read(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 200)),
      ]);
      if (chunk === undefined) continue; // 心跳拍——回环重查期限
      if (chunk.done) break;
      acc += decoder.decode(chunk.value, { stream: true });
      for (const block of acc.split('\n\n')) {
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine === undefined) continue; // ping 注释行
        try {
          const frame = JSON.parse(dataLine.slice(6)) as { kind?: string; payload?: { status?: string } };
          if (frame.kind === 'status') statusPayload = frame.payload?.status;
        } catch {
          // 半帧尾——续读拼齐
        }
      }
    }
    // status 帧载荷 = 回执单源 helper 逐字符（TUI footer 右段与 webui SSE 两位同文）
    expect(statusPayload).toBe(thinkingLevelReceipt('max'));
    controller.abort();
    io.send('\x04');
    expect(await entry).toBe(0);
  });
});

describe('键位三件装配（挂账解挂批 2026-09-15——alt+enter 候跑 / ctrl+p 模型循环）', () => {
  /** 双模型 rig（循环序可观测——m1 → m2 → m1） */
  async function rigTwoModelEntry(dataDir: string, cwd: string) {
    const faux = fauxProvider({ provider: 'faux-key3', models: [{ id: 'm1' }, { id: 'm2' }] });
    const io = new FakeTerminalIO();
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io,
      cwd,
      version: 'test',
      dataDir,
      providers: [faux.provider],
      model: 'faux-key3/m1',
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
    });
    await io.ready();
    return { entry, io, faux };
  }

  it('alt+enter 候跑全链：busy 期排队回执上屏 + run 终态候跑文种子新 run', async () => {
    const { entry, io, faux } = await rigTwoModelEntry(rigDir('entry-qf-'), rigDir('entry-ws-qf-'));
    // 首 run 迟响应（Promise 工厂延迟——busy 窗口可控制）；次 run 即答
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const userTextsByCall: string[][] = [];
    faux.setResponses([
      async (context) => {
        userTextsByCall.push(
          context.messages.filter((m) => m.role === 'user').map((m) => String((m as { content: unknown }).content)),
        );
        await firstGate;
        return messageOf();
      },
      (context) => {
        userTextsByCall.push(
          context.messages.filter((m) => m.role === 'user').map((m) => String((m as { content: unknown }).content)),
        );
        return messageOf();
      },
    ]);
    io.send('一问\r');
    await until(() => faux.state.callCount >= 1); // 首 run 在飞（响应挂起——busy 窗口）
    io.send('候跑问');
    io.send('\x1b[13;3u'); // alt+enter（kitty 形）——候跑提交
    await until(() => io.output.includes('已排队（当前回复结束后自动开始）')); // 排队回执一行（notify 面）
    expect(faux.state.callCount).toBe(1); // 候跑未顶注在飞 run（零新调用）
    releaseFirst(); // 首 run 放行——候跑件种子新起 run
    await until(() => faux.state.callCount >= 2);
    io.send('\x04');
    expect(await entry).toBe(0);
    // 第二请求才含候跑文（新 run 种子——与首 run 分叉）
    expect(userTextsByCall[1]!.some((t) => t === '候跑问')).toBe(true);
    expect(userTextsByCall[0]!.some((t) => t === '候跑问')).toBe(false);
  });

  it('ctrl+p 模型循环全链：notify 回执 + footer 模型段换新 + 下一 run 用新模型', async () => {
    const { entry, io, faux } = await rigTwoModelEntry(rigDir('entry-mc-'), rigDir('entry-ws-mc-'));
    const modelsByCall: string[] = [];
    // 模型观测位 = faux 工厂第 4 参（pi-ai FauxResponseFactory 形参序——
    // options 第 2 参无 model 键，实测 keys 仅 apiKey/headers/env；原断言位
    // 恒红属测试自伤，随本批勘正——同段数据路批测试勘正先例）
    const observeModel = (_c: unknown, _o: unknown, _s: unknown, model: unknown) => {
      const m = model as { provider?: string; id?: string } | undefined;
      modelsByCall.push(`${m?.provider ?? ''}/${m?.id ?? ''}`);
      return messageOf();
    };
    faux.setResponses([observeModel, observeModel]);
    io.send('一问\r'); // m1 run
    await until(() => modelsByCall.length >= 1);
    io.output = ''; // 切换帧起收窗（此前帧恒含旧短名 footer——判别锚窗口必须在切换之后）
    io.send('\x10'); // ctrl+p——模型循环（m1 → m2）
    await until(() => io.output.includes('模型已切换')); // notify 回执行
    // V-4 注⑪② 判别性锁（setFooterModel 双入口之一——onModelCycle）：' · m2'
    // 连接符形只在 footer 行1 帧本体——回执文本恒含全形 faux-key3/m2，旧
    // toContain('m2') 是 vacuous（回执单载体即可过）；键分派同步于 io.send
    // （收窗后任何帧不可再持旧短名 ' · m1'——换出即证活写非残留）
    await until(() => stripAnsi(io.output).includes(' · m2'));
    expect(stripAnsi(io.output)).not.toContain(' · m1'); // 旧短名换出
    io.send('二问\r'); // 下一 run 起跑消费新模型
    await until(() => modelsByCall.length >= 2);
    io.send('\x04');
    expect(await entry).toBe(0);
    expect(modelsByCall[0]).toContain('m1');
    expect(modelsByCall[1]).toContain('m2'); // 生效语义 = 下一 run 起跑
  });

  it('/model 面板全链：命令开屏 + 分组头/当前 ● + ↓ enter 选定回执 + footer 模型段活写（V-4 注⑪② 回迁）', async () => {
    // 2026-09-30 UX 对标批 ux-4：/model 命令 → ModelPicker 副屏 → 选定回调
    // 装配闭包（setModel + notify 回执）整链锁——面板件单测（model-picker.test）
    // 锁件内键路，本测锁「命令拦截 → openModelPicker → 装配闭包」三段接线
    // （缺一段即红：命令不拦截无开屏头锚、回调未接无回执）。V-4 笔3 起
    // footer 行1 模型段回迁（注⑪②——setFooterModel 双入口之二），选定后
    // footer 帧本体与回执双载体并行（下方判别性锁）。
    const { entry, io } = await rigTwoModelEntry(rigDir('entry-mp-'), rigDir('entry-ws-mp-'));
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门（当前模型 m1）
    io.send('/model\r');
    await until(() => io.output.includes('切换模型 · 2 个')); // 副屏开屏（头行锚——两模型全列）
    // provider 分组头 + 条目全列（面板呈现两件——ctrl+p 循环宇宙同清单单源）
    expect(io.output).toContain('── faux-key3 ──');
    expect(io.output).toContain('faux-key3/m1');
    expect(io.output).toContain('faux-key3/m2');
    io.send('\x1b[B'); // ↓ 光标至 m2（移帧落定门——条目行左段单 writeText，'›   全形' 连续可锚）
    await until(() => stripAnsi(io.output).includes('›   faux-key3/m2'));
    io.send('\r'); // enter 选定——先收副屏再回调（closeAlt 复屏重画帧持旧短名，属回执位之前）
    await until(() => io.output.includes('模型已切换：faux-key3/m2'));
    // V-4 注⑪② 判别性锁（setFooterModel 双入口之二——selectModel）：回执字节
    // 位起开窗——' · m2' 连接符形只在 footer 行1 帧本体（回执/面板条目恒全形
    // faux-key3/m2〔右段裸名无连接符〕不可作证）；复屏重画帧与回执行同帧序前
    // 于 footer 段（flush 先执行 op 队列后重建固定区），旧短名 ' · m1' 只可能
    // 出现在回执位之前——窗后仍在即活写失效
    const afterReceipt = stripAnsi(io.output.slice(io.output.indexOf('模型已切换：faux-key3/m2')));
    expect(afterReceipt).toContain(' · m2'); // 新短名入帧
    expect(afterReceipt).not.toContain(' · m1'); // 旧短名换出
    io.send('\x04');
    expect(await entry).toBe(0);
  });
});

describe('--no-plugins 自救链入口腿（E14——坏插件现场锁死 → 安全模式起得来）', () => {
  /**
   * 坏插件现场速记：启用清单 yaml 坏形（fail-loud 拒启——装载读侧唯一
   * 「锁死启动」形；行级隔离形〔清单坏/入口抛错〕不拦启动不属本链）。与
   * assembly.test「启用清单损坏」/ serve-entry.test「坏形清单 fail-loud 退 1」
   * 同款最轻构造——单文件一笔，覆盖前各层已有、入口层缺（E14 补口）。
   */
  function rigCorruptEnabledYaml(): string {
    const dataDir = rigDir('entry-rescue-data-');
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins: [ Oops'); // yaml 坏形
    return dataDir;
  }

  it('对照组（不带 flag）：坏插件现场锁死启动——退 1 + stderr 可见回执（修复指引）+ TUI 屏零输出', async () => {
    const io = new FakeTerminalIO();
    // stderr 收窄观察位（core-plugins.test console.error spy 同法——只截文本
    // 不改语义面；恢复恒走 finally）。回执是宿主 fail-loud 文案非 AI 生成文本，
    // 断言锚「启动失败」档前缀与现场文件名（结构标记非逐字全文）
    let stderrText = '';
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: Uint8Array | string) => {
      stderrText += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    });
    try {
      const faux = fauxProvider({ provider: 'faux-lock', models: [{ id: 'm1' }] });
      const code = await runTuiEntry({
        flags: { noPlugins: false, debug: false },
        io,
        cwd: rigDir('entry-rescue-ws-lock-'),
        version: 'test',
        dataDir: rigCorruptEnabledYaml(),
        providers: [faux.provider],
        model: 'faux-lock/m1',
        env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
      });
      expect(code).toBe(1); // 锁死：非零退出——正常起跑被装载读侧拦死
      expect(stderrText).toContain('启动失败'); // 可见回执（用户可自修档呈报）
      expect(stderrText).toContain('enabled.yaml'); // 修复指引指向现场文件
      // TUI 屏从未起（backend.start 未达——锁死证据）：批D 起动面后输出 =
      // 纯文本动画行恰集（头行 + 已完成阶段行——失败路部分阶段留存语义），
      // 屏本体（raw 窗首帧 CSI 面）零字节
      expect(io.output).toBe('berry-agent vtest\n✓ 运行时\n✓ 会话栈\n');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('自救腿（--no-plugins）：同一坏现场起得来——插件零装载（披露段 0/0/0）+ 会话全链照跑 + 现场文件不被触碰', async () => {
    const dataDir = rigCorruptEnabledYaml(); // 与对照组同一坏现场（自救起点）
    const faux = fauxProvider({ provider: 'faux-rescue', models: [{ id: 'm1' }] });
    faux.setResponses([() => messageOf(), () => messageOf()]);
    const io = new FakeTerminalIO();
    // 运行时捕获（入口注入面 onRuntime——披露段计数的读取位）
    let runtimeRef: HostRuntime | undefined;
    const entry = runTuiEntry({
      flags: { noPlugins: true, debug: false }, // 安全模式：装载面整跳（读侧之前短路——坏清单不再拦）
      io,
      cwd: rigDir('entry-rescue-ws-live-'),
      version: 'test',
      dataDir,
      providers: [faux.provider],
      model: 'faux-rescue/m1',
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
      onRuntime: (rt) => void (runtimeRef = rt),
    });
    // 起得来：装配序全通（含装载段旁路）——输入管线挂接即屏已起；与入口终态
    // 竞速（旁路缺失形 = 入口先退 1，此处即快速红——不靠挂钟超时兜底）
    await Promise.race([
      io.ready(),
      entry.then((code) => {
        throw new Error(`自救失败：入口先终态（退出码 ${code}）——TUI 屏未起`);
      }),
    ]);
    // 插件零装载的入口级证据：披露段插件计数行（04 §environment 钉形「插件 N
    // 个（启用 M · 失败 F）」）——core: 与用户行都不装（io.ready 已过 = boot
    // 完成点，计数匣为终值非初值）
    expect(runtimeRef).toBeDefined();
    expect(runtimeRef!.disclosure()).toContain('- 插件: 0 个（启用 0 · 失败 0）');
    // 会话/入口正常起跑：提交流转全链照跑（零插件形态对话本体不受累）
    io.send('自救探针\r');
    await until(() => faux.state.callCount >= 1); // 全链达模型
    await until(() => io.output.includes('ok')); // 应答上屏
    io.send('\x04');
    expect(await entry).toBe(0);
    // 自救 = 旁路不修盘：坏现场原样保留（用户退出安全模式后自行修复——本腿
    // 不代写用户配置）
    expect(readFileSync(join(dataDir, 'enabled.yaml'), 'utf8')).toBe('plugins: [ Oops');
  });
});

describe('启动版本检查腿接线（07 §8.5 第 6 条——2026-09-19 启动版本检查批）', () => {
  /** 接线测试速记（注入桩替换整腿——零网络零 spawn；faux provider + 假终端） */
  async function rigUpdateEntry(
    dataDir: string,
    startupUpdateCheck: Parameters<typeof runTuiEntry>[0]['startupUpdateCheck'],
    manualUpdateCheck?: Parameters<typeof runTuiEntry>[0]['manualUpdateCheck'],
    version = 'test', // 判序腿要 semver 形版本时覆写（'test' 非 semver → 恒「已是最新」支）
  ) {
    const faux = fauxProvider({ provider: 'faux-upd', models: [{ id: 'm1' }] });
    const io = new FakeTerminalIO();
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io,
      cwd: rigDir('entry-upd-ws-'),
      version,
      dataDir,
      providers: [faux.provider],
      model: 'faux-upd/m1',
      env: {}, // 注桩腿不读 env——关断键不设（桩即真腿，别处关断形已有专测）
      startupUpdateCheck,
      // 注入面缺省即真腿（?? 语义）——未注桩时不得传 undefined 键（显式
      // undefined 同缺席，但条件展开零键更诚实：读 options 即知桩形）
      ...(manualUpdateCheck !== undefined ? { manualUpdateCheck } : {}),
    });
    await io.ready();
    return { entry, io };
  }

  it('有新版且未提示过 → notify 一行 + notifiedVersion 落账（去重基线）', async () => {
    const dataDir = rigDir('entry-upd-data-');
    const { entry, io } = await rigUpdateEntry(dataDir, async () => ({
      kind: 'checked' as const,
      latest: '9.9.9',
      hasUpdate: true,
      alreadyNotified: false,
    }));
    await until(() => io.output.includes('新版本 9.9.9 可用——/update 查看详情'));
    // 提示形完整句锁（§8.5 第 6 条）：notify 一行含指路与升级动作——
    // 用户不看 /update 也知道下一步
    expect(io.output).toContain('退出后执行 berry update');
    io.send('\x04');
    expect(await entry).toBe(0);
    // 落账走真实 fs 面（temp dataDir）：notifiedVersion = 提示过的那版
    const state = JSON.parse(readFileSync(join(dataDir, 'update-check.json'), 'utf8')) as {
      notifiedVersion?: string;
    };
    expect(state.notifiedVersion).toBe('9.9.9');
  });

  it('该版已提示过（alreadyNotified）→ 零提示（按版本去重律）', async () => {
    let decided = false;
    const { entry, io } = await rigUpdateEntry(rigDir('entry-upd-dup-'), async () => {
      decided = true;
      return { kind: 'checked' as const, latest: '9.9.9', hasUpdate: true, alreadyNotified: true };
    });
    await until(() => decided); // 决策已出（notify 分支微任务随之冲完）
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(io.output).not.toContain('新版本');
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('网络失败 → 零提示零噪音（失败静默律——决策不消费即无 notify 无落账）', async () => {
    let decided = false;
    const dataDir = rigDir('entry-upd-fail-');
    const { entry, io } = await rigUpdateEntry(dataDir, async () => {
      decided = true;
      return { kind: 'failed' as const, message: 'offline' };
    });
    await until(() => decided);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(io.output).not.toContain('新版本');
    io.send('\x04');
    expect(await entry).toBe(0);
    // 失败不落账（update-check.json 缺席——下次启动照查不被钉窗）
    expect(existsSync(join(dataDir, 'update-check.json'))).toBe(false);
  });

  it('/update 薄壳：检查回执 + registryFallback 注记在场（回退官方源不静默吞——CLI 腿同句单源）', async () => {
    const dataDir = rigDir('entry-upgrade-fb-');
    const { entry, io } = await rigUpdateEntry(
      dataDir,
      async () => ({ kind: 'skipped' as const, reason: 'env-off' as const }),
      async () => ({ kind: 'ok' as const, latest: '9.9.9', registryFallback: true }),
      '0.1.0', // semver 版本——判序走「新版本」支（指引文案同锁）
    );
    io.send('/update\r');
    await until(() => io.output.includes('新版本 9.9.9'));
    expect(io.output).toContain('退出后执行 berry update'); // 指引支文案
    // 回退官方源注记跟着回执走（注记单源在 upgrade.ts 常量——两腿同源律呈报位）
    await until(() => io.output.includes('回退官方源'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/update 薄壳：已是最新如实说 + fallback 缺席零注记（两向锁）', async () => {
    const dataDir = rigDir('entry-upgrade-ok-');
    const { entry, io } = await rigUpdateEntry(
      dataDir,
      async () => ({ kind: 'skipped' as const, reason: 'env-off' as const }),
      async () => ({ kind: 'ok' as const, latest: '0.1.0', registryFallback: false }),
    );
    io.send('/update\r');
    await until(() => io.output.includes('已是最新'));
    expect(io.output).toContain('远端 latest 0.1.0');
    expect(io.output).not.toContain('回退官方源'); // fallback 缺席不虚报注记
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/update 薄壳：latest 非 semver 形诚实拒——白名单门先于判序不落「已是最新」诚实谎（第十一役 D——修前红：坏串直达判序 cmp null 落已是最新支）', async () => {
    const dataDir = rigDir('entry-upgrade-bad-');
    const { entry, io } = await rigUpdateEntry(
      dataDir,
      async () => ({ kind: 'skipped' as const, reason: 'env-off' as const }),
      async () => ({ kind: 'ok' as const, latest: 'v99.0.0-beta+meta', registryFallback: false }),
    );
    io.send('/update\r');
    // 诚实拒支：非 semver latest 是坏应答不是「无更新」——修前 cmp null 落
    // else 支报「已是最新」（诚实谎——与启动腿 upgrade.ts TARGET_RE 白名单
    // 门同律：白名单先于判序，非 semver latest「已是最新」判据不成立）
    await until(() => io.output.includes('版本检查失败'));
    expect(io.output).toContain('格式不对');
    expect(io.output).not.toContain('已是最新');
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/update 检查腿 reject：错误码随回执直呈（foldErrorText 单源——修前红：String(err) 形落 Error: 前缀丢码）', async () => {
    const { entry, io } = await rigUpdateEntry(
      rigDir('entry-upd-code-'),
      async () => ({ kind: 'skipped' as const, reason: 'env-off' as const }),
      // 检查腿炸（probe reject 形）：BaseError 折 `code：message`——修前
      // String(err) 只得 'Error: 检查腿炸了'（BaseError 无 toString 覆写，码丢失）
      () => Promise.reject(new BaseError('SDK_TRANSPORT', '检查腿炸了')),
    );
    io.send('/update\r');
    await until(() => io.output.includes('版本检查异常：SDK_TRANSPORT：检查腿炸了'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });
});

describe('启动引导面板（ob-2——07 §4.1 呈现面件 11 双层制第一层）', () => {
  it('unconfigured：面板行落屏（provider 点名 + --model-provider 指路）+ s 跳过后主屏照常起', async () => {
    const dataDir = rigDir('tui-onboard-skip-data-');
    const ws = rigDir('tui-onboard-skip-ws-');
    const keys = ['s'];
    const { entry, io } = await rigEntry(dataDir, ws, {
      // 注入键源 = 面板测试形（产线真身 = io raw 窗一键——注入面先例族）
      onboardingKey: async () => keys.shift() ?? 'q',
    });
    expect(io.output).toContain('还没配置 API key'); // cooked 窗面板行
    expect(io.output).toContain('--model-provider faux-entry'); // ob-1 录入位指路（provider 点名）
    io.send('\x04'); // ctrl+d 空框退出
    expect(await entry).toBe(0);
  });

  it('q 决策：不起 TUI 干净退 0（主屏零武装——无进屏字节；不经 rigEntry 因 io.ready 永不resolve）', async () => {
    const dataDir = rigDir('tui-onboard-quit-data-');
    const ws = rigDir('tui-onboard-quit-ws-');
    const faux = fauxProvider({ provider: 'faux-entry', models: [{ id: 'm1' }] });
    const io = new FakeTerminalIO();
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io,
      cwd: ws,
      version: 'test',
      dataDir,
      providers: [faux.provider],
      model: 'faux-entry/m1',
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
      onboardingKey: async () => 'q',
    });
    expect(await entry).toBe(0); // 面板 q 直接收口（backend 未起）
    expect(io.output).not.toContain('\x1b[?2004h'); // bracketed paste 进屏字节缺席 = 未起屏证
    expect(io.output).toContain('还没配置 API key'); // 面板行仍落屏（先写后读）
  });

  it('ready 态（env 键在场）：面板缺席直进主屏（键源零调用）', async () => {
    const dataDir = rigDir('tui-onboard-ready-data-');
    const ws = rigDir('tui-onboard-ready-ws-');
    let keyCalled = false;
    const { entry, io } = await rigEntry(dataDir, ws, {
      env: { FAUX_ENTRY_API_KEY: 'ready-key' }, // 供血判据 env 位就绪（faux-entry 一般律键名）
      onboardingKey: async () => {
        keyCalled = true;
        return 'q';
      },
    });
    await io.ready(); // 主屏照常起（ready 态面板整段缺席）
    expect(io.output).not.toContain('模型凭证未配置');
    expect(keyCalled).toBe(false); // 键源零调用 = 面板零进入
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  // #12（major——07 §8.4 豁免同步）：自定义渠道 unconfigured 时引导面板不得呈
  // 「export <ID>_API_KEY=」例键——env 永不生效（绑定行唯一供血），指路即误导
  it('#12 自定义渠道引导面板免呈 env 例键：绑定行途径独呈（修前红：MY_GW_API_KEY 例键行在场）', async () => {
    const dataDir = rigDir('tui-onboard-custom-data-');
    const ws = rigDir('tui-onboard-custom-ws-');
    writeFileSync(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        customProviders: {
          'my-gw': { protocol: 'openai-completions', baseUrl: 'https://gw.example.test/v1', models: ['m1'] },
        },
      }),
    );
    const keys = ['s'];
    const { entry, io } = await rigEntry(dataDir, ws, {
      model: 'my-gw/m1', // 当前模型停自定义渠道（豁免集在场：env 判据不合成 + 绑定行无 → unconfigured）
      onboardingKey: async () => keys.shift() ?? 'q',
    });
    expect(io.output).toContain('还没配置 API key'); // 面板行（unconfigured 检测腿命中）
    expect(io.output).toContain('渠道 my-gw'); // 供血目标点名
    // 修前红：env 例键行在场（providerApiKeyEnvNames 无条件合成 MY_GW_API_KEY
    // ——该指路对自定义渠道永不生效）
    expect(io.output).not.toContain('MY_GW_API_KEY');
    // envExample 缺席序号重排：途径首条（「1.」位）= 凭证表绑定行（唯一有效途径）
    expect(io.output).toContain('1. 保存 API key 给该渠道用');
    io.send('\x04'); // ctrl+d 空框退出
    expect(await entry).toBe(0);
  });
});

describe('readSingleKeyFromIo lone-ESC 判定窗（产线单键读真身——SSH 高延迟/tmux 拆片防线）', () => {
  it('分片转义序列（\\x1b 与 [A 两 chunk 相邻到达）→ unknown 归一不冒充 esc（修前红：首片即决回 escape 即踢出面板）', async () => {
    const io = new FakeTerminalIO();
    const read = readSingleKeyFromIo(io);
    io.send('\x1b');
    // 首片决议微任务冲完 + 续片窗订阅落位（真实传输两 data 事件本就异拍——
    // 微任务间隔是物理保守形）
    await tick();
    io.send('[A'); // 窗内续片（30ms 判定窗内到达——方向键上 \x1b[A 拆片形）
    expect(await read).toBe('unknown'); // 面板对 unknown 忽略继续等下一键——不退出
    expect(io.isRaw()).toBe(false); // 读毕复先后验 raw 态（面板期恒 cooked 还）
  });

  it('真单发 \\x1b：窗尽无续 → escape（面板退出键照常）', async () => {
    const io = new FakeTerminalIO();
    const read = readSingleKeyFromIo(io);
    io.send('\x1b');
    await new Promise((resolve) => setTimeout(resolve, 60)); // 窗尽（30ms 判定窗 + 余量）
    expect(await read).toBe('escape');
    expect(io.isRaw()).toBe(false);
  });

  it('非 ESC 键零等待直归一（判定窗只对恰单字符 \\x1b 的 chunk 开）', async () => {
    const io = new FakeTerminalIO();
    const read = readSingleKeyFromIo(io);
    io.send('q');
    expect(await read).toBe('q');
    expect(io.isRaw()).toBe(false);
  });
});

describe('零事件会话锚活体镜像（三消费位——@ 补全 / /rewind 尾参 / /new；03 §10.7「锚不能走库读」律）', () => {
  it('/rewind 尾参补全锚 = 活体镜像非启动根（修前红：零事件会话无库行 → 库读回退启动根 A 与活体锚 B 分叉、manifest 滤空）', async () => {
    const dataDir = rigDir('entry-anchor-data-');
    const wsA = rigDir('entry-anchor-wsA-'); // 启动根 A
    const wsB = rigDir('entry-anchor-wsB-'); // 活体锚 B（与 A 分叉）
    // 预置回退点 manifest：workspaceRoot = canonical(B)——/rewind list 与
    // checkpoint gate 的判据真源 = manager 活体镜像（assembly contextOf）
    mkdirSync(join(dataDir, 'data', 'checkpoint', 'manifests'), { recursive: true });
    writeFileSync(
      join(dataDir, 'data', 'checkpoint', 'manifests', 'cp-anchor-1.json'),
      JSON.stringify({
        id: 'cp-anchor-1',
        sessionId: 'seed-session',
        boundarySeq: 0,
        workspaceRoot: canonicalWorkspaceRoot(wsB),
        capturedAt: Date.now(),
        trigger: 'mutation',
        files: [],
      }),
    );
    const stacks: ConversationStack[] = [];
    const { entry, io } = await rigEntry(dataDir, wsA, { onStack: (stack) => stacks.push(stack) });
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门
    // 建零事件会话（活体锚 B——manager.create 零 I/O、行随首事件落库故无
    // 库行）并注册切焦（/new 同路：registerSession → focus）
    const stack = stacks[0]!;
    const created = stack.manager.create({ workspaceRoot: wsB });
    stack.channels.registerSession(created.sessionId);
    await stack.channels.focus(created.sessionId);
    // /rewind restore 尾参位补全：锚须取活体镜像 B（判据真源同 /rewind list）
    // ——修前库读位行缺席回退启动根 A，manifest 滤空弹层永不现
    const before = io.output.length;
    io.send('/rewind restore c');
    await until(() => io.output.slice(before).includes('cp-ancho')); // 短形 label（8 位截形）
    io.send('\x15'); // ctrl+u 清框（弹层对带修饰键穿透——避 escape 并包歧义）
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/status 面板工作区根 = 活体镜像非库读回退（第四消费位收编；修前红：零事件会话无库行 → cwdLabel 回退启动根 A，footer 却走活体根 B——同会话两面分叉）', async () => {
    const dataDir = rigDir('entry-status-anchor-data-');
    const wsA = rigDir('entry-status-anchor-wsA-'); // 启动根 A
    const wsB = rigDir('entry-status-anchor-wsB-'); // 活体锚 B（与 A 分叉）
    const stacks: ConversationStack[] = [];
    const { entry, io } = await rigEntry(dataDir, wsA, { onStack: (stack) => stacks.push(stack) });
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门
    // 建零事件会话（活体锚 B——manager.create 零 I/O、行随首事件落库故无
    // 库行）并注册切焦（/new 同路：registerSession → focus）
    const stack = stacks[0]!;
    const created = stack.manager.create({ workspaceRoot: wsB });
    stack.channels.registerSession(created.sessionId);
    await stack.channels.focus(created.sessionId);
    // /status 副屏工作区行：单源 focusedWorkspaceRoot()（活体镜像优先）——修前
    // 红：库读位行缺席回退启动根 A，与 footer（活体根 B）同会话两面分叉
    const before = io.output.length;
    io.send('/status\r');
    await until(() => io.output.slice(before).includes('◉ 状态汇总')); // 副屏开屏
    const panel = stripAnsi(io.output.slice(before)); // 切片 = 副屏帧（footer 主屏帧不混入）
    expect(panel).toMatch(/工作区\s+\S+/); // 行在场（值列非空）
    expect(panel).toContain(basename(wsB)); // 活体根 B——修前红：此位呈 A 短名
    expect(panel).not.toContain(basename(wsA)); // 修前双证：回退根 A 亦在场
    io.send('q'); // q text 轨收副屏
    await until(() => io.output.includes('\x1b[?1049l'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  // 保形收编词法锁（D1）：openStatusPanel 作用域 getSessionRow 零残留——防
  // 后续改版把库读腿悄悄搬回（活体镜像单源 = 三级判据唯一真源）
  it('/status 工作区根单源词法锁：openStatusPanel 作用域库读零残留 + focusedWorkspaceRoot 单点收编', () => {
    const source = readFileSync(new URL('./tui-entry.ts', import.meta.url), 'utf8');
    const start = source.indexOf('const openStatusPanel');
    const end = source.indexOf('const openDebugPanel');
    expect(start).toBeGreaterThan(-1); // 切片锚在位（函数改名/搬位即红——锁面自检）
    const body = source.slice(start, end);
    expect(body.split('getSessionRow').length - 1).toBe(0); // 库读腿零残留
    expect(body.split('focusedWorkspaceRoot()').length - 1).toBe(1); // 单源收编恰一点
  });
});

describe('编辑器高度帽几何自适应（生产路撤启动快照注入；TuiBackendOptions.maxVisibleLines 保留给测试注入固定帽）', () => {
  it('放大窗 resize 后帽随新几何放大：被夹出视口的首段回画 + 溢出指示退场（修前红：启动快照注入钉死帽 7——resize 重算腿被短路，首段永不回视口）', async () => {
    const dataDir = rigDir('entry-cap-data-');
    const { entry, io } = await rigEntry(dataDir, rigDir('entry-cap-ws-'));
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门
    // 视口 24 行 → 帽 = max(5, floor(24×0.3)) = 7；敲 12 段（11 个换行——
    // kitty 形 shift+enter `CSI 13;2u`：legacy 字节流 0x0a 被解码器拦作
    // enter（提交键），换行键在 legacy 轨无可表达字节，kitty 序列直达）。
    // 光标沉底末段，视口夹取显示末 7 段（6..12）：首段被夹出视口、首行右端
    // ↑ 溢出指示在场
    io.send('capline01');
    for (let i = 2; i <= 12; i++) {
      io.send('\x1b[13;2u');
      io.send(`capline${String(i).padStart(2, '0')}`);
    }
    await until(() => io.output.includes('capline12')); // 末段落画（光标恒可视）
    await until(() => stripAnsi(io.output).includes('更多')); // 溢出指示在场——截断已发生
    // 放大窗 24 → 80 行：帽应随新几何放大到 max(5, floor(80×0.3)) = 24 ≥ 12
    // ——全量呈现。修前红：装配期注入启动快照帽 7 钉死终身（fixedEditorCap
    // 恒非 null 短路三处重算腿），首段永不回视口（until 轮询超时收红）
    const before = io.output.length; // 切片基线——只看 resize 全帧重画后的新帧面
    io.rows = 80;
    io.emitResize();
    await until(() => stripAnsi(io.output.slice(before)).includes('capline01')); // 修前红锚
    // 终态序锁：resize 编舞先落一帧旧帽残影（repaint 陈旧段高）再由 renderFixed
    // 全量重建覆盖——陈旧指示帧先、全量帧后（lastIndexOf 序）；修前红在上一行
    // until 已收（帽钉死 7——首段永不回视口）
    const slice = stripAnsi(io.output.slice(before));
    expect(slice.lastIndexOf('capline01')).toBeGreaterThan(slice.lastIndexOf('更多'));
    io.send('\r'); // 提交清稿（多行稿 ctrl+u 只删至行首清不空——提交后空框；faux 余量应答）
    await until(() => io.output.includes('ok')); // run 收口锚
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  // 生产路撤注入词法锁（D2）：tui-entry 装配面 maxVisibleLines/editorHeightCap
  // 零残留——防后续改版把启动快照帽搬回（帽自适应归 backend 构造/resize/
  // 复起三路单源；公式单源 height-cap.ts 经 backend 消费）
  it('装配面高度帽注入零残留词法锁', () => {
    const source = readFileSync(new URL('./tui-entry.ts', import.meta.url), 'utf8');
    expect(source.split('maxVisibleLines').length - 1).toBe(0); // 生产装配零注入
    expect(source.split('editorHeightCap').length - 1).toBe(0); // 帽公式调用零残留
  });
});

describe('/setup 配置向导装配（ob-3——07 §4.1 定形注 + 连通验证改裁注）', () => {
  it('零参开向导 + #3 官方桶 = 内置目录 ∩ 运行时在册：注入 id（faux-entry）不入官方桶 + esc 中止收场（零改动回执；修前红：运行时全集派生桶含 faux-entry 冒充官方渠道）', async () => {
    const dataDir = rigDir('tui-setup-data-');
    const ws = rigDir('tui-setup-ws-');
    const { entry, io } = await rigEntry(dataDir, ws, {
      env: { FAUX_ENTRY_API_KEY: 'ready-key' }, // ready 态：引导面板缺席，/setup 手开
    });
    io.send('/setup\r');
    await until(() => io.output.includes('⚙ 配置向导'));
    // 分桶选单相落屏（v2）：官方桶 = 内置目录（builtinProviderIds 单源）∩
    // 运行时在册——孤儿/注入 id 两桶皆不入（#3：settings 已删仍在册、或注入
    // 非内置 id 的渠道不得以官方渠道身份呈现）
    await until(() => io.output.includes('选择模型渠道'));
    expect(io.output).not.toContain('faux-entry'); // 修前红：faux-only rig 下官方桶含注入项
    expect(io.output).toContain('+ 新建自定义渠道'); // v1「手录自定义 provider」腿退役
    // esc 中止（选择步取消）→ outro 已退出收场 + 主屏照常（ctrl+d 可退）
    io.send('\x1b');
    await until(() => io.output.includes('向导已退出'));
    expect(io.output).toContain('未保存任何改动');
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('带参形用法 fail-loud：不执行不兜底（/exit 同律——maybeHandleLocalCommand 执法）', async () => {
    const dataDir = rigDir('tui-setup-arg-data-');
    const ws = rigDir('tui-setup-arg-ws-');
    const { entry, io } = await rigEntry(dataDir, ws, {
      env: { FAUX_ENTRY_API_KEY: 'ready-key' },
    });
    io.send('/setup anthropic\r');
    await until(() => io.output.includes('/setup 不带参数'));
    expect(io.output).not.toContain('⚙ 配置向导'); // 未开面板 = 未执行证
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('补全源与命令册合流：/se 前缀补全含 setup 条目', async () => {
    const dataDir = rigDir('tui-setup-fuzzy-data-');
    const ws = rigDir('tui-setup-fuzzy-ws-');
    const { entry, io } = await rigEntry(dataDir, ws, {
      env: { FAUX_ENTRY_API_KEY: 'ready-key' },
    });
    await until(() => io.output.includes('工作区写 · ')); // footer 就绪门（起屏完成）
    const before = io.output.length;
    io.send('/se');
    await until(() => io.output.slice(before).includes('/setup'));
    io.send('\x15'); // ctrl+u 清框（escape 独立字节有序列等待窗——与后续并 alt 形，弃用）
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('R-1 分桶数据面判据：撞名条两桶皆不入（修前红：键全集入 customIds，撞名条以自定义渠道身份呈现）；官方桶本体胜出半边归 assembly env 豁免锁（rig 注入 providers 整体替代内置全集——runtime.ts「不叠加」注，faux-only 下官方桶无内置本体可断）', async () => {
    const dataDir = rigDir('tui-setup-collide-data-');
    const ws = rigDir('tui-setup-collide-ws-');
    // 预写撞名条：anthropic 键撞内置目录 id（boot 拒注的病态配置——分桶判据
    // 须把撞名条挡在自定义桶外〔两桶皆不入〕；boot 拒注 warn 走 stderr 不入
    // 面板输出，本断言面只覆盖呈现）
    writeFileSync(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        customProviders: {
          anthropic: { protocol: 'anthropic-messages', baseUrl: 'https://evil.example.test', models: ['hijack-model'] },
        },
      }),
    );
    const { entry, io } = await rigEntry(dataDir, ws, {
      env: { FAUX_ENTRY_API_KEY: 'ready-key' },
    });
    io.send('/setup\r');
    await until(() => io.output.includes('⚙ 配置向导'));
    // 分桶选单稳定门（「+ 新建」尾项恒在场；#3 后官方桶 = 内置 ∩ 在册——
    // faux-only 注入 rig 下官方桶空桶，无注入本体行可断）
    await until(() => io.output.includes('+ 新建自定义渠道'));
    await tick(); // 选单一次画出，让渲染微任务走完再收口断言
    // 撞名条不入自定义桶：其 baseUrl 永不呈现（修前红：撞名条入自定义桶，desc 呈 evil.example.test）
    expect(io.output).not.toContain('evil.example.test');
    // esc 收场
    io.send('\x1b');
    await until(() => io.output.includes('向导已退出'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('R-1 装配位接线词法锁：removeBinding 判回执码前缀折档 + unregister 钩子（除名+复位）+ saveCustomChannel 写侧拒撞名（修前红：源码三串全缺）', () => {
    const source = readFileSync(new URL('./tui-entry.ts', import.meta.url), 'utf8');
    // 折档判据（D5 词法锁——回执文本码前缀形，防文案改版静默碎）
    expect(source.split("startsWith('CREDENTIALS_NOT_FOUND：')").length - 1).toBe(1);
    // 删除腿三联动第三步接线（stack.unregisterCustomProvider 组合除名+复位）
    expect(source.split('stack.unregisterCustomProvider(').length - 1).toBe(1);
    // settings 写侧拒撞名（纵深——防 settings 落撞名死条）
    expect(source.split('与内置渠道重名').length - 1).toBe(1);
  });

  // #14（minor）：deps.builtinProviderIds 第三形态（运行时表现算）与保留字执法
  // 单源分叉——插件/注入 id 撞名时文案谎报「内置渠道」。修 = 传 llm 单源
  // builtinProviderIds() 目录（id 步判据与 boot 执法同源）
  it('#14 保留字判据单源：注入 id（faux-entry）非保留字——新建腿 id 步录 faux-entry 放行到协议步（修前红：第三形态判撞内置重问，永不达协议步）', async () => {
    const dataDir = rigDir('tui-setup-resv-data-');
    const ws = rigDir('tui-setup-resv-ws-');
    const { entry, io } = await rigEntry(dataDir, ws, {
      env: { FAUX_ENTRY_API_KEY: 'ready-key' },
    });
    io.send('/setup\r');
    await until(() => io.output.includes('选择模型渠道'));
    // 尾项导航（down 夹取——修前修后条目数异形同到「+ 新建自定义渠道」）
    io.send('\x1b[B\r');
    await until(() => io.output.includes('· 渠道 id'));
    io.send('faux-entry\r'); // 注入 provider id——修前红：判「与内置渠道撞名」重问
    await until(() => io.output.includes('· 协议（网关兼容哪家 API')); // 放行证：id 步不拦直进协议步
    io.send('\x1b'); // esc 收场（保存前零改动）
    await until(() => io.output.includes('向导已退出'));
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  // #2 后半（major）：保存腿写侧合并基必须取原始文件（readRawCustomProviders
  // 单源）——readHostSettings 投影基会丢坏形条目后整键覆写，手编坏形兄弟被静默清除
  it('#2 保存腿合并基 = 原始文件：好形渠道 + 坏形兄弟（缺 protocol）预置 → 向导另存好渠道 → 坏形兄弟幸存（修前红：投影基覆写后 bad-sib 消失）', async () => {
    const dataDir = rigDir('tui-setup-rawmerge-data-');
    const ws = rigDir('tui-setup-rawmerge-ws-');
    writeFileSync(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        customProviders: {
          'my-gw': { protocol: 'openai-completions', baseUrl: 'https://gw.example.test/v1', models: ['m1'] },
          // 坏形兄弟（缺 protocol）：读侧投影丢条点名——手编资产，写侧不得清除
          'bad-sib': { baseUrl: 'https://half.example.test/v1', models: ['m1'] },
        },
      }),
    );
    const { entry, io } = await rigEntry(dataDir, ws, {
      env: { FAUX_ENTRY_API_KEY: 'ready-key' },
    });
    io.send('/setup\r');
    await until(() => io.output.includes('选择模型渠道'));
    // 尾项导航（down×2 夹取——修前 3 项/修后 2 项同到「+ 新建自定义渠道」）
    io.send('\x1b[B\x1b[B\r');
    await until(() => io.output.includes('· 渠道 id'));
    io.send('my-new\r');
    await until(() => io.output.includes('· 协议（网关兼容哪家 API'));
    io.send('\r'); // 协议首项（Anthropic 兼容）
    await until(() => io.output.includes('· Base URL'));
    io.send('https://gw-save.example.test\r');
    await until(() => io.output.includes('· my-new API key'));
    io.send('sk-wizard-key\r');
    await until(() => io.output.includes('· 模型清单'));
    io.send('\x1b[B\r'); // 次项：手动填写（清单端点不可用兜底——零网络律）
    await until(() => io.output.includes('· 模型 id（逗号分隔）'));
    io.send('model-a\r');
    await until(() => io.output.includes('添加自定义请求头？'));
    io.send('n'); // 可选 headers 缺省否
    await until(() => io.output.includes('保存自定义渠道 my-new？'));
    io.send('y'); // 写序落库（凭证行先、settings 后）
    await until(() => io.output.includes('立即切换到 my-new 的模型？'));
    io.send('n'); // 不切模型
    await until(() => io.output.includes('顺手探一下 my-new 的连通性？'));
    io.send('n'); // 不探（单元测试零网络律）
    await until(() => io.output.includes('· 渠道已保存'));
    io.send('\r'); // outro 任意键收屏
    await until(() => io.output.includes('\x1b[?1049l')); // 回主屏
    io.send('\x04');
    expect(await entry).toBe(0);
    // 写侧断言（原始面单源）：三键俱在——坏形兄弟幸存（修前红 = bad-sib 被清除）
    const raw = readRawCustomProviders(dataDir);
    expect(raw).toBeDefined();
    expect(Object.keys(raw ?? {}).sort()).toEqual(['bad-sib', 'my-gw', 'my-new']);
  });

  // #11（纯锁）：删除腿三联动（凭证行 → settings → 运行时除名 + 模型复位）
  // 在 tui-entry 装配组合根的行为锁——修法批（R-1）已有单元/词法锁，本件补
  // 「向导删除腿走完 → 四联动齐达」全链锁。#25 同并入：settings 键删除对
  // 坏形兄弟条目的保留面 = #2 删除腿侧半边（同一原始面合并基）。
  it('#11+#25 删除腿三联动组合锁：预置好形渠道 + host 凭证行 + 当前模型 my-gw/m1 → 向导删除走完 → settings 键删（坏形兄弟幸存）/凭证行删/运行时除名/模型复位四联动', async () => {
    const dataDir = rigDir('tui-setup-del-data-');
    const ws = rigDir('tui-setup-del-ws-');
    // 预置一：settings 好形渠道（boot 注册入运行时表）+ 坏形兄弟（缺 protocol
    // ——读侧投影丢条；删除腿 settings 写侧合并基须保留之，#25 面）
    writeFileSync(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        customProviders: {
          'my-gw': { protocol: 'openai-completions', baseUrl: 'https://gw-del.example.test/v1', models: ['m1'] },
          'bad-sib': { baseUrl: 'https://half.example.test/v1', models: ['m1'] },
        },
      }),
    );
    // 预置二：host 域凭证行（meta.modelProvider 绑 my-gw——供血面与删除腿第一
    // 步同一行）；真库预置后关停（单活跃实例锁——同 dataDir 须先 shutdown 再起 TUI）
    const rt = createHostRuntime({ dataDir });
    rt.persistence.store.setCredential('host', 'my-gw', {
      apiKey: 'sk-del-key',
      meta: { modelProvider: 'my-gw' },
    });
    await rt.persistence.flush();
    await rt.shutdown();
    // 起入口：当前模型指到被删渠道（删除腿模型复位步的触发位）；栈注入面取
    // 真装配栈（联动断言读面——凭证行供血真源，绑定行在场即 ready 无引导面板）
    const stacks: ConversationStack[] = [];
    const { entry, io } = await rigEntry(dataDir, ws, {
      model: 'my-gw/m1',
      onStack: (stack) => stacks.push(stack),
    });
    const stack = stacks[0]!;
    // 删前实态两门：渠道在册 + 凭证行供血（env 豁免集成员——绑定行唯一源）
    expect(stack.llm.listModels('my-gw').length).toBeGreaterThan(0);
    expect(stack.bindingApiKeyOf('my-gw/m1')).toBe('sk-del-key');
    // 向导删除腿走完：桶选（my-gw 首项——#3 后官方桶空，自定义桶 [my-gw]，
    // 坏形兄弟读侧已丢不入桶）→ 条目子选次项「删除渠道」→ confirm y
    io.send('/setup\r');
    await until(() => io.output.includes('选择模型渠道'));
    io.send('\r');
    await until(() => io.output.includes('自定义渠道 my-gw'));
    io.send('\x1b[B\r'); // 次项：删除渠道
    await until(() => io.output.includes('删除自定义渠道 my-gw？'));
    io.send('y');
    await until(() => io.output.includes('· 已删除'));
    io.send('\r'); // outro 任意键收屏
    await until(() => io.output.includes('\x1b[?1049l')); // 回主屏
    io.send('\x04');
    expect(await entry).toBe(0);
    // 四联动断言：
    // ① settings 键已删 + 坏形兄弟幸存（原始面单源——#25 = #2 删除腿侧合并基）
    const raw = readRawCustomProviders(dataDir);
    expect(Object.keys(raw ?? {})).toEqual(['bad-sib']);
    // ② host 凭证行已删（绑定行供血面缺席回 undefined）
    expect(stack.bindingApiKeyOf('my-gw/m1')).toBeUndefined();
    // ③ 运行时 provider 已除名（目录查空——当场生效非重启生效）
    expect(stack.llm.listModels('my-gw')).toEqual([]);
    // ④ 当前模型已复位（目录首条——faux-only rig 下 faux-entry/m1）
    expect(stack.model).toBe('faux-entry/m1');
  });
});

/* ---------------- foldErrorText 收口（alpha.33 处置批 Lane2——A 族残漏 + 行为件） ---------------- */

describe('foldErrorText 收口与行为件（alpha.33 处置批 Lane2）', () => {
  /**
   * 两启速记（坏档位事件注入）：首启一轮对话落库退出 → 库面直缀词表外坏
   * 事件（durable events 异源写入形——词法校验只在 append 写面，持久层直写
   * 与手改库同归 fold fail-loud，session-mode.ts 防御注同律）→ 二启同 cwd
   * resume（s1 在焦）。seq 续 last_seq + 1（连续律）。
   */
  async function rigBadTierEvent(dataDir: string, ws: string, bad: { type: string; data: unknown }): Promise<void> {
    const first = await rigEntry(dataDir, ws);
    first.io.send('档位探针\r');
    await until(() => first.faux.state.callCount >= 1);
    await until(() => first.io.output.includes('ok'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);
    const probe = Persistence.open({
      dbPath: resolveDatabasePathIn(dataDir),
      dataDir,
      migrations: HOST_MIGRATION_TAIL,
    });
    const [row] = probe.store.listSessions({ workspaceRoot: canonicalWorkspaceRoot(ws) });
    expect(row).toBeDefined();
    probe.store.writeEventSingle({
      sessionId: row!.id,
      event: { type: bad.type, seq: row!.lastSeq + 1, time: 1, data: bad.data },
      registration: {
        origin: row!.origin,
        parentId: row!.parentId,
        seedLength: row!.seedLength,
        workspaceRoot: row!.workspaceRoot,
        title: row!.title,
      },
    });
    await probe.close();
  }

  it('/thinking 坏词折档：错误回执错误码直呈（修前红：err.message 形丢 THINKING_LEVEL_INVALID 码）', async () => {
    const dataDir = rigDir('entry-thinkbad-data-');
    const ws = rigDir('entry-thinkbad-ws-');
    await rigBadTierEvent(dataDir, ws, { type: 'session/thinking-level', data: { level: 'bogus' } });
    const second = await rigEntry(dataDir, ws);
    await until(() => stripAnsi(second.io.output).includes('› 档位探针')); // resume 历史回读（s1 在焦）
    second.io.send('/thinking\r');
    // fold 坏词 fail-loud 在开屏面收为错误回执（不崩选择器）：BaseError 折
    // `code：message`——修前 err instanceof Error 走 message 分支，码丢失
    await until(() => second.io.output.includes('思考级别读取失败：THINKING_LEVEL_INVALID：'));
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });

  it('/sandbox 坏词折档：错误回执错误码直呈（修前红：err.message 形丢 SANDBOX_MODE_INVALID 码）', async () => {
    const dataDir = rigDir('entry-sandbad-data-');
    const ws = rigDir('entry-sandbad-ws-');
    await rigBadTierEvent(dataDir, ws, { type: 'sandbox/mode', data: { mode: 'bogus' } });
    const second = await rigEntry(dataDir, ws);
    await until(() => stripAnsi(second.io.output).includes('› 档位探针'));
    second.io.send('/sandbox\r');
    await until(() => second.io.output.includes('沙箱模式读取失败：SANDBOX_MODE_INVALID：'));
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });

  it('TUI 启动期崩溃：stderr 折行错误码直呈（修前红：err.message 形丢码——BaseError extends Error 走 message 分支）', async () => {
    // 注入炸腿：io.size() 首读位在 TuiBackend 装配前（行预算 rows 读）——
    // 崩在主循环外，入口顶层 catch 走 writeCrashLog + stderr 一行 + exit 1
    class BoomSizeIO extends FakeTerminalIO {
      override size(): { columns: number; rows: number } {
        throw new BaseError('HOST_DATA_DIR_BUSY', '尺寸读取炸了');
      }
    }
    const faux = fauxProvider({ provider: 'faux-crash', models: [{ id: 'm1' }] });
    const io = new BoomSizeIO();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io,
      cwd: rigDir('entry-crash-ws-'),
      version: 'test',
      dataDir: rigDir('entry-crash-data-'),
      providers: [faux.provider],
      model: 'faux-crash/m1',
      env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
    });
    const code = await entry;
    const stderrJoined = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    stderrSpy.mockRestore();
    expect(code).toBe(1);
    expect(stderrJoined).toContain('TUI 运行失败：HOST_DATA_DIR_BUSY：尺寸读取炸了');
  });

  it('词法锁（R-1 同法）：六折点 foldErrorText + /jobs 占用降级接线 + 模型切换动作单源 + todoFor memo 双因子键（修前红：四串全缺/双拷贝在场）', () => {
    const source = readFileSync(new URL('./tui-entry.ts', import.meta.url), 'utf8');
    // A 族六折点收口（thinking/sandbox/marketplace/update/wizard/stderr）：
    // 调用位 7 处 = 既有切换回执 1 + 新收 6（修前仅 1 处——单源律残漏面）
    expect(source.split('foldErrorText(').length - 1).toBe(7);
    // #9 /jobs 弃接布尔收口：副屏占用降级回执接线（修前 run 体 void 直弃）
    expect(source.split("panelBusyNotice('后台任务页')").length - 1).toBe(1);
    // #11 模型切换动作单源：回执模板字面量恰一处（修前 onModelCycle 与
    // selectModel 双拷贝——「两入口一动作」注空悬）
    expect(source.split('模型已切换：').length - 1).toBe(1);
    // #10 todoFor memo 双因子键：事件数组引用同且长度同才命中（events() 恒
    // 同引用 + append-only——引用单因子永不失效即错缓存，双因子宁可 miss）
    expect(source.split('hit.eventsRef === events && hit.length === events.length').length - 1).toBe(1);
  });

  it('词法锁（D3——sourcesRejectedNote 句族收编同形）：键位拒载报文单源 keybindingRejectionNote 双消费位同引', () => {
    const source = readFileSync(new URL('./tui-entry.ts', import.meta.url), 'utf8');
    // 句面字面量唯单源位（helper 体内）——修前双站手拼两拷贝，漂移无门
    expect(source.split('键位覆盖未生效：').length - 1).toBe(1);
    // 双消费位（/debug settingsWarnings 列 + 启动首画 notify warn）皆走单源
    expect(source.split('keybindingRejectionNote(rejection)').length - 1).toBe(2);
  });

  it('todoFor 折叠 memo 双因子行为锁（词法锁外的行为半边）：命中路同引用不重折 + 尾追加长度增长即失效重折', async () => {
    const dataDir = rigDir('entry-todomemo-data-');
    const ws = rigDir('entry-todomemo-ws-');
    // 一腿：跑一条消息落史（行首事件 + user/message + assistant 回复）
    const first = await rigEntry(dataDir, ws);
    first.io.send('todo 折叠探针\r');
    await until(() => first.io.output.includes('ok'));
    first.io.send('\x04');
    expect(await first.entry).toBe(0);
    // probe 尾追加 todo/write durable 事件（resume 后日志尾即本事件——fold 成
    // 表两行；items 是 fixture 文本非模型产物，内容可锚）
    let seededId = '';
    {
      const probe = Persistence.open({
        dbPath: resolveDatabasePathIn(dataDir),
        dataDir,
        migrations: HOST_MIGRATION_TAIL,
      });
      const [row] = probe.store.listSessions({ workspaceRoot: canonicalWorkspaceRoot(ws) });
      expect(row).toBeDefined();
      seededId = row!.id;
      probe.store.writeEventSingle({
        sessionId: seededId,
        event: {
          type: 'todo/write',
          seq: row!.lastSeq + 1,
          time: 1,
          data: {
            items: [
              { status: 'in-progress', content: 'memo 探针甲' },
              { status: 'pending', content: 'memo 探针乙' },
            ],
          },
        },
        registration: {
          origin: row!.origin,
          parentId: row!.parentId,
          seedLength: row!.seedLength,
          workspaceRoot: row!.workspaceRoot,
          title: row!.title,
        },
      });
      await probe.close();
    }
    // 二启：resume 续接（历史含 todo/write）→ 捕获缝拿生产 todoFor 闭包本体
    const second = await rigEntry(dataDir, ws);
    await until(() => stripAnsi(second.io.output).includes('› todo 折叠探针')); // resume 回读落画
    const todoFor = todoForCapture.fn!;
    // 命中路：同事件数组引用且长度不变 → 二调返回同引用（未重折——
    // foldTodoTable 每调新建数组，引用同即缓存命中铁证；若退化为恒重折
    // 或键丢长度因子致错缓存，本锚分档红）
    const once = todoFor(seededId);
    expect(once).not.toBeNull();
    expect(once!.length).toBe(2); // seed 两行成表（fold 读侧锚）
    expect(todoFor(seededId)).toBe(once);
    // 失效路：尾追加新事件（提交即落 user/message）→ 长度增长判陈旧重折；
    // fold 倒扫先遇可见 user/message → 空表（用户出手即重置——重折出新结果
    // 非旧缓存回吐，run-scoped 重置语义经 memo 失效路显形）
    second.io.send('重折探针\r');
    await until(() => second.io.output.includes('ok'));
    const refolded = todoFor(seededId);
    expect(refolded).not.toBe(once); // 长度因子失效实证（append-only 尾增长）
    expect(refolded).toEqual([]); // 新结果 = 空表（非旧表回吐）
    second.io.send('\x04');
    expect(await second.entry).toBe(0);
  });
});
