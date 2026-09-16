/**
 * host/tui-entry 组合根测试——TUI 主入口装配序（真盘真库 + faux provider +
 * 注入 TerminalIO——mock 只停在模型层）。
 *
 * 钉死：空框直退 0 / 提交流转全链（输入字节 → 编辑器 → 提交 → 驱动 → faux
 * 模型）/ 同 cwd 重启续接（resume 投影首画回读历史）/ 运行时组装失败退 1 /
 * `--port` webui 咬合（横幅走屏留痕面只带 URL、token 不入屏、退出收场面）。
 * 输入驱动走真 InputDecoder（'\r' 提交、'\x04' ctrl+d 空框退出）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { exitCommandItems, commandArgumentItems, runTuiEntry } from './tui-entry.js';

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

describe('exitCommandItems 退出词补全源（07 §4.1 /exit 批）', () => {
  it('空 query 出两词；前缀过滤；replacement/detail 形齐', () => {
    expect(exitCommandItems('')).toEqual([
      expect.objectContaining({ label: '/exit', replacement: '/exit' }),
      expect.objectContaining({ label: '/quit', replacement: '/quit' }),
    ]);
    expect(exitCommandItems('ex').map((item) => item.label)).toEqual(['/exit']);
    expect(exitCommandItems('qu').map((item) => item.label)).toEqual(['/quit']);
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

  it('/help 副屏 + footer 常驻段（批 10k——R7 帮助面/R6 footer 落码装配位）', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-help-data-'), rigDir('entry-help-ws-'));
    // footer 常驻段首画在场：模型名（faux-entry/m1 → m1 短名）+ 会话短 id 分隔形
    await until(() => io.output.includes(' · m1 · '));
    // /help 命令 → 帮助副屏：命令册首帧可见段（键位册段在册尾视口外——双册
    // 全量已由 help-viewer.test 纯函数直锁，此处锁装配位真源）
    io.send('/help\r');
    await until(() => io.output.includes('❓ 命令与键位帮助'));
    expect(io.output).toContain('── 命令 ──');
    expect(io.output).toContain('/sessions'); // 10k 会话切换器在册（channels 注册面真源）
    expect(io.output).toContain('/usage'); // 10k 用量面板在册
    io.send('q'); // q text 轨收副屏（独立 ESC 字节有序列等待窗——避并包歧义）
    await until(() => io.output.includes('\x1b[?1049l')); // ALT 收屏字节标记（回主屏）
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
    await until(() => second.io.output.includes(' · m1 · ')); // footer 就绪门
    second.io.send('/sessions\r');
    await until(() => second.io.output.includes('⇄ 会话切换 · 1 会话'));
    // enter 切焦：registry.focus 只投影不开驱动 → repaint 回读 s1 历史
    // （user 块 '> ' 锚形与清单行标题形可区分）
    second.io.send('\r');
    await until(() => second.io.output.includes('> 旧会话探针')); // 切焦重画（投影回读）
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
      env: {},
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
    await until(() => io.output.includes('已排队候跑')); // 排队回执一行（notify 面）
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
    io.send('\x10'); // ctrl+p——模型循环（m1 → m2）
    await until(() => io.output.includes('模型已切换')); // notify 回执行
    expect(io.output).toContain('m2'); // footer 模型段已换新（常驻段活写）
    io.send('二问\r'); // 下一 run 起跑消费新模型
    await until(() => modelsByCall.length >= 2);
    io.send('\x04');
    expect(await entry).toBe(0);
    expect(modelsByCall[0]).toContain('m1');
    expect(modelsByCall[1]).toContain('m2'); // 生效语义 = 下一 run 起跑
  });
});
