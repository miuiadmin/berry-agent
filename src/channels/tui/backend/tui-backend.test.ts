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
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTerminalIO, ProcessTerminalIO } from '../../engine/index.js';
import { ansiColor, colorRgb, stringWidth } from '../../engine/index.js';
import { TuiBackend, type TuiBackendOptions } from './tui-backend.js';
import { LEADER_WINDOW_MS } from '../keys/leader.js';
import { buildSgr, SGR_RESET } from './ansi-rows.js';
import { builtinPalette, detectColorDepth, resolveTheme } from '../theme/index.js';
import { AltScreenHost } from '../overlay/alt-screen.js';
import { AUTOCOMPLETE_DEBOUNCE_MS } from '../autocomplete/async.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { MemoryViewerDataDeps } from '../memory/memory-viewer.js';
import type { AgentEvent } from '../../../agent/index.js';
import type {
  AgentMessage,
  AssistantMessage,
  JobEntry,
  UiCallLedgerEntry,
  UiRewindPreview,
  UiSessionSummary,
  UiUsageSummary,
} from '../../../contracts/index.js';
import { BaseError } from '../../../contracts/index.js';

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

function makeBackend(options: Partial<TuiBackendOptions> = {}): {
  io: MemoryTerminalIO;
  backend: TuiBackend;
} {
  const io = new MemoryTerminalIO(COLS, ROWS);
  const backend = new TuiBackend(io, options);
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
    expect(io.bytes).toContain('\x1b[>1u');
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
    expect(io.bytes).toContain('\x1b[1m定稿标题\x1b[0m'); // markdown 渲染（H1 bold）
  });

  it('流式帧字节帽超帽降档纯文本（批 10h R1 perf 护栏——streamFrameByteCap 注入面使触发路可测）', () => {
    // 小帽注入（3 单位）：单字帧不超帽（'• 甲' 3 > 3 假——注⑩ bullet 槽计入
    // 帧长）；带 markdown 帧字节远超 3
    // ——超帽帧本帧仍 markdown 直推（帧已落账不回改），present 后降档（弃 doc），
    // 次帧起流式正文纯文本直推
    const { io, backend } = makeBackend({ streamFrameByteCap: 3 });
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') }); // 1 字节不超帽
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题') });
    expect(io.bytes).toContain('\x1b[1m标题'); // 超帽帧本帧仍 markdown（H1 bold——降档不回改已落帧）
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题\n乙') });
    expect(io.bytes).toContain('# 标题'); // 降档纯文本：标题标记 '#' 原文在场（markdown 档会剥 # 走 bold）
    expect(io.bytes).not.toContain('\x1b[1m'); // 零 bold——流式 markdown 直推档已降
    // 对称面（缺省帽 256KB 生产定值不降档）：同序列次帧仍 markdown 直推——
    // '#' 剥除 + H1 bold 在场（与降档帧互为分辨形，缺省行为不变即锁）
    const ctl = makeBackend();
    emit(ctl.backend, { type: 'message_start', role: 'assistant' });
    emit(ctl.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') });
    ctl.io.bytes = '';
    emit(ctl.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题') });
    emit(ctl.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题\n乙') });
    expect(ctl.io.bytes).not.toContain('# 标题'); // '#' 被剥（H1 无标记原文）
    expect(ctl.io.bytes).toContain('\x1b[1m标题'); // markdown 直推档（H1 bold）
  });

  it('流式帧字节锁·块型族（B4——H1 例之外的闭栏代码块/表格/CJK 三形；固定注入文本非 AI 生成物）', () => {
    // 语义键 SGR 期望值按装配真源现算（dark@16 缺省档——与 rig 零 colorEnv 注入
    // 对齐）：codeKeyword→ANSI 9 / codeNumber→ANSI 12 / tableRule→ANSI 8。
    const darkTheme = resolveTheme(builtinPalette('dark'), detectColorDepth({}));
    const kwSgr = buildSgr({ fg: darkTheme.codeKeyword });
    const numSgr = buildSgr({ fg: darkTheme.codeNumber });
    const ruleSgr = buildSgr({ fg: darkTheme.tableRule });

    // 形一：闭栏代码块流式帧含高亮 SGR（闭栏才高亮——流式防闪烁律；keyword
    // 与 number 两语义键段 + 代码栏 '│ ' 前缀同帧在场；markdown 批闭栏收口形
    // 随迁——前缀独立 dim 段 [2m│ [0m，闭合脚注 └─ ts 同帧）
    const code = makeBackend();
    emit(code.backend, { type: 'message_start', role: 'assistant' });
    emit(code.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') });
    code.io.bytes = '';
    emit(code.backend, {
      type: 'message_update',
      role: 'assistant',
      partial: assistantMsg('甲\n```ts\nconst x = 1;\n```'),
    });
    expect(code.io.bytes).toContain(
      `${buildSgr({ dim: true })}│ ${SGR_RESET}${kwSgr}const${SGR_RESET} x = ${numSgr}1${SGR_RESET};`,
    );

    // 形二：GFM 表格流式帧含双线定界（V-3 注⑨④——表头 ━ 重线整段线色键；
    // 全框形退役：├ ┼ 交点符零在场）
    const table = makeBackend();
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
    // ≤ 屏宽帽（截半即越帽 autowrap 或残宽）+ 折行拼接还原全文（半字即断链）
    const cjkText = '中文测试'.repeat(30); // 120 字素 × 宽 2 = 240 列——80 列屏折 3 行
    const cjk = makeBackend();
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
    expect(io.bytes).toContain('重试中 第 1/3 次'); // 退避窗在场（态③）
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
    expect(io.bytes).toContain('⚙ 搜索文本 …');
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 'tc1', result: {} as never });
    expect(io.bytes).not.toContain('⚙ 搜索文本');
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
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '内容', timestamp: 1 } });
    io.columns = 40;
    io.rows = 6;
    io.bytes = '';
    io.emitResize();
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\x1b[1;3r'); // 6 行 - 固定区 2（状态 1 + 编辑器 1——V-0 注③ 框退役）- R-1 间隔 1 = DECSTBM 1..3
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m内容\n'); // 行集重画
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
    const { io, backend } = makeBackend();
    backend.notify('已续接：e2ehist');
    io.bytes = '';
    io.emitResize();
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

  it('overlay 占焦期编辑器非聚焦：› 无 accent + 光标回退屏底', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('a');
    pump(); // 有变更才有帧——差分只重写内容行：聚焦 accent › 提示符在场
    expect(io.bytes).toContain('\x1b[36m›');
    const p = backend.confirm('占焦？');
    io.bytes = '';
    pump();
    expect(io.bytes).not.toContain('\x1b[36m›'); // 非聚焦 › 降档 secondary（面板标题 accent 是文本段不撞提示符）
    expect(io.bytes.endsWith('\x1b[10;1H')).toBe(true); // 无光标声明回退屏底
    io.emitInput('\r');
    io.bytes = '';
    pump();
    await expect(p).resolves.toBe(true);
    expect(io.bytes).toContain('\x1b[36m›'); // 层关复聚焦——accent › 回归（V-0 注③ 框退役）
  });
});

// —— 应答段底部迁移（2026-10-08 TUI 对标 Codex 五件批 D 件——07 §4.3 呈现位
// 翻档 + V-3 注⑦ ⑤ 底栈扩段对端注）：审批/confirm/select 面板与 input-ask
// 提示行自固定区顶部段迁编辑器下方**应答段**（编辑器 → ask 行 → 面板栈 →
// 工具进度 → footer → JobPanel——紧邻 footer 族与子 Agent 同区域）；占焦模态
// 律/键路由/排队 FIFO 零变化（呈现位迁移非交互语义迁移）；补全弹层维持编辑器
// 上方弹出位（规范明文不迁）。
describe('TuiBackend 应答段底部迁移（07 §4.3 呈现位翻档——面板/ask 行居编辑器下方）', () => {
  /**
   * 屏上行序取证（行序断言辅助）：差分帧序 ≠ 屏上行序（增量帧只重写变更
   * 行、帧间先来后到由事件序决定）——emitResize 触发 renderFixed 全量重画
   * 帧，帧内文本序即屏上行序；取末帧做 indexOf 比较才忠实锁「谁在上谁在
   * 下」。
   */
  const lastFullFrame = (io: { frames: readonly string[]; emitResize(): void }): string => {
    io.emitResize(); // handleResize 同步直呼（不走 schedule）——clear + 全量重画帧即时落账
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

  it('confirm 面板呈现于编辑器下方（修前红：屏顶浮层先于编辑器）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('a');
    pump(); // 聚焦 › 在场——首帧全量铺屏
    const p = backend.confirm('下方确认？');
    pump();
    const frame = lastFullFrame(io);
    const prompt = frame.indexOf('›');
    const panel = frame.indexOf('下方确认');
    expect(prompt).toBeGreaterThanOrEqual(0); // 编辑器在屏（全量帧含 ›）
    expect(panel).toBeGreaterThanOrEqual(0); // 面板在场
    expect(prompt).toBeLessThan(panel); // 修前红：屏顶浮层——面板行先于编辑器行
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe(true);
  });

  it('askApproval 面板呈现于编辑器下方（修前红：屏顶）', async () => {
    const { io, backend, pump } = makeInteractive(undefined, 14); // 审批面板 5 行并陈需高窗
    io.emitInput('a');
    pump();
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    const frame = lastFullFrame(io);
    expect(frame.indexOf('›')).toBeGreaterThanOrEqual(0);
    expect(frame.indexOf('⚙ 写入文件')).toBeGreaterThanOrEqual(0); // 面板标题（V-0 注⑤动词位）
    expect(frame.indexOf('›')).toBeLessThan(frame.indexOf('⚙ 写入文件')); // 修前红
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('approve');
  });

  it('input-ask 提示行迁编辑器下方（修前红：编辑器上方段）', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('a');
    pump();
    const p = backend.input('下方问？');
    pump();
    const frame = lastFullFrame(io);
    expect(frame.indexOf('›')).toBeGreaterThanOrEqual(0);
    expect(frame.indexOf('? 下方问？')).toBeGreaterThanOrEqual(0); // 提示行在场
    expect(frame.indexOf('›')).toBeLessThan(frame.indexOf('? 下方问？')); // 修前红
    io.emitInput('答\r');
    pump();
    await expect(p).resolves.toBe('答');
  });

  it('补全弹层维持编辑器上方弹出位（回归锁——规范明文不迁）', () => {
    // 自含 rig（autocompleteRig 系他 describe 块内函数不达——同形自建）
    const { io, clock } = makeInteractive({
      autocomplete: {
        commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
      },
    });
    io.emitInput('/he');
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1); // 防抖窗到——查询落层弹层在场
    const frame = lastFullFrame(io);
    // 编辑器行锚 = 聚焦 › 提示符转义形（› + 空格 + reset）——弹层 label 行
    // 自带 › 前缀但无空格分隔（› 直随 reset+反白），裸 › 与「› /he」纯文本形
    // 均不可锚；弹层非模态不占焦——编辑器恒聚焦 accent 形在场
    const editorRow = frame.indexOf('\x1b[36m› \x1b[0m');
    expect(frame.indexOf('帮助')).toBeGreaterThanOrEqual(0);
    expect(editorRow).toBeGreaterThanOrEqual(0);
    expect(frame.indexOf('帮助')).toBeLessThan(editorRow); // 弹层行在编辑器行上方
  });
});

describe('TuiBackend ask 撤销说明行（07 §4.3 撤销面——曾在屏者 ⏹ 行 + 迟到 abort 不误写）', () => {
  it('confirm：abort → false + 撤销说明行；面板已 done 后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    // 路一：外部 abort 传播到时层仍在屏——说明行入正文流
    const ac1 = new AbortController();
    const p1 = backend.confirm('一？', { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe(false); // 保守值
    pump();
    expect(io.bytes).toContain('\r⏹ 已取消确认\n'); // 撤销说明行（瞬时行形态）

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

  it('select：abort → 空串 + 撤销说明行；已选定后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    const choices = [{ value: 'a', label: '甲' }];
    const ac1 = new AbortController();
    const p1 = backend.select('选', choices, { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe('');
    pump();
    expect(io.bytes).toContain('\r⏹ 已取消选择\n');

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

  it('input：abort → 空串 + 撤销说明行；inputAsk 已换（应答收场）后迟到 abort 不误写', async () => {
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
    expect(io.bytes).toContain('\r⏹ 已取消提问\n');
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
    rig.io.emitResize(); // 权威清点路（handleResize）
    rig.pump();
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
    expect(io.bytes).toContain('⚙ 搜索文本 …');
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
const MAIN_LEAVE = '\x1b[<u\x1b[?2004l';
const MAIN_ENTER = '\x1b[?2004h\x1b[>1u\x1b[?u\x1b[c';
/** 副屏 Engine 进出屏字节（集成测试序锚） */
const ALT_ENTER = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[>1u\x1b[?u\x1b[c\x1b[?1002h\x1b[?1006h'; // 鼠标准入尾随（mu-2）
const ALT_LEAVE = '\x1b[?1006l\x1b[?1002l\x1b[<u\x1b[?2004l\x1b[?25h\x1b[?1049l'; // 鼠标关停前置（对称反序）

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
    const { io } = makeBackend();
    expect(io.bytes).not.toContain('\x1b]11;?'); // 无 OSC 11 查询
    expect(io.bytes).not.toContain('\x1b[?2031h'); // 无明暗变化订阅
    expect(io.bytes).toContain('\x1b[36m'); // accent ANSI 6 cyan（编辑器 › 提示符载体——V-0 注③）
  });

  it('auto 档 start：OSC 11 查询 + 2031 订阅两写点', () => {
    const { io } = makeBackend({ theme: 'auto' });
    expect(io.bytes).toContain('\x1b]11;?\x07');
    expect(io.bytes).toContain('\x1b[?2031h');
  });

  it('auto 亮底应答换装：accent 翻 ANSI 4（SGR 34）固定区重画', () => {
    const { io } = makeBackend({ theme: 'auto' });
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 白底应答（同步直出——换装即时落帧）
    expect(io.bytes).toContain('\x1b[34m'); // light accent ANSI 4 blue
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
    expect(tc.io.bytes).toContain('\x1b[48;2;32;32;32m'); // 主红锚：新带传导（删比对腿则陈值 20 在场）
    expect(tc.io.bytes).not.toContain('\x1b[48;2;20;20;20m'); // 陈带退场
    tc.io.bytes = '';
    tc.io.emitInput('\x1b]11;rgb:0d11/0d11/0d11\x07'); // 同值冗余应答——三键恒等零重画
    expect(tc.io.bytes).toBe('');
  });

  it('auto 暗底应答迟到照常换装（无钟不设窗——2031 通知语义等价）', () => {
    const { io } = makeBackend({ theme: 'auto' });
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
      keybindings: { 'thinking.toggle': 'ctrl+g', 'no.such-action': 'ctrl+z' },
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
    io.reset();
    return { io, backend, calls };
  }

  it('openThemes 编舞：主屏出屏 → 副屏进 → 主题首帧（计数头 + 当前档标记 + 坏文件 ⚠）', () => {
    const { io, backend } = rig();
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
    io.reset();
    backend.setThemeChoice('light', null);
    expect(io.bytes).toContain('\x1b[34m');
    expect(io.bytes).not.toContain('\x1b[36m');
  });

  it('自定义档运行时切档：覆盖表随装 + 探测开（customOverlay 即探测档）', () => {
    const { io, backend } = rig(); // dark 显式基线
    io.reset();
    backend.setThemeChoice('my-theme', { accent: ansiColor(3) });
    expect(io.bytes).toContain('\x1b[33m'); // 覆盖键生效（accent → ANSI 3 yellow）
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
    expect(io.bytes).toContain('\x1b[33m'); // 构造期：dark 基板 + 覆盖 accent 3
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
    const { io } = makeBackend({
      sessionId: SESSION,
      theme: 'custom-x',
      customThemeOverlay: { secondary: ansiColor(5) }, // 覆盖非 accent 键
    });
    expect(io.bytes).toContain('\x1b[36m'); // 构造期：dark 基板 accent 6
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
    expect(io.bytes).toContain('上下文 996 / 1 M · 0%'); // 真值三件套（K/M 单源——<1K 原值）
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好世界') }); // 估值 +4
    expect(io.bytes).toContain('上下文 1 K / 1 M · 0%'); // 流中平滑：996 + 4 → 1000 → '1 K'
    // 平滑帧晚于 agent_start 间隙帧（turn 边界 settled 996 = 合法中间态——上下文
    // 会话级量跨 run 幸存；判据 = 终态帧序非全程缺席）
    expect(io.bytes.lastIndexOf('上下文 1 K / 1 M · 0%')).toBeGreaterThan(io.bytes.lastIndexOf('上下文 996'));
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
    expect(io.bytes).toContain('上下文 996 / 1 M · 0%'); // settled 纯值（<1K 原值直读）
    expect(io.bytes).not.toContain('上下文 1 K'); // 双计形缺席（996 + 40/50 估值残值 → 1036/1046 → '1 K'——关窗失效形）
  });

  it('context_usage 双可选缺席 = 未知不显示（E-4 事件型语义——诚实缩位）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION, footer: { modelLabel: 'm', cwdLabel: () => 'w' } });
    emit(backend, { type: 'context_usage' });
    expect(io.bytes).not.toContain('上下文');
    emit(backend, { type: 'context_usage', usedTokens: 12_345 }); // maxTokens 缺席 = 二件套（无帽无百分比）
    expect(io.bytes).toContain('上下文 12 K');
    expect(io.bytes).not.toContain(' · 0%');
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
    // 取证走 resize 全量重画帧：持旧值与上帧同内容——增量帧零写出不可断（零
    // 写出 ≠ 显示持旧），全量帧显示值整帧可见
    io.emitResize();
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
    expect(line).toContain('Auto · 思考高 · glm-4.7 · 累计 500 · 50 tok/s · 上下文 1 K / 1 M · 0%');
    // 各槽锚词相对位置严格右移（缺席 indexOf -1 即红——判别锚：调换速度/上下文 push 序本断言红）
    let at = -1;
    for (const anchor of ['Auto', '思考高', 'glm-4.7', '累计 500', '50 tok/s', '上下文 1 K / 1 M · 0%']) {
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
    expect(io.bytes).toContain('回复进行中——输入仍可用：Enter 追加 / Alt+Enter 排队后继'); // 忙态空稿——busy 文案在场（修前红：忙态退场零文案）
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
    expect(io.bytes).toContain('思考中');
    io.reset();
    tiers = { mode: 'YOLO', thinking: '思考高', sandbox: '无沙箱' };
    backend.refreshFooter(); // 公开刷新面（批B——档位切换点即时刷）
    expect(io.bytes).toContain('YOLO · 思考高');
    expect(io.bytes).toContain('无沙箱'); // 行2 沙箱原词同刷
    expect(io.bytes).not.toContain('思考中');
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
    expect(io.bytes).toContain('⚙ 搜索文本 … · 本轮 50'); // 工具段后拼本轮段（' · ' 连接）
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

  it('arm 入态 + 待续提示在场；三分支字母命中即消费（字母不入稿——吞字锁）', () => {
    const { io, calls, branches, pump } = leaderRig();
    io.emitInput('\x18'); // ctrl+x——五闸全开（空稿闲态无浮层）入待续态
    pump();
    expect(io.bytes).toContain('Ctrl+X 已按 · b 任务 · m 模型 · h 帮助'); // 待续提示（footer 教学位）
    io.bytes = '';
    io.emitInput('b'); // 分支字母——text 路拦截
    pump();
    expect(branches).toEqual(['jobs']); // 分发命中
    expect(io.bytes).not.toContain('b'); // 修前红锚：字母不入稿（提示/稿面零裸 b——b 被分支消费）
    io.emitInput('\r'); // 空稿提交零动作——证稿恒空
    pump();
    expect(calls.submitted).toEqual([]);
    // m / h 两分支同形（各自重新 arm）
    io.emitInput('\x18');
    pump();
    io.emitInput('m');
    pump();
    io.emitInput('\x18');
    pump();
    io.emitInput('h');
    pump();
    expect(branches).toEqual(['jobs', 'model', 'help']);
  });

  it('非匹配字母解除 + 透传入稿（吞零键）；提示随解除退场', () => {
    const { io, branches, pump } = leaderRig();
    io.emitInput('\x18');
    pump();
    io.bytes = '';
    io.emitInput('c'); // 非分支字母——解除 + 透传
    pump();
    expect(branches).toEqual([]); // 零分发
    expect(io.bytes).toContain('c'); // 入稿（透传不吞）
    expect(io.bytes).not.toContain('Ctrl+X 已按'); // 提示退场（ disarm 对账）
    io.emitInput('b'); // 待续态已解除——后续 b 是普通字符
    pump();
    expect(branches).toEqual([]); // 无迟到分发
    expect(io.bytes).toContain('cb'); // 连缀成稿
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
    expect(io.bytes).toContain('回复进行中'); // 分支解除后提示位归忙态（正向对照——busy 文案并非不可达）
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

describe('TuiBackend 固定区段优先级截断（07 §4.1 挂账解挂批 C②——极小终端固定区溢出）', () => {
  /** 极小形载荷：8 条 todo（量高 7 = 帽 6 + 溢出行）+ footer 注入（状态行常驻段可观测） */
  const manyTodos = Array.from({ length: 8 }, (_, i) => ({ status: 'pending' as const, content: `任务零${i}` }));

  it('rows 缩至 5：低段（todo）先缩至 1 行——状态行钉屏底 + 编辑器下限在场 + 无越屏定位（V-0 注③ 框退役释放 2 行预算——整段隐形上移更小屏）', () => {
    const io = new MemoryTerminalIO(COLS, 12); // 先宽后窄：宽形（12 行）无截断全量进画，让 todo 7 行先进场
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: '只读' }) },
      todoFor: () => manyTodos,
    });
    backend.start();
    // todo 进场锚点：tool_execution_end（refreshTodo 三时点之二——tool 未开档 end 无行，纯 todo 形）
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    io.bytes = ''; // 宽形中间帧不计——聚焦缩窗后的全量重画帧
    io.rows = 5;
    io.emitResize(); // 极小形：截断目标 = 固定区总高 ≤ 视口 - 1 = 4（正文滚动区至少 1 行）
    // 截断后固定区 = todo 1 + 编辑器下限 1 + 状态行 2 = 4（V-4 注⑪ 笔3 三行栈——
    // env 在场量高 2：仪表行空保留 + 环境行短 id/沙箱原词；框退役后编辑器省
    // 2 行——低段从「整段隐」升为「缩 1 行」；段内梯缩至首条摘要行）
    // 状态行恒保底且钉屏底（注⑪①——环境行 = 最底行；secondary 弱化 SGR）
    expect(io.bytes).toContain('\x1b[5;1H\x1b[0m\x1b[90msess-aaa · 只读'); // 钉屏底（1 基第 5 行——环境行短 id 起）
    expect(io.bytes).toContain('\x1b[3;1H\x1b[0m\x1b[36m›'); // composer 输入行（1 基第 3 行——状态 2 行上移）
    expect(io.bytes).toContain('任务零0'); // 低段缩至首条在场——段不虚报缺席
    expect(io.bytes).not.toContain('任务零1'); // 缩掉的不虚报（修前 7 行全量进画）
    expect(io.bytes).not.toContain('\x1b[6;1H'); // 无越屏定位（修前固定区 11 行越 5 行屏）
  });

  it('rows 缩至 8：低段先缩不隐——todo 收到 1 行 + 正文滚动区非退化', () => {
    const io = new MemoryTerminalIO(COLS, 12); // 同上先宽（12 行全量 11 ≤ 预算 11 无截断）后窄
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: { tiers: () => ({ mode: null, thinking: null, sandbox: '只读' }) },
      todoFor: () => manyTodos,
    });
    backend.start();
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    io.bytes = '';
    io.rows = 8;
    io.emitResize(); // 预算 7：todo 缩 1 + 编辑器 1 + 状态行 2 = 4 ≤ 7——「先缩后隐」之缩形
    expect(io.bytes).toContain('任务零0'); // todo 缩到 1 行——首条在场（段在场）
    expect(io.bytes).not.toContain('任务零1'); // 缩掉的不虚报（修前 6 条全量进画）
    // 固定区总高 4（V-0 注③ 框退役编辑器 1 + V-4 注⑪ 状态行 2）→ 滚动区底 = 8 - 4 - R-1 间隔 1 = 3（修前总高 11 → 退化 [1;1r + 越屏定位）
    expect(io.bytes).toContain('\x1b[1;3r');
    expect(io.bytes).not.toContain('\x1b[9;1H'); // 无越屏定位（修前写到第 11 行）
  });

  it('【sweep23-件1 修前红→回归锁】长稿极小视口收缩目标夹帽：垫行不借道内容地板保位——固定区不超屏（修前陈货守卫整段不写）', () => {
    const io = new MemoryTerminalIO(COLS, 7); // 编辑器帽 = max(5, floor(7×0.3)) = 5
    const backend = new TuiBackend(io, { sessionId: SESSION });
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
    expect(io.bytes).toContain('↑ 5 更多'); // 编辑器在场 + 内容窗恰帽内 5 行（修前：整段缺席）
    expect(io.bytes).toContain('\x1b[1;1r'); // 滚动区 1 行非退化（固定区 6 = 编辑器 5 + 状态 1 ≤ 预算 6）
  });
});

/* ================= TUI 第四役 fx2（后端组——复起补吐/视口帽/残影/死路双清/复起附件） ================= */

/**
 * 剥 ANSI 序列后的显示宽（fx2-A 断言锚）：SGR/OSC 零宽（终端把 ESC 序列当
 * 控制不占列）——与物理行落屏宽同算术。CSI 参数/中间字节类含 <>=（kitty
 * 键盘推栈 \x1b[>1u 等私营形零宽同剥）。
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
    // ❯→› 图标收敛批：光标记号独立 accent 段（› 与反白正文分属两个 SGR 段）
    expect(finalWindow).toContain('\x1b[7;36m›\x1b[0m\x1b[7m opt-20'); // 高亮末项——光标移动且窗沉底跟随
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
    expect(io.bytes).toContain('\x1b[7;36m›\x1b[0m\x1b[7m opt-3'); // 高亮随键可见（› 反白段——图标收敛批形）
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
    expect(io.bytes).not.toContain('已取消提问'); // 从未上屏——不落撤销说明行
    expect(io.bytes).toContain('? 第一问'); // 队首不受扰
    io.bytes = ''; // 清零——后续只认取消帧增量
    ac1.abort(); // 队首 abort——激活态撤销面 + 第三问晋升接续
    pump();
    await expect(p1).resolves.toBe('');
    expect(io.bytes).toContain('已取消提问'); // 撤销说明行（曾在屏者——07 §4.3 撤销面）
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
    expect(io.bytes).toContain('正在对话中'); // 态① 基础文案
    expect(io.bytes).toContain('按 ESC 取消对话'); // keyText('global.interrupt') 首键 escape → ESC 显示单源
    expect(io.bytes).toContain('\x1b[1;2r'); // 10 行 - 固定区 7（任务行 1 + 编辑器 5〔上垫 1+呈现 3+下垫 1〕+ 状态行 1——五件批 A+B）- R-1 间隔 1
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('正在对话中'); // 闲态零高度缺席（忙态呈现不驻留）
    expect(io.bytes).toContain('\x1b[1;3r'); // 固定区回 6 行（任务行退役→编辑器 5+状态 1）——高度变更滚动区重设（10-6-1=R-1 间隔）
  });

  it('态② 细分（V-4 注⑪⑦）：message_start → 「思考中」；尾块分诊 thinking/text → 思考中/生成中；message_end 归态①', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'message_start', role: 'assistant' });
    expect(io.bytes).toContain('思考中'); // 起跑缺省思考中（首 update 分诊纠正——零空窗）
    io.bytes = '';
    // thinking 尾块在场 → 思考中（词面维持——同词零重绘）
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['先想想'], []),
    });
    expect(io.bytes).toContain('思考中');
    io.bytes = '';
    // text 尾块到达 → 生成中（词面迁移一次）
    emit(backend, {
      type: 'message_update',
      role: 'assistant',
      partial: mixedSnapshot(['先想想'], ['你好']),
    });
    expect(io.bytes).toContain('生成中');
    io.bytes = '';
    emit(backend, { type: 'message_end', message: assistantMsg('答') });
    expect(io.bytes).toContain('正在对话中'); // 流式窗关归态①
  });

  it('本轮 N 边跑边涨 + 真值校正（估值器 ⑥c 供数——message_update 差分累计 / message_end onSettled）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_start', role: 'assistant' });
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('你') });
    expect(io.bytes).toContain('本轮 1'); // CJK 1 token/字（首快照全量）
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好世界') });
    expect(io.bytes).toContain('本轮 4'); // 差分 +3（非重算形）
    io.bytes = '';
    // message_end 真值校正：output = 50 顶替估值（单次收敛）
    emit(backend, { type: 'message_end', message: usageMsg(100) });
    expect(io.bytes).toContain('本轮 50');
    io.bytes = '';
    // 下一 turn 起跑：reset 重建基线（agent_start fresh 清账 + message_start 复位）
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('新') });
    expect(io.bytes).toContain('本轮 1'); // 前轮账已清——差分从零重计
  });

  it('态③ 重试倒计时：retry_wait_start → 「重试中 第 n/N 次 · Ns 后」+ 转轮持续推帧', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'retry_wait_start', attempt: 2, maxAttempts: 3, nextAt: Date.now() + 3_000 });
    expect(io.bytes).toContain('重试中 第 2/3 次 · 3s 后'); // 绝对时刻 → 本地钟现算倒计时
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
    expect(io.bytes).toContain('正在对话中');
    expect(io.bytes).not.toContain('✗ 失败');
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
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 30_000 });
    // weakRule = round(fg×0.2 + bg×0.8) 逐通道 = (56,61,67) = #383d43——修前红：旧形恒 DIM 直拼
    expect(io.bytes).toContain(`${buildSgr({ fg: colorRgb('#383d43') })}── 用时 30s · 工具 1 次 ──${SGR_RESET}`);
    expect(io.bytes).not.toContain(`${buildSgr({ dim: true })}── 用时`);
  });

  it('时长门废：<60s 短 run 也呈耗时段（V-0 注⑥——不设 ≤60s 门）', () => {
    let t = 0;
    const { io, backend } = makeBackend({ now: () => t });
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    t += 30_000;
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 30_000 });
    expect(io.bytes).toContain('── 用时 30s · 工具 1 次 ──'); // 修前红：旧形 <60s 省时段只呈时刻
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
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 30_000 });
    expect(io.bytes).toContain('── 用时 30s · 重试 1 ──'); // 修前红：旧形纯对话轮判据只看工具——重试独场整行缺席
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
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 45_000 });
    // 修前红：'── 用时 45s · 工具 1 次 · 重试 1 ──'（整 run 口径词面冒充）
    expect(io.bytes).toContain('工具 1 次（自本次接入起算）');
    expect(io.bytes).toContain('重试 1（自本次接入起算）');
    expect(io.bytes).not.toContain('── 用时 45s · 工具 1 次 · 重试 1 ──'); // 修前红锚位（无注整段词面）
    // 耗时段不加注维持（durationMs 载荷在场即服务端整 run 真值——口径分立）
    expect(io.bytes).toContain('用时 45s ·');
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
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 45_000 });
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
    emit(backend, { type: 'agent_end', status: 'completed', durationMs: 30_000 });
    expect(io.bytes).toContain('── 用时 30s · 工具 1 次 ──'); // 完整观察整 run 口径
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

describe('TuiBackend 排队常驻面板（2026-10-05 ZCode TUI 对标批——07 §4.1 装配向接线排队常驻面板翻档注）', () => {
  it('入列可见：帧首拉取「已排队 N：首条预览 +M」折叠计数形（N≥2）', () => {
    const { io } = makeBackend({ sessionId: SESSION, queueFor: () => ['修复登录跳转', '补测试'] });
    expect(io.bytes).toContain('已排队 2：修复登录跳转 +1'); // N≥2 折叠计数形（+M = N-1）
  });

  it('单件形无折叠段（N=1——首条预览后零「+M」尾巴不虚报）', () => {
    const { io } = makeBackend({ sessionId: SESSION, queueFor: () => ['修复登录跳转'] });
    expect(io.bytes).toContain('已排队 1：修复登录跳转');
    expect(stripAnsi(io.bytes)).not.toContain('修复登录跳转 +'); // 单件零折叠段
  });

  it('消费移除 / 清空退场：帧锚重拉——计数收敛、队列归零即段退场（零高度）', () => {
    const queue: string[] = ['修复登录跳转', '补测试'];
    const { io, backend } = makeBackend({ sessionId: SESSION, queueFor: () => queue });
    expect(io.bytes).toContain('已排队 2：修复登录跳转 +1');
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
});
