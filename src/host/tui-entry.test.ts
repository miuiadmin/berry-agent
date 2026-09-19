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
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { TerminalIO } from '../channels/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';
import { Persistence, resolveDatabasePathIn } from '../persist/index.js';

import { createHostRuntime, HOST_MIGRATION_TAIL } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { sandboxModeReceipt, thinkingLevelReceipt } from './session-tier-copy.js';
import { exitCommandItems, commandArgumentItems, runTuiEntry } from './tui-entry.js';
import { runMarketplaceEntry } from './marketplace-cmd.js';

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
    // 启动版本检查关断（07 §8.5 第 6 条——单元测试零网络律；接线锁另有专测注桩）
    env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' },
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
    await until(() => io.output.includes(' · m1 · '));
    // /marketplace 恰零参命中（本地拦截族第七件）→ 副屏开屏：快照行集首帧
    io.send('/marketplace\r');
    await until(() => io.output.includes('◆ 插件市场 · 1 条目（1 源）'));
    expect(io.output).toContain('▸ hello-plugin@alpha'); // 光标在首行（未装——无徽标）
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

  it('/new 切焦全链（命令面增补批 C2——07 §4.1 逐件语义 1）：同 cwd 建新会话即切焦 + footer 短 id 更新 + 零事件不在 /sessions 清单', async () => {
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
    await until(() => second.io.output.includes('> 旧会话探针')); // resume 历史回读（s1 在焦）
    second.io.send('/new extra\r');
    await until(() => second.io.output.includes('/new 不带参数')); // 用法 fail-loud（未切焦——零参命中才执行）
    // /new：同 cwd 建新会话即切焦（registry.focus 既有权威路——/sessions 选定
    // 同路）+ notify 回执一行（新会话短 id）
    second.io.send('/new\r');
    await until(() => second.io.output.includes('新会话：'));
    const short = /新会话：([0-9a-f]{8})/.exec(second.io.output)?.[1]; // 回执短 id（uuid v7 首 8 位）
    expect(short).toBeDefined();
    await until(() => second.io.output.includes(` · m1 · ${short}`)); // footer 短 id 更新（切焦 repaint 驱动）
    // 零事件新会话不在 /sessions 清单——库行真源律已知边界（createSession 零
    // I/O、行随首事件落库——05 §1.2/§6.3 write-behind；footer 短 id 即其可见
    // 位，非缺陷）：清单恰 1 行 = s1（旧会话不动可回切）
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
    await until(() => io.output.includes(' · m1 · ')); // footer 就绪门
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

  // —— 档位装配面单源锁（第九役遗漏扫描批 C1——2026-09-19）：两表迁
  // session-tier-copy 单源件后 webui 腿有三重对拍锁（webui-bridge.test 行集
  // toEqual × 单源表 + 回执 === helper），TUI 装配闭包腿零锁（tui-backend
  // 测试用本地自造夹具锁渲染器不锁装配、e2e 锚只到计数头 + 档位词 + 回执
  // 前缀——detail 列垃圾 / 回执绕 helper 内联两形全不红）。本两测经真装配
  // 闭包锁「行集 detail 列 + 回执全文」两形（03 §10.4「两装配面同源消费」
  // 单源律的 TUI 腿断言真空收口）。
  it('/thinking 装配单源锁：行集 detail 列单源表直出（关闭思考）+ 选定回执全文 = 单源 helper 逐字符', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-tier-t-data-'), rigDir('entry-tier-t-ws-'));
    await until(() => io.output.includes(' · m1 · ')); // footer 就绪门
    io.send('/thinking\r');
    await until(() => io.output.includes('思考档位 · 7 档')); // 副屏开屏（头行锚）
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
    expect(io.output).toContain('思考档位：max（下一 run 起生效；档位是否生效随模型能力）');
    io.send('\x04');
    expect(await entry).toBe(0);
  });

  it('/sandbox 装配单源锁：danger 行警示语 07 §4.1 钉死句 + 选定回执全文 = 单源 helper 逐字符', async () => {
    const { entry, io } = await rigEntry(rigDir('entry-tier-s-data-'), rigDir('entry-tier-s-ws-'));
    await until(() => io.output.includes(' · m1 · '));
    io.send('/sandbox\r');
    await until(() => io.output.includes('沙箱档位 · 3 档'));
    // danger 行警示语 = 07 §4.1 钦定措辞（07 §4.1 danger 档行说明位文案钉死
    // 「无沙箱——任何命令直跑宿主」——第三档语义不粉饰）
    expect(io.output).toContain('无沙箱——任何命令直跑宿主');
    io.send('\x1b[4~'); // End → 尾档 danger
    io.send('\r');
    await until(() => io.output.includes(sandboxModeReceipt('danger')));
    expect(io.output).toContain('沙箱档位：danger（即刻生效于后续工具调用）');
    io.send('\x04');
    expect(await entry).toBe(0);
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
    await until(() => io.output.includes(' · m1 · ')); // footer 就绪（webui 已开面）
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
    await until(() => io.output.includes('思考档位 · 7 档'));
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
      expect(io.output).toBe(''); // TUI 屏从未起（backend.start 未达——锁死证据）
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
  ) {
    const faux = fauxProvider({ provider: 'faux-upd', models: [{ id: 'm1' }] });
    const io = new FakeTerminalIO();
    const entry = runTuiEntry({
      flags: { noPlugins: false, debug: false },
      io,
      cwd: rigDir('entry-upd-ws-'),
      version: 'test',
      dataDir,
      providers: [faux.provider],
      model: 'faux-upd/m1',
      env: {}, // 注桩腿不读 env——关断键不设（桩即真腿，别处关断形已有专测）
      startupUpdateCheck,
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
    await until(() => io.output.includes('新版本 9.9.9 可用——/upgrade 查看详情'));
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
});
