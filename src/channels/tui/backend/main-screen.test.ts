/**
 * MainScreen 主屏编舞测试（批 10e-1——MemoryTerminalIO 收帧断言）。
 *
 * 几何：80 列 × 10 行、固定区高 2 → 滚动区 DECSTBM 1..8（0 基行 0..7）、
 * 固定区钉行 8..9。断言收帧字节序（定位序列 + 内容行 + EL 擦除）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, MemoryTerminalIO, sanitizeDisplayText, stringWidth } from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import type { TranscriptBlock } from './transcript.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { DEFAULT_THEME } from '../theme/index.js';

const COLS = 80;
const ROWS = 10;
const FIXED = 2;

function makeScreen(): { io: MemoryTerminalIO; screen: MainScreen } {
  const io = new MemoryTerminalIO(COLS, ROWS);
  return { io, screen: new MainScreen(io, { fixedHeight: FIXED }) };
}

/** 用户块（单行文本——不触折行路径的基元形态） */
const userBlock = (text: string): TranscriptBlock => ({ kind: 'user', text });
/** 流式槽块（epoch 恒 1 同槽；doc = null 纯文本降档形——字节期望不随高亮抖动；思考面缺席位 = 零思考槽形） */
const slotBlock = (text: string): TranscriptBlock => ({
  kind: 'streaming',
  epoch: 1,
  text,
  doc: null,
  thinking: '',
  thinkingDoc: null,
  thinkingSettled: false,
  thinkingExpanded: false,
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+t',
});

/** 固定区网格（两行占位——差分路径行走用） */
function fixedGrid(text: string): CellGrid {
  const grid = new CellGrid(COLS, FIXED);
  grid.writeText(0, 0, text);
  return grid;
}

describe('MainScreen 启动与基础编舞', () => {
  it('start：清屏 + 滚动区确立 + 光标归固定区末行', () => {
    const { io, screen } = makeScreen();
    screen.start();
    expect(io.bytes).toBe('\x1b[2J\x1b[H' + '\x1b[1;8r' + '\x1b[10;1H');
  });

  it('首块直写：CUU 归追加位 + CR 行内容 LF 推进 + 光标归位', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([userBlock('你好')]);
    // 追加位 = 行 0（光标从行 9 上移 9）→ 写行 → 光标归固定区末行
    expect(io.bytes).toBe('\x1b[9A' + '\r> 你好\n' + '\x1b[10;1H');
  });

  it('增量追加：第二块从 durable 末起笔（CUU 距离随账推进）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('第一')]);
    io.bytes = '';
    screen.present([userBlock('第一'), userBlock('第二')]);
    expect(io.bytes).toBe('\x1b[8A' + '\r> 第二\n' + '\x1b[10;1H');
  });

  it('user 块折行续挂对齐（续行两空格前缀）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    // 宽 78 列（80 - 前缀 2）：恰 20 个汉字 40 列 ×2 行
    screen.present([userBlock('一'.repeat(45))]);
    expect(io.bytes).toContain('\r> ' + '一'.repeat(39) + '\n');
    expect(io.bytes).toContain('\n\r  ' + '一'.repeat(6) + '\n');
  });

  it('⚙ / ↳ 简行块 dim 包裹', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([
      { kind: 'tool-call', name: 'read', brief: '(path)' },
      { kind: 'tool-result', brief: '命中 3 处' },
    ]);
    expect(io.bytes).toContain('\r\x1b[2m ⚙ read(path)\x1b[0m\n');
    expect(io.bytes).toContain('\r\x1b[2m ↳ 命中 3 处\x1b[0m\n');
  });

  it('markdown 块经 CellGrid 渲染（标题 bold + 尾线）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of('# 标题') }]);
    expect(io.bytes).toContain('\x1b[1m标题\x1b[0m'); // 标题行 bold 游程贯通
    expect(io.bytes).toContain('─'); // H1 尾线
  });
});

describe('MainScreen 流式槽与固定区', () => {
  it('槽写入：durable 后随写（无追加块时 CUU 回槽首）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('问')]);
    io.bytes = '';
    screen.present([userBlock('问'), slotBlock('流式回答')]);
    // 光标从行 9 回槽首（行 1）：CUU 8 → 写槽行 → 归位
    expect(io.bytes).toBe('\x1b[8A' + '\r流式回答\n' + '\x1b[10;1H');
  });

  it('槽增长换装：整槽重写（旧槽行被覆盖）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([slotBlock('短')]);
    io.bytes = '';
    screen.present([slotBlock('短文变长了')]);
    expect(io.bytes).toBe('\x1b[9A' + '\r短文变长了\n' + '\x1b[10;1H');
  });

  it('槽回缩：余行 EL 清除（EL 擦除禁空格填充）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([slotBlock('a'.repeat(100))]); // 100 列 → 槽两行（行 0..1）
    io.bytes = '';
    screen.present([slotBlock('b')]);
    // 新槽一行（行 0）→ 余行清除：行 1（cursorRow=1 位 CR+EL）→ 归位
    expect(io.bytes).toBe('\x1b[9A' + '\rb\n' + '\r\x1b[K' + '\x1b[10;1H');
  });

  it('定稿换装：槽关闭 + markdown 块追加（旧槽行清除）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('问'), slotBlock('答'.repeat(100))]); // 槽两行（行 1..2）
    io.bytes = '';
    screen.present([userBlock('问'), { kind: 'markdown', doc: MarkdownDoc.of('定稿') }]);
    // 追加位 = durable 末（行 1）：markdown 一行 → 行 3..4 清除（余行）→ 归位
    expect(io.bytes).toContain('\r定稿\n');
    expect(io.bytes).toContain('\x1b[K'); // 旧槽 stale 行 EL 清除在场
  });

  it('固定区差分：首画全量、同帧零写出、变行整行重写', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.setFixed(fixedGrid('状态A|输入'));
    const firstPaint = io.bytes.length;
    screen.setFixed(fixedGrid('状态A|输入')); // 同帧
    // 差分空帧：变行零写出、只余呈现不变式归位 CUP
    expect(io.bytes.slice(firstPaint)).toBe('\x1b[10;1H');

    io.bytes = '';
    screen.setFixed(fixedGrid('状态B|输入')); // 变行 0
    expect(io.bytes).toContain('\x1b[9;1H'); // 行 8（0 基）绝对定位
    expect(io.bytes).toContain('状态B');
    expect(io.bytes).not.toContain('状态A'); // 变行整行重写、旧文不在
    expect(io.bytes).toContain('\x1b[K'); // 行尾 EL
  });

  it('固定区高度变化：滚动区重设 + 差分基准失效全量重画', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.setFixed(new CellGrid(COLS, 3)); // 高 2 → 3：DECSTBM 1..8 → 1..7
    expect(io.bytes).toContain('\x1b[1;7r');
    expect(io.bytes).toContain('\x1b[9;1H'); // 三行固定区首行（0 基行 8）全量重画
  });

  it('setFixed 光标声明：声明位落 cup + 行账同步（后续相对定位不漂移）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('问')]); // durable 末 = 行 1
    // 三行固定区（钉行 7..9）、光标声明在固定区首行行内（0 基行 7、列 3）——编辑器形态
    const grid = new CellGrid(COLS, 3);
    grid.writeText(0, 0, '› 输入中');
    grid.setCursor(0, 3);
    io.bytes = '';
    screen.setFixed(grid);
    // 尾帧落声明位 cup(7,3)（非屏底不变式位——编辑光标外显）
    expect(io.bytes.endsWith('\x1b[8;4H')).toBe(true);
    // 行账同步：后续 present 归 durable 末（行 1）应 CUU 6（若账留屏底行 9 则误发 CUU 8）
    io.bytes = '';
    screen.present([userBlock('问'), userBlock('答')]);
    expect(io.bytes.startsWith('\x1b[6A')).toBe(true);
    expect(io.bytes).toContain('\r> 答\n');
  });

  it('setFixed 无光标声明：回退屏底归位（呈现不变式原样）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.setFixed(fixedGrid('状态A|输入')); // 无 setCursor
    expect(io.bytes.endsWith('\x1b[10;1H')).toBe(true);
    // clearCursor 显式撤声明同回退（末次声明为准）
    const grid = fixedGrid('状态B|输入');
    grid.setCursor(0, 2);
    grid.clearCursor();
    io.bytes = '';
    screen.setFixed(grid);
    expect(io.bytes.endsWith('\x1b[10;1H')).toBe(true);
  });
});

describe('MainScreen 滚动与重建', () => {
  it('区底触滚：超滚动区行数直写不越固定区（光标账稳定）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    // 滚动区 8 行（0..7）：写 12 个单行块 → 区底持续触滚
    const blocks: TranscriptBlock[] = Array.from({ length: 12 }, (_, i) => userBlock(`行 ${i}`));
    screen.present(blocks);
    expect(io.bytes).toContain('\r> 行 0\n');
    expect(io.bytes).toContain('\r> 行 11\n');
    expect(io.bytes.endsWith('\x1b[10;1H')).toBe(true); // 尾帧光标归位不变式
  });

  it('repaint：清屏 + 全量重写（writtenBlocks 归零）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('旧 1'), userBlock('旧 2')]);
    io.bytes = '';
    screen.repaint([userBlock('新 1')]);
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // 清屏
    expect(io.bytes).toContain('\r> 新 1\n');
    expect(io.bytes).not.toContain('旧'); // 全量重写不写卸载块
  });

  // 2026-09-17 TUI 余量收官批（tmux e2e 抓获真缺陷回归锁）：启动抹屏形——
  // 会话注册即 onRepaint（repaint 空 transcript + 调用方 renderFixed 同值
  // grid 再 diff）。修复前 repaint 只清屏不失效 prevFixed → 空 transcript
  // 零正文 + 差分对清屏前基准零写出 = 全屏空白（真终端上首绘被抹、直到下
  // 一次 diff 变化才恢复局部）。锁：repaint 后固定区必全量重写在场。
  it('repaint 空行集 + 同值固定区：清屏后固定区必全量重写（prevFixed 失效律）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.setFixed(fixedGrid('编辑器')); // 首画全量（prevFixed 记账）
    io.bytes = '';
    // 启动注册形：repaint 空投影（滚动区零正文可写）+ 调用方以同值 grid 再 setFixed
    screen.repaint([]);
    screen.setFixed(fixedGrid('编辑器'));
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // 清屏在场为前提
    expect(io.bytes).toContain('编辑器'); // 清屏后固定区全量重写——不可零写出
  });

  it('handleResize：几何重取 + 滚动区重设 + 全量重画', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('内容')]);
    io.columns = 40;
    io.rows = 6;
    io.bytes = '';
    screen.handleResize([userBlock('内容')]);
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\x1b[1;4r'); // 6 行 - 固定区 2 = DECSTBM 1..4
    expect(io.bytes).toContain('\r> 内容\n');
  });

  it('appendTransient：瞬时行直写不记 writtenBlocks（后续 present 不重写）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('块')]);
    screen.appendTransient(['✓ abc12345 后台完成']);
    io.bytes = '';
    screen.present([userBlock('块')]); // 无新块无槽——零正文写出
    expect(io.bytes).not.toContain('后台完成');
    expect(io.bytes).not.toContain('> 块');
  });
});

/* ---------------- 超视口冻结提交（批 10h R1——流式 markdown 直推编舞） ---------------- */

/** 十个 H3 标题块（每块一行 + 块间空行——append-only 全稳定流样本；两冻结 describe 共用） */
const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const headingText = (count: number): string => {
  const heads = NUMS.slice(0, count).map((n) => `### ${n}`);
  if (count > 10) heads.push(`### 十${NUMS[count - 11] ?? '一'}`);
  return heads.join('\n\n') + '\n'; // 尾随换行——尾块终态判据
};
const sg = (n: string): string => `\x1b[1m${n}\x1b[0m`; // 标题行 bold 包裹形

describe('MainScreen 超视口冻结提交', () => {
  const docSlot = (text: string, doc: StreamingMarkdown): TranscriptBlock => ({
    kind: 'streaming',
    epoch: 1,
    text,
    doc,
    thinking: '',
    thinkingDoc: null,
    thinkingSettled: false,
    thinkingExpanded: false,
    theme: DEFAULT_THEME,
    toggleHint: 'ctrl+t',
  });

  it('稳定面前缀超视口 → 冻结升格 durable（帧一全内容恰写一次）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(headingText(10)); // 10 行 + 9 空行 = 19 行 > 容量 8（区 0..7）
    io.bytes = '';
    screen.present([docSlot(headingText(10), doc)]);
    // 冻结 11 行 + 尾段 8 行——每标题恰写一次（冻结段与尾段无重叠）
    for (const n of NUMS) {
      expect(io.bytes.split(sg(n)).length - 1).toBe(1);
    }
    expect(screen.lastSlotFrameBytes).toBeGreaterThan(0); // 帧字节计量面在场
  });

  it('闪烁负断言：帧二追加后已冻结前缀零写出（帧间未变冻结行不重写）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(headingText(10));
    screen.present([docSlot(headingText(10), doc)]);
    const text2 = headingText(11); // 追加第十一标题
    doc.update(text2);
    io.bytes = '';
    screen.present([docSlot(text2, doc)]);
    // 帧一冻结的前缀（溢出 11 行：标题一..六及其间隔）不再写出
    for (const n of ['一', '二', '三', '四', '五', '六']) {
      expect(io.bytes).not.toContain(sg(n));
    }
    expect(io.bytes).toContain(sg('十一')); // 新尾写出（尾段重写）
  });

  it('message_end 定稿换装：B 段跳过已冻结行（冻结行不重写不重复）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = headingText(10);
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([docSlot(text, doc)]); // 冻结 11 行（标题一..六）
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of(text) }]); // 定稿换装（同文同宽同行集）
    for (const n of ['一', '二', '三', '四', '五', '六']) {
      expect(io.bytes).not.toContain(sg(n)); // 已冻前缀不重写
    }
    for (const n of ['七', '八', '九', '十']) {
      expect(io.bytes.split(sg(n)).length - 1).toBe(1); // 未冻尾恰写一次
    }
    expect(screen.lastSlotFrameBytes).toBe(0); // 无槽帧计量归零
  });

  it('定稿块与下条新槽同帧（合并帧形）：epoch 复位后置于 B 段 skip 消费——已冻前缀不重写', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = headingText(10);
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([docSlot(text, doc)]); // 冻结 11 行（标题一..六）
    io.bytes = '';
    // 合并帧形（装配层 enqueuePresent 连续 present 保末次快照——fps 帽合并窗
    // 内 message_end 定稿与紧邻下条 message_start 新槽同 op）：blocks = [定稿
    // 块, 新槽]。修前：present 入口的 epoch 复位先于 B 段取 skip → 冻结账被
    // 清零、B 段 skip=0 → 定稿块连已冻前缀全量重写（scrollback 内容双份）
    const doc2 = new StreamingMarkdown();
    doc2.update('次条流式');
    screen.present([
      { kind: 'markdown', doc: MarkdownDoc.of(text) }, // 定稿块（同文同宽同行集）
      {
        kind: 'streaming',
        epoch: 2,
        text: '次条流式',
        doc: doc2,
        thinking: '',
        thinkingDoc: null,
        thinkingSettled: false,
        thinkingExpanded: false,
        theme: DEFAULT_THEME,
        toggleHint: 'ctrl+t',
      },
    ]);
    for (const n of ['一', '二', '三', '四', '五', '六']) {
      expect(io.bytes).not.toContain(sg(n)); // 已冻前缀不重写（修前红锚：全量重写双显）
    }
    for (const n of ['七', '八', '九', '十']) {
      expect(io.bytes.split(sg(n)).length - 1).toBe(1); // 未冻尾恰写一次
    }
    expect(io.bytes).toContain('次条流式'); // 新槽换装照常
  });

  it('不稳定尾（段落回流形）不冻结：帧帧全量重写（v1 边界——接受滚动）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = 'A' + 'a'.repeat(80 * 14); // 单段落块折 15 行——恒不稳
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([docSlot(text, doc)]);
    io.bytes = '';
    screen.present([docSlot(text, doc)]); // 同文——无冻结面可承接
    expect(io.bytes).toContain('\rA'); // 首行仍重写（未冻证据——stableLineCount = 0）
  });

  it('降档纯文本（doc = null）零冻结：溢出走滚动不升格', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = 'b'.repeat(80 * 12); // 12 行纯文本 > 容量 8
    screen.present([slotBlock(text)]);
    io.bytes = '';
    screen.present([slotBlock(text)]);
    expect(io.bytes).toContain('\rb'); // 全量重写——doc 空则 freezable 恒 0
  });
});

/* ---------------- 思考前缀冻结面（批 10i R1——stableSlotLineCount 消费） ---------------- */

describe('MainScreen 思考前缀冻结', () => {
  /** 思考槽块（标签行 + doc 行——settled 判据参数化；折叠档 thinkingDoc 不消费） */
  const thinkSlot = (text: string, doc: StreamingMarkdown, thinking: string, settled: boolean): TranscriptBlock => ({
    kind: 'streaming',
    epoch: 1,
    text,
    doc,
    thinking,
    thinkingDoc: null,
    thinkingSettled: settled,
    thinkingExpanded: false,
    theme: DEFAULT_THEME,
    toggleHint: 'ctrl+t',
  });

  it('settled 思考标签行入冻结面（帧二标签零重写——思考行全稳可冻）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(headingText(10)); // 标签 1 行 + doc 19 行 = 20 行 > 容量 8
    screen.present([thinkSlot(headingText(10), doc, '想法', true)]);
    io.bytes = '';
    doc.update(headingText(11)); // 追加第十一标题（doc 尾续推）
    screen.present([thinkSlot(headingText(11), doc, '想法', true)]);
    expect(io.bytes).not.toContain('✻ 思考'); // 标签行已冻——帧间不重写
    expect(io.bytes).toContain(sg('十一')); // 新尾仍写出（尾段重写）
  });

  it('思考在场未定 → 冻结面整体为空（不稳头行不可跳——前缀连续律；标签帧帧重写）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(headingText(10)); // 交错形：doc 稳定溢出但末思考块在末文本块后
    screen.present([thinkSlot(headingText(10), doc, '想法', false)]);
    io.bytes = '';
    screen.present([thinkSlot(headingText(10), doc, '想法在继续', false)]); // 标签字数变
    expect(io.bytes).toContain('✻ 思考'); // 标签行重写（未冻证据——冻结面前缀连续）
  });

  it('message_end 换装：thinking 块 + markdown 块跳过已冻前缀（含标签行——不重写不重复）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = headingText(10);
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([thinkSlot(text, doc, '想法', true)]); // 冻结 12 行（标签 + 一..六）
    io.bytes = '';
    screen.present([
      {
        kind: 'thinking',
        text: '想法',
        expanded: false,
        theme: DEFAULT_THEME,
        toggleHint: 'ctrl+t',
        doc: MarkdownDoc.of('想法'),
      },
      { kind: 'markdown', doc: MarkdownDoc.of(text) },
    ]);
    expect(io.bytes).not.toContain('✻ 思考'); // 已冻标签行不重写
    for (const n of ['七', '八', '九', '十']) {
      expect(io.bytes.split(sg(n)).length - 1).toBe(1); // 未冻尾恰写一次
    }
  });

  it('冻结后交错形终值标签（挂账解挂批让位形）：翻回 false 冻结账让位重画 → 再定终值 → 定稿换装收敛', () => {
    const { io, screen } = makeScreen();
    screen.start();
    // 帧一 settled 冻结（批 10i 稳态行为保持不变）：标签 2 字 + doc 前缀共 12 行入冻结账
    const doc = new StreamingMarkdown();
    doc.update(headingText(10));
    screen.present([thinkSlot(headingText(10), doc, '想法', true)]);
    // 帧二交错：后到思考使 settled 翻回 false——已冻标签行变不稳内容，冻结账
    // 为不稳头行让位重算（收缩到稳定面 0）、让位行回换装重写域整面重画
    io.bytes = '';
    screen.present([thinkSlot(headingText(10), doc, '想法继续', false)]);
    expect(io.bytes).toContain('✻ 思考 4 字'); // 新标签重写——交错期新思考文可见反馈（修前红：尾写恒自旧冻账起、标签永不被写）
    expect(io.bytes).toContain(sg('一')); // 让位行含 doc 前缀——整面重画（修前红：doc 前缀同样被旧账跳过）
    expect(io.bytes).not.toContain('✻ 思考 2 字'); // 旧字数标签不在让位重画帧
    // 帧三再定终值（文本续推使 settled 翻回 true）：冻结面自让位账重建，标签携终值字数（6 字）入冻
    io.bytes = '';
    doc.update(headingText(11));
    screen.present([thinkSlot(headingText(11), doc, '想法继续延伸', true)]);
    expect(io.bytes).toContain('✻ 思考 6 字'); // 终值标签可见（修前红：旧冻账不清、终值标签永被跳过）
    // 帧四定稿换装：thinking + markdown 块跳过帧三已冻前缀（含终值标签行——同函数两渲染不漂移）
    io.bytes = '';
    screen.present([
      {
        kind: 'thinking',
        text: '想法继续延伸',
        expanded: false,
        theme: DEFAULT_THEME,
        toggleHint: 'ctrl+t',
        doc: MarkdownDoc.of('想法继续延伸'),
      },
      { kind: 'markdown', doc: MarkdownDoc.of(headingText(11)) },
    ]);
    expect(io.bytes).not.toContain('✻ 思考'); // 已冻终值标签不重写（换装收口——可见标签行字数 = 终态思考字数）
    expect(io.bytes).toContain(sg('十一')); // 未冻尾恰写出
  });
});

/* ---------------- 批 10k 遗漏修：块账绝对位与固定区越界防御 ---------------- */

describe('MainScreen 块账绝对位与越界防御（批 10k 遗漏修）', () => {
  it('blocksOffset 对账：前缀裁块（trim 饱和）后增量只写新块——不漏写不重写', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('A'), userBlock('B'), userBlock('C')], 0);
    io.bytes = '';
    // trim 语义：前缀裁一块（A 离队）+ 尾增新块 D——blocksOffset = 已裁数
    screen.present([userBlock('B'), userBlock('C'), userBlock('D')], 1);
    expect(io.bytes).toContain('> D'); // 新块不漏写（相对块数对账在 trim 后误判零新增）
    expect(io.bytes).not.toContain('> A'); // 裁块不重写（已交 scrollback 物理不可回改）
    expect(io.bytes).not.toContain('> B'); // 在场旧块不重写（增量语义）
  });

  it('repaint 携 blocksOffset：裁块后全量重写不含已裁前缀账漏写', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('A'), userBlock('B')], 0);
    io.bytes = '';
    screen.repaint([userBlock('B'), userBlock('C')], 1); // 切焦重画（trim 已裁 A）
    expect(io.bytes).toContain('> B');
    expect(io.bytes).toContain('> C');
    expect(io.bytes).not.toContain('> A');
  });

  it('固定区超屏（总高 > 行数）零负行定位——baseRow 钳 0（畸形几何防御位）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    // 12 行固定区 > 10 行屏（段溢出形——②段优先级截断挂账，此处锁兜底不产废字节）
    const tall = new CellGrid(COLS, 12);
    tall.writeText(0, 0, '超高固定区');
    screen.setFixed(tall);
    expect(io.bytes).not.toMatch(/\x1b\[-\d+;\d+H/); // 负行 cup = 废字节（终端吃掉或错位）
  });
});

describe('writeLine 控制字节兜底（2026-09-20 TUI 修复组 1 批 F2）', () => {
  it('appendTransient 残余 C0 剥除——CR 不落屏（回列即覆写正文）、调用方 SGR 序列保留', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    // 调用方（TuiBackend）序列化的瞬时行可能夹带残余控制字——writeLine 是
    // inline 面落屏末道防线：CR/NUL/DEL 剥除；SGR 配色 ESC 序列是合法载荷保留
    screen.appendTransient(['a\rb\x00', `x\x1b[31mred\x1b[0m`]);
    expect(io.bytes).toContain('\rab\n'); // CR 在内容段内剥除（前导 \r 是 CR 起笔定位）
    expect(io.bytes).not.toContain('a\rb');
    expect(io.bytes).toContain('x\x1b[31mred\x1b[0m\n'); // SGR 序列原样过线
  });

  it('durable 块路径同律（writeLine 单点——present 追加直写同走兜底）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    // user 块文本经 wrapText 已源头消毒——此处注入残余控制字验证 writeLine
    // 兜底独立于上游（appendTransient 形直喂）
    screen.appendTransient(['n\x07o']);
    expect(io.bytes).toContain('\rno\n'); // BEL 剥除
  });

  it('残余 tab 展开两空格（第五役 G7——发射面兜底对齐 tab 宽度单源模型）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    // 修前红：\t 不在剥除集原样过线——终端按制表位展开最宽 8 列，未记账
    // 物理宽与 autowrap 漂账同族（capAnsiLine tab 零宽透传的潜伏分歧在此
    // 收口）。展开两空格 = graphemeWidth 记 2 / CellGrid writeText /
    // sanitizeDisplayText 消毒层三面同形的第四面（发射面）
    screen.appendTransient(['a\tb']);
    expect(io.bytes).toContain('\ra  b\n'); // tab → 两空格
    expect(io.bytes).not.toContain('\t');
  });
});

describe('tab 四面互证（第五役 S2 建议①——跨面派生不变式）', () => {
  // tab 豁免位四面各自有孤立字面量锁（width.test graphemeWidth 记 2 /
  // sanitizeDisplayText 'a  b' / cell.test writeText 展开 + 两面对拍锁 /
  // 本件 G7 '\ra  b\n'），但单面改动连同本面字面量一起改时其余面静默漂移
  //（fx1-A 与 G7 两役连烧的同族缺陷即此漂移）——此处把同一输入在四面间做
  // 派生恒等断言：任何一面独走（如 tab 改 4 空格只动消毒层、或 graphemeWidth
  // 改记 1 只动模型账）必有至少一腿在此红。语料与 cell.test.ts 对拍锁同册
  //（避 ESC/LF——writeLine 与 sanitizeDisplayText 在此域同形，可作派生锚）
  const corpus = ['a\tbc', '\t', 'x\ty\tz', 'ab\t\tcd', '中\t文'];

  it('同输入四面恒等：消毒展开宽 === 模型宽 === 落格推进，发射字节 === 消毒形', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    for (const s of corpus) {
      const label = `s=${JSON.stringify(s)}`;
      // 消毒面 ↔ 模型面：tab 语义展开后总宽恰等于模型账（graphemeWidth 记 2）
      expect(stringWidth(sanitizeDisplayText(s)), label).toBe(stringWidth(s));
      // 落格面 ↔ 模型面：writeText 展开推进列恰等于模型宽（cell 对拍锁同式收入互证册）
      const grid = new CellGrid(40, 1);
      expect(grid.writeText(0, 0, s), label).toBe(stringWidth(s));
      // 发射面 ↔ 消毒面：writeLine 落屏字节与消毒形逐字节同形（语料无 ESC/LF）
      screen.appendTransient([s]);
      expect(io.bytes, label).toContain('\r' + sanitizeDisplayText(s) + '\n');
    }
    // 发射面零裸 tab：语料全部过线后整帧无一处制表符（G7 兜底恒在的总账断言）
    expect(io.bytes).not.toContain('\t');
  });
});

/* ================= TUI 第四役 fx2（后端组——陈宽守卫列维 + 收缩残影擦除） ================= */

describe('MainScreen 陈宽固定区守卫（fx2-A——resize 窗口陈货不写出）', () => {
  it('缩窗后、setFixed 重建前：陈宽固定区只归位不写（陈货守卫扩列维）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.setFixed(fixedGrid('固定区行')); // 80 列格入位
    io.columns = 40; // 缩窗（fixedGrid 仍是 80 列陈货）
    io.bytes = '';
    screen.handleResize([]); // repaint → present → redrawFixed：陈货窗口
    // 修前红：行维守卫不拦（陈货 2 行 ≤ 新屏 10 行）——80 列格行整段写出，
    // 40 列屏 autowrap 占 2 物理行/格行、物理行账漂移（801bdb0 家族）
    expect(io.bytes).not.toContain('固定区行');
    // 守卫跳过不毒化差分基准：随后 setFixed 新宽格仍全量重画（prevFixed 已随
    // repaint 清屏失效——与行维守卫同收敛）
    const narrow = new CellGrid(40, FIXED);
    narrow.writeText(0, 0, '新宽行');
    screen.setFixed(narrow);
    expect(io.bytes).toContain('新宽行');
  });
});

describe('MainScreen 固定区收缩残影擦除（fx2-C——setFixed 旧行 cup+EL）', () => {
  it('高度收缩：新基行之上的旧行逐行擦除（残影不滞滚动区正文域）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    // 高 3 格带内容入位（防空行 paint 形与擦除形字节同串——内容标记使
    // 「旧格重写」与「残影擦除」两形可区分）
    const tall = new CellGrid(COLS, 3);
    tall.writeText(0, 0, '旧固定行A');
    tall.writeText(1, 0, '旧固定行B');
    tall.writeText(2, 0, '旧固定行C');
    screen.setFixed(tall); // 固定区占 0 基行 7..9
    io.bytes = '';
    const short = new CellGrid(COLS, 1);
    short.writeText(0, 0, '新固定行');
    screen.setFixed(short); // 收缩 3 → 1：旧行 7..8 让位新滚动区——残影域
    // 修前红：差分只写新格行集（行 9），行 7/8 旧内容滞屏并入滚动区（ghost）；
    // 擦除形 = 绝对 cup + SGR 复位 + EL（行级擦除禁空格填充同律）
    expect(io.bytes).toContain('\x1b[8;1H' + '\x1b[0m' + '\x1b[K'); // 0 基行 7
    expect(io.bytes).toContain('\x1b[9;1H' + '\x1b[0m' + '\x1b[K'); // 0 基行 8
    expect(io.bytes).toContain('新固定行'); // 新格行 9 正常入位
  });
});
