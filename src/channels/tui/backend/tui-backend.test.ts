/**
 * TuiBackend 组合测试（批 10e-1 呈现 + 批 10e-2 交互纵切）。
 *
 * 覆盖：UiBackend 契约面（capabilities/hasAudience）、直播呈现全链
 * （聚焦流式两段 / 非聚焦摘要行）、状态面消费（转轮/工具名/启停）、
 * notify 档位符号、setStatus、tick 推帧、onRepaint 投影重建、resize 自订阅；
 * 交互纵切（10e-2）：自持输入管线与路由四层、提交路由（命令柄/应答优先）、
 * 补全弹层三源、阻塞四件浮层面板、渲染合并与 tick 自驱（手动时钟 rig）；
 * ask 撤销说明行（批 10f-3——07 §4.3 撤销面：abort 后 ⏹ 行在场 + 迟到
 * abort 不误写四路各一例）；
 * 呈现面件 7（终端外显）：起屏基线 title、按会话净计数忙态（OSC 9;4）、
 * clamp 防穿底、切焦跨路回归锁、onRepaint 点缀短 id、stop 复原两写点、
 * 保活周期重发；
 * 主题面（批 10g——07 §4.1 R2）：缺省 dark 确定性基线、auto 档 OSC 11
 * 探测编舞（查询/订阅/应答换装/同板零帧/迟到换装/畸形忽略/stop 复原）、
 * 硬退复原钩 2031 同写（七役扫描批——复原对称律）、resumeMain 复起重查
 * （七役扫描批——副屏在场窗通知丢弃的补偿面）、colorEnv 三档接线。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTerminalIO, ProcessTerminalIO } from '../../engine/index.js';
import { ansiColor, colorRgb, stringWidth } from '../../engine/index.js';
import type { TodoItem } from '../../types.js';
import { TuiBackend, wireForkEdit, type ProcessSignalsSeam, type TuiBackendOptions } from './tui-backend.js';
import type { GitQuery, GitQueryResult } from '../status/branch-stats.js';
import { LEADER_WINDOW_MS } from '../keys/leader.js';
import { SELECTION_CAP_BYTES } from '../history/history-viewer.js';
import { buildSgr, SGR_RESET } from './ansi-rows.js';
import { buildOsc52Copy } from './osc.js';
import { builtinPalette, detectColorDepth, resolveTheme } from '../theme/index.js';
import { AltScreenHost } from '../overlay/alt-screen.js';
import { AUTOCOMPLETE_DEBOUNCE_MS } from '../autocomplete/async.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { MemoryViewerDataDeps } from '../memory/memory-viewer.js';
import type { AgentEvent } from '../../../agent/index.js';
import type {
  AgentMessage,
  AssistantMessage,
  ImageRefContent,
  JobEntry,
  UiCallLedgerEntry,
  UiRewindPreview,
  UiSessionSummary,
  UiUsageSummary,
} from '../../../contracts/index.js';
import { BaseError } from '../../../contracts/index.js';
import { CLIPBOARD_IMAGE_UNSUPPORTED_TEXT, type ClipboardImagePayload } from './clipboard-image.js';

/**
 * spawnSync 定向单点桩（59 轮件 D-2 回归锁）：vi.mock 截获
 * node:child_process 的 spawnSync——默认透传真身（本文件全部既有用例经
 * seam 注入桩零真子进程，透传只保形不改行为），帽锁用例以
 * mockImplementationOnce 定向覆写即弃（当笔消费即还原委托形——断言红态
 * 也不泄漏给后续用例）。vi.hoisted 共享柄：mock 工厂注册位与用例断言位
 * 持同一 mock 实例（工厂内不能引用外部变量的提升律绕道）。
 */
const { spawnSyncStub, realChildProcess } = vi.hoisted(() => {
  // 真身寄存位（mock 工厂 importOriginal 后回填——委托闭包调时解析）
  const realChildProcess: { spawnSync?: (...invoke: unknown[]) => unknown } = {};
  const spawnSyncStub = vi.fn((...invoke: unknown[]) => realChildProcess.spawnSync!(...invoke));
  return { spawnSyncStub, realChildProcess };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  // 双转型只过类型关（@types 重载面 vs 宽松委托形）——运行期即真身引用
  realChildProcess.spawnSync = actual.spawnSync as unknown as (...invoke: unknown[]) => unknown;
  return { ...actual, spawnSync: spawnSyncStub };
});

const COLS = 80;
const ROWS = 10;
const SESSION = 'sess-aaaaaaaaaa';

/** OSC 9;4 两序列（件 7 断言锚——字节形真源在 osc.ts 直测） */
const PROGRESS_ACTIVE = '\x1b]9;4;3\x07';
const PROGRESS_CLEAR = '\x1b]9;4;0\x07';
/** OSC 0 title 序列包装 */
const oscTitle = (t: string): string => `\x1b]0;${t}\x07`;

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

function assistantMsg(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: text !== '' ? [{ type: 'text', text }] : [],
    usage,
    stopReason: 'stop',
    timestamp: 1,
  };
}

/** 混排累计快照（thinking 块在前、text 块在后——message_update 载荷形；尾块分诊测位：thinking 非空且 text 空 → 尾块 thinking） */
function mixedSnapshot(thinking: readonly string[], texts: readonly string[]): AgentMessage {
  const content: AssistantMessage['content'] = [];
  for (const chunk of thinking) content.push({ type: 'thinking', thinking: chunk });
  for (const chunk of texts) content.push({ type: 'text', text: chunk });
  return { role: 'assistant', content, usage, stopReason: 'stop', timestamp: 1 };
}

function makeBackend(
  options: Partial<TuiBackendOptions> = {},
  rows = ROWS,
): {
  io: MemoryTerminalIO;
  backend: TuiBackend;
} {
  const io = new MemoryTerminalIO(COLS, rows);
  const backend = new TuiBackend(io, {
    // 外编受控桩（挖掘 31 轮 [9]）：生产缺省闭包会真 spawn 子进程——
    // MemoryTerminalIO 测试面零真进程纪律。不涉外编的测永不触发（不按
    // ctrl+g）；误触发时 missing-editor 桩 notify 一行可诊断。外编专测
    // 显式注入覆盖此桩
    externalEditor: async () => ({ status: 'missing-editor' as const }),
    ...options,
  });
  backend.start();
  return { io, backend };
}

function emit(backend: TuiBackend, event: AgentEvent, focused = true): void {
  backend.onEnvelope({ sessionId: SESSION, event }, focused);
}

/** ANSI 转义剥除（行内槽序断言用——SGR/光标定位剥除后各槽锚词可作 indexOf 相对位置比对；与 tui-entry 同形） */
function stripAnsi(out: string): string {
  return out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

describe('TuiBackend 契约面', () => {
  it('id / capabilities / hasAudience（阻塞四件浮层呈现——批 10e-2 交互纵切翻真）', () => {
    const { backend } = makeBackend();
    expect(backend.id).toBe('tui');
    expect(backend.capabilities).toEqual({
      notify: true,
      confirm: true,
      select: true,
      input: true,
      approval: true,
      setStatus: true,
      setWidget: false,
    });
    expect(backend.hasAudience()).toBe(true);
  });

  it('start：主屏形模式串 + 清屏 + 滚动区 + 固定区首画（编辑器 + 状态行）', () => {
    const { io } = makeBackend();
    // 主屏形模式串：粘贴开 + kitty 推栈——无 1049 备屏、无光标藏（与全屏形分立）
    expect(io.bytes).toContain('\x1b[?2004h');
    expect(io.bytes).toContain('\x1b[>5u');
    expect(io.bytes).not.toContain('\x1b[?1049h');
    expect(io.bytes).not.toContain('\x1b[?25l');
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\x1b[1;3r'); // 10 行 - 固定区 6（编辑器 5 = 呈现最小高 3 + 垫 2〔五件批 A+B〕+ 状态行 1）- R-1 间隔 1
    expect(io.bytes).toContain('›'); // 编辑器 composer 提示符（V-0 注③——框线零占位）
    expect(io.raw).toBe(true); // raw 模式置位
  });
});

describe('TuiBackend 直播呈现', () => {
  it('聚焦流式两段：纯文本直推 → 定稿 markdown 换装', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式**段') });
    io.bytes = '';
    emit(backend, { type: 'message_end', message: assistantMsg('# 定稿标题') });
    expect(io.bytes).toContain('定稿标题'); // 定稿换装在场
    expect(io.bytes).toContain('\x1b[1;4m# 定稿标题\x1b[0m'); // markdown 渲染（R-3：# 前缀保留 + H1 bold+underline 单游程）
  });

  it('流式帧字节帽超帽降档纯文本（批 10h R1 perf 护栏——streamFrameByteCap 注入面使触发路可测）', () => {
    // 小帽注入（16 单位）：单字帧不超帽（R-4 前缀 dim 后 `\x1b[2m• \x1b[0m甲`
    // = 11 字位——注⑩ bullet 槽含前缀 SGR 一并计入帧长）；42 轮件 A 尾窗化后
    // 帧字节行数维有界（尾窗 ≤ 容量行）——触发语料改**单行超帽**形（H1 长标
    // 题行 ≈ 27 位 > 16，尾窗含该行即超帽）
    // ——超帽帧本帧仍 markdown 直推（帧已落账不回改），present 后降档（弃 doc），
    // 次帧起流式正文纯文本直推
    const { io, backend } = makeBackend({ streamFrameByteCap: 16 });
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') }); // 1 字节不超帽
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题行加长使单行超帽') });
    expect(io.bytes).toContain('\x1b[1;4m# 标题'); // 超帽帧本帧仍 markdown（R-3 H1 属性游程——降档不回改已落帧）
    io.bytes = '';
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: assistantMsg('甲\n# 标题行加长使单行超帽\n乙'),
    });
    expect(io.bytes).toContain('\r  乙'); // 降档纯文本直推尾窗底行（42 轮件 A 尾窗化——顶行帽外，2 空格前缀纯文本形）
    expect(io.bytes).not.toContain('\x1b[1;4m'); // 零属性游程——流式 markdown 直推档已降（R-3 分辨形）
    // 对称面（缺省帽 256KB 生产定值不降档）：同序列次帧仍 markdown 直推——
    // H1 属性游程在场（R-3：# 前缀保留 + bold+underline；与降档帧零游程互为分辨形）
    const ctl = makeBackend();
    emit(ctl.backend, { type: 'message_start', role: 'assistant' });
    emit(ctl.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') });
    ctl.io.bytes = '';
    emit(ctl.backend, {
      type: 'message_update',
      role: 'assistant',
      partial: assistantMsg('甲\n# 标题行加长使单行超帽'),
    });
    emit(ctl.backend, {
      type: 'message_update',
      role: 'assistant',
      partial: assistantMsg('甲\n# 标题行加长使单行超帽\n乙'),
    });
    expect(ctl.io.bytes).toContain('\x1b[1;4m# 标题'); // markdown 直推档（H1 属性游程在场）
  });

  it('流式帧字节锁·块型族（B4——H1 例之外的闭栏代码块/表格/CJK 三形；固定注入文本非 AI 生成物）', () => {
    // 语义键 SGR 期望值按装配真源现算（dark@16 缺省档——与 rig 零 colorEnv 注入
    // 对齐）：codeKeyword→ANSI 9 / codeNumber→ANSI 12 / tableRule→ANSI 8。
    const darkTheme = resolveTheme(builtinPalette('dark'), detectColorDepth({}));
    const kwSgr = buildSgr({ fg: darkTheme.codeKeyword });
    const numSgr = buildSgr({ fg: darkTheme.codeNumber });
    const ruleSgr = buildSgr({ fg: darkTheme.tableRule });

    // 形一：闭栏代码块流式帧含高亮 SGR（闭栏才高亮——流式防闪烁律；keyword
    // 与 number 两语义键段同帧在场；R-3 裸文本形——│ 沟线 dim 段与 └─ 收尾
    // 行双退役，col 0 即代码）
    const code = makeBackend();
    emit(code.backend, { type: 'message_start', role: 'assistant' });
    emit(code.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') });
    code.io.bytes = '';
    emit(code.backend, {
      type: 'message_update',
      role: 'assistant',
      partial: assistantMsg('甲\n```ts\nconst x = 1;\n```'),
    });
    expect(code.io.bytes).toContain(`${kwSgr}const${SGR_RESET} x = ${numSgr}1${SGR_RESET};`);
    expect(code.io.bytes).not.toContain('│'); // 沟线退役锁

    // 形二：GFM 表格流式帧含双线定界（V-3 注⑨④——表头 ━ 重线整段线色键；
    // 全框形退役：├ ┼ 交点符零在场）。24 行屏足容锁全量（43 轮件 B 分离双
    // 渲染后 10 行小屏表格形 = bullet 冻结进 scrollback + 尾行在视口、中段
    // 不稳行容量丢弃——断档在「不稳行数 > 尾窗帽 + 可冻量」时为容量语义
    // 固有；42 轮 10 行屏 ━ 在场靠错位冻结凑巧——本锁锁块型渲染非屏容量）
    const table = makeBackend({}, 24);
    emit(table.backend, { type: 'message_start', role: 'assistant' });
    emit(table.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') });
    table.io.bytes = '';
    emit(table.backend, {
      type: 'message_update',
      role: 'assistant',
      partial: assistantMsg('甲\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |'),
    });
    expect(table.io.bytes).toContain(`${ruleSgr}━━━━━━━━━━${SGR_RESET}`); // 表头重线（表宽 = 列宽 3+3 + 两侧空格 2×2；V-3 注⑨④ 双线制——无纵向线）
    expect(table.io.bytes).not.toContain('├'); // 全框退役锁
    expect(table.io.bytes).not.toContain('┼');

    // 形三：CJK 双宽文本流式帧不截半字——折行走网格管线字素级：逐行可见宽
    // ≤ 屏宽帽（截半即越帽 autowrap 或残宽）+ 折行拼接还原全文（半字即断链）。
    // 24 行屏承载折行族全量（42 轮件 A 尾窗化后小屏尾窗截底段——本锁锁折行
    // 字素完整性非屏容量，语料全量在场须足容屏）
    const cjkText = '中文测试'.repeat(30); // 120 字素 × 宽 2 = 240 列——80 列屏折 3 行
    const cjk = makeBackend({}, 24);
    emit(cjk.backend, { type: 'message_start', role: 'assistant' });
    emit(cjk.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') });
    cjk.io.bytes = '';
    emit(cjk.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg(`甲\n${cjkText}`) });
    const cjkLines = cjk.io.bytes
      .split('\n')
      .filter((line) => /[中文测]/.test(line)) // CJK 段折行族（末行可恰为「测试」二字——不含「中文」串）
      .map((line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\r\n]/g, ''))
      // 任务行同帧重绘（V-4 注⑪⑦——message_update 触固定区收口：⠋ 生成中 ·
      // 本轮 N 尾段与末折行同物理块）——剥至转轮止，折行族采集不受扰
      .map((line) => line.replace(/⠋ .*$/, ''))
      .map((line) => line.replace(/^• 甲 /, '').replace(/^  /, '')); // 首帧行 bullet 槽 + 前段 '• 甲 ' 剥除、续行 bullet 槽两空格剥除（注⑩——同帧重写混排）
    expect(cjkLines.length).toBeGreaterThanOrEqual(3); // 折 3 行（外加首帧甲行不计）
    for (const line of cjkLines) {
      expect(stringWidth(line), 'CJK 折行可见宽 ≤ 帽').toBeLessThanOrEqual(COLS);
    }
    expect(cjkLines.join('')).toBe(cjkText); // 折行零丢字零裂字——拼接还原全文
    expect(cjk.io.bytes).toContain('中文测试中文测试'); // 双宽字素成串完整在场（帧字节非碎片段）
  });

  it('聚焦 user 消息：› 前缀行（界面美化役批⑦——bold+dim 前缀段）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '帮我看下', timestamp: 1 } });
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m帮我看下\n');
  });

  it('非聚焦 agent 事件零正文行（07 §4.1 V-0 注①——瀑布退役，呈现归 JobPanel）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'agent_start' }, false);
    emit(backend, { type: 'agent_end', status: 'failed' }, false);
    emit(backend, { type: 'agent_end', status: 'aborted' }, false);
    expect(io.bytes).not.toContain('⧗');
    expect(io.bytes).not.toContain('后台工作中');
    expect(io.bytes).not.toContain('后台失败');
  });

  it('非聚焦消息族零正文行（不建账）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'message_end', message: { role: 'user', content: '后台', timestamp: 1 } }, false);
    expect(io.bytes).not.toContain('> 后台');
  });
  // 「窄屏摘要行全行入帽」锁随 summaryToAnsi 通道退役翻档（TUI 视觉重设计
  // 批 V-1 笔2）——窄屏截断风险面由 appendJobSettledLine 截断锁承接。
});

describe('TuiBackend 状态面', () => {
  it('agent_start → 转轮 accent 首帧；agent_end → 归闲', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    expect(io.bytes).toContain('\x1b[36m⠋'); // accent（ANSI 6 cyan）转轮首帧
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('⠋');
  });

  it('agent_end 终态分档：failed ✗ / aborted ⏹ 不伪装成功（P0 静默点②——不显 ✓ 用量成功形）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'failed' });
    // 持有档（界面美化役批 4）：failed 到达先持有——不闪「✗」不落尾注
    //（终态揭示由 retry_wait_end aborted/exhausted 翻档；驱动侧保证 failed
    // 后必随发其一——start / end {aborted|exhausted} / 孤儿 end{resumed}
    //（overflow compacted 续入形，第七轮深扫批扩）；消费端延后翻转达成同效 UX）
    expect(io.bytes).not.toContain('✗ 失败');
    expect(io.bytes).not.toContain('✓ 用量');
    emit(backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: Date.now() + 5_000 });
    expect(stripAnsi(io.bytes)).toContain('重试中 第 1/3 次'); // 退避窗在场（态③）
    expect(io.bytes).not.toContain('✗ 失败'); // 窗内仍不闪 ✗（转轮不停）
    io.bytes = '';
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    expect(io.bytes).toContain('✗ 失败'); // 燃尽揭示——红 ✗ 终态
    expect(io.bytes).not.toContain('✓ 用量');
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(io.bytes).toContain('⏹ 已中止');
    expect(io.bytes).not.toContain('✓ 用量');
  });

  it('失败直呈律：errorMessage 经持有档揭示同句携因（✗ 失败 · 原因——孤立红叉禁）', () => {
    // 07 §4.1 V-0 注②：任何 ✗ 失败行必同句携带原因；agent_end failed 的
    // errorMessage 存账（持有档），retry_wait_end 终态揭示时双位（任务行态④ +
    // footer 尾注）同句携因——修前两位皆裸「✗ 失败」零上下文
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'failed', errorMessage: '模型渠道未配置（CHANNEL_UNKNOWN）' });
    emit(backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: Date.now() + 5_000 });
    io.bytes = '';
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    // 任务行态④ + footer 尾注双位同句携因（主呈位 = 输入框上方位）
    expect(io.bytes).toContain('✗ 失败 · 模型渠道未配置（CHANNEL_UNKNOWN）');
    expect(io.bytes).not.toMatch(/✗ 失败[\x1b\r\n]|✗ 失败$/); // 无裸形残留（同句必携因）
  });

  it('失败终态单源化（V-3 注⑧）：✗ 揭示恰一次——footer 尾注腿退役（件 12 态④ 唯一主呈位）', () => {
    // 07 §4.1 V-3 注⑧：footer 尾注 ✗ 失败形退役——「输入框上方 + footer 尾」
    // 双位收敛为单位（/new 孤立红病灶⑤ 终局）；aborted ⏹ / completed ✓ 尾注
    // 维持（同 setStatus 载体）——本锁只退役失败腿
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'failed', errorMessage: '某因' });
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    expect(io.bytes.split('✗ 失败').length - 1).toBe(1); // 修前 2：任务行态④ + footer 尾双呈
    // 邻态不受扰：aborted ⏹ 尾注维持（setStatus 载体活）
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(io.bytes).toContain('⏹ 已中止');
  });

  it('失败原因持有档：resumed 续入清账 + 下轮 agent_start 新账（陈原因不残留）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'failed', errorMessage: '旧原因' });
    emit(backend, { type: 'retry_wait_end', outcome: 'resumed' }); // 续入——账待清
    emit(backend, { type: 'agent_start' }); // 新 run 起——旧账必清
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'failed' }); // 无 errorMessage 形
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    expect(io.bytes).toContain('✗ 失败'); // 兜底裸形（无因可携——诚实缺席非陈因）
    expect(io.bytes).not.toContain('旧原因'); // 陈原因零残留
  });

  it('tool_execution_start → ⚙ 工具名段优先；end → 清工具', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_start', toolCallId: 'tc1', name: 'grep', arguments: {} });
    expect(stripAnsi(io.bytes)).toContain('⚙ 搜索文本 …');
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 'tc1', result: {} as never });
    expect(stripAnsi(io.bytes)).not.toContain('⚙ 搜索文本');
  });

  it('非聚焦事件不驱动状态面（状态行是聚焦会话的）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'agent_start' }, false);
    expect(io.bytes).not.toContain('⠋');
  });

  it('setStatus：闲态文案呈现（last-writer-wins）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    backend.setStatus(SESSION, '就绪');
    expect(io.bytes).toContain('就绪');
  });

  it('tick：忙态推帧、闲态零写出', () => {
    const { io, backend } = makeBackend();
    backend.tick();
    const idleBytes = io.bytes.length;
    backend.tick();
    expect(io.bytes.length).toBe(idleBytes); // 闲态 tick 零写出
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    backend.tick();
    expect(io.bytes).toContain('⠙'); // 第二帧
  });

  it('动效门禁用形装配（挖掘 35 轮 B2+B4）：animations=false → 忙态渲染 • 静态符 + tick 零写出', () => {
    // TuiBackendOptions.animations 单值下装链（tui-entry 装配铸真源——本测
    // 锁 backend 消费位：taskLine 禁用形 + tick 早退）
    const { io, backend } = makeBackend({ animations: false });
    emit(backend, { type: 'agent_start' }); // 态变触固定区重画（禁用形仍达——态变/供数变才重绘律）
    expect(io.bytes).toContain('•'); // 静态符（非 braille 帧）
    expect(io.bytes).not.toContain('⠋');
    io.bytes = '';
    backend.tick();
    expect(io.bytes).toBe(''); // 禁用形 tick 零重绘（80ms 自重排停摆）
  });
});

describe('TuiBackend notify / repaint / resize', () => {
  it('notify 档位符号（info•/success✓/warn⚠/error✗——注⑩ 符号册）+ 弱化两腿（info/success DIM、warn/error 不动）', () => {
    const { io, backend } = makeBackend();
    backend.notify('普通', { level: 'info' });
    // info 档整行 DIM 包裹（V-0 注③ 斜杠命令回执弱化——行尾 SGR_RESET 复原）
    expect(io.bytes).toContain('\r\x1b[2m• 普通\x1b[0m\n');
    backend.notify('成了', { level: 'success' });
    expect(io.bytes).toContain('\x1b[2m✓ 成了\x1b[0m'); // success 同弱化档
    backend.notify('小心', { level: 'warn' });
    expect(io.bytes).toContain('⚠ 小心');
    expect(io.bytes).not.toContain('\x1b[2m⚠'); // warn 不弱化——V-1 笔3 失败直呈律
    backend.notify('坏了', { level: 'error' });
    expect(io.bytes).toContain('✗ 坏了');
    expect(io.bytes).not.toContain('\x1b[2m✗'); // error 同不动
    backend.notify('缺省档');
    expect(io.bytes).toContain('\x1b[2m• 缺省档\x1b[0m'); // 缺省 = info 档
  });

  /* ---- Job 终态收口单行（TUI 视觉重设计批 V-1 笔2——07 §4.1 V-0 注①聚合律） ---- */

  /** JobEntry 夹具（终态三形） */
  function settledEntry(name: string, status: 'completed' | 'killed' | 'failed', detail?: string): JobEntry {
    return {
      id: 'job-1',
      name,
      kind: 'subagent',
      owner: SESSION,
      status,
      startedAt: 1,
      terminal: { status, at: 2, ...(detail !== undefined ? { detail } : {}) },
    };
  }

  it('appendJobSettledLine 三态：✓ 完成 / ✗ 携因 / ⏹ 已停止（瞬时行——追加即定稿）', () => {
    const { io, backend } = makeBackend();
    const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    backend.appendJobSettledLine(settledEntry('任务A', 'completed'));
    expect(plain(io.bytes)).toContain('✓ 任务A · 完成');
    backend.appendJobSettledLine(settledEntry('任务B', 'failed', '模型渠道未配置（CHANNEL_UNKNOWN）'));
    expect(plain(io.bytes)).toContain('✗ 任务B · 模型渠道未配置（CHANNEL_UNKNOWN）');
    backend.appendJobSettledLine(settledEntry('任务C', 'killed', '归属围栏收口'));
    expect(plain(io.bytes)).toContain('⏹ 任务C · 已停止 · 归属围栏收口');
  });

  it('✗/✓ 符号段分色（success/error 语义键着色——两态 SGR 前缀相异）', () => {
    const { io, backend } = makeBackend();
    backend.appendJobSettledLine(settledEntry('任务A', 'completed'));
    backend.appendJobSettledLine(settledEntry('任务B', 'failed', '原因'));
    const okColor = io.bytes.match(/\x1b\[([0-9;]*)m✓/)?.[1];
    const badColor = io.bytes.match(/\x1b\[([0-9;]*)m✗/)?.[1];
    expect(okColor).toBeDefined(); // 符号段带 SGR 前缀（语义色非裸文本）
    expect(badColor).toBeDefined();
    expect(okColor).not.toBe(badColor); // 成功/失败分色（theme 具体色值自由）
  });

  it('失败原因超长截断单行（一句话帽——不溢出屏宽产漂账物理行）', () => {
    const { io, backend } = makeBackend();
    backend.appendJobSettledLine(settledEntry('任务B', 'failed', '原因'.repeat(120)));
    const visible = io.bytes.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
    expect(visible).toContain('任务B'); // 名段在呈现
    // 原因段受一句话帽：预算 = 80 − 名宽 6 − 尾段 6 = 68 可见宽，「原因」每段宽 4 → 至多 17 段
    const reasonCount = (visible.match(/原因/g) ?? []).length;
    expect(reasonCount).toBeGreaterThan(0);
    expect(reasonCount).toBeLessThanOrEqual(17);
  });

  it('killed 归因超长截断单行（detail 填满预算整行可见宽 ≤ 屏宽——预算算式 nameW+14 收口）', () => {
    const { io, backend } = makeBackend();
    backend.appendJobSettledLine(settledEntry('任务C', 'killed', '因'.repeat(60)));
    // 剥 SGR/CR 后取 ⏹ 行整段按字素测宽（CJK 双宽如实计——整行真可见宽）
    const line =
      io.bytes
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        .replace(/\r/g, '')
        .match(/⏹[^\n]*/)?.[0] ?? '';
    expect(line).toContain('已停止'); // 行在场（防 find 空串假绿）
    // 修前红：预算只减 nameW+10 → detail 填满预算时整行超宽（实测 83 > 80）
    // （appendTransientLine 瞬时路无帽直写——终端 autowrap 产未入账物理行，
    // cursorRow 漂账族）
    expect(stringWidth(line)).toBeLessThanOrEqual(COLS);
  });

  it('未终态防御位：terminal 缺席零呈现（不炸不脏流——字节流零追加）', () => {
    const { io, backend } = makeBackend();
    const before = io.bytes; // makeBackend 启动序列已写入——以调用前快照为基线
    backend.appendJobSettledLine({
      id: 'job-2',
      name: '任务D',
      kind: 'subagent',
      owner: SESSION,
      status: 'running',
      startedAt: 1,
    });
    expect(io.bytes).toBe(before);
    expect(io.bytes).not.toContain('任务D');
  });

  it('多行 notify 回执不漂账（doors 帮助形——后续行落在物理末行之后，不覆写回执中段）', () => {
    const { io, backend } = makeBackend();
    // doors 失败回执形：message 本体多行（缺子命令 + usage 各行）。
    // 物理行账漂移的旧形：writeLine 只按一次 +1 记账——4 行文本写出行 0..3
    // 而账只到行 1，后续追加从行 1 起笔覆写回执第 2 行（tmux 实红 2026-09-20）
    backend.notify('缺子命令。\n/doors list | open | close\n  list 用法甲\n  open 用法乙');
    io.bytes = '';
    backend.notify('后继行');
    // 光标归位在编辑声明位（0 基行 5——五件批 A+B 固定区 6：baseRow 4 + 上垫 1
    // = composer 内容行 5）：gotoRow 的 CUU 距离 = 5 - 追加位行号。物理真相 =
    // 滚动区 1..2（R-1 转录 3 行 + 间隔行 1）：回执 4 行超区 1 行，末两次 LF
    // 触滚——首行入 scrollback、末三行落行 0..2 → 追加位行 2 → CUU 3；
    // 漂账形 = 追加位行 1 → CUU 4（修前编辑声明位 8 = 单行 composer 屏底上 1）
    expect(io.bytes).toContain('\x1b[3A\r\x1b[2m• 后继行\x1b[0m\n');
    expect(io.bytes).not.toContain('\x1b[4A\r\x1b[2m• 后继行');
  });

  it('onRepaint：投影重建 + 清屏全量重写', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '旧问题', timestamp: 1 } });
    io.bytes = '';
    backend.onRepaint(SESSION, [{ role: 'user', content: '投影问题', timestamp: 1 }], null);
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m投影问题\n');
    expect(io.bytes).not.toContain('旧问题');
  });

  it('resize 自订阅：emitResize → 清屏 + 新几何滚动区 + 重画', () => {
    const clock = new ManualClock();
    const { io, backend } = makeBackend({ schedule: clock.schedule, cancelSchedule: clock.cancel });
    emit(backend, { type: 'message_end', message: { role: 'user', content: '内容', timestamp: 1 } });
    io.columns = 40;
    io.rows = 6;
    io.bytes = '';
    io.emitResize();
    clock.advance(75); // 尾随防抖窗到（41 轮件 I）——handleResize 汇流末次事件
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\x1b[1;3r'); // 6 行 - 固定区 2（状态 1 + 编辑器 1——V-0 注③ 框退役）- R-1 间隔 1 = DECSTBM 1..3
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m内容\n'); // 行集重画
  });

  it('【件 I 修前红】resize 尾随防抖：拖拽连发窗内零写出、75ms 后恰一次清屏重画（末次几何）', () => {
    const clock = new ManualClock();
    const { io, backend } = makeBackend({ schedule: clock.schedule, cancelSchedule: clock.cancel });
    emit(backend, { type: 'message_end', message: { role: 'user', content: '内容', timestamp: 1 } });
    io.bytes = '';
    io.columns = 40;
    io.emitResize();
    io.columns = 20;
    io.emitResize();
    // 修前红：零防抖同步直呼——首事件即全量重画（bytes 非空）
    expect(io.bytes).toBe('');
    clock.advance(75);
    const clears = io.bytes.split('\x1b[2J\x1b[H').length - 1;
    expect(clears).toBe(1); // 拖拽窗内两事件只认末次——恰一次清屏重画（修前红：两次）
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m内容\n'); // 行集按末次几何重画
  });

  /* ---- 已落屏瞬时行跨权威重建保全（e2e /resume 竞窗根因——三面对称锁） ---- */

  /**
   * 竞窗实录（/resume e2e 时红时绿 50%）：resumeSession 成功后 service 侧
   * `void registry.focus(id)` 与 `uiCore.notify('已续接：…')` 竞速——notify 同步
   * 落屏在先、focus 的 onRepaint 权威重建在后时，修前 collectPendingTransients
   * 只收 pendingOps（未落帧）瞬时行，已落屏行唯一载体是屏面本身：repaint
   * CLEAR_SCREEN 按投影行集重建（瞬时行「不进行集不记 writtenBlocks，
   * repaint 不重建」——main-screen 件自述），已落屏 notify 行被抹且无账可补
   * （不入 scrollback 不复显）。挂起面已有对称律（suspendMain 转账 + 复起
   * 补显射界含瞬时行——07 件 8 在册），本组三锁补「已落帧 + 权威重建」
   * 窗口：repaint / resize / 挂起复起。
   */
  it('已落屏瞬时行跨 repaint 保全（/resume 回执行竞窗主锁——notify 落帧后 focus 重画补吐）', () => {
    const { io, backend } = makeBackend();
    backend.notify('已续接：e2ehist'); // 同步直出档：立即落屏（screen.appendTransient 达成）
    io.bytes = ''; // 清启动+notify 段——只断言 repaint 之后
    backend.onRepaint(SESSION, [{ role: 'user', content: '投影问题', timestamp: 1 }], null);
    // 清屏重写后已落屏 notify 行按到达序补吐（07「瞬时行缓冲不丢」不变式的
    // 已落帧面）；修前红：repaint 后无重放，行永失
    expect(io.bytes).toContain('已续接：e2ehist');
    // 且落在投影行之后（到达序保持——notify 先于 repaint 到达用户视野）
    expect(io.bytes.indexOf('已续接：e2ehist')).toBeGreaterThan(io.bytes.indexOf('投影问题'));
  });

  it('已落屏瞬时行跨 resize 保全（权威重建三面之一——缩窗重画后补吐 + 新宽收口）', () => {
    const clock = new ManualClock();
    const { io, backend } = makeBackend({ schedule: clock.schedule, cancelSchedule: clock.cancel });
    backend.notify('已续接：e2ehist');
    clock.advance(1); // 合并帧落屏（已落帧前提——notify 经 pendingOps 请帧）
    io.bytes = '';
    io.emitResize();
    clock.advance(75); // 防抖窗到 → handleResize 权威清点（41 轮件 I 尾随窗）
    expect(io.bytes).toContain('已续接：e2ehist'); // 修前红：resize 重画抹屏无补吐
  });

  it('已落屏瞬时行跨挂起复起保全（suspendMain 转账面——复起补显射界含瞬时行的已落帧半边）', () => {
    const { io, backend } = makeBackend();
    backend.notify('已续接：e2ehist'); // 挂起前已落屏（复起全帧重画的重建射界外）
    io.bytes = ''; // 清挂起前字节——只断言复起重画之后的补吐
    backend.suspendMain();
    backend.resumeMain();
    // 修前红：suspendMain 只转 pendingOps，已落屏行复起重画后被抹
    expect(io.bytes).toContain('已续接：e2ehist');
  });

  // 挖掘 26 轮 [10]：保全账使命是单次重画竞窗不丢非历史全保——无帽则长会话
  // 随通知量单调增长且每次重画全账 O(N) 重放。小帽注入（3）证 FIFO 裁旧腿：
  // 帽外最旧行让位，重放只见帽内最新行。
  it('保全账帽 FIFO 裁旧：超帽最旧行让位，重放只见帽内最新行（修前红：无帽全量回放）', () => {
    const { io, backend } = makeBackend({ landedTransientCap: 3 });
    for (let i = 1; i <= 5; i++) backend.notify(`回执 ${i}`);
    io.bytes = '';
    backend.onRepaint(SESSION, [], null);
    expect(io.bytes).not.toContain('回执 1'); // 帽外最旧让位
    expect(io.bytes).not.toContain('回执 2');
    expect(io.bytes).toContain('回执 3'); // 帽内最新 3 补吐在场
    expect(io.bytes).toContain('回执 4');
    expect(io.bytes).toContain('回执 5');
  });

  it('当场档瞬时行跨 repaint 不重放（Job 收口行——结算线零复现，两档分立负锁）', () => {
    const { io, backend } = makeBackend();
    const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    backend.appendJobSettledLine(settledEntry('任务A', 'completed'));
    expect(plain(io.bytes)).toContain('✓ 任务A · 完成'); // 先证落屏
    io.bytes = '';
    backend.onRepaint(SESSION, [], null);
    // 结算线族 = 当场档（与 turn 收尾行「repaint 不重建」同律——run 级账目
    // 不跨切焦重放伪造在场）；修若回潮（档位丢失全家入账）此锁红
    expect(plain(io.bytes)).not.toContain('任务A');
  });
});

/* ================= 批 10e-2 交互纵切（手动时钟 rig） ================= */

/** 手动时钟（渲染合并/tick 自驱/ESC 判定窗的确定性驱动） */
class ManualClock {
  public t = 0;
  private seq = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  public readonly now = (): number => this.t;
  public readonly schedule = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  public readonly cancel = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  /** 推进时间：到期定时器按序执行（执行中新排的也可在本窗内到期） */
  public advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.t = due.at;
      this.timers = this.timers.filter((timer) => timer !== due);
      due.fn();
    }
    this.t = target;
  }
}

/** 装配柄调用记录 */
interface RigCalls {
  submitted: [sessionId: string, text: string][];
  interrupted: string[];
  quit: number;
  dispatched: string[];
}

/** 交互 rig：注入调度 + 高 fps 帧帽（帧间隔 ~0——advance 即泵帧）；rows 可调（overlay+弹层并陈的量高场景需高窗） */
function makeInteractive(options: Partial<TuiBackendOptions> = {}, rows: number = ROWS) {
  const io = new MemoryTerminalIO(COLS, rows);
  const clock = new ManualClock();
  const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
  const backend = new TuiBackend(io, {
    // 外编受控桩（同 makeBackend——零真进程纪律；外编专测显式注入覆盖）
    externalEditor: async () => ({ status: 'missing-editor' as const }),
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    now: clock.now,
    fpsCap: 1e6, // 帧间隔 ~0——advance 窗内帧随窗落地
    sessionId: 's1',
    onSubmit: (sessionId, text) => calls.submitted.push([sessionId, text]),
    onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
    onQuit: () => {
      calls.quit += 1;
    },
    ...options,
  });
  backend.start();
  io.bytes = ''; // start 编舞字节不计入交互断言
  return { io, backend, clock, calls, pump: () => clock.advance(1) };
}

/** lone-ESC 判定窗推进（缺省 30ms 窗——advance 顺带泵掉窗内到期帧） */
const escapePump = (clock: ManualClock): void => clock.advance(31);

describe('TuiBackend 输入管线（自持——不经 Engine）', () => {
  it('字符键入 → 编辑器收字 + 光标声明落位；enter → onSubmit(sessionId, text)', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('hi');
    pump();
    expect(io.bytes).toContain('hi'); // 编辑器框内文本
    expect(io.bytes.endsWith('\x1b[6;5H')).toBe(true); // 光标声明（文尾——五件批 A+B 固定区 6：composer 内容行 = baseRow 4 + 上垫 1 = 0 基行 5；1 基列 = › 前缀 2 + 文宽 2 + 1）
    expect(calls.submitted).toEqual([]);
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([['s1', 'hi']]);
  });

  it('超帽提交拒——error 瞬时行反馈 + onSubmit 零达 + 草稿保留（件 B——挖掘 46 轮装配锁）', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('x'.repeat((1 << 20) + 1)); // 单行大段（无换行不触发粘贴标记化）
    pump();
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([]); // 帽拒不下发（onSubmitRejected→notify 装配位）
    expect(io.bytes).toContain('输入超长'); // error 瞬时行（前缀断言——词面整句不断言）
    // 草稿保留：再 enter 仍拒（稿件未清——复原语义在装配面成立）
    io.bytes = '';
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([]);
    expect(io.bytes).toContain('输入超长');
  });

  it('stop：出屏模式串反序 + raw 复原 + 停后帧静默', () => {
    const { io, backend, pump } = makeInteractive();
    backend.stop();
    expect(io.bytes).toContain('\x1b[<u'); // kitty 弹栈
    expect(io.bytes).toContain('\x1b[?2004l'); // 粘贴关
    expect(io.raw).toBe(false); // raw 复原先验态
    io.bytes = '';
    backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    pump();
    expect(io.bytes).toBe(''); // 停后渲染请求静默短路
  });

  it('drainInput 终退排空：吞窗内输入不进编辑器 + 收手停流（07 §4.1 件5——挖掘 26 轮 [9]，Engine.drainInput 同源舞）', async () => {
    const { io, backend, clock, calls } = makeInteractive();
    io.reset();
    const draining = backend.drainInput(1000, 50);
    let done = false;
    void draining.then(() => {
      done = true;
    });
    clock.advance(10);
    io.emitInput('a'); // 第一波（swallow 接管——主屏处理器已卸）
    clock.advance(40);
    io.emitInput('b'); // 第二波（lastData 重置——闲窗续期）
    for (let elapsed = 0; elapsed < 2000 && !done; elapsed += 10) {
      clock.advance(10);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(done).toBe(true);
    // 吞后空稿证吞尽：补打 'x' 提交——draft 只含 'x'（若处理器未卸则 'ab'
    // 已入稿随提交 'abx'——红锚即此）
    io.emitInput('x\r');
    clock.advance(1);
    expect(calls.submitted).toEqual([['s1', 'x']]);
    expect(io.pauseCount).toBeGreaterThanOrEqual(1); // 收手停流
  });

  it('drainInput 运行态恢复：处理器重装 + 流复起（终退形随后 stop 再卸——幂等无害）', async () => {
    const { io, backend, clock } = makeInteractive();
    io.reset();
    const draining = backend.drainInput(1000, 50);
    let done = false;
    void draining.then(() => {
      done = true;
    });
    for (let elapsed = 0; elapsed < 2000 && !done; elapsed += 10) {
      clock.advance(10);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(done).toBe(true);
    expect(io.resumeCount).toBeGreaterThanOrEqual(1); // 恢复放流
    io.emitInput('hi'); // 处理器已重装——编辑器收字
    clock.advance(1);
    expect(io.bytes).toContain('hi');
  });

  it('drainInput 未启/已停 no-op：无排空舞副作用（无 raw 接管即无残账可排）', async () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {}); // 未 start
    io.pauseCount = 0; // reset() 只清输出账——计数手置零（engine 测试同款先例）
    await backend.drainInput(10, 5);
    expect(io.pauseCount).toBe(0);
    backend.start();
    backend.stop();
    io.pauseCount = 0;
    await backend.drainInput(10, 5);
    expect(io.pauseCount).toBe(0); // 已停同理
  });

  it('ctrl+c → onInterrupt 连按计次；ctrl+d 空框 → onQuit', () => {
    const { io, calls } = makeInteractive();
    io.emitInput('\x03');
    io.emitInput('\x03');
    expect(calls.interrupted).toEqual(['s1', 's1']);
    io.emitInput('\x04');
    expect(calls.quit).toBe(1);
  });

  it('ctrl+d 非空草稿首击 = 清稿 + 回执不退（两步序②——2026-10-05 ZCode 对标批）；ask 浮层在场同路收层转 onQuit（E4 翻档——修前占焦纯吞死键）', async () => {
    const first = makeInteractive();
    first.io.emitInput('ab');
    first.pump();
    first.io.bytes = ''; // 首击帧起收窗
    first.io.emitInput('\x04'); // 首击：清稿 + notify（次击直退——非旧 delete-forward 编辑器吞）
    first.pump();
    expect(first.calls.quit).toBe(0); // 首击不退
    expect(first.io.bytes).toContain('已清空——再按 Ctrl+D 退出'); // 回执形（07 §4.1 R5 翻档）

    // 修前：浮层占焦期 ctrl+d 修饰键分支纯吞（完全死键）；现与副屏件族同路
    // ——先与 esc 同语义保守收层（confirm → false）再转装配 onQuit
    const second = makeInteractive();
    const p = second.backend.confirm('做吗？');
    second.pump();
    second.io.emitInput('\x04');
    await expect(p).resolves.toBe(false); // 保守值（不动原状态）
    expect(second.calls.quit).toBe(1); // 收层后退出柄被转（先收屏再转 onQuit）
  });

  it('overlay 模态独占：占焦期字母键不入编辑器，应答后恢复', async () => {
    const { io, backend, pump } = makeInteractive();
    const p = backend.confirm('确认？');
    pump();
    io.emitInput('abc'); // 面板吞——编辑框零扰动
    pump();
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe(true);
    io.bytes = '';
    io.emitInput('b');
    pump();
    expect(io.bytes).toContain('b'); // 层关后键回编辑器
  });

  // B3（y/n 集成链锁）：36aa326 的 y/n 修复只有面板级直调锁（select-confirm
  // .test.ts text 轨四例）——集成链（io chunk → InputDecoder 地面态 textRun
  // 冲刷 → routeEvent 四层序 → overlay 栈模态路由 → 面板 text 轨应答）零锁。
  // 本例经 backend 输入面发裸 'y'/'n' 字节流锁全链 promise 应答（'\r' 应答
  // 测试同 rig 形——新增覆盖锁，无行为变更故无修前红态）。
  it('y/n 集成链锁（B3）：裸字母字节流经 backend 输入面 → confirm promise 对应布尔应答', async () => {
    const { io, backend, pump } = makeInteractive();
    const yes = backend.confirm('删吗？');
    pump();
    io.emitInput('y'); // 裸字母单字节 chunk——text 轨（地面态游程冲刷单 text 事件）
    pump();
    await expect(yes).resolves.toBe(true);
    const no = backend.confirm('再想想？');
    pump();
    io.emitInput('n');
    pump();
    await expect(no).resolves.toBe(false);
  });
});

describe('TuiBackend 提交路由', () => {
  it("'/cmd' → dispatchCommand 柄；false → onSubmit 兜底 / true → 不落", async () => {
    let handled = false;
    const { io, calls, pump } = makeInteractive({
      dispatchCommand: async (input) => {
        calls.dispatched.push(input);
        return handled;
      },
    });
    io.emitInput('/help\r');
    pump();
    await Promise.resolve(); // 微任务排空（dispatch 异步链）
    expect(calls.dispatched).toEqual(['/help']);
    expect(calls.submitted).toEqual([['s1', '/help']]); // false → 兜底

    handled = true;
    io.emitInput('/x\r');
    pump();
    await Promise.resolve();
    expect(calls.dispatched).toEqual(['/help', '/x']);
    expect(calls.submitted).toHaveLength(1); // true → 不落 onSubmit
  });

  it('命令处理器异常 → notify error 兜底（不崩不静默）', async () => {
    const { io, pump } = makeInteractive({
      dispatchCommand: async () => {
        throw new Error('炸了');
      },
    });
    io.emitInput('/boom\r');
    pump();
    await Promise.resolve();
    await Promise.resolve(); // rejection 链两回合（then 折传递 + catch）
    pump();
    expect(io.bytes).toContain('✗ 命令异常'); // error 档符号 + 兜底文案
  });

  it('命令处理器 BaseError 异常 → 码直呈（foldErrorText 形——修前 String 丢码红锚，wf_3c8b00b8 组α）', async () => {
    // 689e5ba 立规：用户面折面 = `码：message`（String(err) 只得「BaseError: <message>」
    // 丢可引用错误码）；本位两 catch 修前裸 String——与 channels.service foldErrorText
    // 单源对齐（同形随批）
    const { io, pump } = makeInteractive({
      dispatchCommand: async () => {
        throw new BaseError('PLUGIN_APPLY_FAILED', '装载失败具名');
      },
    });
    io.emitInput('/boom\r');
    pump();
    await Promise.resolve();
    await Promise.resolve();
    pump();
    expect(io.bytes).toContain('命令异常：PLUGIN_APPLY_FAILED：装载失败具名'); // 码直呈（修前红位）
  });

  it("'/exit' 恰零参 → onQuit（先于通道命令分发终局，不落 onSubmit）", () => {
    const { io, calls, pump } = makeInteractive({
      dispatchCommand: async (input) => {
        calls.dispatched.push(input);
        return true;
      },
    });
    io.emitInput('/exit\r');
    pump();
    expect(calls.quit).toBe(1);
    expect(calls.dispatched).toEqual([]); // 退出词先于 dispatchCommand——不进通道命令面
    expect(calls.submitted).toEqual([]); // 前端生命周期词永不兜底进模型消息
  });

  it("'/quit' 已退役（三反馈批A）——不再终局拦截，与未注册 /词 同路落 onSubmit", () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('/quit\r');
    pump();
    expect(calls.quit).toBe(0); // 退役词不再走退出路（07 §4.1 批A 修订注）
    expect(calls.submitted).toEqual([['s1', '/quit']]); // 驱动侧既有兜底语义——未注册 /词 落模型消息（07 §4.1 批A 退役注）
    io.emitInput('/quit now\r'); // 带参形拦截分支同删——同路兜底
    pump();
    expect(calls.quit).toBe(0);
    expect(calls.submitted).toEqual([
      ['s1', '/quit'],
      ['s1', '/quit now'],
    ]);
  });

  it('带参形 /exit xxx → warn 用法提示不退出；尾随空白 trim 后恰命中仍退出', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('/exit now\r');
    pump();
    expect(io.bytes).toContain('⚠'); // warn 档符号（用法 fail-loud）
    expect(calls.quit).toBe(0);
    expect(calls.submitted).toEqual([]); // 带参形也终局消费——不兜底
    io.emitInput('/exit  \r');
    pump();
    expect(calls.quit).toBe(1); // trim 后恰 '/exit'——退出
  });

  it('input-ask 接管窗 /exit 是应答非命令（既有裁决——退出词此窗不拦）', async () => {
    const { io, backend, calls, pump } = makeInteractive();
    const p = backend.input('填啥？');
    pump();
    io.emitInput('/exit\r'); // ask 接管窗内提交 '/exit'——应答车
    pump();
    await expect(p).resolves.toBe('/exit'); // '/exit' 作为应答原文回填
    expect(calls.quit).toBe(0); // 不退出
  });

  // 挖掘 29 轮件 4：应答车占位文与 composer 缺省分立（enter 是收窗非提交——
  // 「输入消息…」在应答窗误导为新消息）；UiInputOptions.placeholder 契约死位
  // 激活（声明未消费——透传至应答车占位）。
  it('input-ask 应答车占位文切换（修前红：应答窗空稿仍示 composer 缺省「输入消息…」误导）', async () => {
    const { io, backend, pump } = makeInteractive();
    const p = backend.input('下方问？');
    pump();
    expect(io.bytes).toContain('? 下方问？'); // 提示行在场（防空洞断言）
    expect(io.bytes).not.toContain('输入消息'); // 修前红位：应答车空稿示 composer 缺省占位
    expect(io.bytes).toContain('输入回复'); // 应答专用占位（R-6 占位文族第四位——值位白话律）
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答');
    expect(io.bytes).toContain('输入消息'); // 收场回 composer 缺省（空稿态占位复现）
  });

  it('input-ask placeholder 选项透传（UiInputOptions.placeholder 契约死位激活——修前红：opts 声明未消费）', async () => {
    const { io, backend, pump } = makeInteractive();
    const p = backend.input('下方问？', { placeholder: '自定义占位' });
    pump();
    expect(io.bytes).toContain('? 下方问？'); // 提示行在场（防空洞断言）
    expect(io.bytes).toContain('自定义占位'); // 修前红位：opts.placeholder 全链未消费
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答');
  });

  it('onQuit 柄缺席 → 诚实拒提示（不虚报律——不退出不兜底）', () => {
    const { io, calls, pump } = makeInteractive({ onQuit: undefined });
    io.emitInput('/exit\r');
    pump();
    expect(io.bytes).toContain('当前界面不支持 /exit'); // 诚实拒
    expect(calls.quit).toBe(0);
    expect(calls.submitted).toEqual([]);
  });

  // B5（迟到续链 lifecycle 闸——修前红）：真实窄窗 = 同 stdin chunk 粘贴形
  // quit 先行 + '/' 命令后随（'/exit\n/unknown\n' 单 chunk）：事件队列同批
  // 路由（stop 后 decoder 队列已取走——续链不受 unsubInput 影响），'/exit'
  // 提交同步调 onQuit → 真装配 quitResolve 的 shutdown 级联（closer 内
  // backend.stop）是先排微任务；后随 '/unknown' 提交的 dispatchCommand
  // .then 续链后到——在停机态（running=false、装配侧 manager 已 dispose）
  // 触达 onSubmit 可启新 LLM run。本例注入微任务形 onQuit 复现窄窗。
  it('迟到续链 lifecycle 闸（B5——修前红）：单 chunk 双命（quit 先行 + 命令后随）下停机态续链不触达 onSubmit', async () => {
    const rig = makeInteractive({
      dispatchCommand: async () => false, // 未注册 /词——false 兜底路（.then 续链形）
      onQuit: () => queueMicrotask(() => rig.backend.stop()), // quitResolve 微任务级联（真装配 closer 同形）
    });
    rig.io.emitInput('/exit\r/unknown\r'); // 单 chunk 双命（粘贴形——decoder 一批产出两组 text+enter）
    await Promise.resolve(); // 微任务排空：先排的 stop 先落、后随 dispatch .then 续链后到
    expect(rig.backend.lifecycle).toBe('disposed'); // 停机态已达成（级联先排先执行）
    expect(rig.calls.submitted).toEqual([]); // 修前红：续链在停机态触达 onSubmit——'/unknown' 落账
  });
});

describe('TuiBackend 补全弹层（三源路由）', () => {
  /** 补全防抖窗泵（R6 批 10j——20ms 尾沿）：推过窗位使查询落层 */
  const completePump = (clock: { advance: (ms: number) => void }): void => {
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1);
  };

  /** 命令名 + 参数段双源记录 rig */
  function autocompleteRig() {
    const argCalls: [string, string][] = [];
    const rig = makeInteractive({
      autocomplete: {
        commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
        commandArguments: (command, query) => {
          argCalls.push([command, query]);
          return query === 'ar' ? [{ label: 'arg1', replacement: 'arg1 ' }] : [];
        },
      },
    });
    return { ...rig, argCalls };
  }

  it("'/' 起手弹层在场 → tab 整 token 代换 → escape 关层", () => {
    const { io, clock, calls } = autocompleteRig();
    io.emitInput('/he');
    completePump(clock); // 防抖窗到——查询落层弹层在场（R6：尾沿 20ms 后交付）
    expect(io.bytes).toContain('/help'); // 弹层 label 在场
    expect(io.bytes).toContain('帮助'); // detail 右对齐段
    io.emitInput('\t'); // 应用代换
    clock.advance(1);
    io.emitInput('\r'); // 提交代换后命令
    clock.advance(1);
    expect(calls.submitted).toEqual([['s1', '/help']]); // 命令柄缺席——'/' 文本落 onSubmit（trim 后）
    io.bytes = '';
    io.emitInput('\x1b'); // escape 关层（新轮）
    escapePump(clock);
    expect(io.bytes).not.toContain('帮助'); // 弹层已隐
  });

  it('命令名已终结 → 参数段源路由（commandArguments 收命令名与 query）', () => {
    const { io, clock, argCalls } = autocompleteRig();
    io.emitInput('/help ');
    io.emitInput('ar');
    completePump(clock); // 防抖窗到——连打两 chunk 收敛为单查（尾沿律）
    expect(argCalls).toEqual([['help', 'ar']]);
    expect(io.bytes).toContain('arg1');
  });

  it('input-ask 在飞 → 弹层抑制（应答优先）', async () => {
    const { io, backend, pump } = autocompleteRig();
    const p = backend.input('补充说明？');
    pump();
    io.emitInput('/he'); // 应答期键入——补全不开层
    pump();
    expect(io.bytes).not.toContain('帮助');
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('/he'); // 应答原样落 promise
  });

  // —— ask 浮层开层收补全弹层（2026-09-20 TUI 视觉品质战役·组 2 修前红）：
  // input() 路既做「应答期弹层抑制」（cancel + applyResult(null)——tui-backend
  // 码内注释明言），confirm/select/askApproval 三路共用 openAskLayer 却无此
  // 收口——修前形：弹层死显残留 overlay 段之下（overlay 模态独占收键不可
  // 交互），且连打后在途查询迟到仍会刷新死弹层 ——

  it('ask 浮层开层收在场弹层：confirm 开层即刻收层（修前死显残留红）', async () => {
    const { io, backend, clock, pump } = autocompleteRig();
    io.emitInput('/he');
    completePump(clock); // 防抖窗到——弹层在场（'/help' + detail '帮助'）
    expect(io.bytes).toContain('帮助');
    io.bytes = '';
    const p = backend.confirm('做吗？');
    pump();
    expect(io.bytes).toContain('做吗？'); // 浮层面板在场
    expect(io.bytes).not.toContain('帮助'); // 修前红：弹层未被收——死显在 overlay 段之下
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe(true);
  });

  // 挖掘 29 轮件 5：渲染门（budget.popup > 0——极矮屏梯末位牺牲零画出）与
  // 键路门（popup.visible——数据位真即吃键）判据分立——幽灵层吃键。修后键
  // 路门与渲染门同源（本帧实占位缓存），牺牲位键透传编辑器。
  it('极矮屏弹层梯牺牲不吃键（修前红：enter 被不可见弹层吃——选建议吞提交）', () => {
    const { io, clock, calls, pump } = makeInteractive(
      {
        autocomplete: {
          commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
        },
      },
      3, // 3 行屏：预算 2 = 编辑器收缩 1 + 状态行 1——弹层梯末位牺牲（渲染缺席）
    );
    io.emitInput('/he');
    completePump(clock); // 防抖窗到——弹层数据面开
    expect(io.bytes).not.toContain('帮助'); // 防空洞断言：弹层渲染缺席（几何牺牲确达）
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([['s1', '/he']]); // 修前红位：enter 被幽灵弹层吃（选建议——submitted 恒空）
  });

  it('ask 浮层开层撤防抖窗：连打后开层的在途查询不落层（askApproval——修前窗内 fire 落层红）', async () => {
    // rows 加高：审批面板（5 行）+ 弹层（1）+ 编辑器（3）+ 状态行（1）在 10 行
    // 窗会触发牺牲梯隐弹层——量高并陈需 14 行窗（预算 13）才呈修前坏形
    const { io, backend, clock, pump } = makeInteractive(
      {
        autocomplete: {
          commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
        },
      },
      14,
    );
    io.emitInput('/he'); // 防抖窗已排（20ms 尾沿）——弹层未开
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    completePump(clock); // 推过窗位——修前：窗内 fire 落层，弹层死显 overlay 段下
    expect(io.bytes).toContain('⚙ 写入文件：写文件'); // 浮层标题在场（V-0 注⑤动词位）
    expect(io.bytes).not.toContain('帮助'); // 修前红：开层不撤窗——在途查询迟到落层
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('approve');
  });

  // —— escape 关层联动收防抖窗（组 2 修前红）：popup 消费 escape 关本轮但
  // 不触 completer.cancel——20ms 防抖窗内在途/已排查询迟到 fire 会把刚关的
  // 弹层重开（建议框「闪回」，与 popup「关本轮」注释意图相悖）。kitty 轨
  // `\x1b[27u` escape 即达即决（生产主轨——backend 进屏推 kitty 协议），迟到
  // fire 与关层的时序在手动钟下确定可演 ——

  it('escape 关层撤防抖窗：窗内迟到 fire 不重开弹层（修前「闪回」红）', () => {
    // sticky 源：'/he'、'/hel' 前缀均有候选——迟到 fire 携非空结果才能重开弹层
    const { io, clock } = makeInteractive({
      autocomplete: {
        commands: (query) =>
          ['/help', '/hello']
            .filter((name) => name.slice(1).startsWith(query))
            .map((name) => ({ label: name, detail: '帮助', replacement: `${name} ` })),
      },
    });
    io.emitInput('/he');
    completePump(clock); // 弹层在场（两候选）
    io.bytes = ''; // 首开弹层帧字节不计——聚焦 escape 关层后的窗内迟到 fire
    io.emitInput('l'); // 连打——防抖窗重置（弹层持上轮 result 仍可见）
    io.emitInput('\x1b[27u'); // kitty 轨 escape：即达即决——popup 消费关本轮
    clock.advance(1); // 泵掉关层帧
    expect(io.bytes).not.toContain('帮助'); // 关层成立（本轮锚）
    io.bytes = ''; // 关层帧字节不计——聚焦窗内迟到 fire
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1); // 推过防抖窗——修前窗内 fire 重开弹层
    expect(io.bytes).not.toContain('帮助'); // 修前红：迟到 fire → onResult → 弹层重开
  });
});

describe('TuiBackend 阻塞四件（浮层面板呈现）', () => {
  it('confirm：enter → true / esc → false / signal abort → false + 层关', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const p1 = backend.confirm('一？');
    pump();
    expect(io.bytes).toContain('一？');
    io.emitInput('\r');
    pump();
    await expect(p1).resolves.toBe(true);

    const p2 = backend.confirm('二？');
    pump();
    io.emitInput('\x1b');
    escapePump(clock);
    await expect(p2).resolves.toBe(false);

    const ac = new AbortController();
    const p3 = backend.confirm('三？', { signal: ac.signal });
    pump();
    ac.abort();
    await expect(p3).resolves.toBe(false); // 败腿撤销保守值
    io.bytes = '';
    io.emitInput('x'); // 层已关——键回编辑器
    pump();
    expect(io.bytes).toContain('x');
  });

  // —— 入参 signal 已中止早检（纵深防御——十六役 N1 同族在 ask 浮层位的兜底）：
  // abort 事件是一次性广播——已发毕的 signal 再挂监听永不再触发。ui-core 侧已
  // 有两道早检（入参已中止早退 + 排队件 abort 不晋升 start），但 UiBackend 是
  // 公开面——其他装配方直传已中止 signal 时 openAskLayer 只挂监听即开层成
  // 僵尸浮层（无人能答也无人能收）——
  it('入参 signal 已中止的 ask：零呈现直收保守值（修前红：层已开 + 只挂监听——僵尸浮层、promise 永悬）', async () => {
    const { io, backend, pump } = makeInteractive();
    const ac = new AbortController();
    ac.abort(); // 先中止——bridgeApprovalSignal 同步 relay 的生产形（N1 同源）
    const p = backend.confirm('做吗？', { signal: ac.signal });
    pump();
    expect(io.bytes).not.toContain('做吗？'); // 修前红①：层照样开——中止事件已发毕，撤销路不可达
    await expect(p).resolves.toBe(false); // 修前红②：abort 回调永不再触发——promise 永悬
  });

  // input() 路同族对称锁（上件 openAskLayer 兜底的姊妹位）：inputAsk 应答车
  // 无已中止早检——已发毕的 signal 只挂监听永不再触发，激活即占编辑器成
  // 僵尸问（无人能收、promise 永悬）
  it('入参 signal 已中止的 input：零呈现直收保守值（修前红：应答车激活——僵尸问、promise 永悬）', async () => {
    const { io, backend, pump } = makeInteractive();
    const ac = new AbortController();
    ac.abort(); // 先中止——中止事件已发毕，挂监听永不再触发（Node 实证）
    const p = backend.input('叫什么？', { signal: ac.signal });
    pump();
    expect(io.bytes).not.toContain('叫什么？'); // 修前红①：提示行照样上屏——撤销路不可达
    await expect(p).resolves.toBe(''); // 修前红②：abort 回调永不再触发——promise 永悬
  });

  it('select：enter 高亮项 / ↓ 换选 / esc → 空串 / abort → 空串', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const choices = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙' },
    ];
    const p1 = backend.select('选', choices);
    pump();
    io.emitInput('\r');
    pump();
    await expect(p1).resolves.toBe('a');

    const p2 = backend.select('再选', choices);
    pump();
    io.emitInput('\x1b[B'); // ↓（CSI 序列——legacy 单 chunk）
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('b');

    const p3 = backend.select('三', choices);
    pump();
    io.emitInput('\x1b');
    escapePump(clock);
    await expect(p3).resolves.toBe('');

    const ac = new AbortController();
    const p4 = backend.select('四', choices, { signal: ac.signal });
    pump();
    ac.abort();
    await expect(p4).resolves.toBe('');
  });

  it('approval：四值映射 + esc → cancel + 工具名标题与草案 hint 在场', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const p1 = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    expect(io.bytes).toContain('⚙ 写入文件：写文件'); // 工具名标题（V-0 注⑤动词位）
    expect(io.bytes).toContain('/tmp/x'); // always 草案 hint 段
    io.emitInput('\r'); // 高亮首项 = 批准
    pump();
    await expect(p1).resolves.toBe('approve');

    const p2 = backend.askApproval('s1', { summary: '二' });
    pump();
    io.emitInput('\x1b[B\x1b[B'); // ↓↓ = 总是批准
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('always');

    const p3 = backend.askApproval('s1', { summary: '三' });
    pump();
    io.emitInput('\x1b');
    escapePump(clock);
    await expect(p3).resolves.toBe('cancel'); // Esc 面板保守值映射 cancel
  });

  it('主屏 lone-ESC 装排门换锚形自愈：旧定时器早到空转须重排——Esc 不丢、后键不误判 alt', async () => {
    // 定谳回归靶（Engine 同款门的复制位——主屏自持输入管线）：T0 挂起装
    // timer1 → T0+5 续段消解旧挂起（CSI ? u 应答完成）且 chunk 尾起新挂起
    // （锚 T0+5）——装排被「在飞门」拒；timer1 于 T0+30 到点 settle 因
    // elapsed=25<30 空转，修前无人重装 → 新挂起永失 Esc 裁决（confirm 层
    // 永不关）且后续可打印键误判 alt+*（编辑器终局丢弃）。
    const { io, backend, clock, calls, pump } = makeInteractive();
    const p = backend.confirm('确认？');
    pump(); // 层开帧落地
    let closed = false;
    void p.then(() => {
      closed = true;
    });
    io.emitInput('\x1b'); // T0：lone-ESC 挂起——主屏装 timer1（T0+30 到点）
    clock.advance(5); // T0+5
    io.emitInput('[?u\x1b'); // kitty 探测应答消解旧挂起 + 尾起新挂起（锚 T0+5）——门拒装
    clock.advance(26); // T0+31：timer1 于 T0+30 早到空转（elapsed=25<30）
    expect(closed).toBe(false); // 窗仍未满——层不提前关（两实现同绿）
    clock.advance(5); // T0+36 > 锚+窗（T0+35）——自愈重排定时器到点 settle 交 Esc
    await Promise.resolve(); // 冲微任务——面板关层的 resolve 回调落 then 标记
    expect(closed).toBe(true); // 修前红：新挂起永失 Esc 裁决——confirm 层永不关
    await expect(p).resolves.toBe(false);
    pump(); // 关层帧落地
    io.emitInput('x\r'); // 挂起已清——后键落编辑器正文（修前 'x' 被吞成 alt+x 终局丢弃）
    pump();
    expect(calls.submitted).toEqual([['s1', 'x']]);
  });

  it('input：提示行在场 → 提交应答；abort → 空串 + 残稿清框', async () => {
    const { io, backend, calls, pump } = makeInteractive();
    const p1 = backend.input('名字？');
    pump();
    expect(io.bytes).toContain('? 名字？'); // 提示行
    io.emitInput('berry\r');
    pump();
    await expect(p1).resolves.toBe('berry');
    expect(calls.submitted).toEqual([]); // 应答不落 onSubmit
    io.bytes = '';
    pump();
    expect(io.bytes).not.toContain('名字？'); // 提示行已撤

    const ac = new AbortController();
    const p2 = backend.input('补充？', { signal: ac.signal });
    pump();
    io.emitInput('残稿'); // 中途输入
    pump();
    ac.abort();
    await expect(p2).resolves.toBe('');
    io.emitInput('x\r'); // 残稿已清——框内只有 x
    pump();
    expect(calls.submitted).toEqual([['s1', 'x']]);
  });

  it('overlay 占焦期编辑器非聚焦：› 降档 dim（bold 退）+ 光标回退屏底（R-6 翻档——两态色退役）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('a');
    pump(); // 有变更才有帧——差分只重写内容行：聚焦 › bold 提示符在场
    expect(io.bytes).toContain('\x1b[1m›');
    const p = backend.confirm('占焦？');
    io.bytes = '';
    pump();
    expect(io.bytes).not.toContain('\x1b[1m›'); // 非聚焦 › 降档 dim——bold 退场（R-6 翻档：secondary 退役）
    expect(io.bytes).toContain('\x1b[2m›'); // dim › 在场
    expect(io.bytes.endsWith('\x1b[10;1H')).toBe(true); // 无光标声明回退屏底
    io.emitInput('\r');
    io.bytes = '';
    pump();
    await expect(p).resolves.toBe(true);
    expect(io.bytes).toContain('\x1b[1m›'); // 层关复聚焦——bold › 回归（R-6 翻档锚）
  });
});

// —— 应答段底部迁移（2026-10-08 TUI 对标 Codex 五件批 D 件——07 §4.3 呈现位
// 翻档 + V-3 注⑦ ⑤ 底栈扩段对端注）：审批/confirm/select 面板与 input-ask
// 提示行自固定区顶部段迁编辑器下方**应答段**（编辑器 → ask 行 → 面板栈 →
// 工具进度 → footer → JobPanel——紧邻 footer 族与子 Agent 同区域）；占焦模态
// 律/键路由/排队 FIFO 零变化（呈现位迁移非交互语义迁移）；补全弹层已随
// 2026-10-10 Codex 样式复刻批 R-6 迁编辑器下方弹出位（段序：编辑器 → 弹层 →
// ask 行/应答段；fixed-budget 梯不动——牺牲序不变）。
describe('TuiBackend 应答段底部迁移（07 §4.3 呈现位翻档——面板/ask 行居编辑器下方）', () => {
  /**
   * 屏上行序取证（行序断言辅助）：差分帧序 ≠ 屏上行序（增量帧只重写变更
   * 行、帧间先来后到由事件序决定）——emitResize 触发 renderFixed 全量重画
   * 帧，帧内文本序即屏上行序；取末帧做 indexOf 比较才忠实锁「谁在上谁在
   * 下」。
   */
  const lastFullFrame = (
    io: { frames: readonly string[]; emitResize(): void },
    flushResizeDebounce: () => void,
  ): string => {
    io.emitResize(); // resize 路 75ms 尾随防抖（41 轮件 I）——flushResize 推窗到点触发全量重画帧
    flushResizeDebounce();
    // 全量重画 = 末个清屏帧（\x1b[2J）起的整段写出（后续 region/cup/行写出/
    // 归位尾帧同属一次重画编舞）——拼接后文本序即屏上行序
    let clearIdx = -1;
    for (let i = io.frames.length - 1; i >= 0; i--) {
      if (io.frames[i]!.includes('\x1b[2J')) {
        clearIdx = i;
        break;
      }
    }
    return io.frames.slice(clearIdx + 1).join('');
  };

  // confirm 不随件 B 审批迁底栈带（用户仅点名审批——07 §4.3 2026-10-16 批注：
  // 「问问题」族维持编辑器下方现位）：本 it 即 confirm 应答段现位锁
  it('confirm 面板呈现于编辑器下方（修前红：屏顶浮层先于编辑器）', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    io.emitInput('a');
    pump(); // 聚焦 › 在场——首帧全量铺屏
    const p = backend.confirm('下方确认？');
    pump();
    const frame = lastFullFrame(io, () => clock.advance(75));
    const prompt = frame.indexOf('›');
    const panel = frame.indexOf('下方确认');
    expect(prompt).toBeGreaterThanOrEqual(0); // 编辑器在屏（全量帧含 ›）
    expect(panel).toBeGreaterThanOrEqual(0); // 面板在场
    expect(prompt).toBeLessThan(panel); // 修前红：屏顶浮层——面板行先于编辑器行
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe(true);
  });

  it('askApproval 面板迁底栈带：footer 状态行之后、与 JobPanel 同带（件 B 修前红：编辑器下方应答段）', async () => {
    // rig 注 footer（行1 仪表首槽 'Auto'——底栈带行序锚）；16 行窗：编辑器 3 +
    // 审批面板 ~8 + footer 两行并陈需高窗
    const { io, backend, clock, pump } = makeInteractive(
      {
        footer: {
          tiers: () => ({ mode: 'Auto', thinking: '思考高', sandbox: '工作区写', sandboxDanger: false }),
          sessionSpent: () => 500,
          modelLabel: 'zai/glm-4.7',
          cwdLabel: () => 'berry-agent',
        },
      },
      16,
    );
    io.emitInput('a');
    pump();
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    const frame = lastFullFrame(io, () => clock.advance(75));
    expect(frame.indexOf('›')).toBeGreaterThanOrEqual(0);
    expect(frame.indexOf('⚙ 写入文件')).toBeGreaterThanOrEqual(0); // 面板标题（V-0 注⑤动词位）
    expect(frame.indexOf('Auto')).toBeGreaterThanOrEqual(0); // footer 行1 仪表首槽（rig 注入——行序锚）
    // 编辑器仍在面板上方（对话本体序不变——迁位不越编辑器）
    expect(frame.indexOf('›')).toBeLessThan(frame.indexOf('⚙ 写入文件'));
    // 修前红：审批面板现渲染于段六（编辑器下方应答段）先于 footer；迁位后钉
    // 底栈带段八之一.五——footer 状态行之后、JobPanel 之前（用户令「跟子代理
    // 是一个区域的」；拼接序即屏上行序——indexOf 比较即行序比较）
    expect(frame.indexOf('⚙ 写入文件')).toBeGreaterThan(frame.indexOf('Auto'));
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('approve');
  });

  it('input-ask 提示行迁编辑器下方（修前红：编辑器上方段）', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    io.emitInput('a');
    pump();
    const p = backend.input('下方问？');
    pump();
    const frame = lastFullFrame(io, () => clock.advance(75));
    expect(frame.indexOf('›')).toBeGreaterThanOrEqual(0);
    expect(frame.indexOf('? 下方问？')).toBeGreaterThanOrEqual(0); // 提示行在场
    expect(frame.indexOf('›')).toBeLessThan(frame.indexOf('? 下方问？')); // 修前红
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答');
  });

  it('补全弹层迁编辑器下方弹出位（R-6 修前红：编辑器上方弹出位）', () => {
    // 自含 rig（autocompleteRig 系他 describe 块内函数不达——同形自建）
    const { io, clock } = makeInteractive({
      autocomplete: {
        commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
      },
    });
    io.emitInput('/he');
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1); // 防抖窗到——查询落层弹层在场
    const frame = lastFullFrame(io, () => clock.advance(75));
    // 编辑器行锚 = 聚焦 › 提示符转义形（bold + 空格 + reset——R-6 翻档后
    // 聚焦 › 恒 bold 默认前景）；弹层 label 行 2 空格前缀（光标符已退役）
    // 不含 › 字符——› 字符全域唯 composer 提示符位
    const editorRow = frame.indexOf('\x1b[1m› \x1b[0m');
    expect(frame.indexOf('帮助')).toBeGreaterThanOrEqual(0);
    expect(editorRow).toBeGreaterThanOrEqual(0);
    expect(editorRow).toBeLessThan(frame.indexOf('帮助')); // 修前红：弹层行在编辑器行上方
  });
});

describe('TuiBackend ask 撤销面（07 §4.3 撤销句翻档——⏹ 行审批 ask 专属〔挖掘 36 轮 [2]〕+ 迟到 abort 不误写）', () => {
  it('confirm：abort → false + 零撤销瞬时行（⏹ 已取消确认退役——撤销呈现归 ask-decision 落史行）；面板已 done 后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    // 路一：外部 abort 传播到时层仍在屏——层关 + 保守值；撤销呈现归落史行
    //（核侧 UiCore 单汇点——后端直调形零撤销痕迹）
    const ac1 = new AbortController();
    const p1 = backend.confirm('一？', { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe(false); // 保守值
    pump();
    expect(io.bytes).not.toContain('已取消确认'); // ⏹ 瞬时行退役（挖掘 36 轮 [2]）

    // 路二：Enter 应答收场（面板 done）后 abort 迟到——零说明行
    const ac2 = new AbortController();
    const p2 = backend.confirm('二？', { signal: ac2.signal });
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe(true);
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹'); // 不误写
  });

  it('select：abort → 空串 + 零撤销瞬时行（⏹ 已取消选择退役同律）；已选定后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    const choices = [{ value: 'a', label: '甲' }];
    const ac1 = new AbortController();
    const p1 = backend.select('选', choices, { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe('');
    pump();
    expect(io.bytes).not.toContain('已取消选择'); // ⏹ 瞬时行退役（挖掘 36 轮 [2]）

    const ac2 = new AbortController();
    const p2 = backend.select('再选', choices, { signal: ac2.signal });
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('a');
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹');
  });

  it('approval：abort → cancel + 撤销说明行（文案区分于阻塞三件）；已答后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    const ac1 = new AbortController();
    const p1 = backend.askApproval('s1', { summary: '写' }, { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe('cancel'); // 审批项保守值（收口三则同源条款）
    pump();
    expect(io.bytes).toContain('\r⏹ 已取消审批\n'); // 「审批」文案与提问/确认/选择分立

    const ac2 = new AbortController();
    const p2 = backend.askApproval('s1', { summary: '二' }, { signal: ac2.signal });
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('approve');
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹');
  });

  it('input：abort → 空串 + 零撤销瞬时行（⏹ 已取消提问退役——挖掘 36 轮 [2]）；inputAsk 已换（应答收场）后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    const ac1 = new AbortController();
    const p1 = backend.input('名字？', { signal: ac1.signal });
    pump();
    expect(io.bytes).toContain('? 名字？'); // 提示行曾在屏
    io.emitInput('草稿');
    pump();
    io.bytes = ''; // 应答期帧不计入撤销断言
    ac1.abort();
    await expect(p1).resolves.toBe('');
    pump();
    expect(io.bytes).not.toContain('已取消提问'); // ⏹ 瞬时行退役——撤销呈现归落史行
    expect(io.bytes).not.toContain('? 名字？'); // 提示行已撤

    // inputAsk 已换（新 ask 顶上）后旧 signal abort——不误写、不打扰新 ask
    const ac2 = new AbortController();
    const p2 = backend.input('补充？', { signal: ac2.signal });
    pump();
    io.emitInput('答\r'); // 应答收场（inputAsk → null）
    pump();
    await expect(p2).resolves.toBe('答');
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹');
  });
});

// —— ask 浮层异会话 overlay 呈现串行化（07 §4.3 提问队列条 2026-10-04 定形注）：
// TUI overlay 呈现位全局单槽（跨会话亦单——「用户同一时刻只答一个问题」的跨会话
// 推广）；per-session 队列律在通道核不动（present() 仍 start 时即调），串行化纯
// 属后端 overlay 呈现层——槽被占即入呈现等待队列（首次呈现到达序），先呈者占槽
// 至落定即顶上；等待位收场 = 从未在屏 → 静默撤销（零撤销说明行）。
describe('TuiBackend ask 浮层异会话串行（07 §4.3 异会话 overlay 呈现串行化）', () => {
  it('两 ask 串行：第二件等槽不并开——先呈者落定即顶上（修前红：栈式并开两层）', async () => {
    const { io, backend, pump } = makeInteractive();
    const p1 = backend.confirm('一？');
    pump();
    expect(io.bytes).toContain('一？'); // 首件即呈（槽空闲）
    io.bytes = '';
    const p2 = backend.confirm('二？'); // 第二件——槽被占，入呈现等待位
    pump();
    expect(io.bytes).not.toContain('二？'); // 修前红：overlay 栈式并开——第二层照样上屏遮首件
    expect(io.bytes).toContain('他会话有待答问题'); // 等待位可观测（匿名提示形——规范原句）
    io.emitInput('\r'); // 应答首件（单槽——修前键被顶层第二层截走）
    pump();
    await expect(p1).resolves.toBe(true);
    expect(io.bytes).toContain('二？'); // 槽释放——第二件顶上
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe(true);
  });

  it('槽释放按首次呈现到达序激活：三件 FIFO——二件顶上时三件仍在等待位', async () => {
    const { io, backend, pump } = makeInteractive();
    const p1 = backend.confirm('一？');
    const p2 = backend.confirm('二？');
    const p3 = backend.confirm('三？');
    pump();
    expect(io.bytes).toContain('一？'); // 恰队首（首件）呈现
    expect(io.bytes).not.toContain('二？');
    expect(io.bytes).not.toContain('三？');
    expect(io.bytes.match(/他会话有待答问题/g)?.length).toBe(2); // 每等待位一条提示
    io.emitInput('\r');
    pump();
    await expect(p1).resolves.toBe(true);
    expect(io.bytes).toContain('二？'); // 到达序：二先于三顶上
    expect(io.bytes).not.toContain('三？');
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe(true);
    expect(io.bytes).toContain('三？'); // 三顶上
    io.emitInput('\r');
    pump();
    await expect(p3).resolves.toBe(true);
  });

  it('等待位静默撤销：等待中 abort → 保守值收口、零撤销说明行、问句从未上屏', async () => {
    const { io, backend, pump } = makeInteractive();
    const p1 = backend.confirm('一？');
    pump();
    const ac = new AbortController();
    const p2 = backend.confirm('二？', { signal: ac.signal }); // 等待位（带 signal）
    pump();
    ac.abort(); // 等待位撤销——从未在屏（「曾在屏者」判据的等待态推广）
    await expect(p2).resolves.toBe(false); // 保守值
    pump();
    expect(io.bytes).not.toContain('⏹'); // 静默撤销：零撤销说明行（修前红：层在屏——⏹ 行照落）
    expect(io.bytes).not.toContain('二？'); // 问句从未上屏（修前红：栈式并开）
    io.emitInput('\r'); // 首件不受扰——正常应答
    pump();
    await expect(p1).resolves.toBe(true);
  });

  it('败腿锁：槽释放时本件已落定 → 不开层不落撤销行——释放扫队跳过、后继顶上', async () => {
    const { io, backend, pump } = makeInteractive();
    const p1 = backend.confirm('一？');
    pump();
    const ac2 = new AbortController();
    const p2 = backend.confirm('二？', { signal: ac2.signal }); // 等待位 [二]
    pump();
    const p3 = backend.confirm('三？'); // 等待位 [二, 三]
    pump();
    ac2.abort(); // 二先落定（等待位静默撤销）
    await expect(p2).resolves.toBe(false);
    io.bytes = '';
    io.emitInput('\r'); // 应答一——槽释放扫队
    pump();
    expect(io.bytes).not.toContain('⏹'); // 修前红：二在屏（栈式并开）——abort 撤销行照落
    expect(io.bytes).toContain('三？'); // 三顶上（二的落定残位不阻后继）
    io.emitInput('\r');
    pump();
    await expect(p1).resolves.toBe(true);
    await expect(p3).resolves.toBe(true);
  });

  it('跨件别同槽：askApproval 等槽——confirm 落定后审批面板顶上', async () => {
    const { io, backend, pump } = makeInteractive();
    const p1 = backend.confirm('一？');
    pump();
    const p2 = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    expect(io.bytes).not.toContain('写文件'); // 修前红：审批层并开上屏
    io.emitInput('\r'); // 应答 confirm——槽释放
    pump();
    await expect(p1).resolves.toBe(true);
    expect(io.bytes).toContain('⚙ 写入文件：写文件'); // 审批面板顶上（V-0 注⑤动词位标题）
    io.emitInput('\r'); // 高亮首项 = 批准
    pump();
    await expect(p2).resolves.toBe('approve');
  });
});

describe('TuiBackend 渲染合并与 tick 自驱', () => {
  it('帧合并：多事件一帧落地（pump 前零写出）', () => {
    const rig = makeInteractive();
    rig.backend.onEnvelope(
      { sessionId: 's1', event: { type: 'message_end', message: { role: 'user', content: '问一', timestamp: 1 } } },
      true,
    );
    rig.backend.onEnvelope(
      { sessionId: 's1', event: { type: 'message_end', message: { role: 'user', content: '问二', timestamp: 2 } } },
      true,
    );
    expect(rig.io.bytes).toBe(''); // 未泵——零写出（合并位）
    rig.pump();
    expect(rig.io.bytes).toContain('问一');
    expect(rig.io.bytes).toContain('问二');
  });

  it('transient 到达序保持（present 与 transient 交错）', () => {
    const rig = makeInteractive();
    const user = (text: string, ts: number) =>
      rig.backend.onEnvelope(
        { sessionId: 's1', event: { type: 'message_end', message: { role: 'user', content: text, timestamp: ts } } },
        true,
      );
    user('问一', 1);
    rig.backend.notify('通知', { level: 'info' });
    user('问二', 2);
    rig.pump();
    const bytes = rig.io.bytes;
    expect(bytes.indexOf('问一')).toBeLessThan(bytes.indexOf('• 通知'));
    expect(bytes.indexOf('• 通知')).toBeLessThan(bytes.indexOf('问二'));
  });

  it('transient 让位流式槽：槽在场缓冲、定稿关槽帧补吐（批 10k 遗漏修——瞬时行不嵌入槽首行位）', () => {
    const rig = makeInteractive();
    emit(rig.backend, { type: 'message_start', role: 'assistant' });
    emit(rig.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式中') });
    rig.pump();
    rig.io.bytes = '';
    // 槽在场瞬时行（notify）：直写会落槽首行位（gotoRow(durableEndRow) 起笔
    // ——嵌入槽内破槽形）——缓冲不落屏
    rig.backend.notify('槽期通知', { level: 'info' });
    rig.pump();
    expect(rig.io.bytes).not.toContain('槽期通知');
    // 定稿关槽 → 缓冲补吐在定稿块之后（到达序保持）
    emit(rig.backend, { type: 'message_end', message: assistantMsg('定稿') });
    rig.pump();
    expect(rig.io.bytes).toContain('定稿');
    expect(rig.io.bytes).toContain('槽期通知');
    expect(rig.io.bytes.indexOf('定稿')).toBeLessThan(rig.io.bytes.indexOf('槽期通知'));
  });

  it('帧内交错序①：槽期入队 notify 与关槽 present 同帧——瞬时行落定稿块后非嵌槽首（到达时刻槽判定）', () => {
    // 修前红：flush 的 transient 槽判定读 flush 开始时 snapshot（已被同帧 message_end
    // 推进到定稿——未来态），[transient, present(关槽)] 帧内序判「无槽」直写——
    // 瞬时行先于定稿块字节写出且落槽首行位（流式预览被原地覆写破槽形）。修后：
    // 入队时刻（appendTransientLines）已按当时 snapshot 判槽在场 → slotTransients
    // 让位，关槽帧 present 落地后排空——瞬时行出现在定稿块之后（关槽排空序）
    const rig = makeInteractive();
    emit(rig.backend, { type: 'message_start', role: 'assistant' });
    emit(rig.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式预览') });
    rig.pump(); // 前置：流式槽帧已落地、pendingOps 清空（notify 入队时队内无 present op）
    rig.io.bytes = '';
    // 同帧合并窗内到达序：notify（槽期）先、message_end 关槽 present 后
    rig.backend.notify('槽期通知', { level: 'info' });
    emit(rig.backend, { type: 'message_end', message: assistantMsg('定稿') });
    rig.pump(); // 单帧落地：ops = [transient, present(关槽)]
    expect(rig.io.bytes).toContain('定稿');
    expect(rig.io.bytes).toContain('槽期通知');
    // 关槽排空序：瞬时行在定稿块之后（修前：直写嵌槽首——先于定稿块字节）
    expect(rig.io.bytes.indexOf('定稿')).toBeLessThan(rig.io.bytes.indexOf('槽期通知'));
  });

  it('帧内交错序②：无槽期入队 notify 与开槽 present 同帧——瞬时行先于流式块直写非延迟关槽（到达时刻槽判定）', () => {
    // 修前红：flush 读 flush 开始时 snapshot（已被同帧 message_update 推进到开槽
    // ——未来态），[transient, present(开槽)] 帧内序判「有槽」塞 slotTransients——
    // 通知延迟到关槽帧、排到整条流式消息之后。修后：入队时刻判无槽 → pendingOps
    // 入队，flush 无条件直写（到达序——流式块在其下起笔）
    const rig = makeInteractive();
    emit(rig.backend, { type: 'message_end', message: { role: 'user', content: '问', timestamp: 1 } });
    rig.pump(); // 前置：user 块落地、无槽、pendingOps 清空
    rig.io.bytes = '';
    // 同帧合并窗内到达序：notify（无槽期）先、message_start/update 开槽 present 后
    rig.backend.notify('无槽通知', { level: 'info' });
    emit(rig.backend, { type: 'message_start', role: 'assistant' });
    emit(rig.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式正文') });
    rig.pump(); // 单帧落地：ops = [transient, present(开槽)]
    expect(rig.io.bytes).toContain('无槽通知'); // 修前红：误判有槽入槽缓冲——本帧零写出
    // 到达序直写：瞬时行先于流式块（修前：滞留槽缓冲延迟到关槽帧）
    expect(rig.io.bytes.indexOf('• 无槽通知')).toBeLessThan(rig.io.bytes.indexOf('流式正文'));
  });

  it('权威清点抢救合并窗瞬时行：resize/repaint 清点不丢未落帧 notify（第五役 S1-a——修前裸清永失）', () => {
    // 修前红：resize/repaint 的 pendingOps 裸清会丢弃合并窗内已入队未落帧的
    // notify 行——既不入 scrollback（screen.appendTransient 未达）也不复显，
    // pump 后 bytes 恒无此行即永失（与 suspendMain 挂起转账律不对称的破口）
    const rig = makeInteractive();
    rig.backend.notify('resize 前窗内通知', { level: 'info' });
    expect(rig.io.bytes).toBe(''); // 合并窗持有——未落帧零写出
    rig.io.emitResize(); // 权威清点路（handleResize——75ms 尾随防抖后置，41 轮件 I）
    rig.clock.advance(75); // 防抖窗到：窗内帧先落 notify 再权威清点抢救（已落账面）
    expect(rig.io.bytes).toContain('resize 前窗内通知'); // 修前红：清点丢弃——行永失

    // onRepaint 同律（切焦权威重建路）
    const rig2 = makeInteractive();
    rig2.backend.notify('repaint 前窗内通知', { level: 'info' });
    rig2.backend.onRepaint('s2', [], null);
    rig2.pump();
    expect(rig2.io.bytes).toContain('repaint 前窗内通知'); // 修前红：同裸清破口
  });

  it('编辑器键位覆盖注入（批 10k 遗漏修——keymap 装配位缺注）', () => {
    const { io, calls, clock, pump } = makeInteractive({
      keybindings: { 'editor.new-line': 'alt+j' }, // 换行键改 alt+j——ctrl+j 缺省位让位
    });
    // 键序可区分：alt+j 在前（覆盖生效 = 换行；缺注缺省册 = 无动作）、
    // ctrl+j 在后（覆盖生效 = 无动作；缺省册 = 换行）——两态提交文互异
    io.emitInput('a');
    io.emitInput('\x1bj'); // alt+j（legacy ESC 前缀形）——覆盖后的换行位
    escapePump(clock); // lone-ESC 判定窗推进（ESC j 二义性收束）
    io.emitInput('b');
    io.emitInput('\x0a'); // ctrl+j——覆盖后不再换行
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([['s1', 'a\nb']]); // alt+j 换行生效、ctrl+j 未换（缺注态为 'ab'）
  });

  it('tick 自驱：忙态转轮推帧、闲态零写出、stop 后静默', () => {
    const rig = makeInteractive();
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    rig.pump();
    rig.io.bytes = '';
    rig.clock.advance(100); // tick 窗到——推第二帧
    expect(rig.io.bytes).toContain('⠙');
    rig.clock.advance(100);
    expect(rig.io.bytes).toContain('⠹'); // 第三帧（转轮帧序 ⠋⠙⠹——推进有据）
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_end', status: 'completed' } }, true);
    rig.pump();
    rig.io.bytes = '';
    rig.clock.advance(300); // 闲态——tick 零写出
    expect(rig.io.bytes).toBe('');
    rig.backend.stop();
    rig.io.bytes = '';
    rig.clock.advance(300); // stop 后定时器全收
    expect(rig.io.bytes).toBe('');
  });
});

/* ================= 呈现面件 4/5/6（todo 面板 / 工具进度 / usage 状态行） ================= */

/** 定制 usage 的 assistant 消息（件 6 累加数据源） */
function usageMsg(totalTokens: number): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '答' }],
    usage: { input: totalTokens - 50, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens },
    stopReason: 'stop',
    timestamp: 1,
  };
}

describe('TuiBackend todo 面板（件 4）', () => {
  it('todoFor 注入：tool_execution_end 写后即显 + agent_end 刷新 + 空表清板', () => {
    let todos: { status: 'pending' | 'in-progress' | 'completed'; content: string; activeForm?: string }[] = [
      { status: 'pending', content: '写规范' },
      { status: 'in-progress', content: '码实现', activeForm: '正在码实现' },
    ];
    const { io, backend } = makeBackend({ todoFor: () => todos });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    expect(io.bytes).toContain('☐ 写规范'); // 写后即显（刷新三时点之二）
    expect(io.bytes).toContain('◐ 正在码实现'); // activeForm 优先
    todos = [{ status: 'completed', content: '写规范' }]; // 快照推进（工具跑完 todo 完成）
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('☑ 写规范'); // 刷新三时点之三——拉到新快照（行级差分写变行）
    // R-1 间隔迁移：todos 2→1 行固定区 8→7 收缩重设——新底 = 10-7-1 = 2 在场；
    // 旧底 1（todos 2 行形 10-8-1）不残留（agent_end 窗内零旧值重设）
    expect(io.bytes).toContain('\x1b[1;2r');
    expect(io.bytes).not.toContain('\x1b[1;1r');
  });

  it('空表清板（null 与 [] 同义——面板退场）', () => {
    let todos: { status: 'pending'; content: string }[] | null = [{ status: 'pending', content: '任务' }];
    const { io, backend } = makeBackend({ todoFor: () => todos });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('☐ 任务');
    todos = [];
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('\x1b[1;3r'); // 固定区高回缩（清板——编辑器 5 + 状态行 1）→ 滚动区 1..3（R-1 间隔 1：10-6-1）——滚动区重设在场
    expect(io.bytes).not.toContain('☐ 任务');
  });

  it('todoFor 注入缺席 = 面板缺席零变化', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    expect(io.bytes).not.toContain('☐');
  });
});

describe('TuiBackend 工具进度面板（件 5）', () => {
  it('update 建行（宽容解码）/ 原位换行 / end 摘行 / agent_end 清板', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_update', toolCallId: 't1', update: '扫描中' });
    expect(io.bytes).toContain('• 搜索文本 · 扫描中'); // 首个 update 建行
    io.bytes = '';
    emit(backend, {
      type: 'tool_execution_update',
      toolCallId: 't1',
      update: { content: [{ type: 'text', text: '头部\n\n命中 3 处\n' }] },
    });
    expect(io.bytes).toContain('• 搜索文本 · 命中 3 处'); // 倒扫末条非空行
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    expect(io.bytes).not.toContain('• 搜索文本'); // end 即摘行

    emit(backend, { type: 'tool_execution_start', toolCallId: 't2', name: 'read', arguments: {} });
    emit(backend, { type: 'tool_execution_update', toolCallId: 't2', update: '读着' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('• 读取文件'); // agent_end 清板（瞬时面）
  });

  it('start 只建档不建行（面板零扰动）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    expect(io.bytes).not.toContain('• 搜索文本'); // 建档无行——工具名只进状态行
    expect(stripAnsi(io.bytes)).toContain('⚙ 搜索文本 …');
  });
});

describe('TuiBackend usage 状态行（件 6）', () => {
  it('message_end 暂存 → turn_end 累加 → agent_end 落「✓ 用量 N」', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(150) });
    io.bytes = '';
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    expect(io.bytes).not.toContain('用量'); // turn_end 是累加时点非呈现时点
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 150');
  });

  it('多轮累加 + 千位分组', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(1_500) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    emit(backend, { type: 'message_end', message: usageMsg(2_500) });
    emit(backend, { type: 'turn_end', turn: 2, stopReason: 'stop' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 4,000');
  });

  it('agent_start 归零清行（上一 run 尾注不跨 run）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(150) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 150');
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    expect(io.bytes).not.toContain('用量'); // 清行（忙态呈现转轮——尾注退场）
    emit(backend, { type: 'message_end', message: usageMsg(10) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 10'); // 归零重计（非 160）
  });

  it('repaint 清行并归零（切焦清账重计——件 6 尾注射界）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(150) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    backend.onRepaint(SESSION, [], null);
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('✓ 用量 150');
    expect(io.bytes).toContain('✓ 用量 0'); // 清账重计（零轮 run 亦如实呈现）
  });

  it('cost 在场并累货币额（usageView 观测面）', () => {
    const { backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '答' }],
        usage: {
          input: 50,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 100,
          cost: { total: 0.03, currency: 'USD' },
        },
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    expect(backend.usageView).toEqual({
      input: 50,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100,
      cost: 0.03,
      currency: 'USD',
    });
  });

  it('非聚焦事件不驱动 usage 累计（尾注只属聚焦会话）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: usageMsg(150) }, false);
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' }, false);
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('✓ 用量 150');
  });

  /* ---- 三反馈批C：token 速度段（run 级平均——件 6 扩段；V-4 注⑪⑦ 尾注速段退役） ---- */

  it('completed 落行无速段（V-4 注⑪⑦——尾注速段退役；用量值与千分位维持）', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t += 4000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 100');
    expect(io.bytes).not.toContain('tok/s'); // 速度段退役（速度面归行1——V-4 笔3）
    // 千分位格式化面维持（usage 值列 formatCount 单源不随速段退役）
    let t2 = 0;
    const rig2 = makeBackend({ now: () => t2 });
    emit(rig2.backend, { type: 'agent_start' });
    emit(rig2.backend, { type: 'message_end', message: usageMsg(2_500) });
    emit(rig2.backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t2 += 1000;
    rig2.io.bytes = '';
    emit(rig2.backend, { type: 'agent_end', status: 'completed' });
    expect(rig2.io.bytes).toContain('✓ 用量 2,500');
    expect(rig2.io.bytes).not.toContain('tok/s');
  });

  it('诚实缺席律：repaint 清账重计 / failed 终态分档维持（速度段已退役 V-4 注⑪⑦——not tok/s 锁防回潮）', () => {
    // ①时长 <1s：亚秒 run 平均速度无意义（用量行照常、零速段）
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t += 500;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 100');
    expect(io.bytes).not.toContain('tok/s');
    // ②零 token：无速度可言
    let t2 = 0;
    const rig2 = makeBackend({ now: () => t2 });
    emit(rig2.backend, { type: 'agent_start' });
    emit(rig2.backend, { type: 'message_end', message: usageMsg(0) });
    emit(rig2.backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t2 += 4000;
    rig2.io.bytes = '';
    emit(rig2.backend, { type: 'agent_end', status: 'completed' });
    expect(rig2.io.bytes).toContain('✓ 用量 0');
    expect(rig2.io.bytes).not.toContain('tok/s');
    // ③repaint 中途附着：清账连清起点时戳——无亲见 agent_start 的 run 不显速
    let t3 = 0;
    const rig3 = makeBackend({ now: () => t3 });
    emit(rig3.backend, { type: 'agent_start' });
    t3 += 2000;
    emit(rig3.backend, { type: 'message_end', message: usageMsg(150) });
    emit(rig3.backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    rig3.backend.onRepaint(SESSION, [], null); // 切焦清账（含时戳）
    t3 += 2000;
    rig3.io.bytes = '';
    emit(rig3.backend, { type: 'agent_end', status: 'completed' });
    expect(rig3.io.bytes).toContain('✓ 用量 0'); // 清账重计（repaint 后零轮）
    expect(rig3.io.bytes).not.toContain('tok/s');
    // ④failed 终态：维持分档形不加段（成功形专属；✗ 揭示随 retry_wait_end 翻档——批 4 持有档。
    //    窗口从翻档起算：持有窗内任务行按设计续显忙态速度段（态①），非终态证据）
    let t4 = 0;
    const rig4 = makeBackend({ now: () => t4 });
    emit(rig4.backend, { type: 'agent_start' });
    emit(rig4.backend, { type: 'message_end', message: usageMsg(100) });
    emit(rig4.backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t4 += 4000;
    emit(rig4.backend, { type: 'agent_end', status: 'failed', errorMessage: '炸了' });
    rig4.io.bytes = '';
    emit(rig4.backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    expect(rig4.io.bytes).toContain('✗ 失败');
    expect(rig4.io.bytes).not.toContain('tok/s');
  });

  it('speedView 观测面：run 中现算 running average / 终态冻结终值 / 无起点 null（批B footer 消费位）', () => {
    const idle = makeBackend();
    expect(idle.backend.speedView).toBe(null); // 无 run 无速度
    let t = 0;
    const { backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t += 2000;
    expect(backend.speedView).toBe(50); // run 中刷新锚时刻现算（100 / 2s）
    emit(backend, { type: 'agent_end', status: 'completed' }); // 终点时戳冻结分母（agent_end 到达于 t=2000）
    t += 2000;
    expect(backend.speedView).toBe(50); // 终态后保持终值（分母冻结于 2s——不随墙钟漂移；未冻结将漂至 100/4s=25）
    emit(backend, { type: 'agent_start' }); // 清账连清——新 run 起点重记
    expect(backend.speedView).toBe(null); // 新 run 零 token（<1s 且零账双缺席）
  });
});

/* ================= 呈现面件 7（终端外显 OSC） ================= */

describe('TuiBackend 终端外显（件 7）', () => {
  it('起屏基线 title：version 缺席 = 裸名 / 注入 = berry-agent <版本> / 空串同缺席', () => {
    const bare = makeBackend();
    expect(bare.io.frames).toContain(oscTitle('berry-agent'));
    const versioned = makeBackend({ version: '1.2.3' });
    expect(versioned.io.frames).toContain(oscTitle('berry-agent 1.2.3'));
    // 空串边角回归锁（修复前必红）：`berry-agent ` 尾随空格脏基线
    const empty = makeBackend({ version: '' });
    expect(empty.io.frames).toContain(oscTitle('berry-agent'));
    expect(empty.io.frames).not.toContain(oscTitle('berry-agent '));
  });

  it('按会话净计数忙态：任一会话在飞即忙——并存不清零（终端标签页注意力模型）', () => {
    const { io, backend } = makeBackend();
    const env = (sessionId: string, event: AgentEvent, focused: boolean): void => {
      backend.onEnvelope({ sessionId, event }, focused);
    };
    env('sess-a', { type: 'agent_start' }, true); // 会话 A 起（聚焦位）——忙
    expect(io.bytes).toContain(PROGRESS_ACTIVE);
    io.bytes = '';
    env('sess-b', { type: 'agent_start' }, false); // 会话 B 起（非聚焦位）——仍忙零迁移写出
    expect(io.bytes).not.toContain(PROGRESS_ACTIVE);
    io.bytes = '';
    env('sess-a', { type: 'agent_end', status: 'completed' }, false); // A 落——B 仍在飞
    expect(io.bytes).not.toContain(PROGRESS_CLEAR);
    io.bytes = '';
    env('sess-b', { type: 'agent_end', status: 'completed' }, true); // 末路落——清零
    expect(io.bytes).toContain(PROGRESS_CLEAR);
  });

  it('切焦跨路回归锁：聚焦起 + 非聚焦收（run 跨切焦）——归闲 + 保活停针', () => {
    const rig = makeInteractive();
    // 会话 s1 聚焦时起 run（事件时刻 focused=true）
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    rig.pump();
    expect(rig.io.bytes).toContain(PROGRESS_ACTIVE); // 起——忙
    // 用户切焦会话 s2（repaint 不清在飞账——在飞事实与焦点正交）
    rig.backend.onRepaint('s2', [], null);
    // s1 的 run 在非聚焦位收尾（事件时刻 focused=false——按事件时刻聚焦位分两路时
    // end 减非聚焦路被 clamp 吞、聚焦路残 1 永忙；按 sessionId 归账恒落同一会话账）
    rig.io.bytes = '';
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_end', status: 'completed' } }, false);
    rig.pump();
    expect(rig.io.bytes).toContain(PROGRESS_CLEAR); // 实际无会话在飞——归闲（修复前必红：永忙零写出）
    rig.io.bytes = '';
    const activeCount = (): number => rig.io.frames.filter((f) => f === PROGRESS_ACTIVE).length;
    const sealed = activeCount(); // 归闲时刻封账（修复前永续——advance 后账目增长）
    rig.clock.advance(3000); // 保活停针——归闲后零重发（状态行转轮是件 3 聚焦路面——非聚焦 end 不收其转，转轮字节与本锚无关）
    expect(activeCount()).toBe(sealed);
  });

  // ── 桌面通知（挖掘 36 轮 notify-osc9——第三写点触发四档/焦点门控/载波/合并律） ──
  /** 通知帧过滤：OSC 9 桌面通知帧（`OSC 9;<文案>`——与 OSC 9;4 进度族按载荷首段分立） */
  const notifyFrames = (io: MemoryTerminalIO): string[] =>
    io.frames.filter((f) => f.startsWith('\x1b]9;') && !f.startsWith('\x1b]9;4;'));
  /** BEL 通知帧过滤（纯单字节帧——progress 序列含 \x07 但非纯帧） */
  const belFrames = (io: MemoryTerminalIO): string[] => io.frames.filter((f) => f === '\x07');
  /** 终端失焦驱动（DECSET 1004 应答——backend 解码器消费；缺省聚焦乐观律） */
  const blur = (io: MemoryTerminalIO): void => io.emitInput('\x1b[O');

  it('通知缺席注入律：desktopNotify 缺席 / off = 通道关（终态零通知字节——缺席仍写 1004 模式串）', () => {
    for (const opts of [{}, { desktopNotify: 'off' as const }]) {
      const { io, backend } = makeBackend(opts);
      expect(io.frames[0]).toBe(MAIN_ENTER); // 缺席仍开 1004（模式串位与通知门分立）
      io.bytes = '';
      io.frames.length = 0;
      blur(io);
      emit(backend, { type: 'message_end', message: assistantMsg('答案') });
      emit(backend, { type: 'agent_end', status: 'completed' });
      emit(backend, { type: 'agent_end', status: 'failed', errorMessage: '某因' });
      emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
      expect(notifyFrames(io)).toEqual([]); // 零通知帧
      expect(belFrames(io)).toEqual([]); // 零 BEL 帧
      backend.stop();
    }
  });

  it('轮完成档：未聚焦 completed → OSC 9「本轮完成：{正文首行}」（auto+五家载波；多行取首行）', () => {
    const { io, backend } = makeBackend({ desktopNotify: 'auto', notifyEnv: { TERM_PROGRAM: 'ghostty' } });
    blur(io);
    emit(backend, { type: 'message_end', message: assistantMsg('第一行答案\n第二行不进通知') });
    io.frames.length = 0;
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(notifyFrames(io)).toEqual(['\x1b]9;本轮完成：第一行答案\x07']);
  });

  it('焦点门控：缺省聚焦弃发 / CSI O 后发 / CSI I 复焦再弃（不补发不重挂）', () => {
    const { io, backend } = makeBackend({ desktopNotify: 'auto', notifyEnv: { TERM_PROGRAM: 'kitty' } });
    emit(backend, { type: 'message_end', message: assistantMsg('答') });
    emit(backend, { type: 'agent_end', status: 'completed' }); // 缺省聚焦——弃
    expect(notifyFrames(io)).toEqual([]);
    blur(io);
    emit(backend, { type: 'message_end', message: assistantMsg('答二') });
    io.frames.length = 0;
    emit(backend, { type: 'agent_end', status: 'completed' }); // 失焦——发
    expect(notifyFrames(io)).toEqual(['\x1b]9;本轮完成：答二\x07']);
    io.emitInput('\x1b[I'); // 复焦
    emit(backend, { type: 'message_end', message: assistantMsg('答三') });
    io.frames.length = 0;
    emit(backend, { type: 'agent_end', status: 'completed' }); // 复焦——弃
    expect(notifyFrames(io)).toEqual([]);
  });

  it('预览缺席裸词：无 assistant 正文直 completed → 「本轮完成」（诚实缺席非陈摘要）', () => {
    const { io, backend } = makeBackend({ desktopNotify: 'osc9', notifyEnv: {} });
    blur(io);
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(notifyFrames(io)).toEqual(['\x1b]9;本轮完成\x07']);
  });

  it('失败档揭示延后：failed 零通知；retry_wait_end exhausted 携预存原因（两账分立）', () => {
    const { io, backend } = makeBackend({ desktopNotify: 'osc9', notifyEnv: {} });
    blur(io);
    emit(backend, { type: 'agent_end', status: 'failed', errorMessage: '模型渠道未配置' });
    expect(notifyFrames(io)).toEqual([]); // 重试路上不响假警报（V-0 注② 同律）
    io.frames.length = 0;
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    expect(notifyFrames(io)).toEqual(['\x1b]9;本轮失败：模型渠道未配置\x07']);
    io.frames.length = 0;
    emit(backend, { type: 'agent_start' }); // 新 run 清账
    emit(backend, { type: 'agent_end', status: 'failed' }); // 无因 failed
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    expect(notifyFrames(io)).toEqual(['\x1b]9;本轮失败\x07']); // 原因缺席裸词
  });

  it('中止档：aborted → 「本轮已中止」；resumed 续入零通知', () => {
    const { io, backend } = makeBackend({ desktopNotify: 'osc9', notifyEnv: {} });
    blur(io);
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(notifyFrames(io)).toEqual(['\x1b]9;本轮已中止\x07']);
    io.frames.length = 0;
    emit(backend, { type: 'agent_end', status: 'failed', errorMessage: 'x' });
    emit(backend, { type: 'retry_wait_end', outcome: 'resumed' }); // 续入非终态
    expect(notifyFrames(io)).toEqual([]);
  });

  it('载波三形：auto+TMUX → BEL 降级；明示 osc9+TMUX → DCS 包裹；明示 bel 直用', () => {
    const tmux = { TMUX: '/tmp/tmux-501/default,1,0' };
    const auto = makeBackend({ desktopNotify: 'auto', notifyEnv: tmux });
    blur(auto.io);
    emit(auto.backend, { type: 'agent_end', status: 'aborted' });
    expect(notifyFrames(auto.io)).toEqual([]); // 降级形零 OSC 9 通知帧
    expect(belFrames(auto.io)).toEqual(['\x07']); // BEL 单字节帧
    const forced = makeBackend({ desktopNotify: 'osc9', notifyEnv: tmux });
    blur(forced.io);
    emit(forced.backend, { type: 'agent_end', status: 'aborted' });
    expect(forced.io.frames).toContain('\x1bPtmux;\x1b\x1b]9;本轮已中止\x07\x1b\\'); // DCS 透传包裹
    const bel = makeBackend({ desktopNotify: 'bel', notifyEnv: { TERM_PROGRAM: 'ghostty' } }); // 明示压过探测
    blur(bel.io);
    emit(bel.backend, { type: 'agent_end', status: 'aborted' });
    expect(notifyFrames(bel.io)).toEqual([]);
    expect(belFrames(bel.io)).toEqual(['\x07']);
  });

  it('同窗合并律：轮完成(0) 后窗内审批(1) 压过——到点只发最高（250ms 假钟窗）', () => {
    const rig = makeInteractive({ desktopNotify: 'auto', notifyEnv: { TERM_PROGRAM: 'ghostty' } });
    blur(rig.io);
    rig.io.frames.length = 0;
    emit(rig.backend, { type: 'message_end', message: assistantMsg('答') });
    emit(rig.backend, { type: 'agent_end', status: 'completed' }); // 轮完成入账（起 250ms 窗）
    expect(notifyFrames(rig.io)).toEqual([]); // 窗内未发
    void rig.backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' }); // 审批入账（压过）
    rig.io.frames.length = 0;
    rig.clock.advance(250); // 窗到点
    expect(notifyFrames(rig.io)).toEqual(['\x1b]9;等待审批：写入文件\x07']); // 只发最高优先级（恰一条）
  });

  it('低不覆盖高：审批(1) 在账 → 轮完成(0) 弃（同窗不降级）', () => {
    const rig = makeInteractive({ desktopNotify: 'auto', notifyEnv: { TERM_PROGRAM: 'wezterm' } });
    blur(rig.io);
    void rig.backend.askApproval('s1', { summary: '删文件' });
    emit(rig.backend, { type: 'agent_end', status: 'completed' }); // 低优先级——弃
    rig.io.frames.length = 0;
    rig.clock.advance(250);
    expect(notifyFrames(rig.io)).toEqual(['\x1b]9;等待审批：删文件\x07']); // 仍是审批文案
  });

  it('stop 收口：窗在飞 stop → cancel 摘针——窗到点零写出', () => {
    const rig = makeInteractive({ desktopNotify: 'auto', notifyEnv: { TERM_PROGRAM: 'ghostty' } });
    blur(rig.io);
    emit(rig.backend, { type: 'agent_end', status: 'aborted' }); // 入账起窗
    rig.io.frames.length = 0;
    rig.backend.stop(); // 终退收口（含通知窗 cancel）
    rig.clock.advance(250); // 窗位到点——针已摘
    expect(notifyFrames(rig.io)).toEqual([]); // 窗内未 flush 零写出
  });

  // ── 触发档白名单（挖掘 37 轮 settings-notify-key——第七键档位过滤；缺席 =
  // 全集不滤由上方正向测族兼任：completed/aborted/failed/审批四档均未传档位直发） ──
  it('档位子集过滤：关 turn-completed → completed 零帧；开 turn-aborted → aborted 照发（同 backend 两段）', () => {
    const { io, backend } = makeBackend({
      desktopNotify: 'osc9',
      notifyEnv: {},
      notifyTriggers: ['turn-aborted', 'turn-failed', 'approval-waiting'],
    });
    blur(io);
    io.frames.length = 0;
    emit(backend, { type: 'message_end', message: assistantMsg('答') });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(notifyFrames(io)).toEqual([]); // 白名单不含 turn-completed——零账零帧
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(notifyFrames(io)).toEqual(['\x1b]9;本轮已中止\x07']); // 白名单含 turn-aborted——照发
  });

  it('档位-事件映射：turn-failed 档辖 retry_wait_end 全 outcome 形；turn-aborted 档不辖真失败终态', () => {
    // 白名单只开 turn-aborted：真失败终态（retry_wait_end exhausted）在 turn-failed
    // 档辖下——关 turn-failed 即零帧（「中止」词跨两档的映射锁）
    const onlyAbort = makeBackend({ desktopNotify: 'osc9', notifyEnv: {}, notifyTriggers: ['turn-aborted'] });
    blur(onlyAbort.io);
    emit(onlyAbort.backend, { type: 'agent_end', status: 'failed', errorMessage: 'x' });
    emit(onlyAbort.backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    expect(notifyFrames(onlyAbort.io)).toEqual([]); // turn-failed 关——真失败零帧
    // 白名单只开 turn-failed：failed+exhausted 照发（含 aborted outcome 形同辖）
    const onlyFail = makeBackend({ desktopNotify: 'osc9', notifyEnv: {}, notifyTriggers: ['turn-failed'] });
    blur(onlyFail.io);
    emit(onlyFail.backend, { type: 'agent_end', status: 'failed', errorMessage: '某因' });
    emit(onlyFail.backend, { type: 'retry_wait_end', outcome: 'aborted' }); // 非 resumed 全形皆真失败终态
    expect(notifyFrames(onlyFail.io)).toEqual(['\x1b]9;本轮失败：某因\x07']);
  });

  it('空数组 = 显式全静默（合法形——与缺席〔= 全集〕两形分立）；审批档关 → askApproval 零帧', () => {
    const { io, backend } = makeBackend({ desktopNotify: 'osc9', notifyEnv: {}, notifyTriggers: [] });
    blur(io);
    emit(backend, { type: 'message_end', message: assistantMsg('答') });
    emit(backend, { type: 'agent_end', status: 'completed' });
    emit(backend, { type: 'agent_end', status: 'aborted' });
    emit(backend, { type: 'agent_end', status: 'failed', errorMessage: 'x' });
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    void backend.askApproval('s1', { summary: '写文件' }); // Promise 悬置不 await——档位判断在入口，不依赖应答
    expect(notifyFrames(io)).toEqual([]); // 空集全滤——四档全零帧
  });

  it('载波关先于档位：desktopNotify off + 白名单含档 → 仍零帧（两维分立——载波门短路优先）', () => {
    const { io, backend } = makeBackend({
      desktopNotify: 'off',
      notifyEnv: { TERM_PROGRAM: 'ghostty' },
      notifyTriggers: ['turn-completed'],
    });
    blur(io);
    io.frames.length = 0;
    emit(backend, { type: 'message_end', message: assistantMsg('答') });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(notifyFrames(io)).toEqual([]); // notifyConf null 先 return——档位判断不到达
  });

  it('审批档开：子集含 approval-waiting → askApproval 同步直出「等待审批」帧', () => {
    const { io, backend } = makeBackend({
      desktopNotify: 'osc9',
      notifyEnv: {},
      notifyTriggers: ['approval-waiting'],
    });
    blur(io);
    io.frames.length = 0;
    void backend.askApproval('s1', { summary: '删文件' });
    expect(notifyFrames(io)).toEqual(['\x1b]9;等待审批：删文件\x07']); // makeBackend 无钟——scheduleFn 缺席同步直出
    backend.stop(); // 悬置 ask 收口
  });

  it('重复 end 不穿底（clamp ≥ 0——净计数不越零，再 start 即忙）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' }, true);
    emit(backend, { type: 'agent_end', status: 'completed' }, true);
    emit(backend, { type: 'agent_end', status: 'completed' }, true); // 重复 end ×2
    io.bytes = '';
    emit(backend, { type: 'agent_start' }, true); // clamp 下 0→1 即忙（无 clamp 则 -1 不忙）
    expect(io.bytes).toContain(PROGRESS_ACTIVE);
  });

  it('onRepaint：title 点缀会话短 id（基线 · 短id）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    backend.onRepaint(SESSION, [], null);
    expect(io.bytes).toContain(oscTitle('berry-agent · sess-aaa'));
  });

  it('stop：复原两写点（title 复原基线 + 进度清零）', () => {
    const { io, backend } = makeBackend({ version: '0.9.0' });
    emit(backend, { type: 'agent_start' }, true); // 忙态在飞
    backend.onRepaint(SESSION, [], null); // title 已点缀短 id
    io.bytes = '';
    backend.stop();
    expect(io.bytes).toContain(oscTitle('berry-agent 0.9.0')); // 写点一：title 复原基线
    expect(io.bytes).toContain(PROGRESS_CLEAR); // 写点二：进度清零
  });

  it('忙态保活：注入调度下 1000ms 周期重发 + stop 停针后零重发', () => {
    const rig = makeInteractive();
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    rig.pump();
    const activeCount = (): number => rig.io.frames.filter((f) => f === PROGRESS_ACTIVE).length;
    const before = activeCount(); // 首写在账（frames 累积不随 bytes 重置清零）
    expect(before).toBe(1);
    rig.clock.advance(3000); // 三个保活窗——恰三次重发（单链不叠针）
    expect(activeCount() - before).toBe(3);
    rig.backend.stop(); // 复原两写点 + 保活停针（cancelTimer 名册语义）
    rig.io.bytes = '';
    rig.clock.advance(3000); // 停针后零重发
    expect(rig.io.bytes).toBe('');
    expect(activeCount() - before).toBe(3); // 停针封账——无新 ACTIVE
  });
});

/* ================= 主屏挂起面（批 10f-4——AltScreenPrimary 交出面） ================= */

/** 主屏形出 / 进屏模式串（tui-backend 单源常量的字节真源——对称反序互证锚） */
const MAIN_LEAVE = '\x1b[<u\x1b[?1004l\x1b[?2004l';
const MAIN_ENTER = '\x1b[?2004h\x1b[?1004h\x1b[>5u\x1b[?u\x1b[c';
/** 副屏 Engine 进出屏字节（集成测试序锚） */
const ALT_ENTER = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[?1004h\x1b[>5u\x1b[?u\x1b[c\x1b[?1002h\x1b[?1006h'; // 鼠标准入尾随（mu-2）+ 焦点应答位（notify-osc9）+ 推栈 >5u（52 轮件 C）
const ALT_LEAVE = '\x1b[?1006l\x1b[?1002l\x1b[<u\x1b[?1004l\x1b[?2004l\x1b[?25h\x1b[?1049l'; // 鼠标关停前置（对称反序）+ 焦点位对称收口

/** 副屏内容替身（集成测试——写文 + 事件终局吞掉） */
function altLayer(text: string): OverlayContent {
  return {
    measure: () => 1,
    render: (buffer, region) => {
      buffer.writeText(region.row, region.col, text);
    },
    handleEvent: () => true,
  };
}

describe('TuiBackend 主屏挂起面（suspendMain / resumeMain——批 10f-4）', () => {
  it('suspendMain 编舞：出屏串 + 停流 + 换防恒 raw + 卸输入监听 + lifecycle 迁移', () => {
    const { io, backend } = makeBackend();
    expect(backend.lifecycle).toBe('running');
    io.reset();
    backend.suspendMain();
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 出屏模式串（与 start 进屏对称反序）
    expect(io.pauseCount).toBe(1); // 停流（共享 io 换防——副屏随后 start 放流）
    // 换防恒 raw（2026-09-20 DA1 回显泄漏批）：不复先验——副屏同 tick 接管，
    // 关 raw 只开内核 ECHO 窗（挂起瞬间在途应答/连击被 ECHOCTL 回显上屏）；
    // 「raw 复先验」射程 = 交终端给子进程的挂起形（07 篇交出面条款换防例外注）
    expect(io.raw).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    io.reset();
    io.emitInput('x'); // 输入已卸订——编辑器不经手（无 echo 字节）
    expect(io.bytes).toBe('');
  });

  it('进屏 raw 先行：start / resumeMain 进屏串（含探测）写出前 raw 已设——应答永不落 ECHO 窗', () => {
    const { io, backend } = makeBackend();
    // start 段：ENTER_MAIN（含 DA1 探测）与 OSC 11 查询都在 raw 之后写出
    expect(io.ops.indexOf('raw:true')).toBeGreaterThanOrEqual(0);
    expect(io.ops.indexOf('raw:true')).toBeLessThan(io.ops.indexOf('write'));
    backend.suspendMain();
    io.reset();
    backend.resumeMain();
    // resumeMain 段同律（ENTER_MAIN 重发 + OSC 11 重查——应答竞速同受庇护）
    expect(io.ops.indexOf('raw:true')).toBeGreaterThanOrEqual(0);
    expect(io.ops.indexOf('raw:true')).toBeLessThan(io.ops.indexOf('write'));
  });

  it('挂起期零写出（同步直出档）：durable 事件 / notify / setStatus / resize 全 no-op', () => {
    const { io, backend } = makeBackend();
    backend.suspendMain();
    io.reset();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '停屏期正文', timestamp: 1 } }); // durable 事件
    backend.notify('停屏期通知'); // 瞬时行路
    backend.setStatus(SESSION, '停屏期状态'); // 固定区脏位路
    io.emitResize(); // resize 编舞路
    expect(io.bytes).toBe(''); // 渲染请求安全 no-op——停屏期零写出（07 件 8 条款）
  });

  it('挂起期零写出（注入调度档）：帧合并 / tick 定时器全收——推进时钟零写出', () => {
    const rig = makeInteractive();
    rig.backend.suspendMain();
    rig.io.bytes = '';
    emit(rig.backend, { type: 'message_end', message: { role: 'user', content: '停屏期', timestamp: 1 } });
    rig.clock.advance(5000); // tick 窗 ×50——定时器已收，零帧零写出
    expect(rig.io.bytes).toBe('');
  });

  it('挂起期件 7 外显照常（批内裁：终端级不停）——忙态 OSC 写出而摘要行入缓冲不写出', () => {
    const { io, backend } = makeBackend();
    backend.suspendMain();
    io.reset();
    emit(backend, { type: 'agent_start' }, false); // 非聚焦：trackProgress 忙迁移 + 件 9 摘要行
    expect(io.bytes).toContain(PROGRESS_ACTIVE); // OSC 9;4 外显照常（终端级非主屏 cell 内容）
    expect(io.bytes).not.toContain('⧗'); // 摘要行入缓冲不写出（cell 零写出）
    expect(io.bytes).not.toContain('后台工作中');
  });

  it('resumeMain：全帧重画不走（通道）repaint + 瞬时行缓冲补吐（补显射界含停屏期瞬时行）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '停屏前正文', timestamp: 1 } });
    backend.suspendMain();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '停屏期正文', timestamp: 2 } }); // durable 停屏期归账
    backend.notify('停屏期通知'); // 瞬时行入缓冲（件 9 摘要行通道已退役——V-1 笔2）
    io.reset();
    backend.resumeMain();
    expect(io.frames[0]).toBe(MAIN_ENTER); // 进屏模式串（复起起手）
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // 清屏——全帧重画（主屏既有权威全量重建路）
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0m停屏前正文'); // 行集全量重写（前缀段分立——不带正文）
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0m停屏期正文'); // 停屏期 durable 事件在场（树已含停屏期全部事件）
    expect(io.bytes).toContain('• 停屏期通知'); // 瞬时行补吐（不走 repaint 的行为锁——投影不含瞬时行）
    expect(io.bytes).not.toContain('✓ sess-aaa'); // 件 9 摘要行通道退役（V-1 笔2）——非聚焦 agent_end 零补吐
    expect(io.bytes.indexOf('\x1b[1;2m› \x1b[0m停屏期正文')).toBeLessThan(io.bytes.indexOf('• 停屏期通知')); // 补吐序：全帧在前、瞬时行在后
    // 复起回常态：后续事件恢复直写
    io.bytes = '';
    emit(backend, { type: 'message_end', message: { role: 'user', content: '复起后正文', timestamp: 3 } });
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0m复起后正文');
  });

  it('挂起前已入队未落帧的瞬时行不丢（注入调度档：帧合并窗内挂起——suspendMain 转账 pendingOps）', () => {
    const rig = makeInteractive();
    // 生产竞窗复现：注入调度档下 notify 入 pendingOps + 排帧（fps 帽 60 合并窗
    // ~16.7ms），suspendMain 抢在帧回调前（/history 命令链毫秒级 macrotask 后
    // 即挂起）——不泵帧直接挂起即捕获该窗
    rig.backend.notify('挂起前通知');
    rig.backend.suspendMain();
    rig.io.reset(); // 挂起编舞字节不计入
    rig.clock.advance(100); // 在飞帧已被 cancelTimer('frame') 收口——挂起期零写出
    expect(rig.io.bytes).toBe('');
    rig.backend.notify('停屏期通知'); // 停屏期瞬时行入 suspendedTransients（既有缓冲路）
    rig.backend.resumeMain();
    // 修前红锚：挂起前通知永久丢失——pendingOps 被 resumeMain 无条件清空，
    // 该行既不入 scrollback（screen.appendTransient 才入）也不入 suspendedTransients
    expect(rig.io.bytes).toContain('• 挂起前通知');
    expect(rig.io.bytes).toContain('• 停屏期通知');
    // 到达序保持：挂起前行先于停屏期行（转账序 = 入队序）
    expect(rig.io.bytes.indexOf('• 挂起前通知')).toBeLessThan(rig.io.bytes.indexOf('• 停屏期通知'));
  });

  it('挂起位 onRepaint 不二次转账（suspendMain 转账后清队——复起补吐不双显）', () => {
    const rig = makeInteractive();
    // 竞窗形：挂起前通知已入 pendingOps 未落帧 → suspendMain 转账（载体须清）
    // → 挂起期 onRepaint 权威清点。修前：suspendMain 转账不清 pendingOps，挂起
    // 位 onRepaint 的 collectPendingTransients 把同一 transient op 再收一遍推入
    // suspendedTransients——复起补吐同一行写出两遍（双显）
    rig.backend.notify('挂起窗通知');
    expect(rig.io.bytes).toBe(''); // 前置自证：合并窗持有未落帧
    rig.backend.suspendMain(); // 转账 #1（修前 pendingOps 未清——瞬时 op 仍在队）
    rig.backend.onRepaint('s2', [], null); // 挂起位权威清点（修前在此二次转账）
    rig.io.reset(); // 挂起编舞 + onRepaint 的 OSC title 字节不计入
    rig.backend.resumeMain();
    rig.pump();
    // 修前红锚：实得 2（同一行补吐两遍）；修后期望恰一次
    expect(rig.io.bytes.split('挂起窗通知').length - 1).toBe(1);
  });

  it('复起先排空槽期缓冲——停屏前缓冲的 slotTransients 到达序在前（修前：延迟落地且序倒置）', () => {
    const rig = makeInteractive();
    // 流式槽在场：起流后泵帧（末块 streaming 确立）
    emit(rig.backend, { type: 'message_start', role: 'assistant' });
    emit(rig.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式正文') });
    rig.pump();
    rig.backend.notify('槽期旧通知'); // 末块 streaming → 入队时刻（appendTransientLines）缓冲进 slotTransients（破槽形防御让位）
    rig.pump();
    expect(rig.io.bytes).not.toContain('槽期旧通知'); // 前置自证：确入槽期缓冲未直写
    rig.backend.suspendMain();
    // 停屏期关槽：定稿 message_end（末块非 streaming）+ 停屏期瞬时行入缓冲
    emit(rig.backend, { type: 'message_end', message: assistantMsg('定稿正文') });
    rig.backend.notify('停屏期通知');
    rig.backend.resumeMain();
    // 修前红锚：resume 只补吐 suspendedTransients——槽期旧通知滞留 slotTransients
    //（延迟到复起后下一次 flush 才落地且排在新行之后＝到达序倒置；会话静默期持续不可见）
    expect(rig.io.bytes).toContain('• 槽期旧通知');
    expect(rig.io.bytes).toContain('• 停屏期通知');
    // 到达序：挂起前缓冲的旧行在前、停屏期新行在后
    expect(rig.io.bytes.indexOf('• 槽期旧通知')).toBeLessThan(rig.io.bytes.indexOf('• 停屏期通知'));
  });

  it('lifecycle 全程迁移 + 挂起 / 复起幂等', () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io);
    expect(backend.lifecycle).toBe('idle');
    backend.start();
    expect(backend.lifecycle).toBe('running');
    backend.suspendMain();
    backend.suspendMain(); // 幂等——二次 no-op（不重复写出屏串）
    expect(backend.lifecycle).toBe('suspended');
    backend.resumeMain();
    backend.resumeMain(); // 幂等——二次 no-op
    expect(backend.lifecycle).toBe('running');
    backend.stop();
    expect(backend.lifecycle).toBe('disposed');
  });

  it('AltScreenHost 集成：TuiBackend 作 primary——进出副屏端到端编舞 + 停屏期零写出 + 复起补显', () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const clock = new ManualClock();
    const backend = new TuiBackend(io, {
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
      now: clock.now,
      fpsCap: 1e6,
      sessionId: 's1',
    });
    backend.start();
    io.reset(); // start 编舞字节不计入
    const host = new AltScreenHost(backend, io, {
      engineOptions: { now: clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel },
    });
    const handle = host.open(altLayer('alt-frame'));
    expect(handle).not.toBeNull();
    expect(backend.lifecycle).toBe('suspended');
    clock.advance(0); // 副屏首帧落地
    // 进序：主屏出屏串（suspendMain）→ 副屏 1049 进（alt Engine start）
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.frames[2]).toContain('alt-frame');
    // 停屏期主屏零写出（瞬时行入缓冲）
    io.reset();
    backend.notify('停屏期通知');
    clock.advance(100);
    expect(io.bytes).toBe('');
    handle!.close();
    // 出序：副屏出（dispose）→ 主屏进屏串 + 全帧重画 + 瞬时行补吐（resumeMain 同步直出）
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(io.bytes).toContain('• 停屏期通知');
    expect(backend.lifecycle).toBe('running');
    expect(host.isOpen).toBe(false);
  });
});

/* ================= /history 副屏装配面（批 10f-4 特性腿——件 8） ================= */

describe('TuiBackend /history 副屏装配（openHistory / collapseAltScreen——件 8 特性腿）', () => {
  /** 同步直出档装配（无注入调度——副屏 Engine 同步包装：首帧确定、lone-ESC 即决） */
  function historyRig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openHistory 编舞：主屏出屏 → 副屏 1049 进 → 回看器首帧（同一渲染管线正文在场）', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    // 回看器头行：档名前缀 + 会话短 id（id 携会话区分色 SGR——两段分立断言）
    expect(io.bytes).toContain('↩ 历史回看 · ');
    expect(io.bytes).toContain('sess-aaa');
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0m回看正文'); // durable 正文经同一渲染管线（零第二渲染器）
  });

  it('q 退出：io 字节流端到端——副屏出 + 主屏复起（全帧重画不走 repaint）', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    io.emitInput('q'); // kitty 轨纯键打字走 text 事件 → 让位判据（无搜索框）→ 退出
    expect(io.frames[0]).toBe(ALT_LEAVE); // 出序：副屏 dispose 在前
    expect(io.frames[1]).toBe(MAIN_ENTER); // 主屏复起进屏串
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // 全帧重画（清屏 + 光标归位）
    // 主屏行集不含副屏正文——回看内容不渗主屏（两屏行集分立的结构性证据）
    expect(io.bytes).not.toContain('回看正文');
    expect(backend.lifecycle).toBe('running');
  });

  it('collapseAltScreen（ask 收副屏路）：出副屏 + 复起；幂等二次 no-op', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    backend.collapseAltScreen();
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    io.reset();
    backend.collapseAltScreen(); // 幂等——无副屏 no-op
    expect(io.bytes).toBe('');
  });

  it('副屏键面 Ctrl+C：打断在飞 run（装配柄透传携带会话位）', () => {
    const { io, backend, calls } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    io.emitInput('\x03'); // ctrl+c
    expect(calls.interrupted).toEqual([SESSION]);
    expect(backend.lifecycle).toBe('suspended'); // 打断不退副屏（与主屏同键面：只打断）
  });

  it('副屏键面 Ctrl+D：先收副屏（复起）再转退出柄', () => {
    const { io, backend, calls } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    io.emitInput('\x04'); // ctrl+d
    expect(calls.quit).toBe(1);
    expect(backend.lifecycle).toBe('running'); // 先收副屏——退出柄到达时主屏已复起
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
  });

  it('已在副屏再 openHistory no-op（无嵌套备屏）；主屏未启 open 被拒保持无副屏', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, []);
    const frames = io.frames.length;
    backend.openHistory(SESSION, []); // 已在副屏——no-op
    expect(io.frames.length).toBe(frames);
    io.reset();
    // 未启后端：idle 态 open 被拒（AltScreenHost 拒绝位——句柄 null 如实保持）
    const io2 = new MemoryTerminalIO(COLS, ROWS);
    const backend2 = new TuiBackend(io2);
    backend2.openHistory(SESSION, []);
    expect(backend2.lifecycle).toBe('idle');
    expect(io2.bytes).toBe('');
  });

  it('分页装配（挖掘 52 轮件 A）：seq 投影 → 尾窗切装 + more 占位 + 到顶续页 prepend 更早就位', async () => {
    // 修前红锚：修前 openHistory 全量单发——earliest-0 与首窗同帧在场、零占位行
    const { io, backend } = historyRig();
    const messages = Array.from({ length: 205 }, (_, i) => ({
      role: 'user' as const,
      content: i < 5 ? `earliest-${i}` : i >= 200 ? `latest-${i}` : `mid-${i}`,
      timestamp: 1,
      seq: i,
    }));
    backend.openHistory(SESSION, messages);
    expect(backend.lifecycle).toBe('suspended');
    // 尾窗切装（200 帽 + 轮次边界）：末位在场、首窗外最早消息缺席
    expect(io.bytes).toContain('latest-204');
    expect(io.bytes).not.toContain('earliest-0');
    // more 占位（游标非空——头行下固定行）
    expect(io.bytes).toContain('上滚加载更早');
    // 到顶触发（Home 含在到顶判据）→ 续页 prepend（微任务回执 + requestRepaint 请帧）
    io.emitInput('\x1b[H'); // home（CSI H）
    for (let i = 0; i < 4; i++) await Promise.resolve(); // 微任务排空——prepend 落位
    io.emitInput('\x1b[H'); // 再 home——prepend 锚定在旧内容区，回顶见更早页
    expect(io.bytes).toContain('earliest-0'); // 更早页上方就位（快照同源复切）
    expect(io.bytes).toContain('已到最早'); // done 占位（游标到 null）
  });

  it('免 seq 形兼容锁：旧装配直呼 openHistory 全量单发——零分页零占位', () => {
    const { io, backend } = historyRig();
    const messages = Array.from({ length: 205 }, (_, i) => ({
      role: 'user' as const,
      content: `compat-${i}`,
      timestamp: 1,
    }));
    backend.openHistory(SESSION, messages);
    expect(io.bytes).not.toContain('上滚加载更早'); // 零占位（分页未激活）
    // 全量单发：全量行集经搜索可达证（分页形首窗只有尾窗域——此形全域 1 匹配）
    io.emitInput('\x06'); // ctrl+f 开搜索（legacy 0x06 归一）
    for (const ch of 'compat-0') io.emitInput(ch);
    // 渲染强制（副屏 Engine 输入后不自动重画——resize 触发 forceFull，搜索测试同律）
    io.rows = 12;
    io.emitResize();
    expect(io.bytes).toContain('1/1');
  });

  it('stop 防御位：在场副屏先收再退（副屏 Engine 不残活）', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    backend.stop();
    expect(io.frames[0]).toBe(ALT_LEAVE); // 防御收副屏在前
    // 复起编舞退役（挖掘 27 轮 [8]）：stop 先置停再收副屏——resumeMain 守卫
    // skip，终退路零 ENTER_MAIN 探测/零清屏重画闪帧（旧锁 MAIN_ENTER/
    // MAIN_LEAVE 断言随编舞退役——挂起期主屏模式串已在 suspendMain 收口）
    expect(io.bytes).not.toContain('\x1b[c'); // DA1 探测零发出（复起编舞零跑）
    expect(io.bytes).toContain('\x1b[r'); // DECSTBM 终退复位照写（[7] 三边齐）
    expect(backend.lifecycle).toBe('disposed');
  });

  it('注入调度档：假钟直通副屏 Engine（帧随窗落地——保活 / 帧帽同源注入）', () => {
    const rig = makeInteractive();
    rig.pump(); // 主屏就绪帧落地（起账基线）
    rig.io.reset();
    rig.backend.openHistory('s1', [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    rig.pump(); // 副屏首帧随窗落地
    expect(rig.io.frames[0]).toBe(MAIN_LEAVE);
    expect(rig.io.frames[1]).toBe(ALT_ENTER);
    expect(rig.io.bytes).toContain('↩ 历史回看 · ');
    expect(rig.io.bytes).toContain('\x1b[1;2m› \x1b[0m回看正文');
    rig.io.reset();
    rig.io.emitInput('q');
    rig.pump();
    expect(rig.io.frames[0]).toBe(ALT_LEAVE);
    expect(rig.backend.lifecycle).toBe('running');
  });

  it('搜索行同册注入（批 10k 遗漏修装配位证）：editor.new-line 用户覆盖对 /history 搜索框生效', () => {
    // 装配缝：openHistory 经 options.keymap 把 backend 会话册注入搜索行守卫与
    // 子编辑器——用户覆盖不因进副屏失联。行为锚（挖掘 27 轮 [5] 锚迁移）：
    // queue-followup 覆盖键被守卫册驱动同义归并跳匹配（计数随跳进）；注入
    // 缺席时 alt+j 非编辑键零动作、计数不动。原锚（new-line 覆盖键插 \n 致
    // 0/0）在 [5] 定谳后是污染非特性——单行框换行键一律吞，锚随迁
    const { io, backend } = historyRig({ keybindings: { 'editor.queue-followup': 'alt+j' } });
    backend.openHistory(SESSION, [
      { role: 'user', content: 'needle 其一', timestamp: 1 },
      { role: 'user', content: 'needle 其二', timestamp: 2 },
    ]);
    io.reset();
    io.emitInput('\x06'); // ctrl+f 开搜索（legacy 0x06 归一）
    io.emitInput('needle'); // 键入查询——恰 2 匹配
    // 渲染强制：副屏 Engine 输入后不自动重画、resize 等几何守卫直退——改几何
    // 后 emitResize 触发 forceFull 全帧（同步直出档即时落账）
    io.rows = 12;
    io.emitResize();
    expect(io.bytes).toContain('1/2');
    io.reset();
    io.emitInput('\x1bj'); // alt+j = 用户覆盖的 editor.queue-followup 提交键
    io.rows = 14;
    io.emitResize();
    expect(io.bytes).toContain('2/2'); // 册驱动确认同义跳下一（覆盖生效的行为证据）
  });
});

/* ---------------- /history 鼠标面 e2e（mu-2——选区复制 OSC 52 + X10 降级装配接线证） ---------------- */

describe('TuiBackend /history 鼠标面 e2e（mu-2）', () => {
  /** SGR 报文便捷铸造（1 基坐标直书——与终端报文同形） */
  const sgr = (cb: number, col: number, row: number, final: 'M' | 'm' = 'M'): string =>
    `\x1b[<${cb};${col};${row}${final}`;

  /** 局部 rig（同 historyRig 形——同步直出档：开屏首帧确定） */
  function histRig() {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset(); // start 编舞字节不计入
    return { io, backend };
  }

  it('拖选三连 → io 字节含 OSC 52;c;base64（onCopy → buildOsc52Copy 装配接线）', () => {
    const { io, backend } = histRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]); // 副屏首帧同步落地
    io.reset(); // 进屏 / 首帧字节不计入——聚焦复制写出
    // 屏行 3（0 基）= 正文行 '\x1b[1;2m› \x1b[0m回看正文'（R-1 块前垫 + user 三明治
    // 前置空行后正文居中）：CJK 双宽——列 2 = 回首、列 6 = 正首
    io.emitInput(sgr(0, 3, 4)); // 左键 press（1 基 col 3/row 4 → 0 基 2/3）
    io.emitInput(sgr(32, 7, 4)); // 按住拖动（motion）
    io.emitInput(sgr(0, 7, 4, 'm')); // 释放——触发复制
    expect(io.bytes).toContain(`\x1b]52;c;${Buffer.from('回看', 'utf8').toString('base64')}\x07`);
  });

  it('X10 首达降级：io 字节含 DECRST 1006/1002（AltScreenHost 接线——回终端原生选区）', () => {
    const { io, backend } = histRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    io.emitInput('\x1b[M !"'); // X10 形（开了 1006 的会话里到达 ⟺ 终端无 SGR 能力）
    expect(io.bytes).toContain('\x1b[?1006l\x1b[?1002l');
  });
});

/* ---------------- /memory 鼠标面 e2e（挂账解挂批①——选区复制 OSC 52 装配接线证） ---------------- */

describe('TuiBackend /memory 鼠标面 e2e（挂账解挂批①）', () => {
  /** SGR 报文便捷铸造（1 基坐标直书——与 /history 鼠标面同形） */
  const sgr = (cb: number, col: number, row: number, final: 'M' | 'm' = 'M'): string =>
    `\x1b[<${cb};${col};${row}${final}`;

  it('拖选三连 → io 字节含 OSC 52;c;base64（onCopy → buildOsc52Copy 装配——与 /history 同柄单源）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset(); // start 编舞字节不计入
    // 单活体条目材料（条目行 = 0 基屏行 4：头行 0 + 健康投影两行 + 分区头 3）
    const rows = [
      {
        id: 'maaaaaaa',
        ownerKey: 'global',
        kind: 'pref',
        summary: '摘要甲',
        content: '',
        status: 'active' as const,
        supersededBy: null,
        updatedAt: 0,
        frozen: false,
        validFrom: null,
      },
    ];
    backend.setMemoryScreen({
      ownerKeys: ['global'],
      dao: {
        listVisibleForManagement: () => rows,
        listForExport: () => rows,
        overview: () => ({ health: { active: 1, dismissed: 0, expired: 0, frozen: 0, total: 1 } }),
        forget: () => rows[0]!,
        restore: () => rows[0]!,
        freeze: () => rows[0]!,
        unfreeze: () => rows[0]!,
      },
      sanitize: () => ({ blocked: false, patterns: [], quoted: false }),
      exportCommand: () => Promise.resolve('已导出'),
    });
    backend.openMemory();
    io.reset(); // 进屏 / 首帧字节不计入——聚焦复制写出
    // 条目行 `[m:maaaaaaa] [pref] 摘要甲 ...`：列 13-18 = `[pref]`（纯 ASCII
    // 段——显示列即 UTF-16 下标，宽度算术不介入）
    io.emitInput(sgr(0, 14, 5)); // 左键 press（1 基 col 14/row 5 → 0 基 13/4）
    io.emitInput(sgr(32, 20, 5)); // 按住拖动（motion → 0 基 col 19）
    io.emitInput(sgr(0, 20, 5, 'm')); // 释放——触发复制
    expect(io.bytes).toContain(`\x1b]52;c;${Buffer.from('[pref]', 'utf8').toString('base64')}\x07`);
  });
});

/* ================= /memory 副屏装配面（mm 批——06 §7 /memory 轻管理面） ================= */

describe('TuiBackend /memory 副屏装配（setMemoryScreen / openMemory——mm 批）', () => {
  /** 最小数据材料（构造期三源取数可用的假 DAO——动词零参形窄化合法） */
  function memoryDeps(): MemoryViewerDataDeps {
    const rows = [
      {
        id: 'maaaaaaa',
        ownerKey: 'global',
        kind: 'pref',
        summary: '摘要甲',
        content: '',
        status: 'active' as const,
        supersededBy: null,
        updatedAt: 0,
        frozen: false,
        validFrom: null,
      },
    ];
    return {
      ownerKeys: ['global'],
      dao: {
        listVisibleForManagement: () => rows,
        listForExport: () => rows,
        overview: () => ({ health: { active: 1, dismissed: 0, expired: 0, frozen: 0, total: 1 } }),
        forget: () => rows[0]!,
        restore: () => rows[0]!,
        freeze: () => rows[0]!,
        unfreeze: () => rows[0]!,
      },
      sanitize: () => ({ blocked: false, patterns: [], quoted: false }),
      exportCommand: () => Promise.resolve('已导出'),
    };
  }

  /** 同步直出档装配（historyRig 同形） */
  function memoryRig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openMemory 编舞：材料注入后真开——主屏出屏 → 副屏进 → 管理面首帧（三分区在场）', () => {
    const { io, backend } = memoryRig();
    backend.setMemoryScreen(memoryDeps());
    expect(backend.openMemory()).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    expect(io.bytes).toContain('◉ 记忆管理 · global'); // 头行 owner 短显（panel-chrome 图标收敛批：❄→◉）
    expect(io.bytes).toContain('── 生效中（1）'); // 三分区首帧
  });

  it('材料缺席（件未装载形）/ null 撤材料：openMemory 返 false 不进副屏', () => {
    const { io, backend } = memoryRig();
    expect(backend.openMemory()).toBe(false); // 未注入材料
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).toBe('');
    backend.setMemoryScreen(memoryDeps());
    backend.setMemoryScreen(null); // 撤材料（件卸载形）
    expect(backend.openMemory()).toBe(false);
    expect(io.bytes).toBe('');
  });

  it('副屏互斥：openHistory 在场 openMemory 返 false；收副屏后可开（单值备屏律）', () => {
    const { io, backend } = memoryRig();
    backend.setMemoryScreen(memoryDeps());
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    expect(backend.openMemory()).toBe(false); // 已在副屏——无嵌套备屏
    expect(io.bytes).toBe('');
    backend.collapseAltScreen();
    expect(backend.openMemory()).toBe(true); // 收后可开
    expect(io.bytes).toContain('◉ 记忆管理 · global');
  });

  it('副屏键面：Ctrl+C 携当前交互会话位（零参形装配闭包）；q 退出复起主屏', () => {
    const { io, backend, calls } = memoryRig();
    backend.setMemoryScreen(memoryDeps());
    backend.openMemory();
    io.reset();
    io.emitInput('\x03'); // ctrl+c——打断不退副屏
    expect(calls.interrupted).toEqual([SESSION]);
    expect(backend.lifecycle).toBe('suspended');
    io.emitInput('q'); // 退出管理面
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).not.toContain('记忆管理'); // 两屏行集分立——管理面不渗主屏
  });

  it('导出行同册注入（批 10k 遗漏修装配位证；27 轮 [5] 锚迁移）：queue-followup 用户覆盖对 /memory 导出行生效', () => {
    // 装配缝：setMemoryScreen 经 options.keymap 把 backend 会话册注入导出行守卫
    // 与子编辑器。行为锚（挖掘 27 轮 [5] 锚迁移）：queue-followup 覆盖键被守卫
    // 册驱动同义归并执行导出（argv 落账）；注入缺席时 alt+j 非编辑键零动作
    // （exportArgv 恒空）。原锚（new-line 覆盖键插 \n——argv ['a\\nb'] 保位）
    // 在 [5] 定谳后是污染非特性（LF 落怪名文件）——单行行换行键一律吞，锚随迁
    const exportArgv: string[][] = [];
    const { io, backend } = memoryRig({ keybindings: { 'editor.queue-followup': 'alt+j' } });
    backend.setMemoryScreen({
      ...memoryDeps(),
      exportCommand: (argv) => {
        exportArgv.push([...argv]);
        return Promise.resolve('已导出');
      },
    });
    backend.openMemory();
    io.emitInput('e'); // 开导出参数行（text 轨）
    io.emitInput('--out mem.md');
    io.emitInput('\x1bj'); // alt+j = 用户覆盖的 editor.queue-followup 提交键
    expect(exportArgv).toEqual([['--out', 'mem.md']]); // 册驱动确认同义执行（覆盖生效的行为证据）
  });
});

describe('主题面（批 10g——07 §4.1 R2 三档色域 + OSC 11 自动明暗）', () => {
  it('缺省注入缺席 = dark 确定性基线：零探测写出、accent 落 ANSI 6（与批 10g 前字节同源）', () => {
    const { io, backend } = makeBackend();
    expect(io.bytes).not.toContain('\x1b]11;?'); // 无 OSC 11 查询
    expect(io.bytes).not.toContain('\x1b[?2031h'); // 无明暗变化订阅
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    // accent ANSI 6 cyan（转轮载体——R-6 翻档后编辑器 › 恒 bold 不再携 accent）
    expect(io.bytes).toContain('\x1b[36m');
  });

  it('auto 档 start：OSC 11 查询 + 2031 订阅两写点', () => {
    const { io } = makeBackend({ theme: 'auto' });
    expect(io.bytes).toContain('\x1b]11;?\x07');
    expect(io.bytes).toContain('\x1b[?2031h');
  });

  it('auto 亮底应答换装：accent 翻 ANSI 4（SGR 34）固定区重画', () => {
    const { io, backend } = makeBackend({ theme: 'auto' });
    emit(backend, { type: 'agent_start' }); // 转轮 accent 载体在屏（换装重画帧可锚）
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 白底应答（同步直出——换装即时落帧）
    expect(io.bytes).toContain('\x1b[34m'); // light accent ANSI 4 blue（转轮换装重建）
    expect(io.bytes).not.toContain('\x1b[36m'); // dark accent 不再上帧
  });

  it('auto 同板应答零重画（2031 冗余应答与噪声不触发无谓帧）', () => {
    const { io } = makeBackend({ theme: 'auto' }); // 构造期先 dark
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:0000/0000/0000\x07'); // 黑底 = 同板
    expect(io.bytes).toBe('');
  });

  it('auto 同板带值变 → userMessageBg 背景带随新值传导（界面美化役批⑦——真彩档后续 user 行携带）', () => {
    // 缺省注入 = 16 档：带恒 undefined——同板应答（含首达）零重画（上一测已锁）。
    // 真彩档三段：探测值首达 = 带从无到有（换装本身屏上无可见增量——固定区 diff 只
    // 走光标字节，故以「后续 user 行写出携带带 SGR」为传导证据）；同值冗余零重画；
    // 同板异值（GitHub dark #0d1117 vs 纯黑——同 dark 板、混合值不同）带随新值重出
    const tc = makeBackend({ theme: 'auto', colorEnv: { COLORTERM: 'truecolor' } });
    tc.io.emitInput('\x1b]11;rgb:0000/0000/0000\x07'); // 同板首达——带从 undefined 铸入
    tc.io.bytes = '';
    tc.io.emitInput('\x1b]11;rgb:0000/0000/0000\x07'); // 同值冗余应答（2031 噪声形）
    expect(tc.io.bytes).toBe(''); // 同板同带零重画
    emit(tc.backend, { type: 'message_end', message: { role: 'user', content: '帮我看下', timestamp: 1 } });
    // 黑底 dark 混白 12%：0 + 0.12 × 255 = 30.6 → 31（逐通道四舍五入）——背景带进帧
    expect(tc.io.bytes).toContain('\x1b[48;2;31;31;31m');
    tc.io.emitInput('\x1b]11;rgb:0d11/0d11/0d11\x07'); // 同板异值——带随新值重算
    emit(tc.backend, { type: 'message_end', message: { role: 'user', content: '再问', timestamp: 2 } });
    // 0x0d11 逐通道 16bit → 8bit 折算 13：13 + 0.12 × 242 = 42.04 → 42——新带字节在场
    expect(tc.io.bytes).toContain('\x1b[48;2;42;42;42m');
  });

  it('同板应答唯 toolCardBg 值变 → 换装传导新卡面带（三键比对 toolCardBg 腿独立红锚——删比对腿则陈值吞带变更）', () => {
    // 三键比对（userMessageBg / toolCardBg / weakRule 任一变即换装）的 toolCardBg
    // 腿独立锁：自定义板显式带 userMessageBg 静态值（覆盖恒胜不随探测变——同时
    // 开探测传值门：板列本键即动态键族供血）+ 缺 text（weakRule 无混合基恒
    // undefined）+ 缺 toolCardBg（动态混合随探测 bg 变）——同板异值两应答间三
    // 比对键唯 toolCardBg 腿承重。换装与否以工具卡卡面带 SGR 传导值为证（删
    // backend handleOscReply 比对腿则零换装、陈带吞新值——本测转红）。
    const tc = makeBackend({
      theme: 'custom-x',
      customThemeOverlay: { userMessageBg: { r: 40, g: 40, b: 40 } },
      colorEnv: { COLORTERM: 'truecolor' },
    });
    tc.io.emitInput('\x1b]11;rgb:0000/0000/0000\x07'); // 纯黑首达——toolCardBg 铸入 round(0 + 8%×255) = 20
    emit(tc.backend, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't1', name: 'grep', arguments: {} }],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    emit(tc.backend, {
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'grep',
        content: [{ type: 'text', text: '命中 1 处' }],
        isError: false,
        usage,
        timestamp: 1,
      },
    });
    // grep 属探索族——toolResult 入组窗不即时落卡，agent_end 收口（N=1 逐卡）才上帧
    emit(tc.backend, { type: 'agent_end', status: 'completed' });
    expect(tc.io.bytes).toContain('\x1b[48;2;20;20;20m'); // 首带传导（20,20,20——dark 混白 8%）
    tc.io.bytes = '';
    tc.io.emitInput('\x1b]11;rgb:0d11/0d11/0d11\x07'); // 同板异值——16bit→8bit 折算 13：round(13 + 8%×242) = 32
    emit(tc.backend, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't2', name: 'grep', arguments: {} }],
        usage,
        stopReason: 'stop',
        timestamp: 2,
      },
    });
    emit(tc.backend, {
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 't2',
        toolName: 'grep',
        content: [{ type: 'text', text: '命中 2 处' }],
        isError: false,
        usage,
        timestamp: 2,
      },
    });
    emit(tc.backend, { type: 'agent_end', status: 'completed' }); // 探索族同律——收口上帧
    expect(tc.io.bytes).toContain('\x1b[48;2;32;32;32m'); // 主红锚：新带传导（删比对腿则陈值 20 在场）
    expect(tc.io.bytes).not.toContain('\x1b[48;2;20;20;20m'); // 陈带退场
    tc.io.bytes = '';
    tc.io.emitInput('\x1b]11;rgb:0d11/0d11/0d11\x07'); // 同值冗余应答——三键恒等零重画
    expect(tc.io.bytes).toBe('');
  });

  it('auto 暗底应答迟到照常换装（无钟不设窗——2031 通知语义等价）', () => {
    const { io, backend } = makeBackend({ theme: 'auto' });
    emit(backend, { type: 'agent_start' }); // 转轮 accent 载体在屏
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 先亮底换装
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:0d11/0d11/0d11\x07'); // 再暗底（GitHub dark #0d1117）——换回
    expect(io.bytes).toContain('\x1b[36m');
    expect(io.bytes).not.toContain('\x1b[34m');
  });

  it('显式档短路：dark 显式下应答全忽略（防御位——查询本未发）', () => {
    const { io } = makeBackend({ theme: 'dark' });
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07');
    expect(io.bytes).toBe('');
  });

  it('畸形应答诚实忽略：非 11 码 / 非 rgb 形不换装', () => {
    const { io } = makeBackend({ theme: 'auto' });
    io.bytes = '';
    io.emitInput('\x1b]10;rgb:ffff/ffff/ffff\x07'); // 前景色码（OSC 10）——非本面
    io.emitInput('\x1b]11;rgb:zz/0/0\x07'); // 非 hex
    expect(io.bytes).toBe('');
  });

  it('stop 复原：auto 档关 2031 订阅；显式档从未开不写关', () => {
    const auto = makeBackend({ theme: 'auto' });
    auto.backend.stop();
    expect(auto.io.bytes).toContain('\x1b[?2031l');
    const explicit = makeBackend(); // 缺省 dark
    explicit.backend.stop();
    expect(explicit.io.bytes).not.toContain('\x1b[?2031l');
  });

  it('硬退复原钩含 2031 复原（七役扫描批——复原对称律：armExitRestore 与 stop 同写）', () => {
    // armExitRestore 仅真 ProcessTerminalIO 武装（注入 MemoryTerminalIO 零污染）
    // ——捕获子类过 instanceof 门、写出面截留（不触真 stdout）
    class CapturingProcessIO extends ProcessTerminalIO {
      captured = '';
      override write(data: string): void {
        this.captured += data;
      }
    }
    const io = new CapturingProcessIO();
    const backend = new TuiBackend(io, { theme: 'auto' });
    const before = new Set(process.listeners('exit'));
    backend.start();
    // 武装位自证：start 恰新增一个 'exit' 监听（armExitRestore 真身路径）
    const added = process.listeners('exit').filter((l) => !before.has(l));
    expect(added).toHaveLength(1);
    io.captured = ''; // start 编舞字节不计入
    (added[0] as () => void)(); // 模拟硬退——直调 process 'exit' 监听（零副作用：不发真 exit 事件）
    expect(io.captured).toContain(MAIN_LEAVE); // 既有复原面（出屏串）在场
    expect(io.captured).toContain('\x1b[?2031l'); // 修复点：2031 复原——修前此字节缺席（红锚）
    backend.stop(); // 收尾：卸 stdin/resize 订阅 + 解除 exit 钩（不泄漏到后续进程退出）
  });

  it('硬退复原钩显式档不写 2031 关（与 stop 同条件——显式档从未开不写关）', () => {
    class CapturingProcessIO extends ProcessTerminalIO {
      captured = '';
      override write(data: string): void {
        this.captured += data;
      }
    }
    const io = new CapturingProcessIO();
    const backend = new TuiBackend(io); // 缺省 dark 显式档
    const before = new Set(process.listeners('exit'));
    backend.start();
    const added = process.listeners('exit').filter((l) => !before.has(l));
    expect(added).toHaveLength(1);
    (added[0] as () => void)(); // 模拟硬退
    expect(io.captured).toContain(MAIN_LEAVE); // 出屏复原照常
    expect(io.captured).not.toContain('\x1b[?2031l'); // 显式档从未开订阅——不写关
    backend.stop();
  });

  it('挂起窗硬退复原：终端级写点收口（2031 关 + osc.restore——A2 复原对称律不留单边缺口）', () => {
    // 副屏在场窗：副屏 Engine 的 exit 钩只复原其屏形（LEAVE_MODES[alt] + raw）
    // ——2031 订阅 / OSC title 点缀 / OSC 9;4 忙态是挂起期特意保活的终端级写点，
    // 修前 suspendMain disarm 自家钩后这些写点硬退无人收口
    class CapturingProcessIO extends ProcessTerminalIO {
      captured = '';
      override write(data: string): void {
        this.captured += data;
      }
    }
    const io = new CapturingProcessIO();
    const backend = new TuiBackend(io, { theme: 'auto' });
    const before = new Set(process.listeners('exit'));
    backend.start();
    backend.onRepaint(SESSION, [], null); // title 点缀会话短 id（挂起期保活的终端级写点）
    backend.suspendMain(); // 挂起（生产形随后开副屏——此处挂起态直测收口钩）
    // 挂起窗仍恰一个本件 'exit' 钩（修前红锚：disarm 后为零——终端级写点残留）
    const added = process.listeners('exit').filter((l) => !before.has(l));
    expect(added).toHaveLength(1);
    io.captured = ''; // 挂起编舞字节不计入
    (added[0] as () => void)(); // 模拟挂起窗硬退——直调收口钩（零副作用）
    expect(io.captured).toContain('\x1b[?2031l'); // 2031 订阅关（挂起期保活写点的对称复原）
    expect(io.captured).toContain(PROGRESS_CLEAR); // OSC 9;4 进度清零（osc.restore）
    expect(io.captured).toContain(oscTitle('berry-agent')); // title 复原基线（点缀让位）
    // 挂起档不写主屏出屏串：主屏模式串已在 suspendMain 写出收口、副屏屏形归
    // 副屏 Engine 自家钩——写出会污染在场副屏
    expect(io.captured).not.toContain(MAIN_LEAVE);
    backend.stop(); // 收尾：卸钩不泄漏到后续进程退出
  });

  it('挂起窗硬退复原含 DECSTBM 复位且落 1049l 之后（挖掘 27 轮 [7]——修前红：裸钩零复位）', () => {
    // 副屏在场窗硬退：副屏 Engine 自家钩复原屏形（1049l 回主屏缓冲），但主屏
    // margins（MainScreen applyScrollRegion 反复写 1;{N}r 设区——终端侧状态
    // 不随进程退出自复位）无人清——shell 继承破 margins（光标在区外 LF 不滚、
    // 长输出覆写屏底）。修前挂起档钩只收终端级写点（2031/raw/osc）。复位还
    // 须落在 1049l 之后（先收副屏再复位——margins 按 grid 的 tmux 形裸写在
    // 副屏期 no-op；与 stop()/armExitRestore 两路同形）。
    // 【挖掘 28 轮 [3] 锁勘正】原形 openHistory 前显式 suspendMain 使
    // altHost.open 被 lifecycle 闸拒（返 null——副屏从未打开，钩内 closeAlt
    // no-op 零 1049l），lastIndexOf 对 -1 恒过=落序锁空转；删显式挂起走
    // 生产序（openHistory 自带挂起）+ 增 1049l 在场断言去空化
    class CapturingProcessIO extends ProcessTerminalIO {
      captured = '';
      override write(data: string): void {
        this.captured += data;
      }
    }
    const io = new CapturingProcessIO();
    const backend = new TuiBackend(io, { theme: 'auto' });
    const before = new Set(process.listeners('exit'));
    backend.start();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]); // 挂起窗副屏在场（生产序——openHistory 自带挂起）
    io.captured = ''; // 挂起/开屏编舞字节不计入
    // 模拟硬退：先跑本件挂起档钩（注册序先于副屏 Engine 钩）——修内收副屏
    // 写 1049l；副屏 Engine 钩随后幂等零写
    const added = process.listeners('exit').filter((l) => !before.has(l));
    (added[0] as () => void)();
    expect(io.captured).toContain('\x1b[r'); // 修复点：DECSTBM 复位（修前红锚——裸钩零复位）
    expect(io.captured).toContain('\x1b[?1049l'); // 去空化：副屏确经钩收退（空转锁恒过缺陷——挖掘 28 轮 [3]）
    // 落位序：复位落在副屏退场（1049l 回主屏缓冲）之后——修前裸加形亦红
    expect(io.captured.lastIndexOf('\x1b[r')).toBeGreaterThan(io.captured.lastIndexOf('\x1b[?1049l'));
    backend.stop(); // 收尾：卸钩不泄漏到后续进程退出
  });

  it('挂起档硬退钩先置停不复起主屏探测（挖掘 28 轮 [2]——修前红）：exit 钩内零编舞零 raw 残留', () => {
    // 修前挂起档钩在 running=true 时 closeAlt→primary.resumeMain 守卫通过
    // ——ENTER_MAIN（含 DA1/kitty 探测）+ auto 档 OSC 11 重查 + 清屏重画全在
    // process 'exit' 钩内复起；探测应答在进程死后到达被 cooked+ECHOCTL 回显
    // 进 shell 成乱码（e4bae0a 给 stop() 修的同一缺陷在钩路未修）。且副屏
    // Engine dispose 把 raw 复位成进屏前 true——钩首 setRawMode(false) 被冲
    // 掉，raw 残留 ON 交还 shell。修向 = 钩内先置停（resumeMain 守卫短路）
    // + 钩尾重申交还
    class HookProbeIO extends ProcessTerminalIO {
      captured = '';
      rawCalls: boolean[] = [];
      override write(data: string): void {
        this.captured += data;
      }
      override setRawMode(raw: boolean): void {
        this.rawCalls.push(raw);
        super.setRawMode(raw);
      }
    }
    const io = new HookProbeIO();
    const backend = new TuiBackend(io, { theme: 'auto' });
    const before = new Set(process.listeners('exit'));
    backend.start();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]); // 生产序——副屏真在场
    io.captured = '';
    io.rawCalls = [];
    const added = process.listeners('exit').filter((l) => !before.has(l));
    (added[0] as () => void)(); // 直调挂起档收口钩
    expect(io.captured).not.toContain('\x1b[c'); // DA1 探测零发出（修前红锚——复起编舞含探测）
    expect(io.captured).not.toContain('\x1b]11;?\x07'); // OSC 11 重查零发出（同编舞）
    expect(io.captured).toContain('\x1b[?1049l'); // 副屏退场照收（收口序不变）
    expect(io.captured).toContain('\x1b[r'); // DECSTBM 复位照写（[7] 收口三边齐）
    expect(io.rawCalls.at(-1)).toBe(false); // raw 终态交还 shell（修前红锚——dispose/复起把 raw 复位 ON 残留）
    // 置停即名义 disposed（lifecycle getter !running→disposed——exit 钩内进程
    // 将死，名义态无害）；置停也使后续 stop() 入口守卫直返不卸钩——手动卸
    expect(backend.lifecycle).toBe('disposed');
    process.removeListener('exit', added[0] as () => void); // 收尾：钩不泄漏到测试进程退出
  });

  it('stop 挂起态副屏收屏不复起主屏探测（挖掘 27 轮 [8]——修前红）：应答无 cooked 回显窗', () => {
    // 修前 stop→closeAlt→primary.resumeMain 全编舞照跑（ENTER_MAIN 含 DA1/
    // kitty 探测 + auto 档 OSC 11 重查 + 清屏重画闪帧）——探测应答落在输入
    // 卸订/raw 交还之后到达，cooked+ECHOCTL 下内核回显应答字节进 shell
    //（乱码）；复起重画随即被终退收口覆盖本就浪费。修向 = stop 先置
    // running=false 再收副屏——resumeMain 守卫即 skip（探测零发出）
    const { io, backend } = makeBackend({ theme: 'auto' });
    // openHistory 自带挂起（coordinator.open 内部 suspendMain——显式先挂会置
    // lifecycle='suspended' 使 open 拒绝，生产序无此形）
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]); // 挂起窗副屏在场
    io.reset(); // 挂起/开屏编舞字节不计入
    backend.stop();
    expect(io.bytes).not.toContain('\x1b[c'); // DA1 探测查询零发出（修前红锚——复起编舞含探测）
    expect(io.bytes).not.toContain('\x1b]11;?\x07'); // OSC 11 重查零发出（同编舞）
    expect(io.bytes).toContain('\x1b[?1049l'); // 副屏退场照收（收口序不变）
    expect(io.bytes).toContain('\x1b[r'); // DECSTBM 复位照写（[7] 收口三边齐）
    expect(backend.lifecycle).toBe('disposed');
  });

  it('resumeMain auto 档补发 OSC 11 重查（七役扫描批——副屏在场窗通知丢弃的复起补偿）', () => {
    const { io, backend } = makeBackend({ theme: 'auto' });
    backend.suspendMain();
    io.reset();
    backend.resumeMain();
    expect(io.frames[0]).toBe(MAIN_ENTER); // 复起起手仍是进屏串（重查不打头）
    expect(io.bytes).toContain('\x1b]11;?\x07'); // 第二次 OSC 11 查询——修前缺席（红锚）
  });

  it('resumeMain 显式档不补发 OSC 11（显式档零探测——对称面）', () => {
    const { io, backend } = makeBackend(); // 缺省 dark
    backend.suspendMain();
    io.reset();
    backend.resumeMain();
    expect(io.bytes).not.toContain('\x1b]11;?');
  });

  it('colorEnv 三档接线：truecolor 档 accent 仍 ANSI 6 直通、RGB 键走 38;2 直出', () => {
    // accent AnsiColor 全档直通——truecolor 档字节与 16 档同源
    const tc = makeBackend({ colorEnv: { COLORTERM: 'truecolor' } });
    emit(tc.backend, { type: 'agent_start' }); // 转轮 accent 载体（R-6 翻档——编辑器 › 不再携 accent）
    expect(tc.io.bytes).toContain('\x1b[36m');
    expect(tc.io.bytes).not.toContain('38;5;'); // 非聚焦会话色表未进帧（accent 直通自证）
  });
});

/* ================= 批 10i：应用动作键（思考块/工具卡会话级开关——R1/R4/R5） ================= */

describe('TuiBackend 会话级开关键（批 10i ctrl+t / ctrl+o）', () => {
  /** 带思考块的 assistant 消息（本 describe 速构） */
  const thinkingMsg = (thinking: string, text: string): AgentMessage => ({
    role: 'assistant',
    content: [
      ...(thinking !== '' ? [{ type: 'thinking' as const, thinking }] : []),
      ...(text !== '' ? [{ type: 'text' as const, text }] : []),
    ],
    usage,
    stopReason: 'stop',
    timestamp: 1,
  });

  it('ctrl+t 翻思考块会话级展开：repaint 清屏重渲（折叠标签 → 展开体 + 收起提示）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: thinkingMsg('先想再答', '正文') });
    io.bytes = '';
    io.emitInput('\x14'); // ctrl+t
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // repaint 全量重渲（冻结账随 repaint 重置）
    expect(io.bytes).toContain('收起'); // 展开档标签动词
    expect(io.bytes).toContain('先想再答'); // 思考体行在场
    io.bytes = '';
    io.emitInput('\x14');
    expect(io.bytes).toContain('（ctrl+t 展开）'); // 翻回折叠档
    expect(io.bytes).not.toContain('收起');
  });

  it('ctrl+o 翻工具卡会话级展开：折叠尾 5 预览 → 全量（帽外首行回场）', () => {
    const { io, backend } = makeBackend();
    emit(backend, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'tc1', name: 'read', arguments: {} }],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    emit(backend, {
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'read',
        content: [{ type: 'text', text: Array.from({ length: 8 }, (_, i) => `行${i + 1}`).join('\n') }],
        isError: false,
        timestamp: 1,
      },
    });
    emit(backend, { type: 'agent_end', status: 'completed' }); // read 入探索窗——收口补落单卡（N=1 < 2）
    expect(io.bytes).toContain('✓'); // 三态卡头（success——符号段与名段间有转义重置不连续）
    expect(io.bytes).toContain('读取文件'); // 名段用户面动词（V-0 注⑤——原 'read'）
    // 折叠预览中段截断（界面美化役批③——头 2 + 省略行 + 尾 2）：帽外中段不在场
    expect(io.bytes).toContain('行1'); // 头 2 在场（首行不滑失）
    expect(io.bytes).toContain('行2');
    expect(io.bytes).toContain('行7'); // 尾 2 在场
    expect(io.bytes).toContain('行8');
    expect(io.bytes).toContain('⋯（已省 4 行——ctrl+o 展开）'); // 中段省略行（真键位提示）
    expect(io.bytes).not.toContain('行3'); // 中段 4 行不在场
    expect(io.bytes).not.toContain('行6');
    io.bytes = '';
    io.emitInput('\x0f'); // ctrl+o
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('行3'); // 全量展开——中段回场
  });

  // 挖掘 26 轮 [6]：翻转前入队的 present op 持翻转前块对象（rewriteExpandedFlags
  // 换新块非原地改），repaint 后迟到的帧回调按旧 expanded 态重渲在飞流式槽尾窗
  // ——刚展开的思考在屏面塌回折叠态。toggle 两路须同其余四路权威重建
  //（onRepaint/handleResize/suspendMain/resumeMain）先清队（pendingOps/needFixed），
  // 清点前抢救合并窗内瞬时行防裸清永失。复现形 = 在飞流式槽（durable 段被绝对
  // 位对账遮蔽零写、观察面在 C 段旧思考态——verify 实证形）；ctrl+o 定稿卡
  // 全程被绝对位对账遮蔽无观察面（修法同笔对齐——同族权威重建不变式）。
  it('ctrl+t 后迟到的排队 present 帧不把在飞思考塌回折叠态（队列随 repaint 清点）', () => {
    const { io, backend, pump } = makeInteractive();
    emit(backend, { type: 'message_start', role: 'assistant' });
    // 在飞流式槽带思考（mixedSnapshot——thinking 块累计形）：present op 入队
    // 携折叠态快照，不泵帧留住竞窗
    emit(backend, { type: 'message_update', role: 'assistant', partial: mixedSnapshot(['流式中思考'], []) });
    io.bytes = '';
    io.emitInput('\x14'); // ctrl+t：repaint 同步重渲展开档（队内旧 op 仍在）
    expect(io.bytes).toContain('流式中思考'); // 展开思考体在场（repaint 真相）
    pump(); // 迟到的帧回调落地——队已清则零回写
    expect(io.bytes).not.toContain('（ctrl+t 展开）'); // 旧 op 不得把折叠标签写回
  });

  it('层② overlay 占焦期吞 ctrl+t（模态独占——层③.5 应用键不越层）', async () => {
    const { io, backend, pump } = makeInteractive();
    emit(backend, { type: 'message_end', message: thinkingMsg('想法', '文') });
    const p = backend.confirm('确认？');
    pump();
    io.bytes = '';
    io.emitInput('\x14'); // overlay 在场——模态独占
    expect(io.bytes).not.toContain('\x1b[2J'); // 不 repaint（面板吞键——开关零扰动）
    io.emitInput('\r'); // 面板应答——层关
    pump();
    await expect(p).resolves.toBe(true);
  });
});

/* ================= 批 10k 交互面（键位覆盖 / 三副屏装配 / footer 分栏） ================= */

describe('TuiBackend 键位覆盖面（R5 批 10k——keybindings 注入 + 拒载观测）', () => {
  it('注入：好条目生效不受连坐 + 坏条目经 keybindingRejections 透出（装配位呈报）', () => {
    const { backend } = makeBackend({
      // 样例键 ctrl+q（自 ctrl+g 迁——ctrl+g 自挖掘 31 轮 [9] 起册占 external-edit，
      // 挪 thinking.toggle 上去会与缺省册撞出第二条 conflict 拒载）
      keybindings: { 'thinking.toggle': 'ctrl+q', 'no.such-action': 'ctrl+z' },
    });
    expect(backend.keybindingRejections).toHaveLength(1); // 只拒坏条目
    expect(backend.keybindingRejections[0]).toMatchObject({
      kind: 'unknown-action',
      actionId: 'no.such-action',
    });
  });

  it('注入缺席 = 零拒载（缺省册恒净）', () => {
    const { backend } = makeBackend();
    expect(backend.keybindingRejections).toEqual([]);
  });
});

describe('TuiBackend /sessions · /usage · /help 副屏装配（R7 批 10k）', () => {
  const SESSIONS: readonly UiSessionSummary[] = [
    { id: 'sess-cccccccccc', title: '调 TUI', updatedAt: new Date(2026, 8, 15, 10, 30).getTime(), active: false },
    { id: 'sess-dddddddddd', title: '旧会话', updatedAt: new Date(2026, 8, 14, 9, 5).getTime(), active: true },
  ];
  const SUMMARY: UiUsageSummary = {
    turns: 2,
    input: 12345,
    output: 6789,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 19134,
    cost: 0.5,
    currency: 'USD',
  };

  /** 同步直出档装配（historyRig 同形） */
  function rig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openSessions 编舞：主屏出屏 → 副屏进 → 切换器首帧清单在场', () => {
    const { io, backend } = rig();
    expect(backend.openSessions(SESSIONS, () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    expect(io.bytes).toContain('⇄ 会话切换 · 2 会话'); // 头行
    expect(io.bytes).toContain('调 TUI'); // 清单行（标题）
    expect(io.bytes).toContain('●'); // 活跃位（sess-dd 活跃行）
  });

  it('openSessions 选定：enter 先收副屏再透传 onSelect（切焦回调核闭包）', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openSessions(SESSIONS, (id) => selected.push(id));
    io.reset();
    io.emitInput('\r'); // enter——首行默认光标
    expect(selected).toEqual(['sess-cccccccccc']); // 选定回调透传
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
  });

  it('openSessions 副屏内 Ctrl+C：打断目标 = 当前交互会话位（不退副屏）', () => {
    const { io, backend, calls } = rig();
    backend.openSessions(SESSIONS, () => {});
    io.reset();
    io.emitInput('\x03');
    expect(calls.interrupted).toEqual([SESSION]); // 装配闭包锚交互会话（切焦前语义）
    expect(backend.lifecycle).toBe('suspended');
  });

  it("openSessions 'o' 开史即收形：透传前先收切换器副屏再达 onOpenHistory（id + initialCursor 位双参）；已收后连续 'o' 结构性不可能", () => {
    const { io, backend } = rig();
    const opened: Array<[string, number, string]> = [];
    backend.openSessions(
      SESSIONS,
      () => {},
      undefined,
      undefined,
      undefined,
      (id, cursorAt) => opened.push([id, cursorAt, backend.lifecycle]),
      1, // initialCursor——光标复原位（构造位透传）
    );
    io.reset();
    io.emitInput('o'); // kitty 轨 text 事件 → picker text 轨 'o'（光标位 = initialCursor）
    expect(opened).toEqual([['sess-dddddddddd', 1, 'running']]); // 即收形铁证：回调到达时切换器已收主屏已复起
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    io.reset();
    io.emitInput('o'); // 已收切换器无键源——竞窗结构性消解（主屏编辑器归输入）
    expect(opened.length).toBe(1);
  });

  it('openHistory 退出复原钩：onCloseReopen 在场 onExit 双步（先收副屏再触发）；缺席单步现行为零变', () => {
    const { io, backend } = rig();
    const calls: string[] = [];
    backend.openHistory(SESSION, [], undefined, () => calls.push(`reopen@${backend.lifecycle}`));
    io.reset();
    io.emitInput('q'); // 键面退出路（ask/stop 外部收屏路不经 viewer onExit——承认丢失）
    expect(calls).toEqual(['reopen@running']); // 双步序：复原钩到达时副屏已收主屏已复起
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    // 缺席单步（现行为锁——第四参不传 q 退出即既有形）
    const bare = rig();
    bare.backend.openHistory(SESSION, []);
    bare.io.reset();
    bare.io.emitInput('q');
    expect(bare.backend.lifecycle).toBe('running'); // 现行为零变
  });

  it('openUsage 编舞：用量面板首帧（短 id 头行 + 分表千位分组 + 费用）', () => {
    const { io, backend } = rig();
    expect(backend.openUsage('sess-dddddddddd', SUMMARY)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◉ 会话用量 · sess-ddd'); // 头行（参数会话非交互位；短 id 8 字符；❄/⧗→◉ 图标收敛批）
    expect(io.bytes).toContain('12,345'); // 输入分表千位分组
    expect(io.bytes).toContain('0.5000 USD'); // 费用行
  });

  it('openUsage 上下文余量条形行：context_usage 真值在场 → 开屏快照带条形（挖掘 31 轮 [6]——静态档不活跟）', () => {
    // 行集 12 行 + 头/底 2 超缺省 10 行终端视口——高终端（24 行）使条形行入
    // 首帧（openDebug 组同形）；缺省终端截断形由既有编舞测锁（费用行同截）
    const io = new MemoryTerminalIO(COLS, 24);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    emit(backend, { type: 'context_usage', usedTokens: 400_000, maxTokens: 1_000_000 }); // settled 落账（非流中——无估值窗）
    io.reset();
    expect(backend.openUsage('sess-dddddddddd', SUMMARY)).toBe(true);
    expect(io.bytes).toContain('[████████████░░░░░░░░] 剩 60% · 400 K / 1 M'); // 修前红：条形行缺席
  });

  it('openUsage 上下文缺席 = 无条形行（诚实缺席双态之二——足迹面零条形符号）', () => {
    const { io, backend } = rig();
    expect(backend.openUsage('sess-dddddddddd', SUMMARY)).toBe(true);
    expect(io.bytes).not.toContain('█');
    expect(io.bytes).not.toContain('剩 ');
  });

  // B3 批 2：台账载荷（结构兼容真源形——conversation 侧 foldCallLedger 产物
  // 同形直传零映射；两条 = 主路 stop + 单发路带归因/耗时）
  const CALL_ENTRIES: readonly UiCallLedgerEntry[] = [
    {
      source: 'conversation',
      time: new Date(2026, 8, 15, 10, 30).getTime(),
      seq: 4,
      model: 'faux/m1',
      status: 'stop',
      attempt: 1,
      tokens: 1234,
    },
    {
      source: 'oneshot',
      time: new Date(2026, 8, 15, 10, 31).getTime(),
      seq: 7,
      status: 'stop',
      attempt: 1,
      tokens: 5678,
      elapsedMs: 800,
      attribution: 'probe',
    },
  ];

  it('openCalls 编舞：台账面板首帧（短 id 头行 + 截断披露 + 行段最新在前）', () => {
    const { io, backend } = rig();
    expect(backend.openCalls('sess-dddddddddd', CALL_ENTRIES, 60)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    expect(io.bytes).toContain('◉ 调用台账 · sess-ddd · 60 条（仅显示最近 2）'); // 头行 + 截断披露（超窗注记）
    expect(io.bytes).toContain('m1'); // 模型短名段（id 尾段）
    expect(io.bytes).toContain('完成'); // 状态词（stop → 完成——词面映射归面板）
    expect(io.bytes).toContain('连通测试'); // 归因段（probe → 用户面词）
    // 最新在前：单发路行（seq 7）在主路行（seq 4）之前
    const oneshotAt = io.bytes.indexOf('连通测试');
    const mainAt = io.bytes.indexOf('m1');
    expect(oneshotAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(oneshotAt);
  });

  it('openHelp 编舞：命令册 + 键位册双源首帧', () => {
    const { io, backend } = rig();
    expect(backend.openHelp([{ name: 'exit', description: '退出 TUI' }])).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.bytes).toContain('◉ 命令与键位帮助 · 会话 sess-aaa'); // 头行锚交互会话短 id（❓→◉ 图标收敛批）
    expect(io.bytes).toContain('── 命令 ──'); // 命令册段
    expect(io.bytes).toContain('/exit'); // 注入命令条目
    expect(io.bytes).toContain('── 键位 ──'); // 键位册段（keymap 投影）
    expect(io.bytes).toContain('ctrl+c'); // 键位条目样点（全局域首条）
  });

  it('三面互斥：openHistory 在场三面全 false；收副屏后可开（单值备屏律）', () => {
    const { io, backend } = rig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    expect(backend.openSessions(SESSIONS, () => {})).toBe(false);
    expect(backend.openUsage(SESSION, SUMMARY)).toBe(false);
    expect(backend.openCalls(SESSION, CALL_ENTRIES)).toBe(false); // B3 批 2——台账面同互斥族
    expect(backend.openHelp([])).toBe(false);
    expect(io.bytes).toBe(''); // 拒开零写出
    backend.collapseAltScreen();
    expect(backend.openHelp([])).toBe(true); // 收后可开
  });

  it('openFeedback 编舞：开屏扫一次错误史（头行 + 段头条数 + 条目首行）+ 副屏占用 false（UX ④拍板）', () => {
    const { io, backend } = rig();
    const queries: Array<Record<string, unknown>> = [];
    expect(
      backend.openFeedback({
        sessions: [{ id: 'sess-aaaaaaaaaaaa' }],
        queryEvents: (filter) => {
          queries.push(filter); // 扫描面记录——单会话单页单次
          return {
            events: [
              { type: 'turn/start', time: 1, data: null },
              { type: 'assistant/message', time: 2, data: { errorMessage: '模型 401：密钥失效' } },
              { type: 'turn/end', time: 3, data: { reason: 'error' } },
            ],
            nextCursor: null,
          };
        },
        sinceMs: 0,
        windowDays: 7,
        pageLimit: 100,
        maxEntries: 50,
        sessionsTotal: 3,
        env: ['版本 0.1.0-alpha'],
        daemonLogPath: null, // daemon 段随导出件出（V-0 注⑤）——内存形缺席基线
        daemonLogTail: null,
        writeFile: () => '/tmp/diagnostics/mock.txt',
      }),
    ).toBe(true);
    expect(queries).toHaveLength(1); // 开屏单次扫描（快照档律——不轮询）
    expect(io.bytes).toContain('◉ 反馈 /feedback'); // 头行（图标收敛批同律）
    expect(io.bytes).toContain('── 运行错误（近 7 天 · 1 条）──'); // 段头带范围与条数
    expect(io.bytes).toContain('模型 401：密钥失效'); // 条目错误首行
    io.reset();
    expect(backend.openHelp([])).toBe(false); // 副屏占用（单值备屏律）
    expect(io.bytes).toBe(''); // 拒开零写出
  });

  it('onRepaint 切焦跟随：openHelp 头行短 id 随新聚焦会话（焦点权威信号）', () => {
    const { io, backend } = rig();
    backend.onRepaint('sess-bbbbbbbbbbbb', [], null); // 切焦 repaint——sessionId 跟随
    io.reset();
    backend.openHelp([]);
    expect(io.bytes).toContain('◉ 命令与键位帮助 · 会话 sess-bbb'); // 新会话短 id
  });
});

describe('TuiBackend 本地命令族拦截（07 §4.1 命令面增补批）', () => {
  /** 本地命令族注入 rig：run 调用记录 */
  function localRig() {
    const runs: string[] = [];
    const rig = makeInteractive({
      localCommands: [
        { name: 'status', description: '状态汇总页（版本/模型/会话/环境变量）', run: () => runs.push('status') },
        { name: 'debug', description: '调试信息页（日志尾快照/生效配置/插件清单）', run: () => runs.push('debug') },
      ],
      dispatchCommand: async (input) => {
        rig.calls.dispatched.push(input);
        return false; // 未命中兜底（真通道命令柄语义由既有组覆盖）
      },
    });
    return { ...rig, runs };
  }

  it('恰零参命中 → run() 终局（先于通道命令分发、不落 onSubmit）', () => {
    const { io, runs, calls, pump } = localRig();
    io.emitInput('/status\r');
    pump();
    expect(runs).toEqual(['status']);
    expect(calls.dispatched).toEqual([]); // 本地族先于通道命令面
    expect(calls.submitted).toEqual([]); // 永不兜底进模型消息
    io.emitInput('  /debug  \r'); // 尾随空白 trim 后恰命中
    pump();
    expect(runs).toEqual(['status', 'debug']);
  });

  it('带参形 → warn 用法提示终局（不执行不兜底）', () => {
    const { io, runs, calls, pump } = localRig();
    io.emitInput('/status now\r');
    pump();
    expect(io.bytes).toContain('不带参数'); // 用法 fail-loud（/exit 同律）
    expect(io.bytes).toContain('⚠'); // warn 档符号
    expect(runs).toEqual([]);
    expect(calls.submitted).toEqual([]);
  });

  it('run() 异常 → notify error 兜底（不崩不静默——dispatchCommand 路同句单源）', () => {
    // 修前红：maybeHandleLocalCommand 对 spec.run() 直调无 try/catch——异常经
    // handleInput 同步上抛（真装配升格 uncaughtException 走崩溃编舞 exit(1)）
    const rig = makeInteractive({
      localCommands: [
        {
          name: 'boom',
          description: '炸药',
          run: () => {
            throw new Error('炸了');
          },
        },
      ],
    });
    expect(() => {
      rig.io.emitInput('/boom\r');
      rig.pump();
    }).not.toThrow(); // 修前红：异常穿透输入管线到 emitInput 调用方
    expect(rig.io.bytes).toContain('✗ 命令异常'); // error 档符号 + 兜底文案（与 dispatchCommand 同句）
  });

  it('词干未命中 → 落通道命令柄（false 兜底进 onSubmit）；注入缺席 = 零拦截', async () => {
    const { io, calls, pump } = localRig();
    io.emitInput('/statusy\r'); // 前缀近似但非词干——不拦
    pump();
    await Promise.resolve(); // dispatch 异步链微任务排空
    expect(calls.dispatched).toEqual(['/statusy']);
    expect(calls.submitted).toEqual([['s1', '/statusy']]);
    // 注入缺席：'/status' 是普通 '/' 文本（既有路由零扰动）
    const bare = makeInteractive();
    bare.io.emitInput('/status\r');
    bare.pump();
    expect(bare.calls.submitted).toEqual([['s1', '/status']]);
  });

  it('退出词优先级不降：本地族在场时 /exit 仍走 onQuit（调用序在前）', () => {
    const { io, runs, calls, pump } = localRig();
    io.emitInput('/exit\r');
    pump();
    expect(calls.quit).toBe(1); // 退出词先于本地族（handleSubmit 调用序）
    expect(runs).toEqual([]);
  });
});

describe('TuiBackend /status · /debug · /skills 副屏装配（07 §4.1 命令面增补批）', () => {
  const STATUS_DATA = {
    version: '0.2.0',
    model: 'faux/test-model',
    modelCount: 3,
    // 模型凭证态（ob-2——StatusPanelData 新增必填位；态可入面锁样点）
    modelCredential: 'ready' as const,
    sessionId: SESSION,
    cwdLabel: 'berry-agent',
    turns: 7,
    dataDir: '/tmp/berry-home',
    theme: 'dark',
    env: [
      { key: 'BERRY_AGENT_MODEL', value: null },
      { key: 'BERRY_AGENT_DATA_DIR', value: '/tmp/berry-home' },
      { key: 'BERRY_AGENT_LOG_LEVEL', value: 'debug' },
    ],
  };
  const DEBUG_DATA = {
    daemonLogPath: '/tmp/berry-home/serve/daemon.log',
    daemonLogTail: ['daemon 启动', 'token 回执：Bearer tok_secret123'],
    logLevel: 'debug',
    settingsKeys: ['theme'],
    settingsWarnings: ['theme 坏值 warn 样点'],
    sqlitePath: '/tmp/berry-home/agent.db',
    pluginIds: ['core:skills'],
  };
  const SKILLS = [
    { name: 'commit-style', description: '提交信息风格', layer: 'project', hidden: false },
    { name: 'dataviz', description: '图表建议', layer: 'user', hidden: true },
  ];

  /** 同步直出档装配（R7 组同形） */
  function rig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openStatus 编舞：主屏出屏 → 副屏进 → 状态首帧；开屏锚顶（首段在场尾段缺席）', () => {
    const { io, backend } = rig();
    expect(backend.openStatus(STATUS_DATA)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    expect(io.bytes).toContain('◉ 状态汇总 · 会话 sess-aaa'); // 头行（短 id）
    // 开屏锚顶：行集 14 行超视口（10 行终端）——首段「── 运行时 ──」在场而
    // 尾行 env LOG_LEVEL 缺席（贴尾回看器语义会只显末段）
    expect(io.bytes).toContain('── 运行时 ──');
    expect(io.bytes).not.toContain('BERRY_AGENT_LOG_LEVEL');
  });

  it('【44 轮件 C】窄终端开屏截断入帧：openStatus 注入 columns → 工作区全路径段形中截（修前红：columns 未传全长折行）', () => {
    const io = new MemoryTerminalIO(40, 24);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    io.reset();
    expect(backend.openStatus({ ...STATUS_DATA, cwdFull: '/Users/alice/work/very/deep/nested/berry-agent' })).toBe(
      true,
    );
    // 40 列 → 预算 40 − 标签列 10 = 30 → 段形中截 '/Users/…/berry-agent'（宽 22 容）
    expect(io.bytes).toContain('/Users/…/berry-agent');
    // 全长中段恒不入帧（截断形唯一——防折行全长形双呈）
    expect(io.bytes).not.toContain('/Users/alice/work/very/deep/nested');
  });

  it('openDebug 编舞：调试首帧；daemon.log 尾快照 token 形掩码（明文恒不在场）', () => {
    // 行集 15 行超 10 行终端视口——高终端（24 行）使尾快照段入首帧（锚顶律
    // 由 openStatus 组同形锁定，本组聚焦掩码呈现）
    const io = new MemoryTerminalIO(COLS, 24);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    io.reset();
    expect(backend.openDebug(DEBUG_DATA)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◉ 调试信息'); // 头行（⚙→◉ 图标收敛批）
    expect(io.bytes).toContain('serve/daemon.log'); // 路径行
    expect(io.bytes).toContain('Bearer ****'); // 掩码形在场
    expect(io.bytes).not.toContain('tok_secret123'); // 明文恒不入面（04 §7 敏感件纪律）
    expect(io.bytes).toContain('core:skills'); // 插件清单行
  });

  it('openSkills 编舞：清单首帧（计数头 + 光标行 + 隐藏标记）', () => {
    const { io, backend } = rig();
    expect(backend.openSkills(SKILLS, () => 'BACKFILL')).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 技能清单 · 2 个'); // 头行（✦→◆ 图标收敛批——picker 形记号）
    expect(io.bytes).toContain('› commit-style'); // 首行光标
    expect(io.bytes).toContain('隐 · user'); // 隐藏件标记（含入不滤）
  });

  it('openSkills enter 回填：先收副屏再回填输入框（不执行——无提交流）', () => {
    const { io, backend, calls } = rig();
    backend.openSkills(SKILLS, (index) => (index === 0 ? 'BACKFILL-FIRST' : 'BACKFILL-SECOND'));
    io.emitInput('\x1b[B'); // ↓——光标到第二行（dataviz；可能产重绘帧）
    io.reset(); // 只断言 enter 编舞
    io.emitInput('\r'); // enter——选定回填
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).toContain('BACKFILL-SECOND'); // 回填文本入编辑器（首帧固定区）
    expect(calls.submitted).toEqual([]); // 回填不执行——提交与否归用户
  });

  it('三面与既有副屏互斥（单值备屏律）；收后可开', () => {
    const { io, backend } = rig();
    backend.openHelp([]);
    io.reset();
    expect(backend.openStatus(STATUS_DATA)).toBe(false);
    expect(backend.openDebug(DEBUG_DATA)).toBe(false);
    expect(backend.openSkills(SKILLS, () => '')).toBe(false);
    expect(io.bytes).toBe(''); // 拒开零写出
    backend.collapseAltScreen();
    expect(backend.openStatus(STATUS_DATA)).toBe(true); // 收后可开
  });

  it('副屏内 Ctrl+C：打断目标 = 当前交互会话位（不退副屏）', () => {
    const { io, backend, calls } = rig();
    backend.openStatus(STATUS_DATA);
    io.reset();
    io.emitInput('\x03');
    expect(calls.interrupted).toEqual([SESSION]);
    expect(backend.lifecycle).toBe('suspended'); // 打断不退副屏
  });
});

describe('TuiBackend /themes · /diff 副屏装配 + 主题切换面（/themes 批——R2 挂账解挂 + 命令面增补批）', () => {
  const THEME_ENTRIES = [
    { name: 'auto', detail: '跟随终端明暗（自动检测）', broken: false },
    { name: 'dark', detail: '内置暗色', broken: false },
    { name: 'light', detail: '内置亮色', broken: false },
    { name: 'my-theme', detail: '自定义（themes/<名>.json）', broken: true },
  ];

  /** /thinking 七档条目（2026-09-17 会话档位切换面批 F1——词序同 THINKING_LEVELS） */
  const THINKING_ENTRIES = [
    { level: 'off', detail: '关闭思考' },
    { level: 'minimal', detail: '极简思考' },
    { level: 'low', detail: '低强度思考' },
    { level: 'medium', detail: '中强度思考' },
    { level: 'high', detail: '高强度思考' },
    { level: 'xhigh', detail: '超高强度思考' },
    { level: 'max', detail: '最大思考' },
  ];

  /** /sandbox 三档条目（2026-09-17 会话档位切换面批 F2——词序同 SANDBOX_MODES） */
  const SANDBOX_ENTRIES = [
    { mode: 'read-only', detail: '只读——写与执行全拒' },
    { mode: 'workspace-write', detail: '工作区可写——越界写须审批' },
    { mode: 'danger', detail: '无沙箱——任何命令直跑宿主' },
  ];

  const DIFF_MESSAGES = [
    {
      type: 'assistant',
      toolCalls: [
        {
          type: 'toolCall',
          toolCallId: 't1',
          toolName: 'edit',
          arguments: JSON.stringify({ patch: '*** Update File: src/a.ts\n+hi\n' }),
        },
      ],
    },
    { type: 'toolResult', toolCallId: 't1' },
  ];

  function rig(options: Partial<TuiBackendOptions> = {}, rows: number = ROWS) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend(
      {
        sessionId: SESSION,
        onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
        onQuit: () => {
          calls.quit += 1;
        },
        ...options,
      },
      rows,
    );
    io.reset();
    return { io, backend, calls };
  }

  it('openThemes 编舞：主屏出屏 → 副屏进 → 主题首帧（计数头 + 当前档标记 + 坏文件 ⚠）', () => {
    // 行高 12 = 恰容整面（48C 样例区 +6：头 1 + 4 条目 + 样例 6 + 底 1）——
    // 缺省 10 行下条目视口被样例区压到 2 行、坏文件条目挤出窗（⚠ 缺席）
    const { io, backend } = rig({}, 12);
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 主题切换 · 4 个主题');
    expect(io.bytes).toContain('● dark'); // 当前档标记
    expect(io.bytes).toContain('⚠'); // 坏文件条目标注
  });

  it('openThemes enter 选定：先收副屏再回调（选定名透传——SessionPicker 同序律）', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openThemes(THEME_ENTRIES, 'auto', (name) => selected.push(name));
    io.emitInput('\x1b[B'); // ↓ → dark
    io.reset();
    io.emitInput('\r'); // enter 选定
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(selected).toEqual(['dark']);
  });

  it("openThemes 'c' 复制主题名（56 轮件 3）：OSC 52 写出（copyToClipboard 单源）+ 收屏后 notify 回执", () => {
    const { io, backend } = rig();
    backend.openThemes(THEME_ENTRIES, 'dark', () => {});
    io.reset();
    io.emitInput('c'); // 'c' = 复制在选主题名（光标预选现档 dark——48C 预选律）
    // 剪贴板写链：nativeClipboardSpawn seam 缺席（makeBackend 零真进程纪律）
    // → 测试环境无 TMUX → 第①层裸 OSC 52 直写（字节形 = buildOsc52Copy 真源）
    expect(io.bytes).toContain(buildOsc52Copy('dark'));
    // notify 回执副屏期走 suspendedTransients 缓冲——主屏零双显、收屏补吐
    expect(io.bytes).not.toContain('已复制主题名');
    expect(backend.lifecycle).toBe('suspended'); // 复制不收副屏（面板驻留）
    io.emitInput('q'); // 收屏 → resumeMain 补吐回执（「已复制最近一条回复」同族词面）
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).toContain('已复制主题名：dark');
  });

  it('副屏输入补帧（mp-5 家族修·修前红）：openThemes ↓ 后光标移动帧落地——修前输入零帧，光标变更肉眼不可见', () => {
    const { io, backend } = rig();
    backend.openThemes(THEME_ENTRIES, 'auto', () => {});
    io.reset(); // 清进屏序与首帧（首帧已含 dark 行）——聚焦输入补帧
    io.emitInput('\x1b[B'); // ↓ auto → dark（面板光标态变更）
    expect(io.frames.length).toBeGreaterThan(0); // 修前红：输入只转发不请帧——零新帧
    expect(io.frames.join('')).toContain('›'); // 光标标记移上新行（diff 帧写变更格）
  });

  it('openThinking 编舞：主屏出屏 → 副屏进 → 档位首帧（计数头 + 当前档 ● + 底行「下一轮对话起生效」提示）', () => {
    const { io, backend } = rig();
    expect(backend.openThinking(THINKING_ENTRIES, 'medium', () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 深度思考 · 7 级');
    expect(io.bytes).toContain('● medium'); // 当前档标记
    expect(io.bytes).toContain('下一轮对话起生效'); // 生效语义提示（底行）
    expect(io.bytes).toContain('部分模型不支持'); // 诚实句（S3——选定不等于生效：档位能力随 provider）
  });

  it('openThinking current 缺席 = 零 ● 锚（诚实无锚——boot 未设且无切档事件）', () => {
    const { io, backend } = rig();
    expect(backend.openThinking(THINKING_ENTRIES, undefined, () => {})).toBe(true);
    expect(io.bytes).not.toContain('●');
  });

  it('openThinking enter 选定：先收副屏再回调（档位词透传——SessionPicker 同序律）+ 与主题面互斥', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openThinking(THINKING_ENTRIES, 'off', (level) => selected.push(level));
    io.emitInput('\x1b[B'); // ↓ → minimal
    io.reset();
    io.emitInput('\r'); // enter 选定
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(selected).toEqual(['minimal']);
    // 单值备屏律：收屏后可再开主题面（互斥位已释放）
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
  });

  it('openSandbox 编舞：主屏出屏 → 副屏进 → 档位首帧（计数头 + 当前档 ● + danger 警示语 + 底行「即刻生效于后续工具调用」提示）', () => {
    const { io, backend } = rig();
    expect(backend.openSandbox(SANDBOX_ENTRIES, 'workspace-write', () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 沙箱 · 3 级');
    expect(io.bytes).toContain('● workspace-write'); // 当前档标记
    expect(io.bytes).toContain('直跑宿主'); // danger 行警示语
    expect(io.bytes).toContain('即刻生效于后续工具调用'); // 生效语义提示（底行——A4 分拆形：per 工具调用现取）
  });

  it('openSandbox current 缺席 = 零 ● 锚（诚实无锚——boot 未设且无切档事件）', () => {
    const { io, backend } = rig();
    expect(backend.openSandbox(SANDBOX_ENTRIES, undefined, () => {})).toBe(true);
    expect(io.bytes).not.toContain('●');
  });

  it('openSandbox enter 选定：先收副屏再回调（档位词透传——SessionPicker 同序律）+ 与主题面互斥', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openSandbox(SANDBOX_ENTRIES, 'read-only', (mode) => selected.push(mode));
    io.emitInput('\x1b[B'); // ↓ → workspace-write
    io.reset();
    io.emitInput('\r'); // enter 选定
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(selected).toEqual(['workspace-write']);
    // 单值备屏律：收屏后可再开主题面（互斥位已释放）
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
  });

  it('openDiff 编舞：改动总览首帧（组头路径 + 计数）；零 edit 投影 = 诚实空态', () => {
    const { io, backend } = rig();
    expect(backend.openDiff(DIFF_MESSAGES)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('± 改动总览 · 1 文件');
    expect(io.bytes).toContain('src/a.ts');
    expect(io.bytes).toContain('+1');
    backend.collapseAltScreen();
    io.reset();
    expect(backend.openDiff([{ type: 'user' }])).toBe(true); // 空投影收后可开
    expect(io.bytes).toContain('± 改动总览 · 0 文件');
    expect(io.bytes).toContain('本会话没有文件改动');
  });

  it('两新面与既有副屏互斥（单值备屏律）：拒开零写出、收后可开', () => {
    const { io, backend } = rig();
    backend.openHelp([]);
    io.reset();
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(false);
    expect(backend.openDiff(DIFF_MESSAGES)).toBe(false);
    expect(io.bytes).toBe('');
    backend.collapseAltScreen();
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
  });

  it('themeChoice 观测位：构造档直读；setThemeChoice 后即时更新', () => {
    const { backend } = rig();
    expect(backend.themeChoice).toBe('dark'); // makeBackend 缺省
    backend.setThemeChoice('auto', null);
    expect(backend.themeChoice).toBe('auto');
  });

  it('setThemeChoice OSC 编舞：显式→探测档开订阅 + 查询；探测→显式档关订阅（不重查）', () => {
    const { io, backend } = rig(); // dark 显式——零探测
    expect(io.bytes).not.toContain('\x1b]11;?');
    backend.setThemeChoice('auto', null); // 开探测
    expect(io.bytes).toContain('\x1b]11;?\x07');
    expect(io.bytes).toContain('\x1b[?2031h');
    io.reset();
    backend.setThemeChoice('dark', null); // 关探测
    expect(io.bytes).toContain('\x1b[?2031l');
    expect(io.bytes).not.toContain('\x1b]11;?');
  });

  it('setThemeChoice auto→auto：补发重查（重选即重探——运行时切档重走下装同律）', () => {
    const { io, backend } = rig({ theme: 'auto' });
    io.reset();
    backend.setThemeChoice('auto', null);
    expect(io.bytes).toContain('\x1b]11;?\x07'); // 重查在场
    expect(io.bytes).not.toContain('\x1b[?2031h'); // 已开不重开
  });

  it('setThemeChoice 换装即时落帧：dark → light accent 翻 ANSI 4（SGR 34）', () => {
    const { io, backend } = rig(); // dark 基线
    emit(backend, { type: 'agent_start' }); // 转轮 accent 载体在屏
    io.reset();
    backend.setThemeChoice('light', null);
    expect(io.bytes).toContain('\x1b[34m');
    expect(io.bytes).not.toContain('\x1b[36m');
  });

  it('自定义档运行时切档：覆盖表随装 + 探测开（customOverlay 即探测档）', () => {
    const { io, backend } = rig(); // dark 显式基线
    emit(backend, { type: 'agent_start' }); // 转轮 accent 载体在屏
    io.reset();
    backend.setThemeChoice('my-theme', { accent: ansiColor(3) });
    expect(io.bytes).toContain('\x1b[33m'); // 覆盖键生效（accent → ANSI 3 yellow——转轮换装重建）
    expect(io.bytes).toContain('\x1b[?2031h'); // 自定义档 = 键级回退探测恒在
  });

  it('自定义档 OSC 11 应答重合成：覆盖键恒胜（accent 3 不被基板明暗翻转冲掉）', () => {
    // 裸帧可见色 = 编辑器 › 提示符 accent（secondary 无承载行——基板翻转另测）。
    // 重合成后走脏格差分渲染：覆盖键保住 = 提示符色不变 = 零色字节写出（若
    // 覆盖丢失翻 light 裸 accent 4，差分必写 \x1b[34m——负断言即证据）
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      theme: 'custom-x',
      customThemeOverlay: { accent: ansiColor(3) },
    });
    emit(backend, { type: 'agent_start' }); // 转轮 accent 载体（R-6 翻档——编辑器 › 不再携 accent）
    expect(io.bytes).toContain('\x1b[33m'); // dark 基板 + 覆盖 accent 3（转轮载体）
    io.reset();
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 亮底应答——重合成
    expect(io.bytes).not.toBe(''); // 重画路过（换装四面重渲染发生了）
    expect(io.bytes).not.toContain('\x1b[34m'); // 覆盖键未被冲掉（丢失则差分必现 4）
    expect(io.bytes).not.toContain('\x1b[36m'); // 亦未回落 dark 裸 accent 6
    io.reset();
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 同板应答——零重画
    expect(io.bytes).toBe('');
    expect(backend.themeChoice).toBe('custom-x');
  });

  it('自定义档 OSC 11 应答重合成：缺键随基板（accent 未覆盖——dark 6 翻 light 4）', () => {
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      theme: 'custom-x',
      customThemeOverlay: { secondary: ansiColor(5) }, // 覆盖非 accent 键
    });
    emit(backend, { type: 'agent_start' }); // 转轮 accent 载体（R-6 翻档——编辑器 › 不再携 accent）
    expect(io.bytes).toContain('\x1b[36m'); // dark 基板 accent 6（转轮载体）
    io.reset();
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 亮底应答
    expect(io.bytes).toContain('\x1b[34m'); // 基板翻 light——缺键回退同位键（accent 4）
    expect(io.bytes).not.toContain('\x1b[36m');
  });

  it('自定义档明暗翻转后同板零重画（dark 应答在 dark 基板期）', () => {
    const { io } = rig({
      theme: 'custom-x',
      customThemeOverlay: { accent: ansiColor(3) },
    });
    io.reset();
    io.emitInput('\x1b]11;rgb:0000/0000/0000\x07'); // 暗底 = 同板（dark 基板）
    expect(io.bytes).toBe('');
  });
});

describe('TuiBackend /marketplace 选装副屏（mp-5——03 §9.6 TUI 选装面）', () => {
  /** 可变模型 rig（host 拥有形——字段替换式变更，readonly 投影给面板） */
  function marketModel() {
    return {
      rows: [
        {
          id: 'hello-plugin@alpha',
          name: 'hello-plugin',
          version: '1.0.0',
          market: 'alpha',
          description: '问好插件',
          installed: false,
        },
        {
          id: 'demo-pkg@alpha',
          name: 'demo-pkg',
          version: '1.2.3',
          market: 'alpha',
          installed: true,
        },
      ],
      tail: ['alpha 跳过：缓存缺 snapshot.json'],
      results: [],
      busyLabel: null as string | null,
    };
  }

  /** rig 同 themes 段（calls 收集位非本面重点——只借进/出屏序锁） */
  function rig() {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset();
    return { io, backend };
  }

  it('openMarketplace 编舞：主屏出屏 → 副屏进 → 选装首帧（头行计数 + › 光标 + 已装徽标 + tail 尾行区）', () => {
    const { io, backend } = rig();
    expect(
      backend.openMarketplace(marketModel(), {
        install: () => {},
        uninstall: () => {},
        upgrade: () => {},
        refresh: () => {},
      }),
    ).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 插件市场 · 2 条目（1 源）');
    expect(io.bytes).toContain('› hello-plugin@alpha'); // 光标在首行
    expect(io.bytes).toContain('demo-pkg@alpha 已装'); // 已装徽标
    expect(io.bytes).toContain('alpha 跳过：'); // tail 尾行区
    expect(io.bytes).toContain('↑↓ 移动 · enter 安装/卸载'); // 键面提示行
  });

  it('host 模型变更路（requestAltRepaint）：busyLabel 换装即时落帧 + busy 期动作键锁（enter 零回调 + warn 入挂起缓冲复起补吐）', () => {
    const { io, backend } = rig();
    const model = marketModel();
    const calls: string[] = [];
    backend.openMarketplace(model, {
      install: (id) => calls.push(`install:${id}`),
      uninstall: (id) => calls.push(`uninstall:${id}`),
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.reset(); // 清进屏序与首帧——聚焦模型变更补帧
    model.busyLabel = '正在安装（marketplace install hello-plugin@alpha）';
    backend.requestAltRepaint();
    expect(io.bytes).toContain('⏳ 正在安装'); // busy 底行上屏（host 侧变更经公开面请帧）
    io.reset();
    io.emitInput('\r'); // busy 期 enter——面板锁键第一道（fail-loud + 零回调）
    expect(calls).toEqual([]);
    io.emitInput('q'); // 收屏——复起补吐挂起期 warn（BUSY 锁文）
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).toContain('操作进行中，完成后可重试');
  });

  it('enter 选定：先收副屏再回调 install（07 §4.1 既有律）+ 未装→install / 已装→uninstall 分叉', () => {
    const { io, backend } = rig();
    const calls: string[] = [];
    const model = marketModel();
    backend.openMarketplace(model, {
      install: (id) => calls.push(`install:${id}`),
      uninstall: (id) => calls.push(`uninstall:${id}`),
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.reset(); // 清进屏序与首帧——聚焦 enter 编舞
    io.emitInput('\r'); // 光标在首行（hello-plugin 未装）→ install
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(backend.lifecycle).toBe('running');
    expect(calls).toEqual(['install:hello-plugin@alpha']);
    // 第二开屏：↓ 移到已装条目 → enter = uninstall 分叉
    backend.openMarketplace(marketModel(), {
      install: (id) => calls.push(`install:${id}`),
      uninstall: (id) => calls.push(`uninstall:${id}`),
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.emitInput('\x1b[B'); // ↓ → demo-pkg（已装）
    io.reset();
    io.emitInput('\r');
    expect(calls.at(-1)).toBe('uninstall:demo-pkg@alpha');
  });

  it('u 换装 / r 刷新面板驻留不收屏 + 副屏占用如实拒（第二开 false）', () => {
    const { io, backend } = rig();
    const calls: string[] = [];
    backend.openMarketplace(marketModel(), {
      install: () => {},
      uninstall: () => {},
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.reset();
    io.emitInput('\x1b[B'); // ↓ → demo-pkg（已装）
    io.emitInput('u'); // 已装条目 u = 换装回调（驻留——不出屏）
    expect(backend.lifecycle).toBe('suspended'); // 仍在副屏
    expect(calls).toEqual(['upgrade:demo-pkg@alpha']);
    io.emitInput('r'); // r = 刷新回调（驻留）
    expect(calls.at(-1)).toBe('refresh');
    expect(backend.lifecycle).toBe('suspended');
    // 副屏在场再开 = 如实 false（openThemes 同律）
    expect(
      backend.openMarketplace(marketModel(), {
        install: () => {},
        uninstall: () => {},
        upgrade: () => {},
        refresh: () => {},
      }),
    ).toBe(false);
    expect(backend.openThemes([{ name: 'dark', detail: '', broken: false }], 'dark', () => {})).toBe(false);
  });
});

describe('TuiBackend footer 三行栈（V-4 注⑪ 笔3——行1 仪表/行2 环境/今日段退役迁 /status）', () => {
  it('【V-4 注⑪ 修前红→回归锁】三行栈首画：行1 仪表（模式/思考/模型/累计——速度/上下文缺席缩位）+ 行2 环境（目录/短 id/沙箱原词/教学）；今日段退役锁', () => {
    const { io } = makeBackend({
      sessionId: SESSION,
      footer: {
        tiers: () => ({ mode: 'Auto', thinking: '思考高', sandbox: '工作区写', sandboxDanger: false }),
        sessionSpent: () => 500,
        modelLabel: 'zai/glm-4.7',
        cwdLabel: () => 'berry-agent',
      },
    });
    expect(io.bytes).toContain('Auto · 思考高 · glm-4.7 · 累计 500'); // 行1 仪表（六槽右三缺席）
    // 行2（⎇ 缺席——非 git 目录）：教学槽 dim 样式打断纯文本连缀——环境段与
    // 教学段分两断言（SGR 边界在 ' · ' 连接符后）
    expect(io.bytes).toContain('berry-agent · sess-aaa · 工作区写 · ');
    expect(io.bytes).toContain('? 快捷键');
    expect(io.bytes).not.toContain('今日'); // 今日段退役（承载面迁 /status——注⑪⑤）
  });

  it('模式词投影：tiers.mode 透传（MODE_SHORT 装配侧换词——计划/Auto/YOLO 三档）+ 公开刷新面拉现值', () => {
    let mode = '计划';
    let danger = false;
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: {
        tiers: () => ({ mode, thinking: null, sandbox: '只读', sandboxDanger: danger }),
        cwdLabel: () => 'w',
      },
    });
    backend.start();
    expect(io.bytes).toContain('计划'); // 行1 模式槽（唯一在场槽——思考 null/无模型/零累计故无连接符）
    io.reset();
    mode = 'YOLO';
    danger = true;
    backend.refreshFooter(); // 公开刷新面（档位切换点即时刷）
    expect(io.bytes).toContain('YOLO');
    expect(io.bytes).not.toContain('计划');
  });

  it('setFooterModel 活写回迁（注⑪②——ctrl+p 联动）：模型短名即时换新；注入缺席 no-op', () => {
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      footer: {
        tiers: () => ({ mode: 'Auto', thinking: null, sandbox: null }),
        modelLabel: 'faux/m1',
        cwdLabel: () => 'w',
      },
    });
    expect(io.bytes).toContain('Auto · m1'); // 行1 模型槽（id 尾段——全形归 /status；模式槽在场故有连接符）
    io.bytes = '';
    backend.setFooterModel('zai/glm-4.7');
    expect(io.bytes).toContain('Auto · glm-4.7');
    expect(io.bytes).not.toContain('m1'); // 旧短名换出
    // 注入缺席：footer 无 → no-op 零扰动（V-2 退役前同律）
    const bare = makeBackend();
    expect(() => bare.backend.setFooterModel('x/y')).not.toThrow();
  });

  it('context_usage 消费（注⑪② 上下文三件套）：真值在场 → 流中估值平滑 → 切焦清位', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION, footer: { modelLabel: 'm', cwdLabel: () => 'w' } });
    emit(backend, { type: 'context_usage', usedTokens: 996, maxTokens: 1_000_000 });
    expect(io.bytes).toContain('上下文 996 / 1 M · 剩 100%'); // 真值三件套（K/M 单源——<1K 原值；剩余口径+向标词——44 轮件 B）
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好世界') }); // 估值 +4
    expect(io.bytes).toContain('上下文 1 K / 1 M · 剩 100%'); // 流中平滑：996 + 4 → 1000 → '1 K'
    // 平滑帧晚于 agent_start 间隙帧（turn 边界 settled 996 = 合法中间态——上下文
    // 会话级量跨 run 幸存；判据 = 终态帧序非全程缺席）
    expect(io.bytes.lastIndexOf('上下文 1 K / 1 M · 剩 100%')).toBeGreaterThan(io.bytes.lastIndexOf('上下文 996'));
    // 切焦清位（onRepaint → resetUsage 连清——首轮前整段缺席律 per focus）
    backend.onRepaint('sess-bbbbbbbbbbbb', [], null);
    io.bytes = '';
    backend.refreshFooter();
    expect(io.bytes).not.toContain('上下文');
  });

  it('【注⑪② 回归锁】message_end 关窗防双计：context_usage 落账后工具相位重画 = settled 纯值（关窗失效将 settled+估值双计）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION, footer: { modelLabel: 'm', cwdLabel: () => 'w' } });
    emit(backend, { type: 'context_usage', usedTokens: 996, maxTokens: 1_000_000 }); // settled 基线落账
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' }); // 流中平滑窗开
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('字'.repeat(40)) }); // 估值累积 40
    emit(backend, { type: 'message_end', message: usageMsg(440) }); // 真值收口（output=50；关窗位即本分支）
    emit(backend, { type: 'context_usage', usedTokens: 996, maxTokens: 1_000_000 }); // turn 收口 settled 真值再落账（E-4 序：turn_end 前）
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    io.bytes = '';
    // 工具相位（turn 间长窗）：touchFixed 触帧 + setStatus 扇出锚（G1-#3——
    // refreshFooter 同帧重拉仪表段）迫使状态行整行重写（行级差分下同内容帧
    // 零写出——尾注变更使上下文槽重落屏可观测）
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    backend.setStatus(SESSION, '相位观测');
    expect(io.bytes).toContain('上下文 996 / 1 M · 剩 100%'); // settled 纯值（<1K 原值直读）
    expect(io.bytes).not.toContain('上下文 1 K'); // 双计形缺席（996 + 40/50 估值残值 → 1036/1046 → '1 K'——关窗失效形）
  });

  it('context_usage 双可选缺席 = 未知不显示（E-4 事件型语义——诚实缩位）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION, footer: { modelLabel: 'm', cwdLabel: () => 'w' } });
    emit(backend, { type: 'context_usage' });
    expect(io.bytes).not.toContain('上下文');
    emit(backend, { type: 'context_usage', usedTokens: 12_345 }); // maxTokens 缺席 = 二件套（无帽无百分比）
    expect(io.bytes).toContain('上下文 12 K');
    // 已用率裸形退役防复发锁（44 轮件 B）+ 二件套无百分比守锁
    expect(io.bytes).not.toContain(' · 0%');
    expect(io.bytes).not.toContain(' · 剩');
  });

  it('【44 轮件 B 双面同值】footer 上下文槽剩余口径：384 K / 1 M → 剩 62%（单源 contextRemainingPercent——/usage 余量行同式同值）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION, footer: { modelLabel: 'm', cwdLabel: () => 'w' } });
    emit(backend, { type: 'context_usage', usedTokens: 384_000, maxTokens: 1_000_000 });
    // 100 − floor(0.384 × 100) = 62：footer 呈现值与 /usage 余量行（31 轮 [6] 锁
    // 「剩 60%」形——400 K/1 M 语料）同读数单源——round 变体此值仍 62 不可判别，
    // 取整向判别锁在 usage-viewer.test.ts A2 纯函数面（385 K→62 分叉）
    expect(io.bytes).toContain('上下文 384 K / 1 M · 剩 62%');
    // 旧已用率裸形缺席（38% = 100−62 互补形退役——44 轮件 B）
    expect(io.bytes).not.toContain(' · 38%');
  });

  it('【注⑪⑥(c) 修前红→回归锁】速度槽流中供数腿（一机制喂两槽）：流中相位读估值平滑非空——settled 账整段缺席修前', () => {
    let t = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      now: () => t,
      footer: { modelLabel: 'm', cwdLabel: () => 'w' },
    });
    emit(backend, { type: 'agent_start' }); // resetUsage 清账——首个 turn_end 落账前 usageTotal=0
    emit(backend, { type: 'message_start', role: 'assistant' }); // 流中相位开窗
    t += 2000; // 本轮流式已历时 2s（注入钟——分母确定性）
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(400)) }); // 估值 400/4=100 tokens
    expect(io.bytes).toContain('50 tok/s'); // 100 / 2s——修前：速度槽纯认 settled 账（零 token）→ 流中整段缺席
    // 流中窗外回落 settled 真值：message_end 关窗 + turn_end 落账 → run 级平均
    emit(backend, { type: 'message_end', message: usageMsg(600) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' }); // usageTotal = 600
    t += 2000; // run 已历时 4s
    io.bytes = '';
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} }); // 工具相位触重画
    expect(io.bytes).toContain('150 tok/s'); // 600 / 4s——settled 真值（非估值账；亚秒/零 token 诚实缺席律同 speedView）
  });

  it('【E 件 修前红→回归锁】速度槽显示节流 500ms：窗内值变显示持旧（供数层零降频）、推窗刷新、相位切换即刷新', () => {
    let t = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      now: () => t,
      footer: { modelLabel: 'm', cwdLabel: () => 'w' },
    });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' }); // 流中相位开窗（分母起跑于 t=0）
    t += 2000; // 流中已历时 2s
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(400)) }); // 100 tokens → 50 tok/s
    expect(io.bytes).toContain('50 tok/s'); // 首帧刷新（显示缓存空——agent_start 清账）
    // 节流窗内（<500ms）供数值变而显示持旧：+400 tokens 快照差分 → 500 tokens / 2.4s ≈ 208 tok/s
    t += 400;
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(2000)) }); // 供数层照常收账（显示帧零写出——持旧同内容行级差分零写）
    io.bytes = '';
    // 取证走状态行整行重写帧（41 轮件 I 后 resize 路带 75ms 尾随防抖——同
    // 步直出档取证改走 setStatus 触发行重写，语义同前：持旧值与上帧同内容
    // ——增量帧零写出不可断（零写出 ≠ 显示持旧），行重写帧显示值整行可见）
    backend.setStatus(SESSION, '取证');
    expect(io.bytes).toContain('50 tok/s'); // 显示持旧（修前红：无节流 → '208 tok/s' 在场、'50' 缺席）
    expect(io.bytes).not.toContain('208 tok/s'); // 供数值不进显示（节流位 = 呈现层显示缓存）
    // 推过节流窗（≥500ms 自首帧起算）：600 tokens / 2.5s = 240 tok/s 刷新
    t += 100;
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(2400)) });
    expect(io.bytes).toContain('240 tok/s');
    // 相位切换（流中 → settled）：单轮流中账关窗即缺席（settled usageTotal 尚
    // 零）→ 缓存清空，agent_end 终帧经空窗路现算——终值冻结 600 / 2.55s ≈
    // 235 tok/s（相位键的独立锁归 sweep23-件4 专测：本腿单轮形「空窗清缓存」
    // 与「相位键」两机制各自单独充分、删相位键不红——sweep23 突变实证）
    t += 50; // 仍在节流窗内（2500 → 2550 仅 50ms）——若纯时间节流将持旧 '240'
    emit(backend, { type: 'message_end', message: usageMsg(600) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' }); // usageTotal = 600
    emit(backend, { type: 'agent_end', status: 'completed' }); // 终态帧触重画 + 分母冻结 2.55s
    expect(io.bytes).toContain('235 tok/s'); // 600 / 2.55s ≈ 235.3
  });

  it('【sweep23-件2 修前红→回归锁】多轮 run 终帧速度不冻结陈值：末轮 message_end 中间帧在 turn_end 落账前按旧 usageTotal 强刷缓存，agent_end 终帧失效现算全账真值', () => {
    let t = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      now: () => t,
      footer: { modelLabel: 'm', cwdLabel: () => 'w' },
    });
    emit(backend, { type: 'agent_start' }); // run 时钟起跑 t=0
    // 轮 1：流中帧 + 收口落账（usageTotal = 600）
    emit(backend, { type: 'message_start', role: 'assistant' });
    t += 1000;
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(400)) }); // 100 tok/s（stream 相位缓存）
    emit(backend, { type: 'message_end', message: usageMsg(600) }); // 关窗中间帧：settled 速度 null（usageTotal 尚零）→ 缓存清
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' }); // usageTotal = 600
    // 轮 2 无流中帧：message_end 中间帧（enterWorking 触发同步帧）在 turn_end
    // 落账前按旧 usageTotal 现算强刷——600 / 4.45s ≈ 135 陈值入缓存
    emit(backend, { type: 'message_start', role: 'assistant' });
    t += 3450; // run 已历时 4.45s
    emit(backend, { type: 'message_end', message: usageMsg(2400) });
    emit(backend, { type: 'turn_end', turn: 2, stopReason: 'stop' }); // usageTotal = 3000（不触帧）
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' }); // 终帧：分母冻结 4.45s
    expect(io.bytes).toContain('674 tok/s'); // 修前红：同相位窗内持旧 '135'（run 后 tick 忙态门控零帧不自愈）——终帧失效现算 3000/4.45s ≈ 674
    expect(io.bytes).not.toContain('135 tok/s'); // 陈值不冻结为 run 终读数
    expect(io.bytes).toContain('用量 3,000'); // 同排用量真值——速度与用量不再自相矛盾
  });

  it('【sweep23-件4 修前红→回归锁】相位键独立锁：相位翻转 500ms 窗内即刷（删相位键=纯时间节流持旧相位值——既有面突变全绿不拦）', () => {
    let t = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      now: () => t,
      footer: { modelLabel: 'm', cwdLabel: () => 'w' },
    });
    emit(backend, { type: 'agent_start' }); // t=0
    // 轮 1 落账 600（终值供数源）
    emit(backend, { type: 'message_start', role: 'assistant' });
    t += 1000;
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(400)) }); // 100 tok/s {stream}
    emit(backend, { type: 'message_end', message: usageMsg(600) }); // 关窗：settled null → 缓存清
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' }); // usageTotal = 600
    // 轮 2：流中帧重建 stream 缓存（空窗路——100 tokens / 1s = 100 tok/s）
    emit(backend, { type: 'message_start', role: 'assistant' });
    t += 1000; // t=2000
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('b'.repeat(400)) }); // {stream:'100', at:2000}
    t += 450; // t=2450：节流窗内（450 < 500）
    io.bytes = '';
    // message_end 关窗中间帧：相位 stream→settled 翻转且两侧速度非空（600 已
    // 落账）——相位键是唯一刷新路（时间窗不达、缓存非空）：600 / 2.45s ≈ 245
    emit(backend, { type: 'message_end', message: usageMsg(600) });
    expect(io.bytes).toContain('245 tok/s'); // 修前红（删相位键）：流中估值 '100' 跨相位持旧呈现
    expect(io.bytes).not.toContain('100 tok/s');
  });

  it('【注⑪⑥(c) 诚实缺席锁】速度槽流中相位亚秒窗/零估值两缺席形（JSDoc 三形补锚——speedView 同律既有锁的流中腿）', () => {
    // ①亚秒窗缺席：分母起跑后 500ms——亚秒平均速度无意义（判别性实证锚：
    // 改坏 elapsedMs<1000 判据后本断言红——届时将现 100/0.5s=200 tok/s）
    let t = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      now: () => t,
      footer: { modelLabel: 'm', cwdLabel: () => 'w' },
    });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' }); // 流中相位开窗（分母起跑于 t=0）
    t += 500; // 亚秒窗
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(400)) }); // 估值 400/4=100 tokens
    expect(io.bytes).not.toContain('tok/s'); // 亚秒窗缺席（无起点缺席形归 speedView 既有锁——本批在场面外两形）
    // ②跨秒呈现（同轮续推对照组——缺席非恒缺席）：累计 1500ms
    t += 1000;
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(800)) }); // 累计快照差分再 +100 → 200 tokens
    expect(io.bytes).toContain('133 tok/s'); // 200 / 1.5s ≈ 133.3（≥100 整数档——formatTokensPerSecond 单源）
    // ③零估值缺席：空 partial（content 空 → 估值 0）跨秒仍缺席——无 token 无速度可言
    let t2 = 0;
    const rig2 = makeBackend({
      sessionId: SESSION,
      now: () => t2,
      footer: { modelLabel: 'm', cwdLabel: () => 'w' },
    });
    emit(rig2.backend, { type: 'agent_start' });
    emit(rig2.backend, { type: 'message_start', role: 'assistant' });
    t2 += 2000; // 跨秒窗（对照组②分母充分——缺席只可归零估值）
    rig2.io.bytes = '';
    emit(rig2.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('') }); // content: [] → 零估值
    expect(rig2.io.bytes).not.toContain('tok/s');
  });

  it('速度段行1（注⑪②——speedView 消费）：completed 终值冻结进仪表；aborted 终态抑制不显段', () => {
    let t = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      now: () => t,
      footer: { modelLabel: 'm', cwdLabel: () => 'w' },
    });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t += 4000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('25 tok/s'); // 100/4s 终值冻结入行1
    // aborted：终值照算（speedView 观测面）但呈现抑制（批C 诚实缺席律——呈现面
    // 专属）。busy-off 信封帧（]9;4;0 路先行于 agent_end 终态突变）携带终前
    // 速度属揭示前中间帧；判据 = 终态帧族（⏹ 揭示后）不再含速度段
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(50) });
    emit(backend, { type: 'turn_end', turn: 2, stopReason: 'stop' });
    t += 4000;
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(io.bytes.lastIndexOf('⏹ 已中止')).toBeGreaterThan(io.bytes.lastIndexOf('tok/s'));
    expect(io.bytes).toContain('⏹ 已中止');
  });

  it('【注⑪② 补锁】行1 六槽全在场连接序：模式·思考·模型·累计·速度·上下文（instrumentSlots 压栈序=坍缩梯宽序）', () => {
    // 坍缩梯⑧右起丢（status-line slots.pop()）——instrumentSlots 压栈序即宽序
    // （上下文最先丢、模式词恒保）：调换 push 序则内容序随错且丢弃序随错，而
    // 既有锁只锁四槽前缀（'Auto · 思考高 · glm-4.7 · 累计 500'）与速度/上下文
    // 各自单独在场——六槽并陈全序此前零内容锁。行级差分下变行整行重写，帧内
    // 全序可读（stripAnsi 剥 SGR/定位后 indexOf 序比对各槽锚词相对位置）
    let t = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      now: () => t,
      footer: {
        tiers: () => ({ mode: 'Auto', thinking: '思考高', sandbox: '工作区写', sandboxDanger: false }),
        sessionSpent: () => 500, // 累计槽（>0 在场）
        modelLabel: 'zai/glm-4.7', // 模型槽（id 尾段短名）
        cwdLabel: () => 'proj',
      },
    });
    emit(backend, { type: 'context_usage', usedTokens: 996, maxTokens: 1_000_000 }); // 上下文槽真值落账
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' }); // 流中相位开窗（速度槽供数腿）
    t += 2000; // 注入钟——流中已历时 2s（分母确定性）
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('a'.repeat(400)) }); // 估值 100 → 速度 50 tok/s；上下文 996+100 → 1 K
    const line = stripAnsi(io.bytes);
    // 整行1 连接序恰为六槽序（' · ' 连接——整行显示宽 71 < 80 无坍缩无损）
    expect(line).toContain('Auto · 思考高 · glm-4.7 · 累计 500 · 50 tok/s · 上下文 1 K / 1 M · 剩 100%');
    // 各槽锚词相对位置严格右移（缺席 indexOf -1 即红——判别锚：调换速度/上下文 push 序本断言红）
    let at = -1;
    for (const anchor of ['Auto', '思考高', 'glm-4.7', '累计 500', '50 tok/s', '上下文 1 K / 1 M · 剩 100%']) {
      const next = line.indexOf(anchor, at + 1);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it('行2 ⎇ 段：git 库目录现支名@短哈希（readGitHead 低频锚缓存——/status 行维持不撤）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berry-git-slot-'));
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'dev'), 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n');
    try {
      const { io } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
      });
      expect(io.bytes).toContain('⎇ dev @a1b2c3d'); // 支名 @短哈希（前 7 位——零子进程直读 refs；'⎇ 支名 @' 记形随 gitHeadSuffix 单源）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('【注⑪③ 补锁】行2 ⎇ 与沙箱并陈序：⎇ 支名@短哈希在沙箱原词之前（envSlots 压栈序=右起丢弃序）', () => {
    // 坍缩梯⑧右起丢（row2 pop()：教学先丢→沙箱→⎇→短 id）——envSlots 压栈
    // 序 ⎇ 先于沙箱即宽序（沙箱先于 ⎇ 丢）。既有锁只锁 ⎇ 单独在场（本组上
    // 一测）与沙箱单独在场（首画测），两槽并陈相对序此前零内容锁
    const dir = mkdtempSync(join(tmpdir(), 'berry-git-order-'));
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'dev'), 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n');
    try {
      const { io } = makeBackend({
        sessionId: SESSION,
        footer: {
          tiers: () => ({ mode: 'Auto', thinking: null, sandbox: '工作区写' }), // 行2 沙箱槽（原词）
          cwdLabel: () => 'proj',
          gitRoot: () => dir, // 行2 ⎇ 槽（支名@短哈希——零子进程直读 refs）
        },
      });
      const line = stripAnsi(io.bytes);
      const gitAt = line.indexOf('⎇ dev @a1b2c3d');
      const sandboxAt = line.indexOf('工作区写');
      expect(gitAt).toBeGreaterThanOrEqual(0);
      expect(sandboxAt).toBeGreaterThanOrEqual(0);
      expect(gitAt).toBeLessThan(sandboxAt); // ⎇ 在沙箱原词之前（压栈序即宽序——整行显示宽 54 < 80 无坍缩全序在场）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JobPanel 迁位（注⑪④——行3 最底行）：任务行在状态行之下（行序断言）', () => {
    const jobs: JobEntry[] = [
      { id: 'job-1', name: '后台探查', kind: 'subagent', owner: SESSION, status: 'running', startedAt: 0 },
    ];
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: {
        tiers: () => ({ mode: 'Auto', thinking: null, sandbox: '工作区写' }),
        cwdLabel: () => 'berry-agent',
      },
      jobs: { running: () => jobs, list: () => jobs },
    });
    backend.start();
    // 行序断言走字节位序（流内无换行符——split('\n') 全落首段失效谱）
    const footerAt = io.bytes.indexOf('? 快捷键'); // 行2（状态行末行）
    const jobsAt = io.bytes.indexOf('后台探查');
    expect(footerAt).toBeGreaterThanOrEqual(0);
    expect(jobsAt).toBeGreaterThan(footerAt); // 任务面板迁最底行（状态行之下）
  });

  it('注入缺席：状态行无常驻段（门控零扰动——旧形锚）', () => {
    const { io } = makeBackend({ sessionId: SESSION });
    expect(io.bytes).not.toContain('sess-aaa'); // 无 footer——短 id 不落状态行（title 基线不含会话位）
  });

  it('onRepaint 无 footer 注入：常驻段不开（门控零扰动——修前红锚：refreshFooter 此前无门控）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset();
    backend.onRepaint(SESSION, [], null);
    // 修前：refreshFooter 无门控恒拼段 → 状态行被开常驻段（SGR 包裹的分栏 footer 行）
    expect(io.bytes).not.toContain('\x1b[0msess-aaa\x1b[0m');
  });
});

describe('TuiBackend footer 教学提示门控 + `?` 闲态教学键（V-3 注⑦②④）', () => {
  it('空稿闲态教学提示在场 / 输稿即退 / 清稿复现（syncFooterHint 翻转锚单源）', () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: null }) },
    });
    backend.start();
    expect(io.bytes).toContain('? 快捷键'); // 构造期空稿闲态——hint 首画在场
    io.reset();
    io.emitInput('字'); // 输稿——editor.onChange → syncFooterHint 翻转
    expect(io.bytes).not.toContain('? 快捷键'); // 非空稿退场
    io.reset();
    io.emitInput('\x7f'); // 退格清稿——翻回
    expect(io.bytes).toContain('? 快捷键');
  });

  it('忙态教学提示双态（07 §4.1 教学位扩双态注——忙态空稿呈「输入仍可用」教学非退场）', () => {
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: null }) },
    });
    expect(io.bytes).toContain('? 快捷键'); // 闲态空稿基线（`?` 教学键闲态专属）
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    expect(io.bytes).toContain('回复中——输入仍可用：Enter 追加 / Alt+Enter 排队 / Alt+↑ 弹回'); // 忙态空稿——busy 文案在场（修前红：忙态退场零文案；47 轮件 A 扩尾跟新——宽度预算形）
    expect(io.bytes).not.toContain('? 快捷键'); // 闲态文案退场（忙态 `?` 落编辑器是字符——提示面与键位实况对齐）
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('? 快捷键'); // agent 收尾闲态复现
    expect(io.bytes).not.toContain('回复进行中'); // busy 文案退场
  });

  it('应答窗教学提示退场 / 收场复现（inputAsk 并入门控——提示面与键位实况对齐）', async () => {
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: null }) },
    });
    expect(io.bytes).toContain('? 快捷键'); // 空稿闲态基线在场
    io.bytes = '';
    const answered = backend.input('补全语料');
    // 应答窗：activateInputAsk 清稿（空稿）且闲态不变——但 '?' 键按 routeEvent
    // 层门控（inputAsk===null）此时是应答稿字符非帮助捷键，提示面不退即示假键位
    expect(io.bytes).toContain('? 补全语料'); // 应答提示行同帧在场（断言非空洞——固定区确已重画）
    expect(io.bytes).not.toContain('? 快捷键'); // 修前红：门控漏 inputAsk 半
    io.emitInput('好\r'); // 应答提交——收场
    await answered;
    expect(io.bytes).toContain('? 快捷键'); // 收场复现（空稿闲态无应答窗——三闸全开）
  });

  it('`?` 闲态教学键：text 路分诊开 /help（空稿闲态门控）；柄缺席不劫键', () => {
    const helps: number[] = [];
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      onHelpShortcut: () => helps.push(1),
      onSubmit: (_sid, text) => submitted.push(text),
    });
    backend.start();
    io.bytes = '';
    io.emitInput('?'); // 可打印字符——引擎地面态 text 事件路（key 路恒不命中）
    expect(helps).toHaveLength(1); // 门控全开：柄触发（'?' 被劫即终局不入稿）
    // 非空稿门控：先输普通字符再 '?'——不劫，'?' 作普通字符入稿
    io.emitInput('字');
    io.emitInput('?');
    expect(helps).toHaveLength(1); // 稿非空不劫
    io.emitInput('\r'); // 提交捕获第一段稿文
    expect(submitted).toEqual(['字?']);
    // 忙态门控：agent_start 后空稿 '?' 同样不劫——作普通字符入稿
    emit(backend, { type: 'agent_start' });
    io.emitInput('?');
    expect(helps).toHaveLength(1); // 忙态不劫
    emit(backend, { type: 'agent_end', status: 'completed' });
    io.emitInput('\r'); // 提交捕获第二段稿文
    expect(submitted).toEqual(['字?', '?']);
  });

  it('`?` 柄缺席：不劫键零扰动（普通字符入稿——确定性基线）', () => {
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      onSubmit: (_sid, text) => submitted.push(text),
    });
    backend.start();
    io.emitInput('?');
    io.emitInput('\r');
    expect(submitted).toEqual(['?']);
  });

  it('`?` 教学键 jump 待靶期不劫（挖掘 27 轮 [4]）：待靶态为五闸漏位——? 入编辑器消费靶、后续打字不吞首字', () => {
    const helps: number[] = [];
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      onHelpShortcut: () => helps.push(1),
      onSubmit: (_sid, text) => submitted.push(text),
    });
    backend.start();
    // 空稿置 jump 待靶态（ctrl+] = 0x1d legacy 映射）：模型不动仍空稿、
    // 忙态/overlay/弹层/应答四闸全开——恰是旧五闸的盲区形
    io.emitInput('\x1d');
    io.emitInput('?');
    // 修前红①：? 被 teachingGatesOpen 劫去开 /help（Editor 私有 jumpPending
    // 盲视——待靶态跨开/关面板残留），helps 计 1
    expect(helps).toHaveLength(0); // 待靶期不劫——? 入编辑器消费靶（空稿无命中 no-op 清靶）
    io.emitInput('你好');
    io.emitInput('\r');
    // 修前红②：待靶态残留使首字素「你」被 consumeJumpTarget 吞作跳靶——
    // submitted=['好']；修后待靶态已被 ? 消费清空，全稿 intact
    expect(submitted).toEqual(['你好']);
  });

  it('`?` 教学键 input-ask 应答期不劫（修前红：问题行在场/编辑器空/闲态三闸全开——? 被劫去开 /help 顶掉应答）', async () => {
    const helps: number[] = [];
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      onHelpShortcut: () => helps.push(1),
    });
    backend.start();
    const asked = backend.input('补充一个名字'); // 应答期：问题行在场 + 编辑器清框
    io.bytes = '';
    io.emitInput('?'); // 应答期空稿打 ?——期望作普通字符入应答稿
    expect(helps).toHaveLength(0); // 修前红位：inputAsk 缺席于门控——应答期被误判闲态教学窗
    io.emitInput('\r');
    await expect(asked).resolves.toBe('?'); // ? 是应答内容非教学键
  });
});

/* 空态引导几何（五件批 A+B 随迁）：固定区 6（编辑器 5 + 状态 1）后 10 行屏
 * 转录区仅 4 行——容不下 5 行引导，drawEmptyGuide「放不下不写」诚实缺席（生
 * 产语义正确）。本 describe 锁的是引导**门控语义**（块集 × 稿件 × 忙闲 × 切
 * 焦）非紧几何——用 14 行屏（转录区 8 = 旧 10 行屏固定区 2 时的区域尺寸，
 * 区域内行为逐位恒等），缺席律由本 describe 末测锁定（sweep23-件3：10 行屏
 * 诚实缺席——直接回归锁：修前序复原即红，挖 24 勘正原注「突变形」低估） */
const GUIDE_ROWS = 14;

describe('主屏空态引导（07 §4.1 空转写态注 2026-10-05——零块空稿态转录区引导）', () => {
  it('零块空稿态引导在场 / 输稿退场 / 清稿复现（门控三源：块集 × 稿件 × 忙闲）', () => {
    const io = new MemoryTerminalIO(COLS, GUIDE_ROWS);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    expect(io.bytes).toContain('输入消息开始对话——? 查看快捷键'); // 零块空稿闲态——引导在场（修前红：无引导）
    expect(io.bytes).toContain('berry-agent'); // logo 字形行（启动动画字形语系）
    io.reset();
    io.emitInput('字'); // 输稿——稿件翻转退场
    expect(io.bytes).not.toContain('输入消息开始对话'); // 非空稿退场
    io.reset();
    io.emitInput('\x7f'); // 退格清稿——复现
    expect(io.bytes).toContain('输入消息开始对话——? 查看快捷键');
    io.reset();
    emit(backend, { type: 'agent_start' }); // 忙态——空转写态是就绪态概念，忙期归任务行/busy 教学位
    expect(io.bytes).not.toContain('输入消息开始对话'); // 忙态退场
    io.reset();
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('输入消息开始对话——? 查看快捷键'); // 收尾复现（仍零块空稿）
  });

  it('首块到达即退场零滞留（D 段并账 EL 清引导尾行——append-only 区不残屏）', () => {
    const io = new MemoryTerminalIO(COLS, GUIDE_ROWS);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    expect(io.bytes).toContain('输入消息开始对话'); // 基线在场（5 行引导：字形 3 + 空 1 + 提示 1）
    io.reset();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '你好', timestamp: 1 } });
    expect(io.bytes).toContain('你好'); // 首块（user 块 3 行：空行包夹 + › 前缀行）覆写引导首三行
    expect(io.bytes).not.toContain('输入消息开始对话'); // 引导退场（块集非零门控）
    // 零滞留锁：引导 5 行 − 块 3 行 = 尾 2 行必须 EL 清（修前红：无引导账可清——
    // EL 数 0；实现后恰 2——多余 EL 即清账漂移，少即残屏）
    expect(io.bytes.match(/\x1b\[K/g)?.length ?? 0).toBe(2);
  });

  it('提交清稿的等回声抑制：非命令草稿提交后回声未落前不闪引导', () => {
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, GUIDE_ROWS);
    const backend = new TuiBackend(io, { sessionId: SESSION, onSubmit: (_sid, text) => submitted.push(text) });
    backend.start();
    expect(io.bytes).toContain('输入消息开始对话'); // 基线在场
    io.reset();
    io.emitInput('字');
    io.emitInput('\r'); // 提交清稿——裸 onSubmit 形无用户块回声（等回声窗）
    expect(submitted).toEqual(['字']); // 提交已达（防空洞断言——清稿确已发生）
    expect(io.bytes).not.toContain('输入消息开始对话'); // 修前红位：清稿瞬间零块空稿——引导闪现一帧
    io.emitInput('再'); // 再键入（非空稿）——等回声抑制位复位
    io.emitInput('\x7f'); // 清稿回零块空稿
    expect(io.bytes).toContain('输入消息开始对话'); // 复现（抑制已复位——诚实态非残锁）
  });

  it('切焦即新观察窗：旧焦等回声抑制位不跨切焦携带——空会话新焦引导即时在场', () => {
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, GUIDE_ROWS);
    const backend = new TuiBackend(io, { sessionId: 'sA', onSubmit: (_sid, text) => submitted.push(text) });
    backend.start();
    io.emitInput('字');
    io.emitInput('\r'); // 提交清稿——等回声窗置位（回声未落：submissions 的 user 块 write-behind 窗内）
    expect(submitted).toEqual(['字']); // 防空洞断言——置位前提确达
    io.reset();
    // 切焦空会话 B（repaint 是焦点切换权威信号——切焦即新观察窗）：修前红——
    // awaitingEcho 跨切焦存续，新焦零块空会话的引导被旧焦瞬态抑制（直到编辑器
    // 再键入才解锁——旧焦在途稿件不携带到新焦）
    backend.onRepaint('sB', [], null);
    expect(io.bytes).toContain('输入消息开始对话'); // 修前恒缺席
  });

  it('同会话 refresh 重画不清位：等回声抑制跨同焦 repaint 存续（write-behind 窗防误闪——回归锁）', () => {
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, GUIDE_ROWS);
    const backend = new TuiBackend(io, { sessionId: 'sA', onSubmit: (_sid, text) => submitted.push(text) });
    backend.start();
    io.emitInput('字');
    io.emitInput('\r'); // 等回声窗置位（回声未落）
    io.reset();
    // 同焦 refresh seam 重画（投影回写未含在途稿件——误清位会在重画帧闪引导一帧）：
    // 抑制位维持，与切焦支分治（切焦无条件清 / 同焦条件 settle）
    backend.onRepaint('sA', [], null);
    expect(io.bytes).not.toContain('输入消息开始对话'); // 抑制在场（非残锁——回声落地或再键入即复位）
  });

  it('瞬时行落地即收引导不沉底（第四门——notify 推进 durable 末，引导不随行追画）', () => {
    const io = new MemoryTerminalIO(COLS, GUIDE_ROWS);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    expect(io.bytes).toContain('输入消息开始对话'); // 基线在场
    io.reset();
    backend.notify('一行通知');
    expect(io.bytes).toContain('一行通知');
    expect(io.bytes).not.toContain('输入消息开始对话'); // 修前红位：引导随瞬时行沉底追画（逐次下潜触滚漂账）
    io.reset();
    backend.notify('后继通知');
    expect(io.bytes).toContain('后继通知');
    expect(io.bytes).not.toContain('输入消息开始对话'); // 追画修前红第二面：后续瞬时行下不再现引导
    // 权威清点门重置语义：notify 保全档行入清点账——repaint 重放后仍占转录区，
    // 引导按门保持退场（清点量非零 = 重建后转录区非纯净）
    backend.onRepaint(SESSION, [], null);
    expect(io.bytes).toContain('一行通知'); // 保全档重放（权威重建补吐——竞窗根因修锁面）
    expect(io.bytes).not.toContain('输入消息开始对话');
  });

  it('【sweep23-件3 修前红→直接回归锁——修前序复原即红】「放不下不写」缺席律：10 行屏转录区 4 < 引导 5 行——诚实缺席零画出（renderFixed 序倒退即红；删缺席守卫突变路同断言亦红）', () => {
    const io = new MemoryTerminalIO(COLS, 10); // 固定区 6（编辑器 5 + 状态 1）→ 转录区 4 行
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    expect(io.bytes).toContain('›'); // 固定区在场（缺席不殃及主屏——编辑器与状态行如常写出）
    expect(io.bytes).not.toContain('输入消息开始对话'); // 引导放不下不写——诚实缺席优于截半画出一半字形（修前红=直接红：修前序复原即红〔renderFixed 后置令预备几何 4 误判可容→画出且永驻〕——挖 24 勘正：原注「突变形」低估锁强度；删缺席守卫突变路同断言亦红）
  });
});

/* 头卡几何注：18 行屏转录区 12 行——头卡 5（框 4 + 首行 1……实为顶框+首行+
 * model+directory+底框 5 行）+ 引导 5 + 余量；共存/退场/抑制三面在足容几何
 * 下锁语义（渲染形细节归 transcript.test 头卡 describe） */
describe('会话头卡（Codex 样式复刻批 R-7——07 §4.1 2026-10-10 durable 首块）', () => {
  const HEADER = { version: '0.1.1', model: 'zhipu/glm-4.7', directory: '/Users/w/demo' };
  const HEADER_ROWS = 18;

  it('注入即首帧头卡（╭ 圆角框 + >_ 首行 + model/directory 行）；注入缺席旧形零头卡', () => {
    const io = new MemoryTerminalIO(COLS, HEADER_ROWS);
    const backend = new TuiBackend(io, { sessionId: SESSION, sessionHeader: HEADER });
    backend.start();
    expect(io.bytes).toContain('╭'); // 圆角框线（「框语言退役」的显式例外——单块自定界）
    // 首行三段各属 SGR 游程（>_ dim/名 bold/版本 dim）——跨段纯文本被转义码
    // 切割，锚取段内连续子串（段形细节归 transcript.test styled 层锁）
    expect(io.bytes).toContain('>_ ');
    expect(io.bytes).toContain('berry-agent');
    expect(io.bytes).toContain('(v0.1.1)');
    expect(io.bytes).toContain('model: zhipu/glm-4.7');
    expect(io.bytes).toContain('directory: /Users/w/demo');
    // 缺席旧形（确定性测试基线零扰动——footer 门控同律）
    const bare = new MemoryTerminalIO(COLS, HEADER_ROWS);
    new TuiBackend(bare, { sessionId: SESSION }).start();
    expect(bare.bytes).not.toContain('>_ '); // 引导 logo 字形行不含 >_ 前缀——判据纯头卡
  });

  it('头卡与空态引导并存 + 首对话块到达退场（修前红：零块判据旧形 snapshot.length===0 头卡在场恒 false——引导饿死永不显示）', () => {
    const io = new MemoryTerminalIO(COLS, HEADER_ROWS);
    const backend = new TuiBackend(io, { sessionId: SESSION, sessionHeader: HEADER });
    backend.start();
    expect(io.bytes).toContain('>_ '); // 头卡在场（durable 首块 top:0——段内子串判据）
    expect(io.bytes).toContain('输入消息开始对话——? 查看快捷键'); // 修前红位：头卡在场引导饿死
    io.reset();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '你好', timestamp: 1 } });
    expect(io.bytes).toContain('你好'); // 首对话块落在头卡之下（块间空行制——头卡与首块间垫行）
    io.reset();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('输入消息开始对话'); // 退场不闪回（对话块非零门控 + D 段并账清引导尾行）
  });

  it('头卡不误复位等回声抑制（修前红：旧判据 snapshot.length>0 头卡在场恒真——提交后首个信封即刻解锁闪引导）', () => {
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, HEADER_ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      sessionHeader: HEADER,
      onSubmit: (_sid, text) => submitted.push(text),
    });
    backend.start();
    io.emitInput('字');
    io.emitInput('\r'); // 提交清稿——等回声窗置位（用户块回声 write-behind 未落）
    expect(submitted).toEqual(['字']); // 防空洞断言——置位前提确达
    io.reset();
    // 事件信封先于回声窗收口（agent_start/end 皆不落对话块）：修前旧判据在
    // agent_start 即刻误复位抑制——agent_end 闲态引导闪现；修后头卡不计对话
    // 块、抑制维持至真用户块回声落地
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('输入消息开始对话'); // 修前红位
  });
});

describe('TuiBackend footer 扩容段（三反馈批B→V-4 注⑪ 翻档——档位段 + 累计段；忙态速度段退役 → 本轮段）', () => {
  it('缺席缩位：tiers 子段 null / 累计零耗不虚报', () => {
    const { io } = makeBackend({
      sessionId: SESSION,
      footer: {
        tiers: () => ({ mode: null, thinking: null, sandbox: '只读' }),
        sessionSpent: () => 0,
        cwdLabel: () => 'w',
      },
    });
    expect(io.bytes).toContain('只读'); // 行2 沙箱原词（模式/思考子段缩位）
    expect(io.bytes).not.toContain('累计'); // 会话累计零耗不显段（冷启动零噪声）
  });

  it('档位切换即时刷：公开刷新面拉取 pull 闭包现值（选定闭包消费位）', () => {
    let tiers: { mode: string | null; thinking: string | null; sandbox: string | null } = {
      mode: 'Auto',
      thinking: '思考中',
      sandbox: '只读',
    };
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: { tiers: () => tiers, cwdLabel: () => 'w' },
    });
    backend.start();
    expect(stripAnsi(io.bytes)).toContain('思考中');
    io.reset();
    tiers = { mode: 'YOLO', thinking: '思考高', sandbox: '无沙箱' };
    backend.refreshFooter(); // 公开刷新面（批B——档位切换点即时刷）
    expect(io.bytes).toContain('YOLO · 思考高');
    expect(io.bytes).toContain('无沙箱'); // 行2 沙箱原词同刷
    expect(stripAnsi(io.bytes)).not.toContain('思考中');
  });

  it('agent_end 刷累计段（run 落账后拉取现值——⑥a 刷新锚）', () => {
    let spent = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      footer: { tiers: () => ({ mode: 'Auto', thinking: null, sandbox: '只读' }), sessionSpent: () => spent },
    });
    expect(io.bytes).not.toContain('累计'); // 零耗不显段
    io.reset();
    spent = 500;
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('累计 500'); // agent_end 拉取锚（批B→注⑪⑥a）
  });

  it('忙态任务行拼本轮段（估值器消费位——message_end 真值收口后工具相位持续显示；速度段退役）', () => {
    const { io, backend, clock } = makeInteractive({
      sessionId: 's1',
      footer: { tiers: () => ({ mode: 'Auto', thinking: '思考高', sandbox: '只读' }) },
    });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好世') });
    // 真值收口：usageMsg(100) 的 output = 50（faux 覆写同律——本轮 N 恒真值读数）
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    clock.advance(1);
    io.bytes = '';
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    clock.advance(1); // 泵帧
    expect(stripAnsi(io.bytes)).toContain('⚙ 搜索文本 … · 本轮 50'); // 工具段后拼本轮段（' · ' 连接）
    expect(io.bytes).not.toContain('tok/s'); // 速度段退役（注⑪⑦——速度面归行1 笔3）
  });
});

describe('TuiBackend 候跑提交 + 模型循环键（挂账解挂批 2026-09-15；footer 模型段活写 V-4 注⑪② 回迁——ctrl+p 联动）', () => {
  /** 键位三件 rig：提交柄记录 opts 第三参 + 模型循环柄计次 */
  function makeKeyRig(options: Partial<TuiBackendOptions> = {}) {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const clock = new ManualClock();
    const submitted: Array<[string, string, { queueFollowUp?: boolean } | undefined]> = [];
    const modelCycles: number[] = [];
    const backend = new TuiBackend(io, {
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
      now: clock.now,
      fpsCap: 1e6,
      sessionId: 's1',
      onSubmit: (sessionId, text, opts) => submitted.push([sessionId, text, opts]),
      onModelCycle: () => modelCycles.push(1),
      ...options,
    });
    backend.start();
    io.bytes = '';
    return { io, backend, clock, submitted, modelCycles, pump: () => clock.advance(1) };
  }

  it('alt+enter（kitty 13;3u）→ onSubmit 第三参携候跑标记；enter 提交无标记', () => {
    const { io, submitted, pump } = makeKeyRig();
    io.emitInput('候跑文');
    pump();
    io.emitInput('\x1b[13;3u'); // kitty 形 alt+enter
    pump();
    io.emitInput('普通文');
    pump();
    io.emitInput('\r');
    pump();
    // 键序可区分：两提交文本互异 + 标记位互异
    expect(submitted).toEqual([
      ['s1', '候跑文', { queueFollowUp: true }],
      ['s1', '普通文', undefined],
    ]);
  });

  it('ctrl+p → onModelCycle 柄（层③.5 应用动作路）；柄缺席不炸', () => {
    const withHandle = makeKeyRig();
    withHandle.io.emitInput('\x10'); // ctrl+p
    withHandle.pump();
    expect(withHandle.modelCycles).toHaveLength(1);

    const io = new MemoryTerminalIO(COLS, ROWS);
    const bare = new TuiBackend(io, { sessionId: 's1' }); // 柄缺席形
    bare.start();
    io.bytes = '';
    io.emitInput('\x10'); // 不炸（缺席 = 键不劫持）
    expect(io.bytes).toBe('');
  });
});

describe('TuiBackend ctrl+d 防误退两步序 + 档位模式循环键（2026-10-05 ZCode TUI 对标批——07 §4.1 R5 翻档/增册；2026-10-06 死面收口：双击窗维度退役）', () => {
  it('两步序①②：非空草稿首击 = 清稿 + 回执「已清空——再按 Ctrl+D 退出」不退；清稿后次击 → onQuit（直退）', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('ab');
    pump();
    io.bytes = ''; // 首击帧起收窗
    io.emitInput('\x04'); // 首击：清稿 + 回执（次击直退——无窗维度）
    pump();
    expect(calls.quit).toBe(0); // 首击不退
    expect(io.bytes).toContain('已清空——再按 Ctrl+D 退出'); // 回执形（07 §4.1 R5 翻注定值）
    expect(io.bytes).not.toContain('ab'); // 清稿——重画帧不再持旧稿
    io.emitInput('\x04'); // 次击（清稿后空稿——直退）
    pump();
    expect(calls.quit).toBe(1); // 次击直退
  });

  it('清稿后次击直退与时间推进无关（窗维度退役——任意时点同直退，无定时器参与）', () => {
    const { io, calls, clock, pump } = makeInteractive();
    io.emitInput('ab');
    pump();
    io.emitInput('\x04'); // 首击清稿
    pump();
    expect(calls.quit).toBe(0);
    clock.advance(2001); // 时间推进（死面证明：推进前后行为不可区分——正是退役依据）
    io.bytes = '';
    io.emitInput('\x04'); // 次击 = 空稿单击直退（无清稿步无回执）
    pump();
    expect(calls.quit).toBe(1);
    expect(io.bytes).not.toContain('已清空——再按 Ctrl+D 退出'); // 直退形不复发回执
  });

  it('两步序③：空稿 + 无浮层 = 单击直退（不变位——无清稿回执）', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('\x04');
    pump();
    expect(calls.quit).toBe(1);
    expect(io.bytes).not.toContain('已清空——再按 Ctrl+D 退出');
  });

  it('shift+tab → onModeCycle 柄（层③.5 应用动作路——ctrl+p 同构接法）；柄缺席不炸', () => {
    const modeCycles: number[] = [];
    const withHandle = makeInteractive({ onModeCycle: () => modeCycles.push(1) });
    withHandle.io.emitInput('\x1b[Z'); // CSI Z = shift+tab
    withHandle.pump();
    expect(modeCycles).toHaveLength(1);

    const io = new MemoryTerminalIO(COLS, ROWS);
    const bare = new TuiBackend(io, { sessionId: 's1' }); // 柄缺席形
    bare.start();
    io.bytes = '';
    io.emitInput('\x1b[Z'); // 不炸（缺席 = 键不劫持——透传编辑器终局丢弃）
    expect(io.bytes).toBe('');
  });
});

describe('TuiBackend shell 直达（挖掘 47 轮件 B——07 §4.1 shell 直达条款：`!` 前缀）', () => {
  it("'!' 起稿 footer 行1 模式槽换词 shell + danger 档；删 '!' 退态归位；行中 '!' 不触发", () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: {
        tiers: () => ({ mode: 'Auto', thinking: null, sandbox: '只读', sandboxDanger: false }),
        cwdLabel: () => 'w',
      },
    });
    backend.start();
    expect(io.bytes).toContain('Auto'); // 基线（非 shell 态归 tiers）
    io.reset();
    io.emitInput('!git'); // 行首 '!' 即进态（派生态判据——打即进）
    expect(io.bytes).toContain('shell'); // 模式槽换词（沙箱档词在 shell 直达态不适用——诚实呈现）
    expect(io.bytes).not.toContain('Auto');
    // danger 档断言（16 档降采实出 SGR + 词连缀——覆写漏置 danger 旗必红：
    // 漏旗时模式词走 footerStyle 灰档 \x1b[90m，91 vs 90 一字符差即回归信号；
    // MemoryTerminalIO 无色档参数恒 16 档，truecolor 38;2 形不可达）
    expect(io.bytes).toContain('\x1b[91mshell');
    io.reset();
    io.emitInput('\x15'); // ctrl+u 清稿（删至行首——退态）
    expect(io.bytes).not.toContain('shell');
    expect(io.bytes).toContain('Auto'); // 归位（tiers 透传恢复）
    io.reset();
    io.emitInput('a!'); // 行中 '!' 非首——不触发
    // 差分帧证未换词：换词必落帧（shellModeOn 翻转才 rebuildFooter——行1 重画），
    // 未翻转则行1 零重画（'Auto' 在屏未变不重出）——'shell' 全帧缺席即证
    expect(io.bytes).not.toContain('shell');
  });

  it("'!' 提交路由：剥前缀净命令走 seam + onSubmit 零达 + alt+enter 旗忽略同走", () => {
    const commands: string[] = [];
    const { io, calls, pump } = makeInteractive({ runDirectShell: (command) => commands.push(command) });
    io.emitInput('!git status');
    pump();
    io.emitInput('\r');
    pump();
    expect(commands).toEqual(['git status']); // 剥 '!' 净命令
    expect(calls.submitted).toEqual([]); // 不进模型消息（timeline 零污染）
    io.emitInput('!  ls -la  ');
    pump();
    io.emitInput('\x1b[13;3u'); // alt+enter（kitty 形）——queueFollowUp 旗忽略，同走 bang 路由
    pump();
    expect(commands).toEqual(['git status', 'ls -la']); // 首尾空白剥净
    expect(calls.submitted).toEqual([]);
  });

  it("裸 '!' 用法 fail-loud + seam 缺席诚实拒（不兜底进模型消息）", () => {
    const { io, calls, pump } = makeInteractive(); // seam 缺席
    io.emitInput('!');
    pump();
    io.emitInput('\r');
    pump();
    expect(io.bytes).toContain('! 后接命令'); // 用法 warn（/exit 带参同律）
    expect(calls.submitted).toEqual([]);
    io.bytes = '';
    io.emitInput('!ls');
    pump();
    io.emitInput('\r');
    pump();
    expect(io.bytes).toContain('当前界面不支持 shell 直达'); // 诚实拒（/exit onQuit 缺席形同律）
    expect(calls.submitted).toEqual([]); // 永不兜底 onSubmit
  });

  it('停机后提交静默丢弃（lifecycle 闸——onSubmit 同闸语义）', () => {
    const commands: string[] = [];
    const { io, backend, pump } = makeInteractive({ runDirectShell: (command) => commands.push(command) });
    backend.stop();
    io.emitInput('!ls');
    pump();
    io.emitInput('\r');
    pump();
    expect(commands).toEqual([]); // 停机静默丢弃
    expect(io.bytes).not.toContain('不支持'); // 零通知（闸在 seam 判前——非诚实拒形）
  });

  it("ask 应答窗 '!...' 是应答非命令（调用序天然排除——回归锁）", async () => {
    const commands: string[] = [];
    const { io, backend, pump } = makeInteractive({ runDirectShell: (command) => commands.push(command) });
    const p = backend.input('问？'); // 应答窗接管主编辑器
    pump();
    io.emitInput('!cmd\r'); // '!' 开头应答整串
    pump();
    await expect(p).resolves.toBe('!cmd');
    expect(commands).toEqual([]); // bang 路由未达（ask 分支先行）
  });
});

describe('TuiBackend Ctrl+X leader 前缀键系（2026-10-05 ZCode TUI 对标批 B4——07 §4.1 定形注）', () => {
  /** leader rig：footer 注入（提示位观测）+ 分支柄记录 */
  function leaderRig(options: Partial<TuiBackendOptions> = {}) {
    const branches: string[] = [];
    const rig = makeInteractive({
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: null }) },
      onLeaderBranch: (branch) => branches.push(branch),
      ...options,
    });
    return { ...rig, branches };
  }

  it('arm 入态 + 待续提示在场；四分支字母命中即消费（字母不入稿——吞字锁）', () => {
    const { io, calls, branches, pump } = leaderRig();
    io.emitInput('\x18'); // ctrl+x——五闸全开（空稿闲态无浮层）入待续态
    pump();
    expect(io.bytes).toContain('Ctrl+X 已按 · b 任务 · c 复制 · m 模型 · h 帮助'); // 待续提示（footer 教学位；挖掘 36 轮批 [2] c 扩集随迁）
    io.bytes = '';
    io.emitInput('b'); // 分支字母——text 路拦截
    pump();
    expect(branches).toEqual(['jobs']); // 分发命中
    expect(io.bytes).not.toContain('b'); // 修前红锚：字母不入稿（提示/稿面零裸 b——b 被分支消费）
    io.emitInput('\r'); // 空稿提交零动作——证稿恒空
    pump();
    expect(calls.submitted).toEqual([]);
    // m / h / c 三分支同形（各自重新 arm——c 扩集〔挖掘 36 轮批 [2〕〕）
    io.emitInput('\x18');
    pump();
    io.emitInput('m');
    pump();
    io.emitInput('\x18');
    pump();
    io.emitInput('h');
    pump();
    io.emitInput('\x18');
    pump();
    io.emitInput('c');
    pump();
    expect(branches).toEqual(['jobs', 'model', 'help', 'copy']);
  });

  it('非匹配字母解除 + 透传入稿（吞零键）；提示随解除退场', () => {
    const { io, branches, pump } = leaderRig();
    io.emitInput('\x18');
    pump();
    io.bytes = '';
    io.emitInput('z'); // 非分支字母（原例 'c' 已入册 copy 分支——挖掘 36 轮批 [2] 锚迁移）——解除 + 透传
    pump();
    expect(branches).toEqual([]); // 零分发
    expect(io.bytes).toContain('z'); // 入稿（透传不吞）
    expect(io.bytes).not.toContain('Ctrl+X 已按'); // 提示退场（ disarm 对账）
    io.emitInput('b'); // 待续态已解除——后续 b 是普通字符
    pump();
    expect(branches).toEqual([]); // 无迟到分发
    expect(io.bytes).toContain('zb'); // 连缀成稿
  });

  it('2 秒窗到点：提示定时退场 + 窗外分支字母归普通字符（惰性窗判）', () => {
    const { io, branches, clock, pump } = leaderRig();
    io.emitInput('\x18');
    pump();
    io.bytes = '';
    clock.advance(LEADER_WINDOW_MS + 1); // 窗到点——提示退场定时器自愈（armEscapeWindow 形）
    expect(io.bytes).not.toContain('Ctrl+X 已按'); // 修前红锚：ZCode 滞留提示 wort 不搬
    io.emitInput('b');
    pump();
    expect(branches).toEqual([]); // 窗外非分支
    expect(io.bytes).toContain('b'); // 普通字符入稿
  });

  it('重按 ctrl+x 续新窗（disarm + 重 arm 两跳——窗刷新）', () => {
    const { io, branches, clock, pump } = leaderRig();
    io.emitInput('\x18');
    pump();
    clock.advance(1500); // 首窗过半
    io.emitInput('\x18'); // 再按——解除 + 重装（新窗起点）
    pump();
    clock.advance(1500); // 距首 arm 已 3000ms——旧窗已外、新窗内
    io.emitInput('b');
    pump();
    expect(branches).toEqual(['jobs']); // 修前红锚：无续窗则此 b 已是普通字符
  });

  it('arm 五闸各腿：非空稿 / 忙态 / overlay 在场 / 弹层在场 / input-ask 应答窗——皆不 arm', async () => {
    // ① 非空稿
    {
      const { io, branches, pump } = leaderRig();
      io.emitInput('a');
      pump();
      io.bytes = '';
      io.emitInput('\x18');
      pump();
      expect(io.bytes).not.toContain('Ctrl+X 已按'); // 不 arm
      io.emitInput('b');
      pump();
      expect(branches).toEqual([]);
      expect(io.bytes).toContain('ab'); // ctrl+x 透传（编辑器终局丢弃）+ b 连缀
    }
    // ② 忙态（`?` 教学键同门——复用门判）
    {
      const { io, backend, branches, pump } = leaderRig();
      emit(backend, { type: 'agent_start' });
      pump();
      io.bytes = '';
      io.emitInput('\x18');
      pump();
      expect(io.bytes).not.toContain('Ctrl+X 已按');
      io.emitInput('b');
      pump();
      expect(branches).toEqual([]);
      expect(io.bytes).toContain('b');
      emit(backend, { type: 'agent_end', status: 'completed' });
    }
    // ③ overlay 在场（select 浮层模态独占）
    {
      const { io, backend, branches, clock, pump } = leaderRig();
      const picked = backend.select('选一个', [{ value: 'a', label: '甲' }]);
      pump();
      io.bytes = '';
      io.emitInput('\x18');
      pump();
      expect(io.bytes).not.toContain('Ctrl+X 已按');
      io.emitInput('b');
      pump();
      expect(branches).toEqual([]); // 模态期零分发
      io.emitInput('\x1b'); // escape 关层（收浮层）
      escapePump(clock);
      await expect(picked).resolves.toBe('');
    }
    // ④ 弹层在场（补全弹层）
    {
      const rig = leaderRig({
        autocomplete: {
          commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
        },
      });
      rig.io.emitInput('/he');
      rig.clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1); // 防抖窗到——弹层在场
      expect(rig.io.bytes).toContain('帮助'); // 弹层在场锚（非空洞断言）
      rig.io.bytes = '';
      rig.io.emitInput('\x18');
      rig.pump();
      expect(rig.io.bytes).not.toContain('Ctrl+X 已按');
      rig.io.emitInput('\x1b');
      escapePump(rig.clock);
      expect(rig.branches).toEqual([]);
    }
    // ⑤ input-ask 应答窗
    {
      const { io, backend, branches, pump } = leaderRig();
      const asked = backend.input('补充说明？');
      pump();
      io.bytes = '';
      io.emitInput('\x18');
      pump();
      expect(io.bytes).not.toContain('Ctrl+X 已按');
      io.emitInput('b');
      io.emitInput('\r');
      pump();
      await expect(asked).resolves.toBe('b'); // b 是应答内容非分支
      expect(branches).toEqual([]);
    }
  });

  it('分支门四闸（arm 门减闲态）：arm 后忙态起——窗内分支照开（忙期查任务清单正是高频用法）', () => {
    const { io, backend, branches, pump } = leaderRig();
    io.emitInput('\x18'); // 闲态 arm（五闸开）
    pump();
    io.bytes = '';
    emit(backend, { type: 'agent_start' }); // 窗内转忙——若忙态优先于待续，此帧即翻「输入仍可用」
    pump();
    expect(io.bytes).not.toContain('回复进行中'); // 修前红锚：leader 优先于 busy——提示位不随忙态翻
    io.emitInput('b');
    pump();
    expect(branches).toEqual(['jobs']); // 四闸不含闲态——忙期照分发
    expect(io.bytes).toContain('回复中——输入仍可用'); // 分支解除后提示位归忙态（正向对照——busy 文案并非不可达；47 轮件 A 宽度预算形跟新）
  });

  it('escape 闲态取消消费（零分发零入稿）；忙态让路层①打断（打断生命线优先）', () => {
    // 闲态取消
    {
      const { io, calls, branches, pump, clock } = leaderRig();
      io.emitInput('\x18');
      pump();
      io.emitInput('\x1b');
      escapePump(clock);
      expect(branches).toEqual([]);
      expect(calls.interrupted).toEqual([]); // 闲态 escape 是取消非打断
      io.emitInput('b'); // 待续态已收——普通字符
      pump();
      expect(io.bytes).toContain('b');
      expect(branches).toEqual([]);
    }
    // 忙态让路
    {
      const { io, backend, calls, branches, pump, clock } = leaderRig();
      io.emitInput('\x18');
      pump();
      emit(backend, { type: 'agent_start' });
      pump();
      io.emitInput('\x1b'); // 忙态 escape——解除 + 让路打断
      escapePump(clock);
      expect(calls.interrupted).toEqual(['s1']); // 打断先消费（层①）
      io.emitInput('b'); // 待续已解除——普通字符
      pump();
      expect(branches).toEqual([]);
      expect(io.bytes).toContain('b');
    }
  });

  it('窗内 shift+tab：解除透传——档位模式循环照常触发（三键空间互斥零冲突）', () => {
    const modeCycles: number[] = [];
    const { io, branches, pump } = leaderRig({ onModeCycle: () => modeCycles.push(1) });
    io.emitInput('\x18');
    pump();
    io.bytes = '';
    io.emitInput('\x1b[Z'); // shift+tab——非分支非 escape：解除 + 透传
    pump();
    expect(modeCycles).toHaveLength(1); // 层③.5 照常触发
    expect(io.bytes).not.toContain('Ctrl+X 已按'); // 提示退场
    io.emitInput('b');
    pump();
    expect(branches).toEqual([]); // 已解除
  });

  it('窗内 ctrl+d：解除透传进退闸序（空稿直退——两步序键空间互不干扰）', () => {
    const { io, calls, branches, pump } = leaderRig();
    io.emitInput('\x18');
    pump();
    io.bytes = '';
    io.emitInput('\x04'); // ctrl+d——解除 + 透传 → 层① 空稿直退
    pump();
    expect(calls.quit).toBe(1);
    expect(branches).toEqual([]);
  });

  it('arm 键占用 fail-loud：用户覆盖 ctrl+x 到他动作 → leader 族整体禁用 + 占用者可点名', () => {
    const { io, backend, branches, pump } = leaderRig({ keybindings: { 'editor.move-left': 'ctrl+x' } });
    expect(backend.leaderArmBlockedNotice).toContain('editor.move-left'); // 点名占用者
    expect(backend.leaderArmBlockedNotice).toContain('前缀键族不可用');
    io.emitInput('\x18');
    pump();
    expect(io.bytes).not.toContain('Ctrl+X 已按'); // 不 arm（族禁用）
    io.emitInput('b');
    pump();
    expect(branches).toEqual([]); // 零分发
    expect(io.bytes).toContain('b'); // b 普通入稿（ctrl+x 归 move-left 语义）
  });

  it('柄缺席不劫键：onLeaderBranch 缺席 = ctrl+x 透传编辑器（终局丢弃）+ b 普通字符', () => {
    const submitted: string[] = [];
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, { sessionId: 's1', onSubmit: (_sid, text) => submitted.push(text) });
    backend.start();
    io.emitInput('\x18'); // 无柄——族不激活
    io.emitInput('b');
    io.emitInput('\r');
    expect(submitted).toEqual(['b']); // b 入稿提交
  });
});

describe('TuiBackend writeClipboard（挖掘 36 轮批 [2]——/copy 整轮回复复制的后端面）', () => {
  it('帽内正文：OSC 52 序列直出 + written（sessionId 不消费——单终端单剪贴板）', () => {
    const { io, backend, pump } = makeInteractive();
    const result = backend.writeClipboard('s1', '你好 copy');
    pump();
    expect(result).toEqual({ status: 'written' });
    // OSC 52 载波形锁：\x1b]52;c;<base64(utf-8)>\x07（件 8 选区复制 buildOsc52Copy 同源复用）
    expect(io.bytes).toContain(`\x1b]52;c;${Buffer.from('你好 copy', 'utf8').toString('base64')}\x07`);
  });

  it('超 64 KiB 帽：too-large 零写（utf-8 字节计非码点数——SELECTION_CAP_BYTES 单源）', () => {
    const { io, backend } = makeInteractive();
    // 65537 单字节字符 = 65537 字节 > 65536 帽（界值外 1 字节）
    const over = 'a'.repeat(SELECTION_CAP_BYTES + 1);
    expect(backend.writeClipboard('s1', over)).toEqual({ status: 'too-large' });
    expect(io.bytes).not.toContain('\x1b]52;'); // 零写——帽拒先于 io.write
    // 界值内恰帽放行（64 KiB 整——边界含端点）
    io.bytes = '';
    expect(backend.writeClipboard('s1', 'a'.repeat(SELECTION_CAP_BYTES))).toEqual({ status: 'written' });
    expect(io.bytes).toContain('\x1b]52;');
  });
});

describe('TuiBackend copyToClipboard 分诊（挖掘 38 轮件 A——tmux 三层分诊，07 §4.1 件 8 细则）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('非 tmux 环境：裸 OSC 52 直写 + 零子进程（现行为不变腿）', () => {
    vi.stubEnv('TMUX', undefined); // 删键（空串形 env 在场会误走 tmux 腿——缺席须 undefined）
    const calls: string[][] = [];
    const { io, backend, pump } = makeInteractive({
      tmuxSpawn: (args) => {
        calls.push([...args]);
        return { status: 0, stdout: '' };
      },
    });
    const r = backend.writeClipboard('s1', 'hi');
    pump();
    expect(r).toEqual({ status: 'written' });
    expect(io.bytes).toContain(`\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07`);
    expect(io.bytes).not.toContain('\x1bPtmux;');
    expect(calls).toHaveLength(0); // 零子进程（调时读 env 缺席直走裸序列）
  });

  it('tmux + set-clipboard on：load-buffer -w - 首选举荐（stdin 喂文本、零序列直写）', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    const calls: Array<{ args: string[]; input?: string }> = [];
    const { io, backend, pump } = makeInteractive({
      tmuxSpawn: (args, input) => {
        calls.push({ args: [...args], input });
        return { status: 0, stdout: args[0] === 'show-options' ? 'on' : '' };
      },
    });
    backend.writeClipboard('s1', 'tmux 文本');
    pump();
    expect(calls).toEqual([
      { args: ['show-options', '-gv', 'set-clipboard'], input: undefined }, // 预检
      { args: ['load-buffer', '-w', '-'], input: 'tmux 文本' }, // stdin 喂文本
    ]);
    expect(io.bytes).not.toContain('\x1b]52;'); // 转发由 tmux 承担——零序列直写
  });

  it('tmux + set-clipboard off：DCS 包裹形直穿（预检拒 load-buffer——防静默吞）', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    const calls: string[][] = [];
    const { io, backend, pump } = makeInteractive({
      tmuxSpawn: (args) => {
        calls.push([...args]);
        return { status: 0, stdout: 'off' };
      },
    });
    backend.writeClipboard('s1', 'hi');
    pump();
    expect(calls).toEqual([['show-options', '-gv', 'set-clipboard']]); // off 即止——不试 load-buffer
    expect(io.bytes).toContain(`\x1bPtmux;\x1b\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07\x1b\\`);
  });

  it('tmux + probe 输出带尾随换行：trim 归一后按值分诊（真身 spawnSync 形——冷读闸补）', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    const calls: Array<{ args: string[]; input?: string }> = [];
    const { backend } = makeInteractive({
      tmuxSpawn: (args, input) => {
        calls.push({ args: [...args], input });
        // 真身实测形：'external\n'（trim 归一在 defaultTmuxSpawn 封装内——桩喂
        // 已归值时以分诊逻辑为锁；此处桩带换行模拟封装前形，验证比较按裸值）
        return { status: 0, stdout: args[0] === 'show-options' ? 'external' : '' };
      },
    });
    backend.writeClipboard('s1', 'x');
    expect(calls).toEqual([
      { args: ['show-options', '-gv', 'set-clipboard'], input: undefined },
      { args: ['load-buffer', '-w', '-'], input: 'x' },
    ]);
  });

  it('tmux + probe 失败（非 0/无 tmux）：降级 DCS 包裹形', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    const { io, backend, pump } = makeInteractive({
      tmuxSpawn: () => ({ status: 1, stdout: '' }), // 无 tmux 可执行/spawn 失败形
    });
    backend.writeClipboard('s1', 'hi');
    pump();
    expect(io.bytes).toContain('\x1bPtmux;');
  });

  it('tmux + probe on + load-buffer 失败：降级 DCS 包裹形', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    const { io, backend, pump } = makeInteractive({
      tmuxSpawn: (args) => ({
        status: args[0] === 'show-options' ? 0 : 1,
        stdout: args[0] === 'show-options' ? 'on' : '',
      }),
    });
    backend.writeClipboard('s1', 'hi');
    pump();
    expect(io.bytes).toContain(`\x1bPtmux;\x1b\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07\x1b\\`);
  });

  it('击杀通道锁（59 轮件 D-2）：缺省真身 defaultTmuxSpawn 两笔 spawnSync 均带 5s 帽 + SIGKILL——死 socket 悬挂不冻结整屏', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    // 不注入 tmuxSpawn——backend 落缺省真身 defaultTmuxSpawn → 截获位的
    // spawnSync；定向覆写回执形（probe 带尾随换行真形——trim 归一在封装内）
    spawnSyncStub.mockImplementationOnce(() => ({ status: 0, stdout: 'on\n', stderr: '' }));
    spawnSyncStub.mockImplementationOnce(() => ({ status: 0, stdout: '', stderr: '' }));
    const { backend } = makeInteractive();
    const r = backend.writeClipboard('s1', 'hi');
    expect(r).toEqual({ status: 'written' }); // probe on + load 0——tmux 面转发成功早退
    // 通道锁（58 轮件③ 击杀通道锁同形镜像）：spawnSync 唯有 timeout 在场才
    // 到点杀（原生层点火——JS 线程同步阻塞不影响其计时）；killSignal=SIGKILL
    // 非 SIGTERM（悬挂子进程可忽略 SIGTERM）；两笔（预检 + load-buffer）均须携带
    expect(spawnSyncStub).toHaveBeenCalledTimes(2);
    for (const call of spawnSyncStub.mock.calls) {
      expect(call[2]).toMatchObject({ timeout: 5_000, killSignal: 'SIGKILL' });
    }
  });

  it('帽点被杀回执形（59 轮件 D-2 回执面锁）：probe status null（5s 帽 SIGKILL 强杀形）→ ?? -1 归一 → 分诊落 DCS 降级腿', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    // 不注入 tmuxSpawn——backend 落缺省真身 defaultTmuxSpawn → 截获 spawnSync；
    // 帽点被杀真身回执形：status=null + error 置位（timeout 到点信号杀——
    // 既非 0 也非通常失败形的第三态），stdout 空；归一 ?? -1 在封装内
    //（tui-backend.ts defaultTmuxSpawn），归一值才进分诊比较
    spawnSyncStub.mockImplementationOnce(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawnSync tmux ETIMEDOUT'),
    }));
    const { io, backend, pump } = makeInteractive();
    const r = backend.writeClipboard('s1', 'hi');
    pump();
    expect(r).toEqual({ status: 'written' }); // 降级非拒亦非炸——错误不外抛（外抛即冻结整屏）
    expect(spawnSyncStub).toHaveBeenCalledTimes(1); // probe 即止——非 0 归一不试 load-buffer（off 例同律）
    // DCS 包裹形直穿（分诊落点 buildOsc52CopyDcs——内层 ESC 双写防提前终结，
    // 与 probe off 例同形字节锚。注：双写形 `\x1b\x1b]52;…` 以第二个 ESC 起
    // 仍含裸形子串，「非裸直写」不可用 not.toContain 裸形判——整形锚即区分）；
    // 守护形 = 帽点分支被等价重构删除/改判时红
    expect(io.bytes).toContain(`\x1bPtmux;\x1b\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07\x1b\\`);
  });
});

describe('TuiBackend copyToClipboard 第⓪层原生腿（挖掘 40 轮件 A——SSH 判定 + 平台矩阵首选，07 §4.1 件 8 括注第⓪层）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** 平台矩阵命中期望命令（矩阵外平台 null——测试环境不涉，防误配护栏） */
  const expectedNativeCommand = (): string | null =>
    process.platform === 'darwin'
      ? 'pbcopy'
      : process.platform === 'linux'
        ? 'wl-copy'
        : process.platform === 'win32'
          ? 'clip.exe'
          : null;

  /** 清 SSH 痕迹 + linux 配显示服键（平台矩阵命中形的 env 前置） */
  const stubNativeEnv = (): void => {
    vi.stubEnv('SSH_TTY', undefined); // 删键（SSH 会话内跑测试不误判跳原生）
    vi.stubEnv('SSH_CONNECTION', undefined);
    vi.stubEnv('TMUX', undefined); // 落穿位 = 裸 OSC 52（早退对比可见）
    if (process.platform === 'linux') vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0'); // darwin 不读显示服键
  };

  it('真修前红·非 SSH 本地会话：原生腿首选早退——OSC 52 零写 + 桩收到平台矩阵计划', () => {
    stubNativeEnv();
    const expected = expectedNativeCommand();
    if (expected === null) return; // 矩阵外平台腿缺席恒落穿——本测试环境不涉
    const calls: string[] = [];
    const { io, backend, pump } = makeInteractive({
      nativeClipboardSpawn: (plan) => {
        calls.push(plan.command);
        return 'ok';
      },
    });
    const r = backend.writeClipboard('s1', 'hi');
    pump();
    expect(r).toEqual({ status: 'written' }); // 回执两腿归一（written 值中立零新态）
    expect(calls).toEqual([expected]); // 修前红①：无腿桩零调用
    expect(io.bytes).not.toContain('\x1b]52;'); // 修前红②：修前原生腿缺席落穿必含裸 OSC 52
  });

  it('SSH 会话（SSH_TTY 在场）：跳原生直走终端介导——桩零调用 + 裸 OSC 52 在场', () => {
    vi.stubEnv('SSH_TTY', '/dev/pts/0'); // 原生剪贴板属本地机不可达——判定先于平台
    vi.stubEnv('TMUX', undefined);
    if (process.platform === 'linux') vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0'); // 矩阵命中但 SSH 优先
    const calls: string[] = [];
    const { io, backend, pump } = makeInteractive({
      nativeClipboardSpawn: (plan) => {
        calls.push(plan.command);
        return 'ok';
      },
    });
    backend.writeClipboard('s1', 'hi');
    pump();
    expect(calls).toHaveLength(0); // 零原生调用
    expect(io.bytes).toContain('\x1b]52;'); // 落穿终端介导
  });

  it('原生腿失败落穿：桩 failed → 裸 OSC 52 在场（三层原序不动作终腿——失败不静默）', () => {
    stubNativeEnv();
    if (expectedNativeCommand() === null) return;
    const { io, backend, pump } = makeInteractive({
      nativeClipboardSpawn: () => 'failed', // 子进程面确认失败（如 ENOENT/非 0 退出）
    });
    backend.writeClipboard('s1', 'hi');
    pump();
    expect(io.bytes).toContain('\x1b]52;'); // 落穿不吞
  });

  it('失败落穿三层完整：failed + TMUX 在 + set-clipboard on → tmux load-buffer 原序照走', () => {
    vi.stubEnv('SSH_TTY', undefined);
    vi.stubEnv('SSH_CONNECTION', undefined);
    vi.stubEnv('TMUX', '/tmp/tmux-0,123,0');
    if (process.platform === 'linux') vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');
    if (expectedNativeCommand() === null) return;
    const spawnCalls: Array<{ args: string[]; input?: string }> = [];
    const { backend } = makeInteractive({
      nativeClipboardSpawn: () => 'failed',
      tmuxSpawn: (args, input) => {
        spawnCalls.push({ args: [...args], input });
        return { status: 0, stdout: args[0] === 'show-options' ? 'on' : '' };
      },
    });
    backend.writeClipboard('s1', 'hi');
    expect(spawnCalls).toEqual([
      { args: ['show-options', '-gv', 'set-clipboard'], input: undefined },
      { args: ['load-buffer', '-w', '-'], input: 'hi' }, // 落穿后三层原序完整可走
    ]);
  });

  it('seam 缺席：计划可算但执行腿缺席——裸 OSC 52 落穿（测试基线零真进程律；38 轮首锁同态承接）', () => {
    stubNativeEnv();
    const { io, backend, pump } = makeInteractive({}); // 不注入 nativeClipboardSpawn
    backend.writeClipboard('s1', 'hi');
    pump();
    expect(io.bytes).toContain('\x1b]52;'); // 无论矩阵命中否——执行腿缺席即落穿
  });
});

describe('TuiBackend 固定区段优先级截断（07 §4.1 挂账解挂批 C②——极小终端固定区溢出）', () => {
  /** 极小形载荷：8 条 todo（量高 7 = 帽 6 + 溢出行）+ footer 注入（状态行常驻段可观测） */
  const manyTodos = Array.from({ length: 8 }, (_, i) => ({ status: 'pending' as const, content: `任务零${i}` }));

  it('rows 缩至 5：低段（todo）先缩至 1 行——状态行钉屏底 + 编辑器下限在场 + 无越屏定位（V-0 注③ 框退役释放 2 行预算——整段隐形上移更小屏）', () => {
    const io = new MemoryTerminalIO(COLS, 12); // 先宽后窄：宽形（12 行）无截断全量进画，让 todo 7 行先进场
    const clock = new ManualClock();
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: '只读' }) },
      todoFor: () => manyTodos,
    });
    backend.start();
    // todo 进场锚点：tool_execution_end（refreshTodo 三时点之二——tool 未开档 end 无行，纯 todo 形）
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    clock.advance(1); // 宽形中间帧先落（41 轮件 I 防抖后帧延迟——不带此步则积压帧以旧几何混入断言窗）
    io.bytes = ''; // 宽形中间帧不计——聚焦缩窗后的全量重画帧
    io.rows = 5;
    io.emitResize(); // 极小形：截断目标 = 固定区总高 ≤ 视口 - 1 = 4（正文滚动区至少 1 行）
    clock.advance(75); // 尾随防抖窗到（41 轮件 I）——全量重画帧落账
    // 截断后固定区 = todo 1 + 编辑器下限 1 + 状态行 2 = 4（V-4 注⑪ 笔3 三行栈——
    // env 在场量高 2：仪表行空保留 + 环境行短 id/沙箱原词；框退役后编辑器省
    // 2 行——低段从「整段隐」升为「缩 1 行」；段内梯缩至首条摘要行）
    // 状态行恒保底且钉屏底（注⑪①——环境行 = 最底行；secondary 弱化 SGR）
    expect(io.bytes).toContain('\x1b[5;1H\x1b[0m\x1b[90msess-aaa · 只读'); // 钉屏底（1 基第 5 行——环境行短 id 起）
    expect(io.bytes).toContain('\x1b[3;1H\x1b[0m\x1b[1m›'); // composer 输入行（1 基第 3 行——状态 2 行上移；R-6 翻档：聚焦 › bold）
    expect(io.bytes).toContain('任务零0'); // 低段缩至首条在场——段不虚报缺席
    expect(io.bytes).not.toContain('任务零1'); // 缩掉的不虚报（修前 7 行全量进画）
    expect(io.bytes).not.toContain('\x1b[6;1H'); // 无越屏定位（修前固定区 11 行越 5 行屏）
  });

  it('rows 缩至 8：低段先缩不隐——todo 收到 1 行 + 正文滚动区非退化', () => {
    const io = new MemoryTerminalIO(COLS, 12); // 同上先宽（12 行全量 11 ≤ 预算 11 无截断）后窄
    const clock = new ManualClock();
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: '只读' }) },
      todoFor: () => manyTodos,
    });
    backend.start();
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    clock.advance(1); // 宽形中间帧先落（同上——防抖后帧延迟）
    io.bytes = '';
    io.rows = 8;
    io.emitResize(); // 预算 7：todo 缩 1 + 编辑器 1 + 状态行 2 = 4 ≤ 7——「先缩后隐」之缩形
    clock.advance(75); // 尾随防抖窗到（41 轮件 I）
    expect(io.bytes).toContain('任务零0'); // todo 缩到 1 行——首条在场（段在场）
    expect(io.bytes).not.toContain('任务零1'); // 缩掉的不虚报（修前 6 条全量进画）
    // 固定区总高 4（V-0 注③ 框退役编辑器 1 + V-4 注⑪ 状态行 2）→ 滚动区底 = 8 - 4 - R-1 间隔 1 = 3（修前总高 11 → 退化 [1;1r + 越屏定位）
    expect(io.bytes).toContain('\x1b[1;3r');
    expect(io.bytes).not.toContain('\x1b[9;1H'); // 无越屏定位（修前写到第 11 行）
  });

  it('【sweep23-件1 修前红→回归锁】长稿极小视口收缩目标夹帽：垫行不借道内容地板保位——固定区不超屏（修前陈货守卫整段不写）', () => {
    const io = new MemoryTerminalIO(COLS, 7); // 编辑器帽 = max(5, floor(7×0.3)) = 5
    const clock = new ManualClock();
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
    });
    backend.start();
    // 10 行稿（kitty CSI u 形 ctrl+j = editor.new-line 缺省键；裸 \x0a 在解码
    // 器归 enter 提交——不可用）：裸内容 10 > 帽 5——超帽部分本就不可呈现
    // （编辑器内部滚动），梯「收缩至内容高」须取帽内 5。修前收缩目标用裸
    // 10：量高 7（帽 5 + 垫 2）钳位不咬合、垫 2 行借内容地板永不退让 → 固定
    // 区 total 8 > 7 行屏 → MainScreen 陈货守卫固定区整段不写（›/状态行全
    // 缺席、键盘仍路由进不可见编辑器）
    const chars = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    chars.forEach((ch, i) => {
      if (i > 0) io.emitInput('\x1b[106;5u'); // ctrl+j 换行
      io.emitInput(ch);
    });
    io.bytes = ''; // 打字中间帧不计——聚焦全量重画帧取证
    io.emitResize();
    clock.advance(75); // 尾随防抖窗到（41 轮件 I）——窗内积压帧先落、全量重画帧随后
    expect(io.bytes).toContain('↑ 5 更多'); // 编辑器在场 + 内容窗恰帽内 5 行（修前：整段缺席）
    expect(io.bytes).toContain('\x1b[1;1r'); // 滚动区 1 行非退化（固定区 6 = 编辑器 5 + 状态 1 ≤ 预算 6）
  });
});

/* ================= TUI 第四役 fx2（后端组——复起补吐/视口帽/残影/死路双清/复起附件） ================= */

/**
 * 剥 ANSI 序列后的显示宽（fx2-A 断言锚）：SGR/OSC 零宽（终端把 ESC 序列当
 * 控制不占列）——与物理行落屏宽同算术。CSI 参数/中间字节类含 <>=（kitty
 * 键盘推栈 \x1b[>5u 等私营形零宽同剥〔52 轮件 C 位并注〕。
 */
function displayWidth(text: string): number {
  return stringWidth(text.replace(/\x1b\[[0-9;?<>=]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ''));
}

/**
 * 补吐行提取（fx2-A 断言形）：writeLine 每行 `CR + 行 + LF` 写出——取 LF 间
 * 各段末次 CR 之后的内容即一条写行（行前若混入无 LF 的定位/固定区字节，末次
 * CR 截断即剥）；只断言携内容标记（「宽」= notify 折行产物）的补吐行，排除
 * 固定区/正文行（固定区差分整段无 LF 间隔，段宽 = 多行合计，不属本断言域）。
 */
function replayLinesMarked(bytes: string, marker: string): string[] {
  const out: string[] = [];
  for (const seg of bytes.split('\n')) {
    const idx = seg.lastIndexOf('\r');
    const line = idx >= 0 ? seg.slice(idx + 1) : seg;
    if (line.includes(marker)) out.push(line);
  }
  return out;
}

describe('TuiBackend 复起补吐宽度收口（fx2-A——M2 残宽面）', () => {
  it('挂起期 notify 折行产物按新列宽截宽——缩窗复起补吐段不超屏（修前 100 列行入 60 列屏必红）', () => {
    const io = new MemoryTerminalIO(100, 30);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    backend.suspendMain();
    // 挂起期 notify：wrapText(•, 98) 折行产物首段 = '• ' + 49 全宽字 = 100 显示宽
    backend.notify('宽'.repeat(60));
    io.columns = 60; // 停屏期缩窗（挂起期 resize 安全 no-op——几何真值复起重取）
    io.reset();
    backend.resumeMain();
    // 逐补吐行剥 SGR/OSC 后断言显示宽 ≤ 60——修前补吐首行实测 100 宽必红
    // （终端 autowrap 占 2 物理行而账只 +1 → 后续 durable 起笔漂账）
    const replayed = replayLinesMarked(io.bytes, '宽');
    expect(replayed.length).toBeGreaterThan(0); // 前置自证：确有补吐行入断言域
    for (const line of replayed) {
      expect(displayWidth(line)).toBeLessThanOrEqual(60);
    }
    // 补吐内容在场为前提（截宽非丢行——保账优先但内容可见）
    expect(io.bytes).toContain('• ');
  });

  it('复起排空槽期缓冲同律截宽（drainSlotTransients 补吐路——修前按挂起前宽度直写）', () => {
    const io = new MemoryTerminalIO(80, 20);
    const clock = new ManualClock();
    const backend = new TuiBackend(io, {
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
      now: clock.now,
      fpsCap: 1e6,
      sessionId: SESSION,
    });
    backend.start();
    io.bytes = '';
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式正文') });
    clock.advance(1);
    // 槽在场期 notify 入槽期缓冲（80 列折行首段 = '• ' + 38 全宽字 = 80 显示宽）
    backend.notify('宽'.repeat(45));
    clock.advance(1);
    expect(io.bytes).not.toContain('宽'); // 前置自证：确入槽期缓冲未直写
    backend.suspendMain();
    emit(backend, { type: 'message_end', message: assistantMsg('定稿正文') }); // 停屏期关槽
    io.columns = 40;
    io.reset();
    backend.resumeMain();
    const replayed = replayLinesMarked(io.bytes, '宽');
    expect(replayed.length).toBeGreaterThan(0); // 前置自证：缓冲行确补吐入断言域
    for (const line of replayed) {
      expect(displayWidth(line)).toBeLessThanOrEqual(40);
    }
    expect(io.bytes).toContain('宽'); // 缓冲行补吐在场（截宽非丢行）
  });
});

describe('TuiBackend SelectPanel 视口帽（fx2-B——选项超可用预算开滚动窗）', () => {
  it('24 行屏 21 选项：面板窗口化入帽——标题与编辑器提示符在场（修前固定区超高守卫整段不写必红）', () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    const choices = Array.from({ length: 21 }, (_, i) => ({ value: `v${i}`, label: `opt-${i}` }));
    backend.select('ZZQ', choices); // 21 选项 + 标题 1 = 22 行面板
    pump();
    // 修前红：面板 22 + 编辑器 3 + 状态行 1 = 26 > 24 行屏——MainScreen 陈货
    // 守卫（行维）整段不写，面板与编辑器全部不可见（模态开屏即黑）
    expect(io.bytes).toContain('ZZQ'); // 面板标题在场（窗口化非隐层）
    expect(io.bytes).toContain('›'); // 编辑器提示符在场（固定区未超高）
    // 窗口化面：首帧光标在首项 → 窗顶贴 0、底部溢出指示行在场（↓ N 更多——
    // moreHint 中文单源形，英文 more 形已全域废止）
    expect(io.bytes).toContain('↓ ');
    expect(io.bytes).not.toContain('↑ '); // 顶部无隐藏（光标居中钳 0）
  });

  it('窗口滚动跟随：↓ 到末项——底部指示消失、顶部指示在场（光标恒可视 + 选值随窗不漂）', async () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    const choices = Array.from({ length: 21 }, (_, i) => ({ value: `v${i}`, label: `opt-${i}` }));
    const p = backend.select('ZZQ', choices);
    pump();
    io.bytes = '';
    // ↓ × 20 → 末项 opt-20（多序列单 chunk 可解——decoder 逐序发事件）
    io.emitInput('\x1b[B'.repeat(20));
    // 键后补帧（修前红实证：stack.routeEvent 消费即返不请帧——闲态零帧源
    // 〔tick 有 busy 闸〕、↓×20 字节增量 0，须 onRepaint 强制帧才可见；修=
    // 返 true 后 touchFixed 对齐弹层路/副屏路 mp-5 补帧——键即帧，锚退役）
    pump();
    // 终态窗块 = 末次 ↑ 指示之后的 diff 段（onRepaint 的 repaint 先陈货全量
    // 重画再同帧 diff 收敛——流中旧窗字节是中间态非终态证据，同 fx2-A 谱）
    const finalWindow = io.bytes.slice(io.bytes.lastIndexOf('↑'));
    // R-6 翻档：选中行整行 accent bold（bold 属性位 1 先于色位 36——SGR 段
    // '\x1b[1;36m'）、› 光标前缀符与 inverse 反色退役
    expect(finalWindow).toContain('\x1b[1;36m  opt-20'); // 高亮末项——光标移动且窗沉底跟随
    expect(finalWindow).not.toContain('↓ '); // 窗沉底——底部无隐藏（指示行消失）
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('v20'); // 窗口化不改选值语义（高亮项 = 应答项）
  });

  it('吃键即帧（闲态冻结修）：无 run 在飞 select 按 ↓——字节增量非零（修前红：tick 有 busy 闸零帧源，↓×3 增量 0 光标纹丝不动）', async () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    const choices = Array.from({ length: 5 }, (_, i) => ({ value: `v${i}`, label: `opt-${i}` }));
    const p = backend.select('ZZQ', choices);
    pump(); // 开层首帧
    io.bytes = ''; // 清零——后续增量只认键驱帧
    io.emitInput('\x1b[B\x1b[B\x1b[B'); // ↓×3 → opt-3
    pump();
    expect(io.bytes.length).toBeGreaterThan(0); // 键即帧（修前 0——面板态已变从未画出）
    expect(io.bytes).toContain('\x1b[1;36m  opt-3'); // 高亮随键可见（整行 accent bold——R-6 翻档锚）
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('v3');
  });

  // fx2-B 缝修·形A 翻档（2026-10-04——07 §4.3 异会话 overlay 呈现串行化定形注
  // 取代 overlay 栈式并存）：修前本例锁「满帽 select 上叠 confirm——底层收缩让
  // 位新层可见」（修前红形：overlay 19+2 > 帽 19 → total 25 > 24 守卫整段不写、
  // confirm 隐形盲层）；单槽化后「叠开」结构性不可达——同几何改锁：先呈者占
  // 槽至落定、次件等待位候槽，落定顶上后单层自帽内（总高恒 ≤ 预算不变式续锁）。
  it('满帽 select 上后到 confirm 等槽（形A 翻档）：先呈者占槽至落定、次件顶上后总高恒 ≤ 预算', async () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    const choices = Array.from({ length: 30 }, (_, i) => ({ value: `v${i}`, label: `opt-${i}` }));
    const ps = backend.select('ZZQ', choices);
    pump();
    io.emitInput('\x1b[B'.repeat(15)); // ↓×15 至中段——双指示行齐 = measure 恰帽 19（首帧 above=0 只量 18）
    pump();
    io.bytes = '';
    const pc = backend.confirm('第二层确认'); // 槽被占——入呈现等待位（修前形：并开叠加帽溢出）
    pump();
    expect(io.bytes).not.toContain('第二层确认'); // 等待位不上屏（overlay 族单槽——07 §4.3 翻档注）
    expect(io.bytes).toContain('他会话有待答问题'); // 等待位可观测（匿名提示形）
    expect(io.bytes).not.toContain('\x1b[25;'); // 满帽 select 存续独占——总高恒 ≤ 预算
    io.emitInput('\r'); // 应答 select——槽释放、confirm 顶上
    pump();
    await expect(ps).resolves.toBe('v15');
    expect(io.bytes).toContain('第二层确认'); // 次件顶上（单层在帽内可见非盲层）
    expect(io.bytes).not.toContain('\x1b[25;'); // 顶上后总高仍 ≤ 预算
    io.emitInput('\r');
    pump();
    await expect(pc).resolves.toBe(true);
  });

  it('多层叠开截断恒等式（fx2-B 缝修·形B）：5 行屏单开 confirm——四段齐装不越屏（V-0 注③ 框退役：confirm 2 + 编辑器 1 + 状态 1 = 4 ≤ 5——修前红形 6 > 5 全冻结已翻页）', async () => {
    const { io, backend, pump } = makeInteractive({}, 5);
    const pc = backend.confirm('小屏确认');
    pump();
    // 修前：confirm 2 + 编辑器下限 3 + 状态 1 = 6 > 5 行屏 → MainScreen 守卫
    // 整段不写——帧仅归位序列，连编辑器/状态行全冻结（模态开屏即黑）+ 十六役
    // 扫 #1 追锁：键提示整段漏进编辑器框内（'e' 被左边框覆写成 'nter/y …'）。
    // 框退役后编辑器下限 1——四段齐装：confirm 文案/键提示全宽在场不再截字
    expect(io.bytes).toContain('小屏确认'); // 模态消息行在场（预算足——诚实全显）
    expect(io.bytes).toContain('enter/y 确认'); // 键提示整词在场（修前 'nter/y' 截字形退役）
    expect(io.bytes).toContain('›'); // 编辑器提示符在场（固定区活着）
    expect(io.bytes).not.toContain('\x1b[6;'); // 无越 5 行屏定位
    io.emitInput('\r');
    pump();
    await expect(pc).resolves.toBe(true); // 键盘照路由
  });

  it('input 提问行 overlay 占焦期明示（件 3）：栈非空——提示行带待收场标注（修前红：裸问句呈现可作答、键全进栈顶面板不可答）', async () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    const ps = backend.select('甲选单', [{ value: 'a', label: 'A' }]);
    const pi = backend.input('乙提问');
    pump();
    // 修前红：'? 乙提问' 裸呈现——路由层（routeEvent 栈顶独占）把一切键终局
    // 于选单、编辑器收不到字；修后标注「等面板关闭后作答」明示先后
    expect(io.bytes).toContain('? 乙提问（等面板关闭后作答）');
    io.emitInput('\r'); // 栈顶独占——先应答选单
    pump();
    await expect(ps).resolves.toBe('a');
    io.emitInput('hello\r'); // 收场后编辑器复焦——应答乙提问
    pump();
    await expect(pi).resolves.toBe('hello'); // 问不丢（待收场后语义完整）
  });

  it('input 异会话 FIFO 队列（十六役扫 #2）：两问并发——队首独占、提示行缀排队数、提交后次问自动接续（修前红：第二问直覆第一问——首问 promise 永悬无收场路）', async () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    const p1 = backend.input('第一问');
    const p2 = backend.input('第二问');
    pump();
    // 修前：inputAsk 直覆——'? 第二问' 在屏、p1 永悬（无收场路也无人应答）
    expect(io.bytes).toContain('? 第一问');
    expect(io.bytes).not.toContain('? 第二问'); // 排队问不上屏
    expect(io.bytes).toContain('后面还有 1 个提问在排队'); // 排队数缀标
    io.emitInput('甲\r'); // 队首应答
    pump();
    await expect(p1).resolves.toBe('甲');
    expect(io.bytes).toContain('? 第二问'); // 次问自动晋升接续（FIFO 串行链）
    io.emitInput('乙\r');
    pump();
    await expect(p2).resolves.toBe('乙');
  });

  it('input 提问行窄窗 … 收口（wf_3c8b00b8 组δ X-3）：长问句 + 排队缀标超列硬截断封堵（修前红）', async () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    // 45 个双宽字 = 90 列 + 「? 」前缀 → 92 列 > 80 列屏；排队缀标更超出
    const long = '题'.repeat(45);
    const p1 = backend.input(long);
    const p2 = backend.input('次问');
    pump();
    // 修前：raw grid.writeText 越界静默吸收——行尾硬截断无省略提示；修后
    // ellipsize … 收口（'? ' + 38 个题〔2+76 列〕+ '…' = 79 列恰帽内）
    expect(io.bytes).toContain(`? ${'题'.repeat(38)}…`);
    // 修前红位二：raw 硬截断可写满 80 列（39 个题连排无 …）；收口后至多 38 连排
    expect(io.bytes).not.toContain('题'.repeat(39));
    io.emitInput('答\r'); // 队首照答（收口只动呈现不动键路）
    pump();
    await expect(p1).resolves.toBe('答');
    io.emitInput('乙\r');
    pump();
    await expect(p2).resolves.toBe('乙');
  });

  it('input 排队问 abort 静默出队 + 队首 abort 接续（十六役扫 #2）：从未上屏不落撤销行、保守值收口；激活态取消后队首晋升', async () => {
    const { io, backend, pump } = makeInteractive({}, 24);
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const p1 = backend.input('第一问', { signal: ac1.signal });
    const p2 = backend.input('第二问', { signal: ac2.signal });
    const p3 = backend.input('第三问');
    pump();
    ac2.abort(); // 排队问取消——静默出队（提示行从未上屏）
    pump();
    await expect(p2).resolves.toBe(''); // 保守值收口
    expect(io.bytes).not.toContain('已取消提问'); // 从未上屏——零撤销痕迹
    expect(io.bytes).toContain('? 第一问'); // 队首不受扰
    io.bytes = ''; // 清零——后续只认取消帧增量
    ac1.abort(); // 队首 abort——激活态收口 + 第三问晋升接续
    pump();
    await expect(p1).resolves.toBe('');
    expect(io.bytes).not.toContain('已取消提问'); // ⏹ 瞬时行退役（挖掘 36 轮 [2]）——激活态取消零撤销行
    expect(io.bytes).toContain('? 第三问'); // 队首晋升（FIFO 链不断）
    io.emitInput('丁\r');
    pump();
    await expect(p3).resolves.toBe('丁');
  });
});

describe('TuiBackend overlay 锚定路残账锁（fx2-D 锚定注册表清退 + 第五役 F3 锚管线一刀清）', () => {
  it('select 开合两轮：锚定残账零残留（修前 Map 只写不清——两轮后 size 2）', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const choices = [{ value: 'a', label: '甲' }];
    const p1 = backend.select('一', choices);
    pump();
    io.emitInput('\r');
    pump();
    await expect(p1).resolves.toBe('a');
    const p2 = backend.select('二', choices);
    pump();
    io.emitInput('\x1b');
    escapePump(clock);
    await expect(p2).resolves.toBe('');
    // 修前红：overlayLayout 条目 renderFixed 每帧只写、close 不清——两轮后
    // size 2 死账；其唯一读方（锚定渲染路——已随 renderAll 删除）生产零
    // 调用（fx2-D grep 复核定谳），死路整域双清（Map + anchorFor + 写侧）
    // 后字段缺席恒 0；第五役 F3 再一刀清 OverlayAnchor 型/字段/签名
    expect((backend as unknown as { overlayLayout?: { size: number } }).overlayLayout?.size ?? 0).toBe(0);
  });
});

describe('TuiBackend resumeMain 复起附件（fx2-E——编辑器帽随动 + footer 支名重读）', () => {
  it('编辑器高度帽随新几何重算：缩窗复起 DECSTBM 底按新帽（修前帽停挂起前旧值必红）', () => {
    const io = new MemoryTerminalIO(80, 40);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    // 注入 14 行内容（kitty shift+enter 换行 ×13——初始空行 1 + 13 = 14 行）：
    // 帽 = editorHeightCap(40) = 12 → 呈现 12 + 垫 2（五件批 A+B——Renderable
    // 量高 +2）→ 固定区 15（含状态行）
    for (let i = 0; i < 13; i++) io.emitInput('\x1b[13;2u');
    backend.suspendMain();
    io.rows = 24; // 挂起期缩窗（挂起期 resize 安全 no-op——几何真值复起重取）
    io.reset();
    backend.resumeMain();
    // 修后：帽 = editorHeightCap(24) = 7 → 呈现 7 + 垫 2 → 固定区 10 →
    // DECSTBM 底 = 24 - 10 - R-1 间隔 1 = 13；修前帽停 12 → 固定区 13 → 底 = 10（只写 1;10r）
    expect(io.bytes).toContain('\x1b[1;13r');
  });

  it('【注⑪③ 修前红→回归锁】⎇ 槽复起重读（refreshFooterGit 独立锚）：挂起期 checkout 换支复起即收敛——修前陈支名跨复起驻留（复起路不触发 onRepaint）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berry-resume-git-'));
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'dev'), 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n');
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'feat'), 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8\n');
    try {
      const { io, backend } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
      });
      expect(io.bytes).toContain('⎇ dev @a1b2c3d'); // 构造期低频锚首读
      backend.suspendMain();
      writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/feat\n'); // 挂起期 checkout 换支
      io.reset();
      backend.resumeMain();
      expect(io.bytes).toContain('⎇ feat @f9e8d7c'); // 复起重读收敛（修前：⎇ dev 陈值驻留——git IO 已拆 refreshFooterGit 不在复起锚）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TuiBackend ⎇ 槽统计段 +N/−M（挖掘 39 轮件 II——gitQuery seam 异步只读腿；回执只写缓存永不动 suffix）', () => {
  /** 微任务排空（computeBranchStats 四步 await + then/finally + refreshFooterGit 重检链全微任务——setImmediate 宏任务界冲净链，轮冗余兜二次 fire） */
  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  };

  /** 临时 git 库桩（readGitHead 零子进程直读形——同 ⎇ 槽既有锁族构造法） */
  const mkGitDir = (hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'): string => {
    const dir = mkdtempSync(join(tmpdir(), 'berry-stats-slot-'));
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'dev'), `${hash}\n`);
    return dir;
  };

  /** 全链应答桩基底（origin symbolic-ref 命中链——numstat 应答可覆写） */
  const fullChainQuery =
    (numstat: string): GitQuery =>
    async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return { status: 0, stdout: '.git' };
      if (args[0] === 'remote') return { status: 0, stdout: 'origin\n' };
      if (args[0] === 'symbolic-ref') return { status: 0, stdout: 'refs/remotes/origin/main' };
      if (args[0] === 'merge-base') return { status: 0, stdout: 'mb0000000000' };
      if (args[0] === 'diff') return { status: 0, stdout: numstat };
      return { status: 1, stdout: '' };
    };

  it('origin symbolic-ref 命中链：merge-base → numstat 累加 → suffix 追统计段（binary − 行计 0；− 为 U+2212 同 diffCountRuns 词汇源）', async () => {
    const dir = mkGitDir();
    try {
      const { io } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
        gitQuery: fullChainQuery('12\t3\tsrc/a.ts\n-\t-\tbin/logo.png\n'),
      });
      await flushMicrotasks(); // 异步腿回执后 finally 重拼 + touchFixed 落帧
      expect(io.bytes).toContain('⎇ dev @a1b2c3d +12 −3'); // binary 行计 0——12/3 不受 -/- 行影响
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无 remotes：本地 main 兜底腿调用序走到（rev-parse --verify 存在性判定）+ 统计段照贴', async () => {
    const dir = mkGitDir();
    try {
      const calls: string[] = [];
      const gitQuery: GitQuery = async (args) => {
        calls.push(args.join(' '));
        if (args[0] === 'rev-parse' && args[1] === '--git-dir') return { status: 0, stdout: '.git' };
        if (args[0] === 'remote') return { status: 0, stdout: '' }; // 无 remotes——跳远端腿
        if (args[3] === 'refs/heads/main') return { status: 0, stdout: 'm1' }; // 兜底腿命中
        if (args[0] === 'merge-base') return { status: 0, stdout: 'mb' };
        if (args[0] === 'diff') return { status: 0, stdout: '5\t2\tsrc/b.ts\n' };
        return { status: 1, stdout: '' };
      };
      const { io } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
        gitQuery,
      });
      await flushMicrotasks();
      expect(calls).toContain('rev-parse --verify --quiet refs/heads/main'); // 存在性判定非 merge-base 试探
      expect(io.bytes).toContain('⎇ dev @a1b2c3d +5 −2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merge-base 失败：suffix 维持零追加 + 负缓存同键不重试（resumeMain 二次锚 diff 腿永未到达）', async () => {
    const dir = mkGitDir();
    try {
      let diffReached = 0;
      const gitQuery: GitQuery = async (args) => {
        if (args[0] === 'diff') diffReached += 1; // merge-base 失败则 diff 不应到达——到达即管线漏
        if (args[0] === 'rev-parse' && args[1] === '--git-dir') return { status: 0, stdout: '.git' };
        if (args[0] === 'remote') return { status: 0, stdout: 'origin\n' };
        if (args[0] === 'symbolic-ref') return { status: 0, stdout: 'refs/remotes/origin/main' };
        return { status: 1, stdout: '' }; // merge-base 失败 → 管线 null
      };
      const { io, backend } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
        gitQuery,
      });
      await flushMicrotasks();
      expect(io.bytes).toContain('⎇ dev @a1b2c3d'); // 维持支名@短哈希
      expect((io.bytes.match(/\+\d+ −\d+/g) ?? []).length).toBe(0); // 零追加（负缓存=缺席值非未算）
      backend.suspendMain();
      io.reset();
      backend.resumeMain(); // 二次锚（同 cwd+shortHash 键）
      await flushMicrotasks();
      expect(io.bytes).toContain('⎇ dev @a1b2c3d');
      expect((io.bytes.match(/\+\d+ −\d+/g) ?? []).length).toBe(0);
      expect(diffReached).toBe(0); // 负缓存命中零重发（防失败无限重 fire）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同键二次锚：缓存命中零重发 + 统计段保形不丢（缓存消费的是 stats 值非「跳过一切」）', async () => {
    const dir = mkGitDir();
    try {
      const calls: string[] = [];
      const gitQuery: GitQuery = async (args, cwd) => {
        calls.push(args.join(' '));
        return fullChainQuery('12\t3\tsrc/a.ts\n')(args, cwd);
      };
      const { io, backend } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
        gitQuery,
      });
      await flushMicrotasks();
      expect(io.bytes).toContain('⎇ dev @a1b2c3d +12 −3');
      const callsAfterFirst = calls.length;
      backend.suspendMain();
      io.reset();
      backend.resumeMain(); // 二次锚（同键命中——resumeMain 不触发 onRepaint 须此锚）
      await flushMicrotasks();
      expect(calls.length).toBe(callsAfterFirst); // 零重发
      expect(io.bytes).toContain('⎇ dev @a1b2c3d +12 −3'); // 锚上缓存命中保形不丢段
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('竞窗锁：在途期 checkout 换哈希 + 二次锚被单飞挡 → 旧回执只写旧键缓存不虚报新 HEAD（新键回执后贴段）', async () => {
    const dir = mkGitDir();
    try {
      let diffCalls = 0;
      // 对象属性形（闭包内赋值外部读——TS 流分析不窄化对象属性，规避 let 局部变量闭包赋值不可见折 never）
      const release = { resolveDiff: null as ((v: GitQueryResult) => void) | null };
      const gitQuery: GitQuery = async (args, cwd) => {
        if (args[0] !== 'diff') {
          const base = fullChainQuery('')(args, cwd);
          return base; // 前三步即答（diff 帽在下方）
        }
        diffCalls += 1;
        if (diffCalls === 1)
          return new Promise<GitQueryResult>((resolve) => {
            release.resolveDiff = resolve;
          }); // 首发挂起（在途）
        return { status: 0, stdout: '3\t1\ty.ts\n' }; // 次发即答（新键回执）
      };
      const { io, backend } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
        gitQuery,
      });
      await flushMicrotasks(); // 前三步走完、diff 挂起（单飞在途）
      backend.suspendMain();
      writeFileSync(join(dir, '.git', 'refs', 'heads', 'dev'), 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8\n'); // 在途窗内 checkout 换哈希
      io.reset();
      backend.resumeMain(); // 二次锚：新键 miss + 单飞旗在途被挡
      expect(io.bytes).toContain('⎇ dev @f9e8d7c'); // 新哈希落位、无段（有界缺席缩一窗）
      expect((io.bytes.match(/\+\d+ −\d+/g) ?? []).length).toBe(0);
      release.resolveDiff?.({ status: 0, stdout: '99\t9\tx.ts\n' }); // 旧回执到达（旧键 99/9）
      await flushMicrotasks(); // 旧回执写旧键缓存 → finally 清旗重检 → fire 新键即答 → 贴段
      expect(io.bytes).toContain('⎇ dev @f9e8d7c +3 −1'); // 新键回执贴新段
      expect(io.bytes).not.toContain('+99 −9'); // 旧 stats 永不虚报到新 HEAD（回执不动 suffix 结构性保证）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seam 缺席：腿缺席零行为变（构造/复起锚后 suffix 恒支名@短哈希零段零异常——现状锁）', async () => {
    const dir = mkGitDir();
    try {
      const { io, backend } = makeBackend({
        sessionId: SESSION,
        footer: { cwdLabel: () => 'proj', gitRoot: () => dir },
      });
      await flushMicrotasks();
      expect(io.bytes).toContain('⎇ dev @a1b2c3d');
      backend.suspendMain();
      io.reset();
      backend.resumeMain();
      await flushMicrotasks();
      expect(io.bytes).toContain('⎇ dev @a1b2c3d');
      expect((io.bytes.match(/\+\d+ −\d+/g) ?? []).length).toBe(0); // 零子进程零段
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TUI 全域清扫 G1/G2/G5/G6（扇出锚 + repaint 清账 + 速度段/兜底层断言补——2026-09-21）', () => {
  it('G1-#3 setStatus 扇出锚：状态扇出统一重拉常驻段（累计段随闭包现值收敛——尾注⑨ 同帧并陈不掩蔽）', () => {
    let spent = 0;
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      footer: {
        tiers: () => ({ mode: 'Auto', thinking: null, sandbox: '只读' }),
        sessionSpent: () => spent,
      },
    });
    expect(io.bytes).not.toContain('累计'); // 零耗缩位（前置自证）
    spent = 500;
    io.bytes = '';
    backend.setStatus(SESSION, '思考高（下一 run 起生效）');
    // 修前红：setStatus 只写右段文案不重拉常驻段——webui 双开切档（远端
    // setStatus 扇出面）累计段/档位段停旧值。V-4 注⑪⑨ 尾注让位族：尾注
    // 右对齐与仪表同帧并陈（挤占几何——不再整段掩蔽）
    expect(io.bytes).toContain('思考高（下一 run 起生效）');
    expect(io.bytes).toContain('累计 500');
  });

  it('G2-#29 切焦 repaint 连清转轮：旧焦 agent_end 非聚焦态到达不触停帧（修前红——永久转轮）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' }); // 旧焦 run 起跑——转轮在转
    io.bytes = '';
    backend.onRepaint('sess-bbbbbbbbbbbb', [], null); // 切焦新会话（旧焦 run 仍在飞）
    io.bytes = '';
    backend.tick();
    expect(io.bytes).not.toContain('⠙'); // 修前：忙态跨焦残留——tick 持续推帧
  });

  it('G2-#29 切焦 repaint 清工具名：旧焦工具段不跨会话残留', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 'tc1', name: 'grep', arguments: {} });
    io.bytes = '';
    backend.onRepaint('sess-bbbbbbbbbbbb', [], null);
    io.bytes = '';
    backend.tick(); // 若工具名/忙态残留即在此写出
    expect(io.bytes).not.toContain('⚙ 搜索文本');
  });

  it('G2-#29 新焦在飞重建忙态：repaint 后 trackProgress 净计数 >0 转轮照转', () => {
    const { io, backend } = makeBackend();
    // s2 在飞（信封到达即净计数 +1——聚焦位不参账，件 7 判据）
    backend.onEnvelope({ sessionId: 'sess-bbbbbbbbbbbb', event: { type: 'agent_start' } }, false);
    backend.onRepaint('sess-bbbbbbbbbbbb', [], null); // 切焦到在飞会话
    io.bytes = '';
    backend.tick();
    expect(io.bytes).toContain('⠙'); // 重建忙态——第二帧在推
  });

  it('G5-#10 aborted 终态：状态行分档形不加段 + speedView 观测面照算终值', () => {
    // 批C 诚实缺席三形的呈现面专属位——aborted 形此前零断言（failed 已锁）
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t += 4000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(io.bytes).toContain('⏹ 已中止'); // 分档形（速度段系成功形专属）
    expect(io.bytes).not.toContain('tok/s');
    expect(backend.speedView).toBe(25); // 观测面照算终值（100/4s——终点时戳
    // 冻结分母；呈现缺席 ≠ 数据缺席——观测面是宿主侧二次消费位）
  });

  it('G6-#8 批B fail-open 兜底：档位/累计闭包抛错整段缩位不炸渲染路', () => {
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      footer: {
        tiers: () => {
          throw new Error('tiers fold boom');
        },
        sessionSpent: () => {
          throw new Error('spent agg boom');
        },
      },
    });
    // 构造期首画即消费抛错闭包（空段缩位 = fail-open 生效的自证）；
    // refreshFooter 再拉覆盖刷新锚路径，两路都不炸
    expect(() => backend.refreshFooter()).not.toThrow(); // 双保兜底层直测
    expect(io.bytes).not.toContain('boom'); // 异常文本不落屏
    expect(io.bytes).not.toContain('累计'); // 抛错段缩位不虚报
  });
});

/* ================= 界面美化役批 2/4/5（Lane RUNSTATE——ESC 让路 + 任务状态行 + 整 run 口径 + 收尾行） ================= */

describe('TuiBackend 任务状态行（界面美化役批 4——四态编舞 + 段缺席 + 滚动区联动）', () => {
  it('忙态在场：agent_start → 转轮 + 「正在对话中」+ ESC 提示（keyText 单源）+ 滚动区让 1 行', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    expect(io.bytes).toContain('\x1b[36m⠋'); // 态① accent 转轮（与文本段分立 SGR——不拼串断言）
    expect(stripAnsi(io.bytes)).toContain('正在对话中'); // 态① 基础文案
    expect(io.bytes).toContain('按 ESC 取消对话'); // keyText('global.interrupt') 首键 escape → ESC 显示单源
    expect(io.bytes).toContain('\x1b[1;2r'); // 10 行 - 固定区 7（任务行 1 + 编辑器 5〔上垫 1+呈现 3+下垫 1〕+ 状态行 1——五件批 A+B）- R-1 间隔 1
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(stripAnsi(io.bytes)).not.toContain('正在对话中'); // 闲态零高度缺席（忙态呈现不驻留）
    expect(io.bytes).toContain('\x1b[1;3r'); // 固定区回 6 行（任务行退役→编辑器 5+状态 1）——高度变更滚动区重设（10-6-1=R-1 间隔）
  });

  it('态② 细分（V-4 注⑪⑦）：message_start → 「思考中」；尾块分诊 thinking/text → 思考中/生成中；message_end 归态①', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'message_start', role: 'assistant' });
    expect(stripAnsi(io.bytes)).toContain('思考中'); // 起跑缺省思考中（首 update 分诊纠正——零空窗）
    io.bytes = '';
    // thinking 尾块在场 → 思考中（词面维持——同词零重绘）
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['先想想'], []),
    });
    expect(stripAnsi(io.bytes)).toContain('思考中');
    io.bytes = '';
    // text 尾块到达 → 生成中（词面迁移一次）
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['先想想'], ['你好']),
    });
    expect(stripAnsi(io.bytes)).toContain('生成中');
    io.bytes = '';
    emit(backend, { type: 'message_end', message: assistantMsg('答') });
    expect(stripAnsi(io.bytes)).toContain('正在对话中'); // 流式窗关归态①
  });

  it('态② 思考活状态头（挖掘 31 轮 [2]）：末思考块首个粗体段替位「思考中」——缺席兜底/换段清头/单行消毒', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' });
    // 无粗体 → 兜底词面「思考中」（不硬造）
    io.bytes = '';
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['先想想再说'], []),
    });
    expect(stripAnsi(io.bytes)).toContain('思考中');
    expect(stripAnsi(io.bytes)).not.toContain('先想想再说'); // 无粗体正文不上状态行
    // 粗体闭合到达 → 活头替位（extract_first_bold 律——首个 **bold** 段内文）
    io.bytes = '';
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['**解析用户意图**\n需要核对配置'], []),
    });
    expect(stripAnsi(io.bytes)).toContain('解析用户意图');
    expect(stripAnsi(io.bytes)).not.toContain('需要核对配置'); // 粗体段外内文不上状态行
    // 粗体未闭合 → 待后续增量（缺席兜底维持，不硬造半截）
    io.bytes = '';
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['**解析用户意图**\n需要核对配置\n**开了没闭'], []),
    });
    expect(stripAnsi(io.bytes)).toContain('解析用户意图'); // 首个闭合段维持（后续增量不清已锁头）
    // text 尾块到达 → 生成中 + 活头退场
    io.bytes = '';
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['**解析用户意图**'], ['你好']),
    });
    expect(stripAnsi(io.bytes)).toContain('生成中');
    // 件 C 后 settled 折叠思考标签行合法携内容预览（「解析用户意图」在
    // transcript 区在场——用户可知所思）；活头退场断言收窄至状态行：含
    // 「生成中」的行不得再携思考头
    expect(
      stripAnsi(io.bytes)
        .split(/\r?\n/)
        .some((l) => l.includes('生成中') && l.includes('解析用户意图')),
    ).toBe(false);
    // thinking 重入新段（interleaved 形——text 后再 thinking，mixedSnapshot 序表达不了须内联）→ 换段清头重建（块界律——旧头不残留）
    io.bytes = '';
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '**解析用户意图**' },
          { type: 'text', text: '你好' },
          { type: 'thinking', thinking: '再想想别的' },
        ],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    expect(stripAnsi(io.bytes)).toContain('思考中');
    expect(stripAnsi(io.bytes)).not.toContain('解析用户意图');
    // 段内换行折叠单空格（任务行单行几何律——消毒单源 sanitizeDisplayText + 空白折叠）
    io.bytes = '';
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['**甲\n乙**'], []),
    });
    expect(stripAnsi(io.bytes)).toContain('甲 乙');
  });

  it('本轮 N 边跑边涨 + 真值校正（估值器 ⑥c 供数——message_update 差分累计 / message_end onSettled）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' });
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('你') });
    expect(stripAnsi(io.bytes)).toContain('本轮 1'); // CJK 1 token/字（首快照全量）
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好世界') });
    expect(stripAnsi(io.bytes)).toContain('本轮 4'); // 差分 +3（非重算形）
    io.bytes = '';
    // message_end 真值校正：output = 50 顶替估值（单次收敛）
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    expect(stripAnsi(io.bytes)).toContain('本轮 50');
    io.bytes = '';
    // 下一 turn 起跑：reset 重建基线（agent_start fresh 清账 + message_start 复位）
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('新') });
    expect(stripAnsi(io.bytes)).toContain('本轮 1'); // 前轮账已清——差分从零重计
  });

  it('态③ 重试倒计时：retry_wait_start → 「重试中 第 n/N 次 · Ns 后」+ 转轮持续推帧', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'retry_wait_start', attempt: 2, maxAttempts: 3, nextAt: Date.now() + 3_000 });
    expect(stripAnsi(io.bytes)).toContain('重试中 第 2/3 次 · 3s 后'); // 绝对时刻 → 本地钟现算倒计时
    io.bytes = '';
    backend.tick();
    expect(io.bytes).toContain('⠙'); // 转轮不停（退避窗内忙态闸在开）
  });

  it('态④ 错误终态驻留不推帧 + 再入清场：exhausted → 红 ✗；下一 agent_start 回态①', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'failed' });
    emit(backend, { type: 'retry_wait_end', outcome: 'exhausted' });
    io.bytes = '';
    backend.tick();
    expect(io.bytes).toBe(''); // 终态不推帧（转轮闸关——闲态 tick 零写出同律）
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    expect(io.bytes).toContain('⠋'); // ✗ 驻留清场——新 run 回忙态（转轮回场）
    expect(stripAnsi(io.bytes)).toContain('正在对话中');
    expect(io.bytes).not.toContain('✗ 失败');
  });
});

describe('TuiBackend 任务行耗时暂停（挖掘 31 轮 [8]——审批/应答浮层期不计耗时）', () => {
  it('askApproval 开窗期读数冻结：等待 45s 后仍 2s，落定续走暂停段不回补', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    emit(backend, { type: 'agent_start' });
    clock.advance(2000); // t=2s：忙态帧携 2s
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump(); // 开窗帧落地
    clock.advance(45_000); // 审批等待 45s——暂停窗内帧照落但读数冻结
    expect(stripAnsi(io.bytes)).toContain('(2s · 按 ESC 取消对话)');
    expect(stripAnsi(io.bytes)).not.toContain('(47s');
    io.emitInput('\r'); // 批准（首项 approve）
    pump();
    await expect(p).resolves.toBe('approve');
    io.bytes = '';
    clock.advance(3000); // 落定续走：帧泵按到期时刻渲染、读数从冻结值渐进——
    // 取全部秒读数断区间（>2s 离开冻结值；<46s 即 45s 暂停段不回补）
    const secs1 = [...stripAnsi(io.bytes).matchAll(/\((\d+)s ·/g)].map((m) => Number(m[1]));
    expect(Math.max(...secs1)).toBeGreaterThan(2);
    expect(Math.max(...secs1)).toBeLessThan(46);
  });

  it('abort 收口同律：信号中止窗内冻结，取消后续走', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    emit(backend, { type: 'agent_start' });
    clock.advance(1000);
    const ac = new AbortController();
    const p = backend.askApproval(
      's1',
      { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' },
      { signal: ac.signal },
    );
    pump();
    clock.advance(20_000);
    expect(stripAnsi(io.bytes)).toContain('(1s · 按 ESC 取消对话)'); // 冻结 1s
    expect(stripAnsi(io.bytes)).not.toContain('(21s');
    ac.abort();
    await expect(p).resolves.toBe('cancel');
    io.bytes = '';
    clock.advance(2000); // 取消续走：读数离开冻结值 1s、20s 暂停段不回补
    const secs2 = [...stripAnsi(io.bytes).matchAll(/\((\d+)s ·/g)].map((m) => Number(m[1]));
    expect(Math.max(...secs2)).toBeGreaterThan(1);
    expect(Math.max(...secs2)).toBeLessThan(20);
  });

  it('input 应答车同族：自由文本应答窗冻结（射界③——阻塞四件全收）', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    emit(backend, { type: 'agent_start' });
    clock.advance(1000);
    const p = backend.input('补充一点', { placeholder: '补充说明…' });
    pump();
    clock.advance(30_000);
    expect(stripAnsi(io.bytes)).toContain('(1s · 按 ESC 取消对话)');
    expect(stripAnsi(io.bytes)).not.toContain('(31s');
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答');
    io.bytes = '';
    clock.advance(2000); // 应答收口续走：读数离开冻结值 1s、30s 暂停段不回补
    const secs3 = [...stripAnsi(io.bytes).matchAll(/\((\d+)s ·/g)].map((m) => Number(m[1]));
    expect(Math.max(...secs3)).toBeGreaterThan(1);
    expect(Math.max(...secs3)).toBeLessThan(30);
  });

  it('run 落于暂停窗内收口：终点折段不抛 + 收尾行用时走 durationMs 真源', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} }); // 有工具——收尾行在场（纯对话轮整行缺席律）
    clock.advance(1000);
    void backend.input('补充一点');
    pump();
    clock.advance(5000); // 窗内 5s 暂停
    io.bytes = '';
    // durationMs 65s >60s——文案标签门开（runRecapLine 单源：≤60s 无标签纯线）
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 65_000 });
    pump();
    // 收尾行用时走事件载荷 durationMs（1m 05s）——不受暂停账影响（射界②口径分立）
    expect(stripAnsi(io.bytes)).toContain('── 用时 1m 05s');
  });
});

describe('TuiBackend 重试续入整 run 口径（界面美化役批 4——B：续入不清 run 级账）', () => {
  it('failed → 退避 → resumed 续入：用量与起点连续累计（修前红：agent_start 无差别清账 → 只显续入段）', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(50) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t += 1_000;
    emit(backend, { type: 'agent_end', status: 'failed' });
    emit(backend, { type: 'retry_wait_start', attempt: 2, maxAttempts: 3, nextAt: t + 2_000 });
    t += 2_000;
    emit(backend, { type: 'retry_wait_end', outcome: 'resumed' });
    emit(backend, { type: 'agent_start' }); // 续入（retryContinuation 消费——run 级账不清）
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    t += 3_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 150'); // 整 run 口径：50 + 100（修前红 = 100）
    expect(io.bytes).not.toContain('tok/s'); // 速度段退役（V-4 注⑪⑦——起点重置语义归 speedView 观测面锁）
  });
});

describe('TuiBackend ESC 让路三分支（界面美化役批 2——escape 扩入中断键集）', () => {
  it('忙态 escape → 打断（含退避窗内）；闲态 escape → 丢弃；ctrl+c 恒打断（浮层在场亦然）', () => {
    const busy = makeInteractive();
    emit(busy.backend, { type: 'agent_start' });
    busy.io.emitInput('\x1b');
    escapePump(busy.clock);
    expect(busy.calls.interrupted).toEqual(['s1']); // 忙态 escape 打断（lone-ESC 判定窗收束）

    const backoff = makeInteractive();
    emit(backoff.backend, { type: 'agent_start' });
    emit(backoff.backend, { type: 'agent_end', status: 'failed' });
    emit(backoff.backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: backoff.clock.t + 60_000 });
    backoff.io.emitInput('\x1b');
    escapePump(backoff.clock);
    expect(backoff.calls.interrupted).toEqual(['s1']); // 退避窗内可取消（态③ 忙态闸在开）

    const idle = makeInteractive();
    idle.io.emitInput('\x1b');
    escapePump(idle.clock);
    expect(idle.calls.interrupted).toEqual([]); // 闲态丢弃（不误发中断）

    const overlay = makeInteractive();
    const settle = overlay.backend.confirm('做吗？');
    overlay.pump();
    overlay.io.emitInput('\x03'); // ctrl+c 恒打断——浮层在场不让路（escape 才让路）
    expect(overlay.calls.interrupted).toEqual(['s1']);
    overlay.backend.stop();
    void settle.catch(() => undefined); // 挂起 promise 不悬（中断不收浮层——用户收屏续办）
  });

  it('浮层在场 escape → 归浮层收屏（让路非打断）', async () => {
    const rig = makeInteractive();
    const settle = rig.backend.confirm('做吗？');
    rig.pump();
    rig.io.emitInput('\x1b');
    escapePump(rig.clock);
    expect(await settle).toBe(false); // esc → false（浮层收屏消费键）
    expect(rig.calls.interrupted).toEqual([]); // 让路：中断柄零触发
  });
});

describe('TuiBackend turn 收尾行（界面美化役批 5 件 9 + V-0 注⑥翻形——codex 记账线）', () => {
  /** 时刻形本地钟自证（与 formatClockHM 同源 getHours/getMinutes——测试期望随时区自洽） */
  const hm = (t: number): string => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  it('completed 有工具 → 「── 用时 1m 02s · 工具 1 次 ──」（时刻段退役）；durationMs 优先于本地观察账', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'message_end', message: { role: 'user', content: '跑', timestamp: 1 } }); // 种子（channel 缺席）
    emit(backend, { type: 'agent_start' }); // 暂存位晋升（种子账维持——取消形时刻源）
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    t += 90_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 62_000 }); // 驱动结算账 62s ≠ 本地 90s
    expect(io.bytes).toContain('── 用时 1m 02s · 工具 1 次 ──'); // 修前红：旧形「─ 用时 … · HH:MM ─」时刻段在场
    expect(io.bytes).not.toContain(hm(1)); // 时刻段退役（成功形记账线无时刻）
    expect(io.bytes).not.toContain('1m 30s'); // 本地观察账让位（A-3 唯一真源）
  });

  it('weakRule 在场 → 收尾行整行混合现算弱线色（V-3 注⑨②）；键缺席回退 DIM 既有形', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t, colorEnv: { COLORTERM: 'truecolor' } });
    // 自定义板带 text（混合基）+ userMessageBg（探测传值门放行——动态键族同门）
    backend.setThemeChoice('weak-test', { text: { r: 230, g: 237, b: 243 }, userMessageBg: { r: 16, g: 16, b: 16 } });
    io.emitInput('\x1b]11;rgb:0d11/1117/1723\x07'); // 探测应答 GitHub dark bg #0d1117
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    t += 30_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 90_000 }); // 90s = 文案标签门外语（⑧ >60s 文案照常）
    // weakRule = round(fg×0.2 + bg×0.8) 逐通道 = (56,61,67) = #383d43——修前红：旧形恒 DIM 直拼；
    // 尾锚随全宽补齐形改前缀式（文案尾与 SGR_RESET 间有右缘 ─ 补齐段——色壳断言经前缀保真）
    expect(io.bytes).toContain(`${buildSgr({ fg: colorRgb('#383d43') })}── 用时 1m 30s · 工具 1 次 ──`);
    expect(io.bytes).not.toContain(`${buildSgr({ dim: true })}── 用时`);
  });

  it('文案标签门（⑧ 两级门制）：>60s 文案形全宽补齐（右缘 ─ 补至列宽）；≤60s 纯线全宽（修前红：旧形恒文案无门无补齐）', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    t += 59_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 59_000 });
    // ≤60s：无标签纯线——全宽 ─（80 列）零文案段（修前红：'── 用时 59s · 工具 1 次 ──' 在场）
    expect(io.bytes).toContain('─'.repeat(COLS));
    expect(io.bytes).not.toContain('用时');
    // >60s：文案形全宽补齐——文案 + 右缘 ─ 补至 80 列（修前红：无补齐裸壳）
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't2', name: 'read', arguments: {} });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 62_000 });
    const recapText = '── 用时 1m 02s · 工具 1 次 ──';
    expect(io.bytes).toContain(recapText + '─'.repeat(COLS - stringWidth(recapText)));
    expect(stripAnsi(io.bytes)).not.toContain('─'.repeat(COLS + 1)); // 恰全宽不越列
  });

  it('重试段随行：retry_wait_start 计数 + 续入不清（整 run 口径）→ 「工具 2 次 · 重试 1」', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    emit(backend, { type: 'agent_end', status: 'failed' });
    emit(backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: t + 60_000 });
    emit(backend, { type: 'retry_wait_end', outcome: 'resumed' });
    emit(backend, { type: 'agent_start' }); // 续入（retryContinuation 消费——run 级账不清）
    emit(backend, { type: 'tool_execution_start', toolCallId: 't2', name: 'read', arguments: {} });
    t += 45_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 120_000 });
    expect(io.bytes).toContain('工具 2 次'); // 修前红：续入后工具计数被清为 1（若误走 resetUsage）
    expect(io.bytes).toContain('重试 1'); // 修前红：旧形无重试段
    expect(io.bytes).not.toContain('重试 0');
  });

  it('段缺席形：工具零省「工具」段（重试独场）→ 「── 用时 … · 重试 1 ──」', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'failed' });
    emit(backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: t + 60_000 });
    emit(backend, { type: 'retry_wait_end', outcome: 'resumed' });
    emit(backend, { type: 'agent_start' }); // 续入——纯对话腿收尾
    t += 30_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 75_000 }); // 75s = 文案标签门外语（⑧ >60s 文案照常）
    expect(io.bytes).toContain('── 用时 1m 15s · 重试 1 ──'); // 修前红：旧形纯对话轮判据只看工具——重试独场整行缺席
    expect(io.bytes).not.toContain('工具'); // 工具段缺席（零计数省段）
  });

  it('双零整行缺席（纯对话轮——工具 ∧ 重试双零判据）；新 run 起重试计数清零', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'agent_end', status: 'failed' });
    emit(backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: t + 60_000 });
    emit(backend, { type: 'retry_wait_end', outcome: 'resumed' });
    emit(backend, { type: 'agent_start' }); // 续入跑完
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 30_000 });
    io.bytes = '';
    emit(backend, { type: 'agent_start' }); // 全新 run（resetUsage——重试账清零）
    t += 120_000;
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 120_000 });
    expect(io.bytes).not.toContain('用时'); // 双零整行缺席（不设时长门——120s 也不落）
    expect(io.bytes).not.toContain('重试'); // 修前红若残账：上一 run 的重试计数泄入新 run
  });

  it('aborted → 「⏹ 对话已取消——HH:MM」恒落（用户动作回执；种子时刻源优先）', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'message_end', message: { role: 'user', content: '跑', timestamp: 5_000_000 } });
    emit(backend, { type: 'agent_start' });
    t += 45_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(io.bytes).toContain(`⏹ 对话已取消——${hm(5_000_000)}`); // 种子时刻（非终态时刻）
  });

  it('瞬时行语义：repaint 不重建（收尾行不在投影——切焦重画零复现）', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    t += 90_000;
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 90_000 });
    expect(io.bytes).toContain('用时 1m 30s');
    io.bytes = '';
    backend.onRepaint(SESSION, [], null); // 全量重画（投影空——瞬时行不在投影面）
    expect(io.bytes).not.toContain('用时'); // 不重建（重放不可见同律）
  });

  it('中途附着（无 agent_start）：计数段逐段尾注「（自本次接入起算）」——部分观察不冒充整 run 口径', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    // 中途附着形：本屏未亲见 run 开头（无 fresh agent_start——runStartedAt
    // null 观察窗，repaint/切焦到在飞会话的本屏观察账）；webui frames 对端
    // 同场景同词面（跨通道同律——词面与判据单源对齐）
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    emit(backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: t + 60_000 });
    t += 45_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 95_000 }); // 95s = 文案标签门外语（⑧ >60s 文案照常——门吞则加注形永不可见）
    // 修前红：'── 用时 1m 35s · 工具 1 次 · 重试 1 ──'（整 run 口径词面冒充）
    expect(io.bytes).toContain('工具 1 次（自本次接入起算）');
    expect(io.bytes).toContain('重试 1（自本次接入起算）');
    expect(io.bytes).not.toContain('── 用时 1m 35s · 工具 1 次 · 重试 1 ──'); // 修前红锚位（无注整段词面）
    // 耗时段不加注维持（durationMs 载荷在场即服务端整 run 真值——口径分立）
    expect(io.bytes).toContain('用时 1m 35s ·');
  });

  it('中途附着+retry 续入仍加注：续入不重开观察窗（runStartedAt 维持 null）——判据由首支独立保证；旗位跨续入存活系防御冗余的回归锁', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    emit(backend, { type: 'agent_end', status: 'failed' });
    emit(backend, { type: 'retry_wait_start', attempt: 1, maxAttempts: 3, nextAt: t + 60_000 });
    emit(backend, { type: 'retry_wait_end', outcome: 'resumed' });
    emit(backend, { type: 'agent_start' }); // 续入（run 级账不清——runStartedAt 维持 null 观察窗，旗同律存活）
    t += 45_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 95_000 }); // 95s = 文案标签门外语（⑧ >60s——门吞则加注形永不可见）
    // 加注真源 = runStartedAt === null 判据支（TUI 续入不重开观察窗——webui
    // frames 侧异构）；runCountsPartial 旗位在 TUI 结构性冗余（见字段诚实化
    // 注），本测兼作旗位跨续入存活的回归锁（若清位逻辑误扩到续入支，此锁红）
    expect(io.bytes).toContain('工具 1 次（自本次接入起算）');
    expect(io.bytes).toContain('重试 1（自本次接入起算）');
  });

  it('整 run 形（agent_start 亲见）零加注；fresh agent_start 清旗——中途附着旗不泄入后继完整 run', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    // 中途附着窗置旗（上一 run 收尾行带注）
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 10_000 });
    io.bytes = '';
    emit(backend, { type: 'agent_start' }); // 全新 run（resetUsage——旗随计数连清）
    emit(backend, { type: 'tool_execution_start', toolCallId: 't2', name: 'read', arguments: {} });
    t += 30_000;
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 90_000 }); // 90s = 文案标签门外语（⑧ >60s 文案照常）
    expect(io.bytes).toContain('── 用时 1m 30s · 工具 1 次 ──'); // 完整观察整 run 口径
    expect(io.bytes).not.toContain('自本次接入起算'); // 旗若不清即泄入（回归锁锚位）
  });
});

describe('TuiBackend 后台任务段 + /jobs 副屏（界面美化役批6——UX 批6 A/B/C 件）', () => {
  /** 运行中任务条目夹具（起跑 0 + 定值钟 65_000 → 时长 '1m 05s'——行文本确定性） */
  function job(id: string): JobEntry {
    return { id, name: `任务 ${id}`, kind: 'subagent', owner: SESSION, status: 'running', startedAt: 0 };
  }
  /** jobs 注入形（running/list 双闭包——推送锚与开屏快照同源） */
  const jobsOf = (entries: () => JobEntry[]) => ({ running: entries, list: entries });

  it('jobs 注入：固定区段二.5 呈 running 行（帧首拉取——零交互首画在场）', () => {
    const { io } = makeBackend({
      sessionId: SESSION,
      now: () => 65_000,
      jobs: jobsOf(() => [job('job-1'), job('job-2')]),
    });
    expect(io.bytes).toContain('◆ 任务 job-1 · 1m 05s');
    expect(io.bytes).toContain('◆ 任务 job-2 · 1m 05s');
  });

  it('注入缺席：固定区零任务行 + openJobs 如实 false（段缺席 = 命令面缺席）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION, now: () => 65_000 });
    expect(io.bytes).not.toContain('任务 job');
    expect(backend.openJobs()).toBe(false);
    expect(backend.lifecycle).toBe('running');
  });

  it('帽 5 + 溢出行指路 /jobs（24 行屏不挤压形——帽外行不虚报）', () => {
    const io = new MemoryTerminalIO(COLS, 24);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      now: () => 65_000,
      jobs: jobsOf(() => Array.from({ length: 7 }, (_, i) => job(`job-${i + 1}`))),
    });
    backend.start();
    expect(io.bytes).toContain('任务 job-5'); // 帽内末行在场
    expect(io.bytes).not.toContain('任务 job-6'); // 帽外不进段（全量史在 /jobs）
    expect(io.bytes).toContain('+ 2 更多 · /jobs 查看');
  });

  it('极小终端（3 行屏）整段隐：先缩后隐梯末位（todo/tool 同档牺牲序——V-0 注③ 框退役后隐位上移：5 行屏已养得起低段 1 行）', () => {
    const io = new MemoryTerminalIO(COLS, 3);
    const backend = new TuiBackend(io, { sessionId: SESSION, now: () => 65_000, jobs: jobsOf(() => [job('job-1')]) });
    backend.start();
    expect(io.bytes).toContain('›'); // 编辑器下限保底在场（composer 单行——'┌' 框锚随框退役）
    expect(io.bytes).not.toContain('任务 job-1'); // 低段让位——零高度不虚报
  });

  it('refreshJobs 推送锚：settle 即时收敛（闲态零帧源的即时路——job_settled 装配订阅位）', () => {
    const running: JobEntry[] = [job('job-1')];
    const { io, backend } = makeBackend({ sessionId: SESSION, now: () => 65_000, jobs: jobsOf(() => running) });
    running.push(job('job-2')); // 模拟新任务起跑（下次拉取才可见的增量）
    io.bytes = '';
    backend.refreshJobs();
    expect(io.bytes).toContain('任务 job-2');
  });

  it('alt+↓ 首按激活光标（› 记入帧）；空段不劫键（编辑器既有键零扰动）', () => {
    const rig = makeInteractive({ now: () => 65_000, jobs: jobsOf(() => [job('job-1'), job('job-2')]) }, 24);
    rig.io.emitInput('\x1b[1;3B'); // alt+↓（CSI 修饰参 3 = 1+alt）
    rig.pump();
    expect(rig.io.bytes).toContain('›'); // 光标期在选行 › 记
    // 空段形：jobs 注入但 running 空——alt+↓ 透传不劫（无光标帧）
    const idle = makeInteractive({ now: () => 65_000, jobs: jobsOf(() => []) }, 24);
    idle.io.emitInput('\x1b[1;3B');
    idle.pump();
    expect(idle.io.bytes).not.toContain('›');
  });

  it('enter 光标激活期开 /jobs 副屏定位在选任务（移动语义端到端）；未激活 enter 零劫', () => {
    const { io, backend, pump } = makeInteractive(
      { now: () => 65_000, jobs: jobsOf(() => [job('job-1'), job('job-2')]) },
      24,
    );
    io.emitInput('\r'); // 光标未激活——enter 不劫（不进副屏，提交语义透传编辑器）
    pump();
    expect(backend.lifecycle).toBe('running');
    io.emitInput('\x1b[1;3B'); // 首按激活置 0
    pump();
    io.emitInput('\x1b[1;3B'); // 移动到 job-2
    pump();
    io.bytes = '';
    io.emitInput('\r'); // enter——开屏定位在选任务
    pump();
    expect(backend.lifecycle).toBe('suspended'); // 副屏在场
    expect(io.bytes).toContain('◉ 后台任务 /jobs'); // 副屏头行
    expect(io.bytes).toContain('› 任务 job-2'); // 进屏光标直落该任务（定位面）
  });

  it('escape 收光标即消费（先于打断分诊——退出导航非打断意图）', () => {
    const { io, backend, clock, calls, pump } = makeInteractive(
      { now: () => 65_000, jobs: jobsOf(() => [job('job-1')]) },
      24,
    );
    io.emitInput('\x1b[1;3B');
    pump();
    io.bytes = '';
    io.emitInput('\x1b');
    escapePump(clock); // lone-ESC 判定窗到点——收光标触重画
    expect(calls.interrupted).toEqual([]); // 未落打断分诊（收光标即消费）
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).not.toContain('›'); // 光标离场帧
  });

  // 挖掘 26 轮 [5]：jobs 光标态跨 input-ask 激活存续——应答窗内 enter 被层③.5
  // 劫去开 /jobs 副屏而非提交答案（答案滞框；且退出副屏后光标仍活须先 escape
  // 才能提交）。修法同「?」教学键族先例：应答窗属应答车道（07:218 编辑器作
  // 应答车接管提交首序）——activateInputAsk 清光标 + jobs 劫持分支加 inputAsk 闸。
  it('jobs 光标态不跨 input-ask 应答窗：enter 交答案非开 /jobs（修前红）', async () => {
    const { io, backend, pump } = makeInteractive(
      { now: () => 65_000, jobs: jobsOf(() => [job('job-1'), job('job-2')]) },
      24,
    );
    io.emitInput('\x1b[1;3B'); // alt+↓ 激活 jobs 光标（应答窗开启前）
    pump();
    const p = backend.input('选哪个？'); // 应答窗接管主编辑器
    pump();
    io.bytes = '';
    io.emitInput('答\r'); // 应答 + enter——应答车道提交
    pump();
    expect(backend.lifecycle).toBe('running'); // 修前红：被劫 suspended 开 /jobs
    await expect(p).resolves.toBe('答'); // 答案提交（修前红：滞框永悬）
    // 应答窗内 alt+↓ 不新激活光标（inputAsk 闸——teachingGatesOpen 同款门）
    const p2 = backend.input('第二问？');
    pump();
    io.emitInput('\x1b[1;3B'); // 应答窗内 alt+↓
    pump();
    io.emitInput('又答\r');
    pump();
    expect(backend.lifecycle).toBe('running'); // 修前红：光标激活 → enter 劫持开副屏
    await expect(p2).resolves.toBe('又答');
  });

  // 挖掘 47 轮件 A——alt+↑ 弹回排队末条（收回编辑）：门序五闸 + jobs 光标
  // 裁决（alt+↑ 双语义窗分割——未激活让位弹回、激活归面板上移、alt+↓ 恒劫持）
  it('alt+↑ 弹回排队末条：草稿整替全文投影 + 面板缩容（帧首重拉）+ 成功零通知', () => {
    const previews = ['排队早件', '排队末件 次词'];
    const { io, pump } = makeInteractive(
      { queueFor: () => [...previews], queuePopLast: () => previews.pop() ?? null },
      24,
    );
    io.emitInput('\x1b[1;3A'); // alt+↑（CSI 修饰参 3 = 1+alt）
    pump();
    expect(io.bytes).toContain('排队末件 次词'); // 草稿整替（编辑器内容行——全文投影非预览折叠）
    expect(io.bytes).toContain('已排队 1：排队早件'); // 面板缩容（renderFixed 帧首重拉 queueFor）
    expect(io.bytes).not.toContain('没有可弹回'); // 成功不通知（填充即反馈）
    expect(io.bytes).not.toContain('草稿非空'); // 零保守拒通知
  });

  it('空弹 info 诚实呈报：专用键静默无反应是困惑面（无可弹件终局消费）', () => {
    const { io, pump } = makeInteractive({ queueFor: () => [], queuePopLast: () => null });
    io.emitInput('\x1b[1;3A');
    pump();
    expect(io.bytes).toContain('没有可弹回的排队文本件（空队或仅图片/操控件）');
  });

  it('草稿非空保守拒 warn（防覆稿丢失——外编种子同律）+ 草稿保持', () => {
    const previews = ['排队件'];
    const { io, pump } = makeInteractive({
      queueFor: () => [...previews],
      queuePopLast: () => previews.pop() ?? null,
    });
    io.emitInput('既有草稿');
    pump();
    io.bytes = '';
    io.emitInput('\x1b[1;3A');
    pump();
    expect(io.bytes).toContain('草稿非空——清空后再弹回（防覆稿丢失）');
    io.emitInput('增'); // 拒后续编一字符（onChange 触 touchFixed 帧重画编辑器区）
    pump();
    expect(io.bytes).toContain('既有草稿增'); // 草稿保持（保守拒不覆稿、可续编——门 ③ 拒不 touchFixed 无固定区帧，续编帧代证）
    expect(previews).toEqual(['排队件']); // 队不受扰（拒在弹前）
  });

  it('seam 缺席 alt+↑ 零扰动（注入缺席 = 功能关——键落终局无害）', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('\x1b[1;3A');
    pump();
    expect(calls.submitted).toEqual([]); // 不误触提交
    expect(io.bytes).not.toContain('弹回'); // 零通知零反馈
  });

  it('应答窗 alt+↑ 零弹（应答车非编辑——门 1 让位不污染应答稿）', async () => {
    const previews = ['排队件'];
    const { io, backend, pump } = makeInteractive({
      queueFor: () => [...previews],
      queuePopLast: () => previews.pop() ?? null,
    });
    const p = backend.input('问？'); // 应答窗接管主编辑器
    pump();
    io.bytes = '';
    io.emitInput('\x1b[1;3A'); // 应答窗内 alt+↑（inputAsk 闸 → 返 false 落终局）
    pump();
    expect(io.bytes).not.toContain('排队件'); // 弹回未发生（应答稿不被污染）
    expect(previews).toEqual(['排队件']); // 队不受扰
    io.emitInput('答\r'); // 应答车道照常
    pump();
    await expect(p).resolves.toBe('答');
  });

  it('回搜态弹回未发生：搜索态吃尽一切键（alt+↑ = 历史步进非弹回——结构性不可达）', () => {
    const previews = ['排队件'];
    const { io, pump } = makeInteractive({
      queueFor: () => [...previews],
      queuePopLast: () => previews.pop() ?? null,
    });
    io.emitInput('\x12'); // ctrl+r 开搜（搜索态先拦）
    pump();
    expect(io.bytes).toContain('回搜'); // 开搜基线
    io.bytes = '';
    io.emitInput('\x1b[1;3A'); // 搜索态 alt+↑ —— 编辑器吞（历史步进），不达弹回
    pump();
    expect(previews).toEqual(['排队件']); // popWaitingLast 零调（弹回未发生）
    expect(io.bytes).not.toContain('草稿非空'); // 零保守拒（弹回闭包未达）
    expect(io.bytes).not.toContain('没有可弹回'); // 零空弹通知（同上）
  });

  it('jobs 光标裁决：未激活 alt+↑ 让位弹回不激活光标 / 激活时归面板上移不走弹回路 / alt+↓ 首按激活保留（47 轮键位裁决）', () => {
    const previews = ['排队件'];
    const rig = makeInteractive(
      {
        now: () => 65_000,
        jobs: jobsOf(() => [job('job-1'), job('job-2')]),
        queueFor: () => [...previews],
        queuePopLast: () => previews.pop() ?? null,
      },
      24,
    );
    // ① 未激活：alt+↑ 让位弹回（busy 常见窗可用）——不激活光标
    rig.io.emitInput('\x1b[1;3A');
    rig.pump();
    expect(rig.io.bytes).toContain('排队件'); // 弹回发生
    expect(rig.io.bytes).not.toContain('› ◆'); // 光标未激活（让位非激活——首按激活语义只在 alt+↓；编辑器行 '› ' 前缀恒在不作锚）
    // ② 激活时：alt+↑ 归面板上移——不走弹回路（队已弹空+稿非空，走弹回路必现其一通知）
    rig.io.emitInput('\x1b[1;3B'); // alt+↓ 首按激活
    rig.pump();
    expect(rig.io.bytes).toContain('› ◆'); // 激活即见光标（首行——CURSOR_MARK+mark 连缀精确锚）
    rig.io.bytes = '';
    rig.io.emitInput('\x1b[1;3A'); // 光标激活态 alt+↑ = 面板上移（首行 clamp 同位——moveCursor「首行之上无路」）
    rig.pump();
    expect(rig.io.bytes).not.toContain('没有可弹回'); // 未走弹回空弹臂
    expect(rig.io.bytes).not.toContain('草稿非空——清空后再弹回'); // 未走弹回保守拒臂
    // ③ alt+↓ 首按激活保留（既有锁回归验证——本裁决零扰动）
    const rig2 = makeInteractive({ now: () => 65_000, jobs: jobsOf(() => [job('job-a')]) }, 24);
    rig2.io.emitInput('\x1b[1;3B');
    rig2.pump();
    expect(rig2.io.bytes).toContain('› ◆');
  });

  it('副屏 q 返回主屏（生命周期复原——件族退出律）', () => {
    const { io, backend, pump } = makeInteractive({ now: () => 65_000, jobs: jobsOf(() => [job('job-1')]) }, 24);
    expect(backend.openJobs()).toBe(true);
    pump();
    expect(backend.lifecycle).toBe('suspended');
    io.emitInput('q');
    pump();
    expect(backend.lifecycle).toBe('running');
  });
});

describe('TuiBackend 排队常驻面板（2026-10-05 ZCode TUI 对标批 + 2026-10-12 排队逐条清单批——07 §4.1 装配向接线翻档注）', () => {
  it('入列可见：首行「已排队 N：首条预览」+ 次条起逐条 ↳ 行（帽 3 内全列）', () => {
    const { io } = makeBackend({ sessionId: SESSION, queueFor: () => ['修复登录跳转', '补测试'] });
    expect(io.bytes).toContain('已排队 2：修复登录跳转'); // 首行 N=2（次条可见——零折叠尾巴）
    expect(stripAnsi(io.bytes)).not.toContain('修复登录跳转 +'); // 旧单行 +M 折叠形退役
    expect(io.bytes).toContain('↳ 补测试'); // 次条独占一行（dim ↳ 形）
  });

  it('单件形：仅首行无 ↳ 行（N=1 零折叠零折行不虚报）', () => {
    const { io } = makeBackend({ sessionId: SESSION, queueFor: () => ['修复登录跳转'] });
    expect(io.bytes).toContain('已排队 1：修复登录跳转');
    expect(stripAnsi(io.bytes)).not.toContain('修复登录跳转 +'); // 单件零折叠段
    expect(io.bytes).not.toContain('↳'); // 无次条行
  });

  it('超帽折行：N=4 可见 3 条（首 + 两 ↳）+ 尾行「+ 1 条更多」', () => {
    const { io } = makeBackend({
      sessionId: SESSION,
      queueFor: () => ['修复登录跳转', '补测试', '更新文档', '跑全量'],
    });
    expect(io.bytes).toContain('已排队 4：修复登录跳转');
    expect(io.bytes).toContain('↳ 补测试');
    expect(io.bytes).toContain('↳ 更新文档');
    expect(io.bytes).not.toContain('↳ 跑全量'); // 帽外条不可见
    expect(io.bytes).toContain('+ 1 条更多'); // 超帽折叠尾行（M = N-3）
  });

  it('余量不足部分呈现：4 行屏恰 1 行退化旧单行形（折叠尾巴回缀首行）', () => {
    const io = new MemoryTerminalIO(COLS, 4);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      queueFor: () => ['修复登录跳转', '补测试', '更新文档'],
    });
    backend.start();
    expect(io.bytes).toContain('›'); // 编辑器下限保底在场
    expect(io.bytes).toContain('已排队 3：修复登录跳转 +2'); // 隐藏数回缀首行（M = N-1）
    expect(io.bytes).not.toContain('↳'); // 无次条行（余量 1 只容首行）
  });

  it('多行不挤编辑器：N=3 清单 3 行与编辑器共存（常规屏恒满高）', () => {
    const { io } = makeBackend({ sessionId: SESSION, queueFor: () => ['修复登录跳转', '补测试', '更新文档'] });
    expect(io.bytes).toContain('已排队 3：修复登录跳转');
    expect(io.bytes).toContain('↳ 补测试');
    expect(io.bytes).toContain('↳ 更新文档');
    expect(io.bytes).toContain('›'); // 编辑器本体仍在场（清单扩行不侵必保段）
  });

  it('消费移除 / 清空退场：帧锚重拉——计数收敛、队列归零即段退场（零高度）', () => {
    const queue: string[] = ['修复登录跳转', '补测试'];
    const { io, backend } = makeBackend({ sessionId: SESSION, queueFor: () => queue });
    expect(io.bytes).toContain('已排队 2：修复登录跳转');
    queue.splice(0, 1); // 消费一件（次条晋升首条——计数收敛）
    io.bytes = '';
    emit(backend, { type: 'agent_start' }); // run 边界帧锚（入列/消费即时刷新路——touchFixed → 帧首重拉）
    expect(io.bytes).toContain('已排队 1：补测试');
    queue.splice(0, 1); // 清空
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('已排队'); // 队列清空即退场
  });

  it('注入缺席：固定区零排队段（旧形锚——既有装配/测试零扰动）', () => {
    const { io } = makeBackend({ sessionId: SESSION });
    expect(io.bytes).not.toContain('已排队');
  });

  it('极小终端（3 行屏）整段隐：先缩后隐梯末位（任务行同形外挂腿——低段让位零高度不虚报）', () => {
    const io = new MemoryTerminalIO(COLS, 3);
    const backend = new TuiBackend(io, { sessionId: SESSION, queueFor: () => ['排队件'] });
    backend.start();
    expect(io.bytes).toContain('›'); // 编辑器下限保底在场
    expect(io.bytes).not.toContain('已排队'); // 低段让位——零高度不虚报
  });
});

describe('TuiBackend /rewind 副屏装配（openRewindPicker——装配 seam 锁）', () => {
  it('装配 seam requestRepaint：预览异步落位经 altHost.requestRepaint 请帧（组合根缝——面板件内锁之外）', async () => {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    // 间谍注入形：altHost 是本件自持构造（非 options 注入面），spy 钉在实例方法
    // 上——锁的正是装配线 requestRepaint: () => this.altHost.requestRepaint() 这道
    // 缝。面板件内有锁（rewind-picker.test 注入 count）但装配笔误〔漏传/传错
    // 柄〕时该锁仍绿——组合根零帧源只有本缝锁可拦
    const host = (backend as unknown as { altHost: AltScreenHost }).altHost;
    const requestRepaint = vi.spyOn(host, 'requestRepaint');
    // 受控 promise：onPreview 落位时机由测试侧掌握（enter 触发后才 resolve）
    let resolvePreview!: (value: UiRewindPreview) => void;
    const opened = backend.openRewindPicker(
      [{ id: 'm-second0001', line: '- m-second… 2026-09-30 12:00:00〔修改前快照〕3 文件 · 回退点 seq=5' }],
      {
        onPreview: () =>
          new Promise<UiRewindPreview>((resolve) => {
            resolvePreview = resolve;
          }),
        onRestore: async () => undefined,
      },
    );
    expect(opened).toBe(true); // 副屏已开（主屏挂起 + 面板首帧）
    io.emitInput('\r'); // list 段 Enter → 进 preview + onPreview 异步加载
    resolvePreview({ restoreCount: 2, deleteCount: 1, untouchedCount: 0 });
    await Promise.resolve();
    await Promise.resolve(); // .then 落位微任务排空
    expect(requestRepaint).toHaveBeenCalled(); // 落位经装配 seam 请帧（笔误态零调用）
  });
});

describe('TuiBackend 持久化史透传（B1——07 §4.1 呈现面件 2 定形注⑦）', () => {
  it('history 注入：seed 播种可 ↑ 召回 + 提交触发 onRecord 镜像（编辑器入册位全链）', () => {
    const records: string[] = [];
    const { io, pump } = makeInteractive({
      history: { seed: ['prev-a', 'prev-b'], onRecord: (text) => records.push(text) },
    });
    // 种子路：空框 ↑ 直入历史回溯（跨进程史召回）
    io.emitInput('\x1b[A'); // ↑
    pump();
    expect(io.bytes).toContain('prev-a');
    // 写路：提交真入册触发镜像（经输入面 → editor.handleSubmit → onHistoryAdd）
    io.emitInput('\x1b[B'); // ↓ 回今态（清框）
    pump();
    io.emitInput('fresh-input\r');
    pump();
    expect(records).toEqual(['fresh-input']);
  });

  it('history 注入去重形：连续同文第二笔不镜像（onSubmit 照发）', () => {
    const records: string[] = [];
    const { io, calls, pump } = makeInteractive({
      history: { seed: [], onRecord: (text) => records.push(text) },
    });
    io.emitInput('dup\r');
    pump();
    io.emitInput('dup\r');
    pump();
    // 提交通道两笔照发（backend 分诊不因去重短路）；镜像只随真入册一笔
    expect(calls.submitted).toEqual([
      ['s1', 'dup'],
      ['s1', 'dup'],
    ]);
    expect(records).toEqual(['dup']);
  });

  it('history 注入缺席 = 旧形零扰动（↑ 无史可翻、提交照旧）', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('plain\r');
    pump();
    expect(calls.submitted).toEqual([['s1', 'plain']]);
    io.bytes = '';
    io.emitInput('\x1b[A'); // ↑ 无史——不进浏览态不炸
    pump();
    expect(calls.submitted).toHaveLength(1);
  });

  it('secretSubmission 透传（61 轮件 C——载密 argv 双闭锁中腿）：谓词真提交 onRecord 不触发、谓词假照旧镜像', () => {
    const records: string[] = [];
    const { io, calls, pump } = makeInteractive({
      history: {
        seed: [],
        onRecord: (text) => records.push(text),
        // 仿宿主装配注入形（真源 isSecretArgvSubmission 在 plugins 域——
        // channels 禁 import plugins，谓词经 options 位进；backend 测试以
        // 同判替身锁透传契约）
        secretSubmission: (text) => text.startsWith('/credentials add'),
      },
    });
    // 载密形：命令提交（dispatchCommand 缺席 → onSubmit 兜底）但双跳全跳
    io.emitInput('/credentials add anthropic sk-plain-leak-9f2a\r');
    pump();
    expect(calls.submitted).toEqual([['s1', '/credentials add anthropic sk-plain-leak-9f2a']]); // 提交通道照发
    expect(records).toEqual([]); // 修前红位：onRecord 镜像收全文
    // 非载密形：照常镜像（零扰动）
    io.emitInput('/credentials list\r');
    pump();
    expect(records).toEqual(['/credentials list']);
  });
});

describe('TuiBackend 外部编辑器（挖掘 31 轮 [9]——ctrl+g 挂起交出形）', () => {
  /** 微任务排干（异步编舞两段 await 后分诊落地——宏任务一轮保全部微任务清空） */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('ctrl+g 编舞全链：挂起 + raw 复先验交出 + seed 播种 + edited 整替回屏', async () => {
    const seeds: string[] = [];
    const { io, pump } = makeInteractive({
      externalEditor: async (seed) => {
        seeds.push(seed);
        return { status: 'edited', text: '外编改写稿' };
      },
    });
    io.emitInput('原稿');
    pump();
    io.bytes = '';
    io.emitInput('\x07'); // ctrl+g（C0：0x07 = g-0x60）
    await flush();
    pump();
    // 播种 = 草稿全文（读时点在挂起前——editor.getText 快照）
    expect(seeds).toEqual(['原稿']);
    // 挂起交出形过程态铁证：rawModeHistory 尾二 = [false(交出复先验), true(复起重设)]
    expect(io.rawModeHistory.slice(-2)).toEqual([false, true]);
    // 出屏/进屏模式串对（主屏 inline 形出屏串——kitty 弹栈 + 粘贴关/开，
    // 与 start/stop 对称；suspendMain LEAVE_MAIN / resumeMain ENTER_MAIN 单源）
    expect(io.bytes).toContain('\x1b[<u');
    expect(io.bytes).toContain('\x1b[?2004l');
    expect(io.bytes).toContain('\x1b[?2004h');
    // 整替回屏：新稿在编辑器呈现（setText 单源路——onChange 记账 + 帧落地）
    expect(io.bytes).toContain('外编改写稿');
  });

  it('edited 整替走 setText 单源路：undo 一步回原稿', async () => {
    const { io, pump } = makeInteractive({
      externalEditor: async () => ({ status: 'edited', text: '外编改写稿' }),
    });
    io.emitInput('原稿');
    pump();
    io.emitInput('\x07');
    await flush();
    pump();
    expect(io.bytes).toContain('外编改写稿');
    io.bytes = '';
    io.emitInput('\x1f'); // ctrl+-（0x1f）——undo 册键首形（readline 迁移键族）
    pump();
    // 整替是可撤销编辑（setText 单源路语义）非旁路覆盖——一步回原稿
    expect(io.bytes).toContain('原稿');
    expect(io.bytes).not.toContain('外编改写稿');
  });

  it('input-ask 应答窗不触发（ctrl+g 让位应答车道——执行器零调用）', async () => {
    const seeds: string[] = [];
    const { io, backend, pump } = makeInteractive({
      externalEditor: async (seed) => {
        seeds.push(seed);
        return { status: 'edited', text: '不应到达' };
      },
    });
    const p = backend.input('下方问？');
    pump();
    io.emitInput('\x07'); // 应答期 ctrl+g——门判 inputAsk === null 拦下
    await flush();
    pump();
    expect(seeds).toEqual([]); // 执行器零调用（应答车道不劫稿）
    expect(io.bytes).not.toContain('不应到达');
    io.emitInput('答\r'); // 应答照常收场（ctrl+g 零扰动应答车）
    pump();
    await expect(p).resolves.toBe('答');
  });

  it('missing-editor 三态呈报：白话指路文案在场、草稿原样', async () => {
    const { io, pump } = makeInteractive({
      externalEditor: async () => ({ status: 'missing-editor' }),
    });
    io.emitInput('原稿');
    pump();
    io.bytes = '';
    io.emitInput('\x07');
    await flush();
    pump();
    expect(io.bytes).toContain('未打开外部编辑器'); // 三态分诊白话文案
    expect(io.bytes).toContain('$VISUAL');
    expect(io.bytes).toContain('Ctrl+G'); // 键位册首键单源显示（displayKeyName 规范化）
    expect(io.bytes).toContain('原稿'); // 草稿未被动过
  });

  it('failed 三态呈报：异常消息 + 草稿未改动回执', async () => {
    const { io, pump } = makeInteractive({
      externalEditor: async () => ({ status: 'failed', message: 'spawn boom' }),
    });
    io.emitInput('原稿');
    pump();
    io.bytes = '';
    io.emitInput('\x07');
    await flush();
    pump();
    expect(io.bytes).toContain('外部编辑器异常：spawn boom');
    expect(io.bytes).toContain('草稿未改动——可重试');
    expect(io.bytes).toContain('原稿');
  });

  it('编舞期同键零重入（挂起期输入已卸订 + 在飞位双保险）；收口复位可再触发', async () => {
    let release: (() => void) | null = null;
    const seeds: string[] = [];
    const { io, pump } = makeInteractive({
      externalEditor: (seed) => {
        seeds.push(seed);
        return new Promise((resolve) => {
          release = () => resolve({ status: 'edited' as const, text: '第一轮' });
        });
      },
    });
    io.emitInput('原稿');
    pump();
    io.emitInput('\x07');
    await flush();
    io.emitInput('\x07'); // 编舞在飞（执行器未决）同键再按——零重入
    await flush();
    expect(seeds).toEqual(['原稿']); // 恰一次（挂起期输入卸订 + 在飞位双保险）
    release!();
    await flush();
    pump();
    expect(io.bytes).toContain('第一轮');
    io.bytes = '';
    io.emitInput('\x07'); // 收口复位（finally 闸复位）——可再触发
    await flush();
    expect(seeds).toEqual(['原稿', '第一轮']); // 第二轮播种 = 上轮整替后稿
  });

  it('标记态外编 seed 走展开投影：粘贴原文入种非占位行；原样读回提交不丢原文（挖掘 32 轮修）', async () => {
    const seeds: string[] = [];
    const { io, calls, pump } = makeInteractive({
      externalEditor: async (seed) => {
        seeds.push(seed);
        return { status: 'edited', text: seed }; // 原样读回（用户未改动形——数据面最险位）
      },
    });
    // 25 行粘贴（bracketed paste 注入）→ 标记化：稿面独占占位行、原文入 markers 登记表
    const body = Array.from({ length: 25 }, (_, i) => `行${i + 1}`).join('\n');
    io.emitInput(`\x1b[200~${body}\x1b[201~`);
    pump();
    io.emitInput('\x07'); // ctrl+g
    await flush();
    pump();
    // 修前红位：旧 seed = editor.getText() 不展开——外编只见占位串
    expect(seeds).toEqual([body]);
    // 读回整替（内容已展开为正文，setText 清 marker 登记零损失）→ 提交原文非占位串
    io.emitInput('\r');
    pump();
    expect(calls.submitted[0]?.[1]).toBe(body);
  });
});

describe('TuiBackend 真挂起回 shell（挖掘 41 轮件 III——ctrl+z SIGTSTP / SIGCONT 复起）', () => {
  /** 信号收账桩（MemoryTerminalIO 测试面零真进程纪律——externalEditor 桩同例） */
  class MemorySignals implements ProcessSignalsSeam {
    readonly kills: Array<[number, string]> = [];
    private readonly contListeners: Array<() => void> = [];
    readonly pid = 4242;
    constructor(readonly platform: string = 'darwin') {}
    kill(pid: number, signal: string): void {
      this.kills.push([pid, signal]);
      // 注入桩不阻塞（真进程此刻停在 SIGTSTP）——「挂起态」由测试显式
      // emitCont()（shell fg 恢复）驱动复起路
    }
    on(signal: string, cb: () => void): () => void {
      if (signal !== 'SIGCONT') return () => {};
      this.contListeners.push(cb);
      return () => {
        const i = this.contListeners.indexOf(cb);
        if (i >= 0) this.contListeners.splice(i, 1);
      };
    }
    /** 测试注入：shell fg 恢复信号 */
    emitCont(): void {
      for (const cb of [...this.contListeners]) cb();
    }
  }

  /** 挂起/复起链的 drainInput 闲窗驱动（advance + 双微任务排干——26 轮 drain 锁同法） */
  const settle = async (clock: ReturnType<typeof makeInteractive>['clock']): Promise<void> => {
    for (let elapsed = 0; elapsed < 2000; elapsed += 10) {
      clock.advance(10);
      await Promise.resolve();
      await Promise.resolve();
    }
  };

  it('ctrl+z 挂起编舞：LEAVE_MAIN → DECSTBM 复原写 → 排空 → raw(priorRaw) → kill(SIGTSTP)（ops 交错序 + 修前红锚）', async () => {
    const signals = new MemorySignals();
    const { io, clock } = makeInteractive({ processSignals: signals });
    io.reset();
    io.emitInput('\x1a'); // ctrl+z（C0：0x1a = z-0x60）
    await settle(clock);
    // 修前红锚：改前 routeEvent 四层全不命中——ctrl+z 静默丢、kills 恒空
    expect(signals.kills).toEqual([[signals.pid, 'SIGTSTP']]); // self-pid 自发恰一发
    // ops 交错序：出屏写 → DECSTBM 复原写 → raw 复先验（排空与 pause/resume
    // 不入 ops——write/raw 交错即编排真源）
    expect(io.ops).toEqual(['write', 'write', 'raw:false']);
    // 帧内容：帧0 出屏串 + 帧1 DECSTBM 复原 + 光标落底（stop 终退同款写）
    expect(io.frames[0]).toContain('\x1b[<u'); // LEAVE_MAIN（kitty 弹栈）
    expect(io.frames[1]).toContain('\x1b[r'); // SCROLL_REGION_RESET
    // 挂起稳态流不悬 paused（drain 尾收平——冷读清偿 P3 生产坑锁）
    expect(io.pauseCount).toBe(io.resumeCount);
  });

  it('SIGCONT 复起：raw(true) 先于进屏写（进屏序律）+ 清屏重画 + 输入路回归 + 单次消费', async () => {
    const signals = new MemorySignals();
    const { io, clock } = makeInteractive({ processSignals: signals });
    io.emitInput('\x1a');
    await settle(clock);
    expect(signals.kills).toHaveLength(1); // 挂起态在场
    io.reset(); // 复起段独立收账
    signals.emitCont(); // shell fg 恢复（SIGCONT）
    await settle(clock);
    // 进屏序律（resumeMain 注同源）：raw 先于 ENTER_MAIN 写出——应答不落
    // 内核 ECHO 窗；ops 首位 raw:true、其后的 write 才是进屏串
    expect(io.ops[0]).toBe('raw:true');
    expect(io.ops.indexOf('raw:true')).toBeLessThan(io.ops.indexOf('write'));
    expect(io.bytes).toContain('\x1b[?2004h'); // ENTER_MAIN（粘贴开——进屏族）
    // 全帧重画含清屏（挂起期 shell 输出滚 scrollback、复起绝对重锚）
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    // 输入路回归：复起后键入进稿（处理器重装证）
    io.emitInput('hi');
    clock.advance(1);
    expect(io.bytes).toContain('hi');
    // 终态放流恰一次（pause/resume 对称 + 复起 resumeMain 放流——不留 paused）
    expect(io.resumeCount).toBe(io.pauseCount + 1);
    // 单次消费：迟到/二次 SIGCONT 零动作（旗守卫——frames 冻结）
    const frames = io.frames.length;
    signals.emitCont();
    clock.advance(1);
    expect(io.frames.length).toBe(frames);
    expect(signals.kills).toHaveLength(1); // 复起不再自发信号
  });

  it('win32 守卫：ctrl+z 零挂起编舞零 kill（SIGTSTP 非 Windows 语义——键消费不生效）', async () => {
    const signals = new MemorySignals('win32');
    const { io, clock } = makeInteractive({ processSignals: signals });
    const rawTail = io.rawModeHistory.length;
    io.reset();
    io.emitInput('\x1a');
    await settle(clock);
    expect(signals.kills).toEqual([]);
    // 挂起编舞特征整体缺席（键触发的常规 UI 帧〔escape 窗/固定区帧〕合法
    // 在场不在此断——只锁出屏/raw 翻转/DECSTBM 三特征）
    expect(io.bytes).not.toContain('\x1b[<u'); // 无 LEAVE_MAIN（kitty 弹栈）
    expect(io.bytes).not.toContain('\x1b[r'); // 无 DECSTBM 复原
    expect(io.rawModeHistory.slice(rawTail)).toEqual([]); // 无 raw 翻转
    // 键透传编辑器形（ctrl+z 非编辑器绑定 → 终局丢弃）——零状态残留
    io.emitInput('x');
    clock.advance(1);
    expect(io.bytes).toContain('x'); // 后续键入照常
  });

  it('挂起态直接 stop 终退：SIGCONT 订阅收柄（双杀险兜底）——fg 恢复信号零路由', async () => {
    const signals = new MemorySignals();
    const { io, backend, clock } = makeInteractive({ processSignals: signals });
    io.emitInput('\x1a');
    await settle(clock);
    expect(signals.kills).toHaveLength(1);
    backend.stop(); // 挂起态终退（shell 下 kill berry 形）——先退订再终退
    io.reset();
    signals.emitCont(); // 迟到 fg 恢复——已退订零路由
    await settle(clock);
    expect(io.ops).toEqual([]); // 复起编舞零触发（已停 backend 不再写屏）
  });
});

describe('TuiBackend 历史回搜守卫（挖掘 31 轮 [3]——七闸接线面）', () => {
  /** 自含 rig（autocompleteRig 系他 describe 块内函数不达——同形自建） */
  function searchRig() {
    const commandCalls: string[] = [];
    const rig = makeInteractive({
      history: { seed: ['hello world', 'hibernate'], onRecord: () => {} },
      autocomplete: {
        // 双源皆记调用（补全请求门的零请求断言真源）
        commands: (query) => {
          commandCalls.push(query);
          return query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : [];
        },
        commandArguments: () => [],
      },
    });
    return { ...rig, commandCalls };
  }

  it('开搜撤补全弹层：草稿弹层在场 → ctrl+r 开搜即刻收层（锚失效防线）', () => {
    const { io, clock } = searchRig();
    io.emitInput('/he');
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1); // 防抖窗到——弹层在场
    expect(io.bytes).toContain('帮助');
    io.bytes = '';
    io.emitInput('\x12'); // ctrl+r 开搜（草稿 '/he' 非空——无空稿闸）
    clock.advance(1);
    expect(io.bytes).toContain('回搜'); // 搜索行顶行在场
    expect(io.bytes).not.toContain('帮助'); // 弹层随开搜撤（锚在草稿前缀——预览占据后失效）
  });

  it('escape 收搜还原：onInterrupt 零调用（让路腿——收场非中断）', () => {
    const { io, clock, calls } = searchRig();
    io.emitInput('\x12'); // ctrl+r 开搜
    clock.advance(1);
    io.emitInput('he'); // query（命中预览入稿）
    clock.advance(1);
    expect(io.bytes).toContain('回搜');
    io.bytes = '';
    io.emitInput('\x1b'); // escape——层①让路腿透传编辑器收搜
    escapePump(clock);
    expect(calls.interrupted).toEqual([]); // 零打断（收场非中断意图）
    expect(io.bytes).not.toContain('回搜'); // 搜索行退场
  });

  it('回搜期键入零补全请求：预览/还原翻转非用户编辑（handleEditorChange 门）', () => {
    const { io, clock, commandCalls } = searchRig();
    io.emitInput('\x12'); // ctrl+r 开搜
    clock.advance(1);
    io.emitInput('he'); // 搜索态 text 入 query——预览翻转触发 change
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1); // 推过防抖窗
    expect(commandCalls).toEqual([]); // 零补全请求（change 门挡 request）
    expect(io.bytes).not.toContain('/help'); // 无弹层
    expect(io.bytes).toContain('回搜'); // 搜索态在场旁证
  });

  it('回搜期 `?` 入 query 不开帮助（teachingGatesOpen 第七闸）', () => {
    const { io, clock } = searchRig();
    io.emitInput('\x12'); // ctrl+r 开搜（空稿闲态——七闸前六闸全开）
    clock.advance(1);
    io.emitInput('?'); // 教学键字符——搜索态应作普通搜索词
    clock.advance(1);
    // SGR 游程切割谱：搜索行三段异样式（前缀 dim/query 正文/缀 dim）字节流被
    // 转义序列切开——字面锚须 stripAnsi 后取（'?' 无命中史 → none 态缀在场）
    expect(stripAnsi(io.bytes)).toContain('回搜：?（未找到）'); // 入 query 而非开 /help
  });

  it('回搜态 ctrl+g 让位搜索模态：执行器零调用（稿位被预览占据，外编不劫稿——挖掘 32 轮修）', async () => {
    const seeds: string[] = [];
    const { io, clock } = makeInteractive({
      history: { seed: ['hello world'], onRecord: () => {} },
      externalEditor: async (seed) => {
        seeds.push(seed);
        return { status: 'edited', text: '不应到达' };
      },
    });
    io.emitInput('\x12'); // ctrl+r 开搜
    clock.advance(1);
    io.emitInput('he'); // query 命中——稿面被预览占据（非用户草稿）
    clock.advance(1);
    io.emitInput('\x07'); // ctrl+g——搜索态让位（事件归编辑器终局消费丢弃）
    await new Promise((resolve) => setTimeout(resolve, 0)); // 编舞微任务排干
    clock.advance(1);
    expect(seeds).toEqual([]); // 执行器零调用（预览不当种子外流）
    expect(io.bytes).not.toContain('不应到达');
    // esc 收搜还原——草稿路径零扰动（外编让位后搜索模态照常收场）
    io.bytes = ''; // 清帧——只断言收场后的增量字节
    io.emitInput('\x1b');
    escapePump(clock);
    expect(io.bytes).not.toContain('回搜');
  });
});

/* ---------------- 审批决策落史行（挖掘 31 轮 [1]）——直播追加公开面 ---------------- */

describe('TuiBackend appendApprovalDecisionLine（挖掘 31 轮 [1]——块账追加即入帧）', () => {
  it('决策行落帧：✗ 已拒绝 · <summary>（块账路——同步直出即入帧）', () => {
    const { io, backend } = makeBackend();
    emit(backend, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '答' }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    backend.appendApprovalDecisionLine({ decision: 'reject', summary: 'git push' });
    // SGR 游程切割谱：✗ 段语义色 + summary 段 dim——字面锚 stripAnsi 后断
    expect(stripAnsi(io.bytes)).toContain('✗ 已拒绝 · git push');
  });

  it('三档词面：approve ✓ / always ✓ / reject ✗（回看重建与直播同词汇单源）', () => {
    const { io, backend } = makeBackend();
    backend.appendApprovalDecisionLine({ decision: 'approve', summary: 'npm test' });
    backend.appendApprovalDecisionLine({ decision: 'always', summary: 'npm run' });
    expect(stripAnsi(io.bytes)).toContain('✓ 已批准 · npm test');
    expect(stripAnsi(io.bytes)).toContain('✓ 已总是批准 · npm run');
  });
});

describe('TuiBackend appendModelChangeLine（挖掘 52 轮件 B——块账追加即入帧）', () => {
  it('切线块落帧：↻ 模型已切换 · <spec>（块账路——同步直出即入帧）', () => {
    const { io, backend } = makeBackend();
    backend.appendModelChangeLine({ seq: 3, model: 'faux-stack/m2' });
    // SGR 游程切割谱同 approval：词头 accent + spec dim——字面锚 stripAnsi 后断
    expect(stripAnsi(io.bytes)).toContain('↻ 模型已切换 · faux-stack/m2');
  });
});

/* ---------------- 宿主通知块（挖掘 53 轮件 C）——直播追加公开面 ---------------- */

describe('TuiBackend appendNoticeLine（挖掘 53 轮件 C——块账追加即入帧）', () => {
  it('通知块落帧：四档头符 + 文案（块账路——同步直出即入帧；头符+空格瞬时 notify 形同族）', () => {
    const { io, backend } = makeBackend();
    backend.appendNoticeLine({ seq: 0, level: 'info', text: '新版本可用' });
    expect(stripAnsi(io.bytes)).toContain('• 新版本可用');
    io.bytes = '';
    backend.appendNoticeLine({ seq: 1, level: 'warn', text: '令牌临期' });
    expect(stripAnsi(io.bytes)).toContain('⚠ 令牌临期');
  });

  it('消毒链在渲染位（后端透传真值）：OSC 序列不入屏账', () => {
    const { io, backend } = makeBackend();
    backend.appendNoticeLine({ seq: 0, level: 'info', text: 'q\x1b]52;c;aGk=\x07b' });
    expect(io.bytes.includes('\x1b]52;')).toBe(false);
    expect(stripAnsi(io.bytes)).toContain('• qb'); // 消毒后拼接形
  });
});

/* ---------------- 评审 findings 块（35 池件 9）——直播追加公开面 + 重建装配锁 ---------------- */

describe('TuiBackend appendReviewLine（35 池件 9——块账追加即入帧）', () => {
  it('评审卡落帧：头行 + 条目 + 正文缩进（块账路——同步直出即入帧）', () => {
    const { io, backend } = makeBackend();
    backend.appendReviewLine({
      seq: 0,
      findings: [
        {
          title: '未处理空值',
          file: './src/example.ts',
          start: 10,
          end: 12,
          priority: 'warn',
          body: '该分支可能收到空值。',
        },
      ],
    });
    const out = stripAnsi(io.bytes);
    expect(out).toContain('• 评审发现 1 项');
    // 路径剥 ./ 前缀 + 行域形 + 正文 4 空格缩进
    expect(out).toContain('⚠ 未处理空值 · src/example.ts:10-12');
    expect(out).toContain('    该分支可能收到空值。');
  });
});

describe('TuiBackend reviewsOf 装配（35 池件 9——重建路数据源注入）', () => {
  it('onRepaint 投影重建带评审卡：reviewsOf 注入位→私有字段→loadProjection 第 6 参全链在帧（装配缺口锁）', () => {
    // 装配缺口锁（单测假注入绿掩盖装配缺口律）：漏 onRepaint 位接线则块只
    // 在直播腿在场、repaint 即消失——本锁钉重建腿四焊接点之一（onRepaint）
    const { io, backend } = makeBackend({
      reviewsOf: () => [
        {
          seq: 0,
          findings: [{ title: '越界访问', file: 'src/mod.ts', start: 3, end: 3, priority: 'error', body: '' }],
        },
      ],
    });
    io.bytes = '';
    backend.onRepaint(SESSION, [{ role: 'user', content: '问', timestamp: 1, seq: 1 }] as never, null);
    expect(stripAnsi(io.bytes)).toContain('• 评审发现 1 项');
    expect(stripAnsi(io.bytes)).toContain('✗ 越界访问 · src/mod.ts:3'); // 单行形（start==end）
  });

  it('缺席源 no-op：未注入 reviewsOf 时 onRepaint 零异常零评审卡（兼容锁）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    backend.onRepaint(SESSION, [{ role: 'user', content: '问', timestamp: 1 }], null);
    expect(stripAnsi(io.bytes)).not.toContain('评审发现');
  });
});

/* ---------------- 问答落史行（挖掘 36 轮 [2]）——直播追加公开面 ---------------- */

describe('TuiBackend appendAskDecisionLine（挖掘 36 轮 [2]——块账追加即入帧）', () => {
  it('已回复落帧：↳ 已回复 · <问题> · <答案>（块账路——同步直出即入帧）', () => {
    // 修前红：appendAskDecisionLine 未存在（TS2339）
    const { io, backend } = makeBackend();
    backend.appendAskDecisionLine({ outcome: 'answered', question: '继续吗', answer: '是' });
    // SGR 游程切割谱同 approval：字面锚 stripAnsi 后断
    expect(stripAnsi(io.bytes)).toContain('↳ 已回复 · 继续吗 · 是');
  });

  it('已取消落帧：↳ 已取消 · <问题>（无答案段）+ 消毒链在渲染位（后端透传真值）', () => {
    const { io, backend } = makeBackend();
    backend.appendAskDecisionLine({ outcome: 'cancelled', question: '选档' });
    expect(stripAnsi(io.bytes)).toContain('↳ 已取消 · 选档');
    // 用户自由输入的 OSC 序列不入屏账（渲染位 sanitizeDisplayText 单源）
    io.bytes = '';
    backend.appendAskDecisionLine({ outcome: 'answered', question: '问', answer: 'a\x1b]52;c;aGk=\x07b' });
    expect(io.bytes.includes('\x1b]52;')).toBe(false);
    expect(stripAnsi(io.bytes)).toContain('↳ 已回复 · 问 · ab');
  });
});

/* ---------------- 回合收尾块化（挖掘 43 轮件 A——completed 走 turn-recap 块路） ---------------- */

describe('TuiBackend 回合收尾 recap 块化（挖掘 43 轮件 A——成功形瞬时行 → 块账载体）', () => {
  it('completed → recap 块入帧：── 用时 … 词面在场（载体迁移零词面回退；修前红在 transcript 层——TS2339/union 穷尽）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} }); // 有工具——双零门开
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 65_000 }); // >60s 标签门开（runRecapLine 单源）
    expect(stripAnsi(io.bytes)).toContain('── 用时 1m 05s'); // 块路同步直出即入帧（enqueuePresent + requestRender）
  });

  it('resize 后重画：recap 行按新几何重算收口（渲染时合成——块路重算语义，非写时定格）', () => {
    const clock = new ManualClock();
    const { io, backend } = makeBackend({ schedule: clock.schedule, cancelSchedule: clock.cancel });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 65_000 });
    io.bytes = '';
    io.columns = 50;
    io.emitResize();
    clock.advance(75); // 尾随防抖窗到——handleResize 权威清点（41 轮件 I）；帧序含
    // resize 前旧几何 flush 行（80 宽）与 resize 后重画行——断言锚**最终屏态**
    //（末匹配）：修前瞬时路重放定格 80 宽、修后块路按新宽重算
    const matches = [...stripAnsi(io.bytes).matchAll(/── 用时 1m 05s[^\n]*/g)];
    expect(matches.length).toBeGreaterThan(0);
    expect(stringWidth(matches.at(-1)![0])).toBeLessThanOrEqual(50); // 渲染腿 repeat(max(0, columns−宽))
  });

  it('双零回合零块：纯对话轮（无工具无重试）completed 不落收尾块（双零整行缺席判据留调用侧）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 65_000 });
    expect(stripAnsi(io.bytes)).not.toContain('── 用时'); // 整行缺席与载体无关——门在 appendClosingLine 调用侧
  });

  it('aborted 仍走瞬时回执：⏹ 对话已取消在场、recap 词面缺席（回执非记账线——V-0 注⑥ 维持）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(stripAnsi(io.bytes)).toContain('⏹ 对话已取消');
    expect(stripAnsi(io.bytes)).not.toContain('── 用时');
  });

  it('onRepaint 后 recap 词面消失：live-only 呈现面（投影无源——块账重建缺席，同 ask-decision 律）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 65_000 });
    expect(stripAnsi(io.bytes)).toContain('── 用时 1m 05s'); // 落帧前提
    io.bytes = '';
    backend.onRepaint(SESSION, [{ role: 'user', content: '投影问题', timestamp: 1 }], null);
    expect(stripAnsi(io.bytes)).not.toContain('── 用时'); // 重建后不在场——turn-recap 无 durable 投影源
  });
});

/* ---------------- 溢出释放节律装配面（挖掘 43 轮件 B——tick 排空腿 + 动画门控） ---------------- */

/** 节律锁语料：稳定标题前缀 + 不稳段落尾（尾窗被段落占——升格时点词面可精确观测；同 main-screen.test paraText 族） */
const paraHead = (count: number): string => {
  const nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return (
    nums
      .slice(0, count)
      .map((n) => `### ${n}`)
      .join('\n\n') +
    '\n' +
    'A' +
    'a'.repeat(80 * 20)
  );
};

describe('TuiBackend 溢出释放节律（挖掘 43 轮件 B——装配级：tick 排空腿 + 动画门控）', () => {
  it('⑩tick 排空腿：停流期积压经 tick 推帧续释放（首例 tick 触转录面；修前红 = 停流无驱动永积压）', () => {
    const { io, backend, clock, pump } = makeInteractive();
    emit(backend, { type: 'message_start', role: 'assistant' }); // enterWorking——tick 体忙态门开
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg(paraHead(6)) });
    pump(); // 帧1：开账即全量（11 稳定行全冻）
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg(paraHead(8)) });
    pump(); // 帧2：Smooth +2——'七' 升格、'八' 留账（尾窗被段落占故零写出）
    const afterStream = io.bytes;
    expect(stripAnsi(afterStream)).not.toContain('### 八'); // 停流时点：'八' 未升格（积压在场）
    // 停 message_update——唯一驱动 = tick 排空腿（releaseBacklogActive 快照 →
    // enqueuePresent + requestRender）；advance 窗内 t=80 tick 到期 → 帧3
    //（now = clock.t）Smooth 再 +2 → '八' 升格写出
    clock.advance(100);
    const drained = io.bytes.slice(afterStream.length);
    expect(stripAnsi(drained)).toContain('### 八'); // 排空驱动升格（修前：tick 不触转录面 → 永积压零新帧）
  });

  it('⑪animations=false：tick 零触转录面（B2+B4 禁用形装配级先例同构——pacing 随动画门关）', () => {
    const { io, backend, clock, pump } = makeInteractive({ animations: false });
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg(paraHead(6)) });
    pump(); // pacing off 全量形——帧1 全冻（'七' 前 11 行）
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg(paraHead(8)) });
    pump(); // 帧2：全量追平——'七' '八' 当帧全升格（42 轮行为零回退）
    const afterStream = io.bytes;
    expect(stripAnsi(afterStream)).toContain('### 八'); // 全量形前提（对照 ⑩ 节律形）
    clock.advance(200); // tick 周期 ×2.5——禁用形 tick 体首行短路
    const drained = io.bytes.slice(afterStream.length);
    expect(stripAnsi(drained)).not.toContain('### 八'); // 已冻行零重写（tick 不触转录面）
    expect(stripAnsi(drained)).not.toContain('### 七');
  });
});

/* ---------------- todo 清单落史快照（挖掘 35 轮 B8）——直播腿锚消费 ---------------- */

describe('TuiBackend todo 快照块直播腿（挖掘 35 轮 B8——tool_execution_end 锚）', () => {
  /** 快照注入源（升序全序列——闸在 transcript 消费位，本桩直给） */
  const snapshotsOf = (entries: ReadonlyArray<{ seq: number; items: readonly TodoItem[] }>) => () => entries;

  it('tool_execution_end 落块入帧：卡头 + 条目行（直播实序块位 = 配对工具卡之前）', () => {
    const { io, backend } = makeBackend({
      todoSnapshotsOf: snapshotsOf([
        { seq: 1, items: [{ status: 'in-progress', content: '写实现', activeForm: '正在写实现' }] },
      ]),
    });
    io.bytes = ''; // 清首画——只断言事件增量
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    // present 自补链：applyFocusedEvent 后于 enqueuePresent——本位须自补两步（否则零呈现）
    expect(stripAnsi(io.bytes)).toContain('任务清单已更新');
    expect(stripAnsi(io.bytes)).toContain('正在写实现'); // activeForm 优先词面
  });

  it('缺席源 no-op：未注入 todoSnapshotsOf 时 tool_execution_end 零异常零呈现（兼容锁）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    expect(stripAnsi(io.bytes)).not.toContain('任务清单已更新');
  });

  it('闸全跳过零帧源不扰动：同签快照重复事件零增量帧', () => {
    const items: readonly TodoItem[] = [{ status: 'pending', content: '甲' }];
    const { io, backend } = makeBackend({ todoSnapshotsOf: snapshotsOf([{ seq: 1, items }]) });
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never }); // 首落
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 't2', result: {} as never }); // 全序列同签——闸跳过
    expect(stripAnsi(io.bytes)).not.toContain('任务清单已更新');
  });
});

/* ---------------- 回溯回执编排 wireForkEdit（挖掘 36 轮末件——session-rewind-fork） ---------------- */

describe('TuiBackend 回溯回执编排 wireForkEdit（forked 门控 seed / 草稿非空让位 / failed 零动作 / 异常兜底）', () => {
  /** 微任务冲刷（fire-and-forget 内链 then/catch 两轮即 settling） */
  async function flush(): Promise<void> {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }

  /** stub deps 装配（账本记录 seed/notify 调用面） */
  function stubDeps(draftEmpty = true) {
    const seeds: string[] = [];
    const notices: { message: string; level?: string }[] = [];
    return {
      deps: {
        draftEmpty: () => draftEmpty,
        seed: (text: string) => seeds.push(text),
        notify: (message: string, opts?: { level?: string }) => notices.push({ message, level: opts?.level }),
        shortIdOf: (sessionId: string) => `sid-${sessionId.slice(-4)}`,
      },
      seeds,
      notices,
    };
  }

  it('forked + 空稿：seed 原文 + success notify（含新会话短 id——血缘呈现位）', async () => {
    const { deps, seeds, notices } = stubDeps(true);
    const fn = wireForkEdit(async () => ({ status: 'forked', sessionId: 'sess-abcd1234' }), deps);
    fn({ seq: 3, text: '回填原文' });
    await flush();
    expect(seeds).toEqual(['回填原文']); // setText 单源回填
    expect(notices).toHaveLength(1);
    expect(notices[0]?.level).toBe('success');
    expect(notices[0]?.message).toContain('sid-1234'); // 短 id 单源注入
    expect(notices[0]?.message).toContain('编辑后发送'); // 不自动提交指路（条款②）
  });

  it('forked + 草稿非空：不 seed（破坏性保守面）+ warn 指路保留草稿', async () => {
    const { deps, seeds, notices } = stubDeps(false);
    const fn = wireForkEdit(async () => ({ status: 'forked', sessionId: 'sess-abcd1234' }), deps);
    fn({ seq: 3, text: '回填原文' });
    await flush();
    expect(seeds).toEqual([]); // 不覆盖非空草稿
    expect(notices).toHaveLength(1);
    expect(notices[0]?.level).toBe('warn');
    expect(notices[0]?.message).toContain('草稿非空'); // 指路文案
  });

  it('failed（vetoed/error 合并终态）：零动作——seed/notify 双零（核侧已报不重复）', async () => {
    const { deps, seeds, notices } = stubDeps(true);
    const fn = wireForkEdit(async () => ({ status: 'failed' }), deps);
    fn({ seq: 3, text: '原文' });
    await flush();
    expect(seeds).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('回执 promise reject：兜底吞不炸（防御位——fire-and-forget 不外抛）', async () => {
    const { deps, seeds, notices } = stubDeps(true);
    const fn = wireForkEdit(() => Promise.reject(new Error('意外腿')), deps);
    expect(() => fn({ seq: 3, text: '原文' })).not.toThrow(); // 同步面零抛
    await flush(); // 异步链 settle 不产生 unhandled rejection
    expect(seeds).toEqual([]);
    expect(notices).toEqual([]);
  });
});

/* ---------------- 终端 title 待处置外显（件 C——挖掘 46 轮） ---------------- */

describe('TuiBackend 终端 title 待处置外显（件 C——挖掘 46 轮）', () => {
  it('input 问在场开注意态——应答收场归位（开帧显形缀常态 title）', async () => {
    const { io, backend, pump } = makeInteractive();
    const p = backend.input('填啥？');
    pump();
    expect(io.bytes).toContain('[ ! ] 待处置 berry-agent'); // 注意帧（常态 title 缀尾——起屏基线值）
    io.bytes = '';
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答');
    expect(io.bytes).toContain('\x1b]0;berry-agent\x07'); // 归位写（帧值→常态值强制重写）
    expect(io.bytes).not.toContain('待处置'); // title 面收净
  });

  it('审批浮层在场同开注意态（stack 开层面）——浮层收场归位', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    expect(io.bytes).toContain('[ ! ] 待处置 berry-agent');
    io.bytes = '';
    io.emitInput('\x1b'); // esc → 面板保守值 '' → cancel
    escapePump(clock);
    await expect(p).resolves.toBe('cancel');
    expect(io.bytes).toContain('\x1b]0;berry-agent\x07'); // 归位写
    expect(io.bytes).not.toContain('待处置');
  });

  it('停机闸：stop 后迟到 abort 队列接续不重启注意针（终退后零 OSC 写出）', async () => {
    const { io, backend, pump } = makeInteractive();
    const ac1 = new AbortController();
    const p1 = backend.input('问一？', { signal: ac1.signal }); // 激活
    pump();
    void backend.input('问二？'); // 入队候接（无 signal——只经迟到 abort 接续激活）
    pump();
    expect(io.bytes).toContain('[ ! ] 待处置'); // 注意态开
    backend.stop(); // 终退（restore 归位基线 + 双针全停）
    io.bytes = '';
    ac1.abort(); // 迟到 abort——激活问收场 + 队列接续问二
    pump();
    expect(io.bytes).toBe(''); // 修前红位：接续激活无停机闸会重启注意针写出注意帧
    await expect(p1).resolves.toBe(''); // 保守值收口
  });
});

/* ================= 39 池 P4——typeahead 竞窗（交互屏开屏前 pending 输入隔离） ================= */

// 机制背景（探针实证前的结构性判读）：主屏输入管线 handleInput = feed →
// armEscapeWindow → take+route 全同步——完整事件永不跨 tick 滞留 decoder
// 队列，异步到达的 ask（通道消息 macrotask）开层时「已缓冲 decoder 事件」
// 结构性为空。唯一跨 tick 的 pending 态 = lone-ESC 判定窗挂起（生产轨
// schedule 注入、30ms 窗定时器在飞）：开屏前按下、尚未裁决的 ESC 在窗内
// 开层后 settle 成键，落入新层键面（escape = 保守值收场）——用户从未见过
// 面板即被陈键裁决。对照：同 chunk 尾随事件（take 先于 route——路由不受
// 中途卸订影响）恒走旧屏管线，不落新屏解码器。

describe('TuiBackend 交互屏开屏 typeahead 竞窗（pending lone-ESC 隔离——39 池 P4）', () => {
  it('判定窗内开层的审批面板不吃陈 ESC——面板保持待答（修前红：陈键裁决保守值）', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    io.emitInput('\x1b'); // T0：lone-ESC 挂起（判定窗 30ms——生产轨 timer 在飞）
    clock.advance(10); // T0+10：窗内——异步 ask 到达（通道消息 macrotask 的时序位）
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump(); // 面板开屏帧
    expect(io.bytes).toContain('⚙ 写入文件：写文件'); // 防空洞：面板确实在场
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    escapePump(clock); // T0+30：开屏前陈 ESC 裁决到点——修前：escape 落入新层面板
    await Promise.resolve(); // 微任务排空——面板若被陈键收场则旗已翻
    expect(settled).toBe(false); // 修前红位：面板被从未见过的开屏前按键以保守值收场
    io.bytes = '';
    io.emitInput('\r'); // 面板仍在场且功能完好——enter 选定首项（批准）
    pump();
    await expect(p).resolves.toBe('approve');
  });

  it('同族位：input 应答车开窗同隔离——窗内陈 ESC 不打断 run（修前红：陈键变打断）', async () => {
    const { io, backend, clock, calls, pump } = makeInteractive();
    emit(backend, { type: 'agent_start' }); // 忙态在身——escape 无层可让时落打断腿
    io.emitInput('\x1b'); // T0：lone-ESC 挂起（开窗前按下——彼时屏面无层无弹层）
    clock.advance(10); // 窗内——input ask 异步到达（应答车开窗：清稿 + 收弹层）
    const p = backend.input('补充说明？');
    pump();
    escapePump(clock); // T0+30：陈 ESC 裁决——修前：经层① escape 三分诊落打断（run 被陈键打断）
    expect(calls.interrupted).toEqual([]); // 修前红位：开屏前按键改写为打断意图
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答'); // 应答车功能完好
  });

  it('对照锚（开屏后按键归新屏——既有键面不随本批变）：面板在场期 ESC 即时保守值收场', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    io.emitInput('\x1b'); // 开屏【后】按下——本就归新屏键面
    escapePump(clock);
    await expect(p).resolves.toBe('cancel');
  });

  it('对照锚（同 chunk 尾随事件归旧屏管线）：开屏触发事件后随的 ctrl+c 走主屏打断——不落副屏 Engine 解码器', () => {
    const { io, backend, calls } = makeInteractive({
      onHelpShortcut: () => {
        backend.openHelp([]); // 装配同形：`?` 教学键 → 帮助副屏（AltScreenHost.open）
      },
    });
    io.emitInput('?\x03'); // 同一 stdin chunk：'?'（text 事件——开屏触发）+ ctrl+c（key 事件——尾随）
    expect(io.bytes).toContain('\x1b[?1049h'); // 副屏已进（触发事件已路由完开屏编舞）
    expect(calls.interrupted).toEqual(['s1']); // 尾随事件经 flushDecoderEvents 既有批次路由走旧屏层①——不进副屏
  });
});

/* ================= 56 轮件 2——ask 邻位三件 + 收场对称第四员（54 轮 penB 挂账 + gateB P3③） ================= */

// 机制背景（54 轮 penB 两开窗位 lone-ESC 隔离的后续定谳批）：
// - ① 开层期粘贴体中段残臂假设证伪：bracketed paste 在 decoder 内整段蓄积、
//   PASTE_END 到达才单原子交付（4MiB 防护帽前无中段冲刷路）——「部分事件已
//   入旧屏管线、部分归新层」的劈叉形结构性不存在。跨层粘贴体整段归
//   PASTE_END 交付时刻的屏面（尾事件归属，与 lone-ESC「settle 时刻归属」
//   同律）：面板期到达 = 层②模态独占吃尽；应答车期到达 = 整段入应答稿
//   （54B「续收」立场的落码锁）。
// - ② 引臂窗残位（本批修）：ctrl+] 待靶臂（editor.jumpPending）与 IME 组字
//   态（decoder 会话态 + model 悬空预编辑）跨面板存活是陈态泄漏——面板期
//   一切事件被层②吃尽，「续收」结构性不可达；收场后陈臂劫首字素 / 组字
//   冲 flush 提交被吃尽后悬空预编辑残呈。ask 开层位同收（臂清 + 组字丢弃）；
//   inputAsk 位不动（应答车续用主编辑器，续收真可达——setText 清臂 +
//   组字续收两既有位，本批落锁）。
// - ③ repaint 无 suspendedMain 闸：定谳注释位（authoritativeRepaint）——
//   推证见该处注释。
// - ④ 收场对称（本批修）：54B 只收两开窗位，漏收 input 应答车「空队退役」
//   收场位——应答窗期按下、判定窗在飞的 ESC 在收场后到点 settle 落主屏
//   （busy 态打断腿）：用户已答完问，陈键改写为打断意图。

describe('TuiBackend ask 邻位三件 + 收场对称（56 轮件 2——粘贴体归属 / 引臂残位 / 空队退役对称）', () => {
  it('①粘贴体跨层整段归属：面板开层期到达的粘贴体被层②整段吃尽——无中段残臂落主稿（原子性锁）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('\x1b[200~前半'); // 粘贴头段（PASTE_END 未至——decoder 蓄积中，零事件交付）
    pump();
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump(); // 面板开层（蓄积中的粘贴体不劈叉——头段不预入旧屏管线）
    io.emitInput('后半\x1b[201~'); // 尾段 + PASTE_END → 头尾合体单原子 paste 事件 → 层②面板吃尽
    pump();
    io.bytes = '';
    io.emitInput('\r'); // 面板功能完好——enter 批准
    pump();
    await expect(p).resolves.toBe('approve');
    pump();
    expect(io.bytes).toContain('输入消息'); // 防空洞：composer 行本窗口确有重写（占位文在场）
    expect(io.bytes).not.toContain('前半'); // 残臂假设（头段已入旧屏主稿）证伪的观测面
    expect(io.bytes).not.toContain('后半'); // 整段随层面板期归属——无任何残段落主稿
  });

  it('①粘贴体跨窗续收：input 应答车开窗期到达的粘贴体整段入应答稿（54B 续收立场锁）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('\x1b[200~答'); // 头段（开窗前蓄积——彼时屏面无窗）
    pump();
    const p = backend.input('补充说明？');
    pump(); // 应答车开窗（清稿不动粘贴态——54B 窄面立场）
    io.emitInput('案\x1b[201~'); // 尾段 → 头尾合体单原子 paste 事件 → 层④应答车收
    pump();
    io.emitInput('\r'); // enter 收窗提交应答
    pump();
    await expect(p).resolves.toBe('答案'); // 整段续收入应答——不丢头、不劈叉
  });

  it('②引臂窗残位：ctrl+] 待靶臂跨面板存活劫收场后首字素（修前红：陈臂吞字）', async () => {
    const { io, backend, calls, pump } = makeInteractive();
    io.emitInput('\x1d'); // ctrl+] → jump-forward 武装（下一可打印字素为跳靶）
    pump();
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump(); // 面板开层——修前：待靶臂无同收位，跨层存活成陈态
    io.emitInput('\r'); // 批准收场（面板键面）
    pump();
    await expect(p).resolves.toBe('approve');
    io.emitInput('a\r'); // 收场后首字素——修前被陈臂劫为跳靶（'a' 不入稿）、enter 空稿零提交
    pump();
    expect(calls.submitted).toEqual([['s1', 'a']]); // 修前红位：submitted 空账——'a' 被陈臂吞
  });

  it('②同族位：input 应答车开窗清稿连带清待靶臂（setText 单源——既有位锁）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('\x1d'); // 武装待靶臂
    pump();
    const p = backend.input('补充说明？');
    pump(); // 开窗位 setText('') 清稿连带清臂（editor.setText 内置——本批落锁既有位）
    io.emitInput('a\r'); // 'a' 入应答稿非跳靶 → enter 提交
    pump();
    await expect(p).resolves.toBe('a');
  });

  it('②IME 组字跨面板：开层同收组字态（丢弃）——收场后无悬空预编辑残呈（修前红）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('\x1b[0;;20013u'); // '中' 单发提交（正文入稿——kitty 首达零延迟交付）
    pump();
    io.emitInput('\x1b[0;;20013:22269u'); // '中国' 前缀链 → 回溯开 session → 组字态（preedit '中国'）
    pump();
    io.bytes = '';
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump(); // 面板开层——修前：组字态无同收位，跨层悬空
    io.emitInput('\r'); // 批准收场——修前：flushImeOnInterrupt 先冲 '中国' 为提交（被面板吃尽）→ 预编辑永无裁决位
    pump();
    await expect(p).resolves.toBe('approve');
    pump();
    expect(io.bytes).toContain('中'); // 防空洞：composer 行本窗口确有重写（开层前已提交的正文在场）
    expect(io.bytes).not.toContain('国'); // 修前红位：悬空预编辑 '国' 残呈在 composer
  });

  it('②IME 组字跨窗续收：应答车开窗不动组字态——冲刷提交整段落应答稿（54B 续收立场锁）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('\x1b[0;;20013u'); // '中' 单发提交（正文入稿）
    pump();
    io.emitInput('\x1b[0;;20013:22269u'); // 组字态 '中国'（preedit）
    pump();
    const p = backend.input('补充说明？');
    pump(); // 应答车开窗：清稿不动组字态（54B 窄面立场——续收语境）
    io.emitInput('\r'); // enter 打断组字：flushImeOnInterrupt 先冲 '中国' 为提交 → 层④应答车收 → enter 提交
    pump();
    await expect(p).resolves.toBe('中国'); // 组字整段续收入应答——不丢、不悬空
  });

  /* 56 轮闸清偿批主会话补锁：② 副屏挂起位同收（P2——suspendMain 单点，model-picker//diff/外编/挂 shell 全同律）+ ⑤ leader 待续窗跨层同收（P3） */

  it('②副屏挂起位同收待靶臂：suspendMain 清 editor 侧陈臂——复起后首字素不被劫（修前红：陈臂吞字）', async () => {
    const { io, backend, calls, pump } = makeInteractive();
    io.emitInput('\x1d'); // ctrl+] → jump-forward 武装（下一可打印字素为跳靶）
    pump();
    backend.openHistory('s1', [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    pump(); // 副屏挂起——decoder 侧随 discardPending 全丢，修前：editor 侧待靶臂无同收位跨屏滞留
    io.emitInput('q'); // 回看器键面退出（onExit → closeAlt → resumeMain 复起）
    pump();
    io.emitInput('a\r'); // 复起后首字素——修前被陈臂劫为跳靶（'a' 不入稿）、enter 空稿零提交
    pump();
    expect(calls.submitted).toEqual([['s1', 'a']]); // 修前红位：submitted 空账——'a' 被陈臂吞
  });

  it('②副屏挂起位同收组字态：suspendMain 清悬空预编辑——复起后稳态帧无残呈（修前红）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('\x1b[0;;20013u'); // '中' 单发提交（正文入稿）
    pump();
    io.emitInput('\x1b[0;;20013:22269u'); // 组字态 '中国'（preedit 悬空——副屏期无裁决位）
    pump();
    backend.openHistory('s1', [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    pump();
    io.emitInput('q'); // 键面退出 → 复起全帧重画
    pump();
    io.bytes = ''; // 观测窗只辖复起后稳态续帧——复起爆内先写投影 stale 行（组字陈态）再被权威重建同爆覆写自纠，同爆双写肉眼不可见，不断言爆内字节
    io.emitInput('x'); // 复起后继续输入——修前：model 悬空预编辑不清则国字续呈于每一后续帧
    pump();
    expect(io.bytes).toContain('中x'); // 防空洞：复起后输入照常入稿（编辑器功能完好）
    expect(io.bytes).not.toContain('国'); // 修前红位：组字跨屏陈态续呈
  });

  it('⑤leader 待续窗跨 ask 层同收：闲态武装的 2s 窗开层即卸——面板 ESC 不被⓪ 吞击（修前红：陈窗吞一击）', async () => {
    const { io, backend, clock, pump } = makeInteractive({ onLeaderBranch: () => {} }); // 族激活（柄在场——层⓪ 头参与分诊）
    io.emitInput('\x18'); // ctrl+x → leader 待续窗武装（闲态空稿——2s 窗在飞）
    pump();
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump(); // 面板开层——修前：陈窗无同收位跨层滞留（分支字母虽有 stack/inputAsk 闸挡）
    io.emitInput('\x1b'); // 面板 ESC（取消语义）——修前：⓪ cancel 分诊先于层② 消费吞一击
    pump();
    escapePump(clock); // lone-ESC 判定窗到点 settle 成键（面板收到 ESC 的唯一路——漏此步则修前修后同悬，红绿失效）
    await expect(p).resolves.toBe('cancel'); // 修前红位：ESC 被陈窗吞 → 面板悬置至超时
  });

  it('④收场对称：input 空队退役位同收应答窗期陈 ESC——不落主屏打断（修前红：陈键打断 run）', async () => {
    const { io, backend, clock, calls, pump } = makeInteractive();
    emit(backend, { type: 'agent_start' }); // 忙态在身——escape 栈空时落打断腿
    const ac = new AbortController();
    const p = backend.input('补充说明？', { signal: ac.signal });
    pump();
    io.emitInput('\x1b'); // 应答窗期按下——lone-ESC 判定窗挂起（30ms 定时器在飞）
    clock.advance(10); // 窗内——收场事件到达（signal abort 的时序位）
    ac.abort(); // 收场（同步收口路：inputAsk=null + continueInputQueue 空队退役）
    await expect(p).resolves.toBe('');
    escapePump(clock); // 判定窗到点——修前：settle 成键落入已收场的主屏键面（busy → 打断）
    expect(calls.interrupted).toEqual([]); // 修前红位：ask 收场后陈键改写为打断意图
  });

  it('④对照锚（收场后新按键归主屏键面——既有键面不随本批变）：退役位同收只辖应答窗期陈键', async () => {
    const { io, backend, clock, calls, pump } = makeInteractive();
    emit(backend, { type: 'agent_start' });
    const ac = new AbortController();
    const p = backend.input('补充说明？', { signal: ac.signal });
    pump();
    ac.abort(); // 收场（无在飞陈键）
    await expect(p).resolves.toBe('');
    io.emitInput('\x1b'); // 收场【后】新按——本就归主屏键面
    escapePump(clock);
    expect(calls.interrupted).toEqual(['s1']); // 忙态 escape 打断照旧
  });
});

/* ================= TUI 剪贴板图片直贴（35 池件 2 + 39 轮 normalize_pasted_path 变体面） ================= */

describe('TuiBackend 剪贴板图片直贴（ctrl+v 读链 + 路径变体面 + 提交消费律）', () => {
  /** 微任务排空（读器 promise 链 then/finally 全微任务——setImmediate 宏任务界冲净链） */
  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  };

  /** 最小 PNG 魔数字节（受理缝是假桩不做魔数执法——载荷只认往返） */
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  /** image-ref 引用块桩（sha256 内容寻址键形——契约面字面量） */
  const refBlock = (n: number): ImageRefContent => ({
    type: 'image-ref',
    ref: `sha256:${String(n).repeat(64)}`,
    mimeType: 'image/png',
    bytes: PNG_BYTES.length,
  });

  /** 提交捕获形（第四参 images 断言位） */
  interface PasteSubmission {
    text: string;
    images: readonly ImageRefContent[] | undefined;
  }

  it('ctrl+v 有图：占位行入稿 + 提交链携 images（image-only 合法——空文本剥占位）', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock(1)],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // ctrl+v（C0 0x16 → key {v, ctrl}）
    await flushMicrotasks(); // 读器 promise 链回执
    pump();
    expect(io.bytes).toContain('[图片]'); // 占位行已入稿（空稿独占——无前后换行残骸）
    io.emitInput('\r');
    pump();
    expect(submissions).toEqual([{ text: '', images: [refBlock(1)] }]); // 占位剥除 + 暂存附图随提交
  });

  it('ctrl+v 无图（null）与读失败（reject）两静默：零占位零弹错，普通提交零漂移', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => null,
      imageIntake: () => [refBlock(1)],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16');
    await flushMicrotasks();
    pump();
    expect(io.bytes).not.toContain('[图片]'); // 无图静默——零入稿
    io.emitInput('普通文本\r');
    pump();
    expect(submissions).toEqual([{ text: '普通文本', images: [] }]); // 纯文本提交零漂移（暂存空图位空数组）
  });

  it('读失败（执行器异常面）同静默：键无效不炸会话', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => {
        throw new Error('clipboard boom');
      },
      imageIntake: () => [refBlock(1)],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16');
    await flushMicrotasks();
    pump();
    expect(io.bytes).not.toContain('[图片]');
    io.emitInput('ok\r');
    pump();
    expect(submissions).toEqual([{ text: 'ok', images: [] }]);
  });

  it('双贴两图 + 手敲文本混合稿：占位全剥、文本保留、两图按序随提交', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock(7)],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('看这张'); // 文本先行（贴图在光标后劈行独占——文本行不被并入）
    io.emitInput('\x16');
    await flushMicrotasks();
    io.emitInput('\x16');
    await flushMicrotasks();
    pump();
    expect(io.bytes).toContain('看这张');
    io.emitInput('\r');
    pump();
    expect(submissions).toEqual([{ text: '看这张', images: [refBlock(7), refBlock(7)] }]);
  });

  it('占位删除即解除挂附（清账律）：贴图后清稿改投纯文本 → 图不随行（暂存不跨提交滞留）', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock(2)],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16');
    await flushMicrotasks();
    io.emitInput('\x15'); // ctrl+u 删至行首——单行稿即清空（占位行删 = 解除挂附交互面）
    io.emitInput('纯文本\r');
    pump();
    expect(submissions).toEqual([{ text: '纯文本', images: [] }]); // 无占位 → 零附图 + 暂存清账
  });

  it('ask 应答窗让位清暂存图账（56 轮闸 P2）：陈图不劫后续提交——再贴新图按新账随行（修前红：min 帽顶掉旧账反挂错图）', async () => {
    const submissions: PasteSubmission[] = [];
    let seq = 0; // 逐贴产异图（图 1 → 图 2——陈账/新账可分辨）
    const { io, backend, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock((seq += 1))],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // ctrl+v → 图 1 暂存 + [图片] 占位入稿
    await flushMicrotasks();
    pump();
    const p = backend.input('补充说明？'); // ask 应答窗开（setText 清稿——占位随之灭）
    pump();
    io.emitInput('答\r'); // 应答提交（ask 早退支——不经 consumeStagedImages）
    pump();
    await expect(p).resolves.toBe('答');
    io.emitInput('\x16'); // 再贴图 2（新账应唯一）
    await flushMicrotasks();
    pump();
    io.emitInput('\r'); // 主稿提交（空文本剥占位 + 暂存附图随行）
    pump();
    expect(submissions).toEqual([{ text: '', images: [refBlock(2)] }]); // 修前红位：陈账在前——min 帽顶掉旧账反挂图 1
  });

  it('ctrl+d 清稿腿清暂存图账（57 轮件③修A——修前红：清稿不清账）：陈图不劫后续提交 + 清稿后手敲 `[图片]` 字面不被剥', async () => {
    const submissions: PasteSubmission[] = [];
    let seq = 0; // 逐贴产异图（图 1 → 图 2——陈账/新账可分辨）
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock((seq += 1))],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // ctrl+v → 图 1 暂存 + [图片] 占位入稿
    await flushMicrotasks();
    pump();
    io.emitInput('\x04'); // ctrl+d 首击：清稿腿（占位随稿灭——图账应同笔让位）
    pump();
    expect(io.bytes).toContain('已清空——再按 Ctrl+D 退出'); // 清稿回执在场（两步序②）
    io.emitInput('\x16'); // 再贴图 2（新账应唯一）
    await flushMicrotasks();
    pump();
    io.emitInput('\r');
    pump();
    // 修前红位：清稿腿不清 stagedImages——陈账在前，min 帽顶掉旧账反挂图 1
    expect(submissions).toEqual([{ text: '', images: [refBlock(2)] }]);
    // 第二断言（暂存空不剥律）：清稿后手敲 `[图片]` 字面提交——原文直通零附图
    // （修前红：暂存陈账在场 → 剥词面 + min 帽反挂图 1 = { text: '', images: [refBlock(1)] }）
    io.emitInput('[图片]\r');
    pump();
    expect(submissions[1]).toEqual({ text: '[图片]', images: [] });
  });

  it('占位行删除身份对账（57 轮件③修B——修前红：FIFO 取首错挂）：删首个占位行 → 幸存占位挂幸存图', async () => {
    const submissions: PasteSubmission[] = [];
    let seq = 0; // 逐贴产异图（占位行 0 ↔ 图 1、占位行 1 ↔ 图 2——删谁可分辨）
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock((seq += 1))],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // 图 1 → 占位行 0
    await flushMicrotasks();
    io.emitInput('\x16'); // 图 2 → 占位行 1（光标驻行 1 尾）
    await flushMicrotasks();
    pump();
    io.emitInput('\x1b[A'); // ↑：多行稿视觉行上移（非历史回溯——光标不在首视觉行）
    io.emitInput('\x01'); // ctrl+a 行首
    io.emitInput('\x0b'); // ctrl+k 删至行尾——行 0 占位文本整删（残空行）
    pump();
    io.emitInput('\r');
    pump();
    // 修前红位：consumeStagedImages FIFO 取首——markerCount=1 恒挂图 1（被删的恰是图 1 的占位、图 2 被弃）
    expect(submissions).toEqual([{ text: '', images: [refBlock(2)] }]);
  });

  it('占位行删除身份对账·对拍锁：删次占位行 → 首图随行（FIFO 与对账两形同果——行为锁）', async () => {
    const submissions: PasteSubmission[] = [];
    let seq = 0;
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock((seq += 1))],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // 图 1 → 占位行 0
    await flushMicrotasks();
    io.emitInput('\x16'); // 图 2 → 占位行 1（光标驻行 1 尾——恰在删除位）
    await flushMicrotasks();
    pump();
    io.emitInput('\x01'); // ctrl+a 行首（行 1）
    io.emitInput('\x0b'); // ctrl+k 删至行尾——行 1 占位文本整删（残空行）
    pump();
    io.emitInput('\r');
    pump();
    // 删的是图 2 的占位 → 图 1 随行（FIFO 旧形同果——本锁守住对账改造不翻此面）
    expect(submissions).toEqual([{ text: '', images: [refBlock(1)] }]);
  });

  it('占位行删除身份对账·不变锁：删非占位行（索引平移）→ 两图全保（对账不得误弹）', async () => {
    const submissions: PasteSubmission[] = [];
    let seq = 0;
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock((seq += 1))],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('x'); // 非占位文本行先行（行 0）
    io.emitInput('\x16'); // 图 1 → 占位行 1
    await flushMicrotasks();
    io.emitInput('\x16'); // 图 2 → 占位行 2（光标驻行 2 尾）
    await flushMicrotasks();
    pump();
    io.emitInput('\x1b[A');
    io.emitInput('\x1b[A'); // ↑×2：上移行 0（两度非首视觉行——纯移动零翻稿）
    io.emitInput('\x01'); // ctrl+a 行首
    io.emitInput('\x0b'); // ctrl+k 删至行尾——行 0 文本整删（残空行——两占位行索引平移）
    pump();
    io.emitInput('\r');
    pump();
    // 占位行全数幸存（仅索引平移）→ 两图全保（修前同果——锁对账零误弹）
    expect(submissions).toEqual([{ text: '', images: [refBlock(1), refBlock(2)] }]);
  });

  it('历史浏览态让位（57 轮闸 P1——修前红：↑ 浏览换稿被判删占位弹空账）：↑↓ 往返后图账幸存', async () => {
    const submissions: PasteSubmission[] = [];
    let seq = 0;
    const { io, pump } = makeInteractive({
      history: { seed: ['prev-entry'], onRecord: () => {} },
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock((seq += 1))],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // ctrl+v → 图 1 暂存 + [图片] 占位入稿
    await flushMicrotasks();
    pump();
    io.emitInput('\x01'); // ctrl+a 行首（↑ 触发三条件之一）
    io.emitInput('\x1b[A'); // ↑ → 历史浏览：草稿被换为 'prev-entry'（占位「消失」非用户删稿）
    pump();
    io.emitInput('\x1b[B'); // ↓ → 还原草稿（占位复现——但若 browse 期账被弹空即不可逆）
    pump();
    io.emitInput('\r');
    pump();
    // 修前红位：browse 换稿帧被对账器判「占位尽删」→ staged 弹空 → 提交
    // images=[] 且占位词面直通泄漏（{ text: '[图片]', images: [] }）
    expect(submissions).toEqual([{ text: '', images: [refBlock(1)] }]);
  });

  it('回搜态让位不变锁（57 轮闸 P1 对拍）：ctrl+r 往返后图账幸存（既有承诺零漂移）', async () => {
    const submissions: PasteSubmission[] = [];
    let seq = 0;
    const { io, clock, pump } = makeInteractive({
      history: { seed: ['prev-entry'], onRecord: () => {} },
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock((seq += 1))],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // 图 1 暂存 + 占位入稿
    await flushMicrotasks();
    pump();
    io.emitInput('\x12'); // ctrl+r 开搜（预览占据草稿——对账应让位）
    clock.advance(1);
    io.emitInput('prev'); // 搜索词（预览帧连翻——均在让位域）
    clock.advance(1);
    io.emitInput('\x1b'); // esc 收搜还原草稿
    escapePump(clock);
    pump();
    io.emitInput('\r');
    pump();
    // 不变式：回搜预览/还原非用户删稿——图账零漂移（对账注释②既有承诺，本锁成文）
    expect(submissions).toEqual([{ text: '', images: [refBlock(1)] }]);
  });

  it('手敲占位词面零误伤（暂存空不剥）：无图提交 `[图片]` 原文直通', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('[图片]\r');
    pump();
    expect(submissions).toEqual([{ text: '[图片]', images: [] }]); // 手敲文本非占位代理——原文不剥
  });

  it('seam 缺席 = 功能关：ctrl+v 不劫不炸，编辑器打字/提交零扰动', async () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('\x16');
    await flushMicrotasks();
    io.emitInput('hi\r');
    pump();
    expect(io.bytes).not.toContain('[图片]');
    expect(calls.submitted).toEqual([['s1', 'hi']]);
  });

  it('受理拒（ctrl+v 路 = 显式图片意图）：error 瞬时行呈报 + 稿面零占位', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => {
        throw new Error('当前模型不支持图片输入');
      },
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16');
    await flushMicrotasks();
    pump();
    expect(io.bytes).toContain('图片未附加'); // foldErrorText 折面回执（前缀断言——词面整句不断言）
    expect(io.bytes).not.toContain('[图片]'); // 受理拒零入稿
    io.emitInput('文字\r');
    pump();
    expect(submissions).toEqual([{ text: '文字', images: [] }]);
  });

  it('路径变体面（normalize_pasted_path）：bracketed paste 恰为在场图片绝对路径 → 转附件占位（路径文本不入稿）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-path-'));
    try {
      const file = join(dir, 'shot.png');
      writeFileSync(file, PNG_BYTES);
      const intakeCalls: ClipboardImagePayload[] = [];
      const submissions: PasteSubmission[] = [];
      const { io, pump } = makeInteractive({
        imageIntake: (images) => {
          intakeCalls.push(...images);
          return [refBlock(3)];
        },
        onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
      });
      io.emitInput(`\x1b[200~${file}\x1b[201~`);
      pump();
      expect(io.bytes).toContain('[图片]'); // 已转占位
      expect(io.bytes).not.toContain(file); // 路径文本不入稿
      io.emitInput('\r');
      pump();
      expect(intakeCalls).toEqual([{ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }]); // 受理缝收到文件载荷
      expect(submissions).toEqual([{ text: '', images: [refBlock(3)] }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('路径变体面：file:// URL 形同转（fileURLToPath 归一）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-path-'));
    try {
      const file = join(dir, 'shot.jpeg');
      writeFileSync(file, PNG_BYTES);
      const submissions: PasteSubmission[] = [];
      const { io, pump } = makeInteractive({
        imageIntake: () => [refBlock(4)],
        onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
      });
      io.emitInput(`\x1b[200~file://${file}\x1b[201~`);
      pump();
      expect(io.bytes).toContain('[图片]');
      io.emitInput('\r');
      pump();
      expect(submissions).toEqual([{ text: '', images: [refBlock(4)] }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('路径变体面拒形静默回退：缺席路径不转（原文本粘贴旧行为零漂移）', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      imageIntake: () => [refBlock(5)],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    const absent = join(tmpdir(), 'clip-absent-图', 'nope.png');
    io.emitInput(`\x1b[200~${absent}\x1b[201~`);
    pump();
    expect(io.bytes).not.toContain('[图片]');
    expect(io.bytes).toContain(absent); // 原文本入稿（旧行为）
    io.emitInput('\r');
    pump();
    expect(submissions).toEqual([{ text: absent, images: [] }]);
  });

  it('ask 应答窗让位（两路同判）：应答期 ctrl+v 与图片路径粘贴都归应答车道——占位零劫持', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-ask-'));
    try {
      const file = join(dir, 'ask.png');
      writeFileSync(file, PNG_BYTES);
      const { io, backend, pump } = makeInteractive({
        clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
        imageIntake: () => [refBlock(6)],
      });
      const asked = backend.input('哪个文件？');
      pump();
      io.emitInput('\x16'); // ctrl+v 应答期让位
      await flushMicrotasks();
      io.emitInput(`\x1b[200~${file}\x1b[201~`); // 路径粘贴应答期让位——路径文本本体就是应答
      pump();
      io.emitInput('\r');
      pump();
      await expect(asked).resolves.toBe(file); // 应答 = 路径原文（未被劫转附件）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('读链回执期 ask 竞窗（冷读闸 P3①——修前红）：挂起读期开应答窗 → 回执静默弃（应答稿零占位、暂存零污染后续稿）', async () => {
    const submissions: PasteSubmission[] = [];
    let resolveRead: ((payload: ClipboardImagePayload | null) => void) | undefined;
    const { io, backend, pump } = makeInteractive({
      // 手持回执（生产 2s 读窗内开 ask 的现实场景——run 期贴图应答「哪个文件？」）
      clipboardImageReader: () =>
        new Promise<ClipboardImagePayload | null>((resolve) => {
          resolveRead = resolve;
        }),
      imageIntake: () => [refBlock(9)],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // 触发挂起读（回执由测试手持——竞窗在飞位）
    const asked = backend.input('哪个文件？'); // 读在飞期开 ask 窗
    pump();
    resolveRead!({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' });
    await flushMicrotasks();
    pump();
    expect(io.bytes).not.toContain('[图片]'); // 回执竞窗静默弃——应答稿零占位污染
    io.emitInput('文字应答\r');
    pump();
    await expect(asked).resolves.toBe('文字应答'); // 应答原文干净（无字面占位）
    io.emitInput('后续稿\r'); // 暂存未入（弃在入栈前）——后续提交零陈图
    pump();
    expect(submissions).toEqual([{ text: '后续稿', images: [] }]);
  });

  it('每消息累积 4 图帽（冷读闸 P3②——修前红）：第 5 张 ctrl+v notify 拒 + 变体面超帽静默回退原文本（恰 4 图随行）', async () => {
    const submissions: PasteSubmission[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'clip-cap-'));
    try {
      const file = join(dir, 'over.png');
      writeFileSync(file, PNG_BYTES);
      const { io, pump } = makeInteractive({
        clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
        imageIntake: () => [refBlock(1)],
        onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
      });
      for (let i = 0; i < 4; i += 1) {
        io.emitInput('\x16');
        await flushMicrotasks();
      }
      pump();
      io.emitInput('\x16'); // 第 5 张——累积超帽（受理链单次调用帽拦不住的形）
      await flushMicrotasks();
      pump();
      expect(io.bytes).toContain('图片未附加'); // 显式意图拒形呈报（受理拒同姿态——前缀断言律）
      // 变体面超帽——静默回退原文本粘贴。粘贴体带前导换行：回退插入位在光标
      // （恰在第 4 条占位行尾），前导换行使路径独占新行——不与占位熔接成非独占
      // 行（熔接形不计占位、按取小律挂 3 图，另行合理非本测意图）。长路径接排
      // 在占位行后被视口折行，回退真值由提交侧断言。
      io.emitInput(`\x1b[200~\n${file}\x1b[201~`);
      pump();
      io.emitInput('\r');
      pump();
      // 四占位剥除 + 路径文本保留 + 恰 4 图随行（帽语义 = webui「每消息恒 ≤4」对齐）
      expect(submissions).toEqual([{ text: file, images: [refBlock(1), refBlock(1), refBlock(1), refBlock(1)] }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('win32 读链显式回执（56 轮件 1a——修前红：静默空集零回执）：seam 回词 → notify info + 读器零调用 + 零占位', async () => {
    // 修前红锚：win32 平台 planClipboardImageReads 空集 → reader() 微任务后归
    // null 四静默形——用户按键如泥牛入海；显式化后 spawn 前即知不支持，info
    // 回执词落屏（回执词真源 = CLIPBOARD_IMAGE_UNSUPPORTED_TEXT 常量单源）
    const reads: number[] = [];
    const { io, pump } = makeInteractive({
      // 桩缝回非 null 词（真值面 darwin 上不可达 win32 分支——seam 注入替真平台）
      clipboardImageUnsupportedReason: () => CLIPBOARD_IMAGE_UNSUPPORTED_TEXT,
      clipboardImageReader: async () => {
        reads.push(1); // 若被调用即败（不支持判定先于读链——零 spawn 零读）
        return { data: PNG_BYTES.toString('base64'), mimeType: 'image/png' };
      },
      imageIntake: () => [refBlock(1)],
    });
    io.emitInput('\x16');
    await flushMicrotasks();
    pump();
    expect(io.bytes).toContain(CLIPBOARD_IMAGE_UNSUPPORTED_TEXT); // info 级显式呈报（回执词面常量单源）
    expect(reads).toHaveLength(0); // 判定先于读链——读器零调用（不支持平台不起子进程）
    expect(io.bytes).not.toContain('[图片]'); // 零入稿
  });

  it('路径变体面 ~ 短写展开全链（56 轮件 1b——修前红：ENOENT 静默拒不转占位）：HOME 桩位真 PNG 转占位；缺席 ~ 路径回退原词面', async () => {
    // POSIX os.homedir 调时读 $HOME 现值——vi.stubEnv 桩主目录（测试跨平台零真 home 依赖）
    const dir = mkdtempSync(join(tmpdir(), 'clip-tilde-'));
    vi.stubEnv('HOME', dir);
    try {
      writeFileSync(join(dir, 'shot.png'), PNG_BYTES);
      const submissions: PasteSubmission[] = [];
      const { io, pump } = makeInteractive({
        imageIntake: () => [refBlock(8)],
        onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
      });
      io.emitInput('\x1b[200~~/shot.png\x1b[201~');
      pump();
      expect(io.bytes).toContain('[图片]'); // 修前红位：~ 不展开 → stat 缺席静默拒，原词入稿无占位
      io.emitInput('\r');
      pump();
      expect(submissions).toEqual([{ text: '', images: [refBlock(8)] }]);
      // 缺席形：展开后文件不在场 → 静默回退原文本粘贴（~ 原词零改写入稿）
      io.emitInput('\x1b[200~~/absent.png\x1b[201~');
      pump();
      io.emitInput('\r');
      pump();
      expect(submissions[1]).toEqual({ text: '~/absent.png', images: [] }); // 暂存首提交已清账——次提交零陈图
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('占位+斜杠命令混合稿（56 轮件 1d 现状锁）：本地命令腿——斜杠行按命令分诊终局 + 暂存图随命令形弃 + 清账不跨稿', async () => {
    const runs: string[] = [];
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock(1)],
      localCommands: [{ name: 'vim', description: '模态编辑开关（测试注入探针）', run: () => runs.push('vim') }],
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16'); // 贴图——占位行入稿
    await flushMicrotasks();
    io.emitInput('\n/vim\r'); // 混合稿：占位行 + 换行 + 斜杠行 → 提交
    pump();
    // 现状定谳（锁）：consumeStagedImages 先剥占位（净稿 '/vim'）→ 本地命令
    // 终局消费——命令本体执行；命令形吞稿路径图一并弃（onSubmit 零达——
    // 与 /exit 同律「命令不兜底进模型消息」，图随稿弃属可接受形）
    expect(runs).toEqual(['vim']);
    expect(submissions).toEqual([]);
    io.emitInput('后续稿\r'); // 暂存已清账——后续提交零陈图错挂
    pump();
    expect(submissions).toEqual([{ text: '后续稿', images: [] }]);
  });

  it('占位+斜杠命令混合稿（56 轮件 1d 现状锁）：未注册 / 词兜底腿——剥占位净稿随图上行（03 §2.2 兜底语义）', async () => {
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock(2)],
      dispatchCommand: async () => false, // 未注册词——通道命令柄不识，兜底进模型消息
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('\x16');
    await flushMicrotasks();
    io.emitInput('\n/unregistered\r');
    pump();
    await flushMicrotasks(); // dispatchCommand 异步 .then 续链（微任务界冲净）
    pump();
    // 现状定谳（锁）：兜底是模型消息形——图不弃（净稿 '/unregistered' + 图随行）
    expect(submissions).toEqual([{ text: '/unregistered', images: [refBlock(2)] }]);
  });

  it('占位+斜杠命令混合稿的等回声预置门净稿化（63 轮件 G——修前红：原始 line0 占位词面漏判斜杠 → awaitingEcho 误置、命令族零回声块无复位源 → 空态引导压到次键）', async () => {
    // 判据位与执法消费位同源（61 轮件 C 谱——本笔是该谱在回声预置面的对齐）：
    // 预置门斜杠判据须看剥占位后的净稿首行——与提交位 handleSubmit 同稿面
    // （consumeStagedImages 剥 `[图片]` 占位 → dispatchCommand 按净稿分发）。
    // 「[图片] + 换行 + /help」混合稿 enter 时刻原始 line0 是占位词面非斜杠，
    // 旧直判据此误置 awaitingEcho；命令族本地终局消费零用户块回声——抑制位
    // 无复位源（settle 需对话块 >0、非空稿键入才清），空态引导被压到次键。
    const dispatched: string[] = [];
    const { io, calls, pump } = makeInteractive(
      {
        clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
        imageIntake: () => [refBlock(11)],
        dispatchCommand: async (input) => {
          dispatched.push(input);
          return true; // 已注册并受理——本地终局消费（命令形吞稿零兜底）
        },
      },
      GUIDE_ROWS, // 14 行屏——转录区容得下 5 行空态引导（门控语义可观测形）
    );
    io.emitInput('\x16'); // ctrl+v → 图暂存 + [图片] 占位行入稿（空稿独占）
    await flushMicrotasks(); // 读器 promise 链回执
    io.emitInput('\n/help\r'); // 混合稿：占位行 + 换行 + 斜杠命令行 → 提交
    pump();
    expect(dispatched).toEqual(['/help']); // 命令按剥占位净稿分发（防空洞断言——提交确达命令柄）
    expect(calls.submitted).toEqual([]); // 受理形终局消费——不兜底进模型消息（/exit 同律）
    expect(io.bytes).toContain('输入消息开始对话'); // 修前红位：预置门未误置——命令清稿后引导即复现（非等回声窗）
  });

  it('提交入史净稿律（56 轮件 1e——修前红：占位词面原样入册）：↑ 召回回灌净稿无占位 + image-only 不入册 + 手敲零误伤', async () => {
    // 判据（重发即真值）：历史条目语义 = 可重发的真值稿——图不随史重建（暂存
    // 不入册），召回回灌若带字面 `[图片]` 行则重发时 resend 幻影占位文本（暂存
    // 空不剥 → 原文直通模型）。故有暂存时入史 = 剥占位净稿；无暂存恒等（手敲
    // 零误伤既有律不动）
    const records: string[] = [];
    const submissions: PasteSubmission[] = [];
    const { io, pump } = makeInteractive({
      clipboardImageReader: async () => ({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' }),
      imageIntake: () => [refBlock(3)],
      history: { seed: [], onRecord: (text) => records.push(text) },
      onSubmit: (_sessionId, text, _opts, images) => submissions.push({ text, images }),
    });
    io.emitInput('看这张');
    io.emitInput('\x16'); // 占位行随稿（raw 稿 = 看这张\n[图片]）
    await flushMicrotasks();
    io.emitInput('\r');
    pump();
    expect(submissions).toEqual([{ text: '看这张', images: [refBlock(3)] }]); // 提交流恒原稿剥占位（54D 既有）
    expect(records).toEqual(['看这张']); // 修前红位：镜像钩原样收「看这张\n[图片]」——净稿化后占位不入册
    io.bytes = '';
    io.emitInput('\x1b[A'); // ↑ 召回最近史目
    pump();
    expect(io.bytes).toContain('看这张'); // 回灌净稿在场
    expect(io.bytes).not.toContain('[图片]'); // 召回稿零占位残骸（重发即真值——无幻影占位文本）
    io.emitInput('\x1b[B'); // ↓ 回今态清框
    pump();
    io.emitInput('\x16'); // image-only 稿（占位独占）
    await flushMicrotasks();
    io.emitInput('\r');
    pump();
    expect(submissions[1]).toEqual({ text: '', images: [refBlock(3)] }); // image-only 合法提交（54D 既有）
    expect(records).toHaveLength(1); // 净稿空串不入册（空史目零意义——与 trim 空闸同语义）
    io.emitInput('[图片]\r'); // 手敲占位词面（暂存空——不剥不入史变换）
    pump();
    expect(records).toEqual(['看这张', '[图片]']); // 恒等入册（手敲文本非占位代理——54D 零误伤律延伸到史面）
  });
});

/* ================= TUI 模态编辑（39 池 P4·L——07 §4.1 R5 mode 域） ================= */

describe('TuiBackend 模态编辑（开关 / 指示词 / DECSCUSR / dd+yy+p 全链）', () => {
  /** DECSCUSR 序列（osc 件字节形真源的装配面消费锚） */
  const CURSOR_BAR = '\x1b[5 q';
  const CURSOR_BLOCK = '\x1b[2 q';
  const CURSOR_RESET = '\x1b[0 q';

  /** footer 注入形（行1 仪表槽可渲染——模态指示词的呈现位） */
  const footerRig = {
    footer: {
      tiers: () => ({ mode: 'Auto', thinking: null, sandbox: null, sandboxDanger: false }),
      cwdLabel: () => 'w',
    },
  };

  it('默认关零漂移锁：无指示词、零 DECSCUSR 字节、字素照入稿', () => {
    const { io, backend, calls, pump } = makeInteractive(footerRig);
    expect(backend.isModalEditing()).toBe(false);
    io.emitInput('x');
    pump();
    io.emitInput('\r'); // 提交取证——稿面 'x' 入册（零拦截的证据面）
    pump();
    expect(calls.submitted).toEqual([['s1', 'x']]);
    expect(io.bytes).not.toContain('-- 普通 --');
    expect(io.bytes).not.toContain('-- 插入 --');
    expect(io.bytes).not.toContain(CURSOR_BAR);
    expect(io.bytes).not.toContain(CURSOR_BLOCK);
  });

  it('开 = normal 态指示词 + SteadyBlock；i 进 insert 换词 + SteadyBar；esc 归 normal 换回', () => {
    const { io, backend, clock, pump } = makeInteractive(footerRig);
    backend.setModalEditing(true);
    pump();
    expect(io.bytes).toContain('-- 普通 --'); // 行1 第 2 位指示词
    expect(io.bytes).toContain(CURSOR_BLOCK); // normal = SteadyBlock
    io.emitInput('i');
    pump();
    expect(io.bytes).toContain('-- 插入 --');
    expect(io.bytes).toContain(CURSOR_BAR); // insert = SteadyBar
    io.emitInput('\x1b'); // 归 normal（lone-ESC 判定窗——escapePump 推进裁决）
    escapePump(clock);
    expect(io.bytes).toContain('-- 普通 --');
    expect(io.bytes).toContain(CURSOR_BLOCK);
    expect(io.bytes.match(/-- 普通 --/g)?.length).toBe(2); // 两度在场（开 + 归 normal）
  });

  it('pending 态指示词「-- 操作 --」+ 关闭复位缺省光标形', () => {
    const { io, backend, clock, pump } = makeInteractive(footerRig);
    backend.setModalEditing(true);
    io.emitInput('d'); // pending d（词面命令——非入稿）
    pump();
    expect(io.bytes).toContain('-- 操作 --'); // 指示词翻转（帧史含此前「普通」帧——词面区分态）
    io.emitInput('\x1b'); // 取消归 normal
    escapePump(clock);
    backend.setModalEditing(false); // 关——复位缺省光标形 + 指示词退役
    pump();
    expect(io.bytes).toContain(CURSOR_RESET);
    expect(backend.isModalEditing()).toBe(false);
  });

  it('dd + yy + p 全链（backend 集成）：normal 态命令编辑稿 + enter 提交携成稿', () => {
    const { io, backend, clock, calls, pump } = makeInteractive(footerRig);
    backend.setModalEditing(true);
    io.emitInput('i'); // 进 insert
    io.emitInput('aaa\nbbb'); // 两行稿（\n 走 ime 轨还是 text 轨均可入稿——换行入文）
    pump();
    io.emitInput('\x1b'); // 归 normal
    escapePump(clock);
    io.emitInput('gg'); // 跳首行
    io.emitInput('yy'); // 复制首行
    io.emitInput('p'); // 贴于行下
    pump();
    io.emitInput('\r'); // 提交
    pump();
    expect(calls.submitted).toEqual([['s1', 'aaa\naaa\nbbb']]); // 成稿全链（yy+p 行形贴）
  });

  it('normal 态拦截不夺既有键面：ctrl+c 生命线照旧打断', () => {
    const { io, backend, calls, pump } = makeInteractive(footerRig);
    backend.setModalEditing(true);
    io.emitInput('\x03'); // ctrl+c（normal 态在身）
    pump();
    expect(calls.interrupted).toEqual(['s1']); // 键路放行——生命线优先
  });

  // 冷读闸 P1 回归锁（ask 应答车模态悬置）：应答车复用主编辑器（路由层④
  // 无条件落 editor.handleEvent）——模态 normal 态会把应答文本吃成命令。
  // 修前红实录：'yy' 入 pending 起动词、'答' 词面外静默丢、enter 提交空稿
  // → resolve('')——审批/提问生命线失能。开窗悬置 + 空队退役复装两对称位。
  it('模态开启期 ask 应答车全链（修前红：P1 应答文本被 normal 态吃成命令）：悬置应答 + 退役复装', async () => {
    const { io, backend, calls, pump } = makeInteractive(footerRig);
    backend.setModalEditing(true);
    pump();
    const p = backend.input('补充？');
    pump();
    io.emitInput('yy'); // 修前红位：normal 态吃成 pending——悬置后是应答稿字符
    io.emitInput('答\r'); // 应答收场
    pump();
    await expect(p).resolves.toBe('yy答'); // 修前红：resolve('')
    expect(calls.submitted).toEqual([]); // 应答车独占——零模型提交
    // 退役复装：空队退役位恢复模态（fresh normal 态）——'o' 是开行命令非入稿
    io.emitInput('ozz'); // o 开行进 insert（'o' 被命令面吃）、zz 入稿
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([['s1', 'zz']]); // 修前红（未复装形）：'ozz' 字面入稿
  });

  it('模态悬置随 FIFO 接续窗续悬置：两问链中窗照常应答，队列真空才复装', async () => {
    const { io, backend, pump } = makeInteractive(footerRig);
    backend.setModalEditing(true);
    pump();
    const p1 = backend.input('一？');
    pump();
    const p2 = backend.input('二？'); // 在飞问在场——入队候接（模态已悬置）
    io.emitInput('甲\r');
    pump();
    await expect(p1).resolves.toBe('甲');
    // 接续窗激活续悬置（恢复位只在空队退役）——第二问应答照旧零拦截
    io.emitInput('dw乙\r'); // 'dw' 修前红位：接续窗若复装即入 pending——续悬置则是应答稿
    pump();
    await expect(p2).resolves.toBe('dw乙');
    expect(backend.isModalEditing()).toBe(true); // 队列真空退役——模态复装
  });

  it('模态关闭期 ask 零悬置账：开关本关时开窗/收场不误开模态（悬置旗零残留）', async () => {
    const { io, backend, pump } = makeInteractive(footerRig);
    const p = backend.input('三？'); // 模态从未开——悬置旗恒 false
    pump();
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答');
    expect(backend.isModalEditing()).toBe(false); // 退役位不误开（旗零残留）
  });
});
