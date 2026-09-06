/**
 * MainScreen 主屏编舞测试（批 10e-1——MemoryTerminalIO 收帧断言）。
 *
 * 几何：80 列 × 10 行、固定区高 2 → 滚动区 DECSTBM 1..8（0 基行 0..7）、
 * 固定区钉行 8..9。断言收帧字节序（定位序列 + 内容行 + EL 擦除）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, MemoryTerminalIO } from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import type { TranscriptBlock } from './transcript.js';
import { MarkdownDoc } from '../markdown/markdown.js';

const COLS = 80;
const ROWS = 10;
const FIXED = 2;

function makeScreen(): { io: MemoryTerminalIO; screen: MainScreen } {
  const io = new MemoryTerminalIO(COLS, ROWS);
  return { io, screen: new MainScreen(io, { fixedHeight: FIXED }) };
}

/** 用户块（单行文本——不触折行路径的基元形态） */
const userBlock = (text: string): TranscriptBlock => ({ kind: 'user', text });
/** 流式槽块 */
const slotBlock = (text: string): TranscriptBlock => ({ kind: 'streaming', text });

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
