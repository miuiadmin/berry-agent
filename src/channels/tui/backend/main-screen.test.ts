/**
 * MainScreen 主屏编舞测试（批 10e-1——MemoryTerminalIO 收帧断言）。
 *
 * 几何：80 列 × 10 行、固定区高 2 → 滚动区 DECSTBM 1..8（0 基行 0..7）、
 * 固定区钉行 8..9。断言收帧字节序（定位序列 + 内容行 + EL 擦除）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CellGrid, MemoryTerminalIO, sanitizeDisplayText, stringWidth } from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import type { TranscriptBlock } from './transcript.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { DEFAULT_THEME } from '../theme/index.js';

/** 剥 SGR/定位序列（忙态文案段扫光〔挖掘 35 轮 B0+B3〕逐字素样式切割字面锚——锚族走剥后形） */
function stripAnsi(out: string): string {
  // eslint-disable-next-line no-control-regex
  return out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

const COLS = 80;
const ROWS = 10;
const FIXED = 2;

function makeScreen(): { io: MemoryTerminalIO; screen: MainScreen } {
  const io = new MemoryTerminalIO(COLS, ROWS);
  return { io, screen: new MainScreen(io, { fixedHeight: FIXED }) };
}

/** 用户块（单行文本——不触折行路径的基元形态；theme = 缺省板 userMessageBg 缺席 → 无背景带形） */
const userBlock = (text: string): TranscriptBlock => ({ kind: 'user', text, theme: DEFAULT_THEME });
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
  thinkingStartAt: null,
  thinkingSettledAt: null,
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
    expect(io.bytes).toBe('\x1b[2J\x1b[H' + '\x1b[1;7r' + '\x1b[10;1H'); // R-1 间隔折入：10−2−1 = 7
  });

  it('首块直写：CUU 归追加位 + CR 行内容 LF 推进 + 光标归位', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([userBlock('你好')]);
    // 追加位 = 行 0（光标从行 9 上移 9）→ 写行 → 光标归固定区末行。
    // user 块三要素（界面美化役批⑦）：上下空行包夹 + `› ` 前缀 bold+dim 游程
    expect(io.bytes).toBe('\x1b[9A' + '\r\n' + '\r\x1b[1;2m› \x1b[0m你好\n' + '\r\n' + '\x1b[10;1H');
  });

  it('增量追加：第二块从 durable 末起笔（CUU 距离随账推进）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('第一')]);
    io.bytes = '';
    screen.present([userBlock('第一'), userBlock('第二')]);
    // 前块 3 行（空行 + 正文 + 空行——首块豁免无垫）→ 追加位行 3：CUU 距离
    // = 9 - 3 = 6；第二块 R-1 块前垫 1 行 + 三明治 3 行
    expect(io.bytes).toBe('\x1b[6A' + '\r\n' + '\r\n' + '\r\x1b[1;2m› \x1b[0m第二\n' + '\r\n' + '\x1b[10;1H');
  });

  it('user 块折行续挂对齐（续行两空格前缀）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    // R-1 折行宽 −3（前缀 2 + 右缘 1 恒空——与 composer innerWidth 同口径）：
    // 内容宽 77 列 → 38 字（76 列）+ 7 字两行
    screen.present([userBlock('一'.repeat(45))]);
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m' + '一'.repeat(38) + '\n');
    expect(io.bytes).toContain('\n\r  ' + '一'.repeat(7) + '\n');
  });

  it('⚙ / ↳ 简行块 dim 包裹', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([
      { kind: 'tool-call', name: 'read', brief: '(path)' },
      { kind: 'tool-result', brief: '命中 3 处' },
    ]);
    expect(io.bytes).toContain('\r\x1b[2m ⚙ 读取文件(path)\x1b[0m\n');
    expect(io.bytes).toContain('\r\x1b[2m ↳ 命中 3 处\x1b[0m\n');
  });

  it('markdown 块经 CellGrid 渲染（R-3：# 前缀保留 + H1 bold+underline 游程贯通）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of('# 标题') }]);
    expect(io.bytes).toContain('\x1b[1;4m# 标题\x1b[0m'); // 前缀与正文同属性单游程
    expect(io.bytes).not.toContain('──'); // H1 下划线行退役（R-3 属性位承载）
  });
});

describe('MainScreen 流式槽与固定区', () => {
  it('槽写入：durable 后随写（无追加块时 CUU 回槽首）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('问')]);
    io.bytes = '';
    screen.present([userBlock('问'), slotBlock('流式回答')]);
    // user 块 3 行（行 0..2）→ 槽首 = 行 3：光标从行 9 CUU 6 → 写槽行 → 归位；
    // R-1 非首槽头垫 1 行（durable 前块在场）；• 前缀 dim（R-4）
    expect(io.bytes).toBe('\x1b[6A' + '\r\n' + '\r\x1b[2m• \x1b[0m流式回答\n' + '\x1b[10;1H');
  });

  it('槽增长换装：整槽重写（旧槽行被覆盖）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([slotBlock('短')]);
    io.bytes = '';
    screen.present([slotBlock('短文变长了')]);
    expect(io.bytes).toBe('\x1b[9A' + '\r\x1b[2m• \x1b[0m短文变长了\n' + '\x1b[10;1H');
  });

  it('槽回缩：余行 EL 清除（EL 擦除禁空格填充）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([slotBlock('a'.repeat(100))]); // 100 列 → 槽两行（行 0..1）
    io.bytes = '';
    screen.present([slotBlock('b')]);
    // 新槽一行（行 0）→ 余行清除：行 1（cursorRow=1 位 CR+EL）→ 归位
    expect(io.bytes).toBe('\x1b[9A' + '\r\x1b[2m• \x1b[0mb\n' + '\r\x1b[K' + '\x1b[10;1H');
  });

  it('定稿换装：槽关闭 + markdown 块追加（旧槽行清除）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('问'), slotBlock('答'.repeat(100))]); // 槽两行（行 1..2）
    io.bytes = '';
    screen.present([userBlock('问'), { kind: 'markdown', doc: MarkdownDoc.of('定稿') }]);
    // 追加位 = durable 末（行 1）：markdown 一行 → 行 3..4 清除（余行）→ 归位
    expect(io.bytes).toContain('\r\x1b[2m• \x1b[0m定稿\n');
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
    screen.present([userBlock('问')]); // durable 末 = 行 3（user 块 3 行——空行包夹）
    // 三行固定区（钉行 7..9）、光标声明在固定区首行行内（0 基行 7、列 3）——编辑器形态
    const grid = new CellGrid(COLS, 3);
    grid.writeText(0, 0, '› 输入中');
    grid.setCursor(0, 3);
    io.bytes = '';
    screen.setFixed(grid);
    // 尾帧落声明位 cup(7,3)（非屏底不变式位——编辑光标外显）
    expect(io.bytes.endsWith('\x1b[8;4H')).toBe(true);
    // 行账同步：后续 present 归 durable 末（行 3）应 CUU 4（若账留屏底行 9 则误发 CUU 6）
    io.bytes = '';
    screen.present([userBlock('问'), userBlock('答')]);
    expect(io.bytes.startsWith('\x1b[4A')).toBe(true);
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m答\n');
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
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m行 0\n');
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m行 11\n');
    expect(io.bytes.endsWith('\x1b[10;1H')).toBe(true); // 尾帧光标归位不变式
  });

  it('repaint：清屏 + 全量重写（writtenBlocks 归零）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('旧 1'), userBlock('旧 2')]);
    io.bytes = '';
    screen.repaint([userBlock('新 1')]);
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // 清屏
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m新 1\n');
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
    expect(io.bytes).toContain('\x1b[1;3r'); // 6 行 - 固定区 2 - 间隔 1 = DECSTBM 1..3（R-1 间隔折入）
    expect(io.bytes).toContain('\r\x1b[1;2m› \x1b[0m内容\n');
  });

  it('appendTransient：瞬时行直写不记 writtenBlocks（后续 present 不重写）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('块')]);
    screen.appendTransient(['✓ abc12345 后台完成']);
    io.bytes = '';
    screen.present([userBlock('块')]); // 无新块无槽——零正文写出
    expect(io.bytes).not.toContain('后台完成');
    expect(io.bytes).not.toContain('› 块');
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
const sg = (n: string): string => `### ${n}\x1b[0m`; // H3 标题行收口形（R-3 整行单游程——# 前缀与正文同 bold+italic；'一'/'十一' 前缀定界不互撞）

/** 流式 markdown 槽块（epoch 指定；冻结/节律 describe 共用） */
const docSlot = (text: string, doc: StreamingMarkdown, epoch = 1): TranscriptBlock => ({
  kind: 'streaming',
  epoch,
  text,
  doc,
  thinking: '',
  thinkingDoc: null,
  thinkingSettled: false,
  thinkingExpanded: false,
  thinkingStartAt: null,
  thinkingSettledAt: null,
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+t',
});

describe('MainScreen 超视口冻结提交', () => {
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
    // 帧一甲案全量冻结（19 行——overflow>0 全冻）；帧二新增 2 稳定行同走冻结升格
    //（写出仅新增段——标题一..十零重写）
    for (const n of NUMS.slice(0, 10)) {
      expect(io.bytes).not.toContain(sg(n));
    }
    expect(io.bytes).toContain(sg('十一')); // 新尾冻结升格写出（帧内恰一份）
  });

  it('message_end 定稿换装：B 段跳过已冻结行（甲案全冻——定稿帧零重写）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = headingText(10);
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([docSlot(text, doc)]); // 甲案帧一溢出期全量冻结（19 行——freezeNow = freezable）
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of(text) }]); // 定稿换装（同文同宽同行集）
    // 42 轮件 A 冻结拓宽：帧一已全冻 → B 段 skip = 19 全跳——定稿帧零块写出。
    // 锁语义升格（非放松）：修前「未冻尾（七..十）恰写一次」→「全量零重写」
    // ——与 :311 帧一恰写一次合取仍锁「恰一份」且更强（滚动源单一化实证）
    for (const n of NUMS) {
      expect(io.bytes).not.toContain(sg(n)); // 已冻全量不重写
    }
    expect(screen.lastSlotFrameBytes).toBe(0); // 无槽帧计量归零
  });

  it('定稿块与下条新槽同帧（合并帧形）：epoch 复位后置于 B 段 skip 消费——已冻前缀不重写', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = headingText(10);
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([docSlot(text, doc)]); // 甲案帧一全量冻结（19 行——freezeNow = freezable）
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
        thinkingStartAt: null,
        thinkingSettledAt: null,
        theme: DEFAULT_THEME,
        toggleHint: 'ctrl+t',
      },
    ]);
    // 甲案全冻（42 轮件 A）：定稿块 skip = 19 全跳零重写；新槽区底锚写出可见
    for (const n of NUMS) {
      expect(io.bytes).not.toContain(sg(n)); // 已冻全量不重写（修前红锚：全量重写双显）
    }
    expect(io.bytes).toContain('次条流式'); // 新槽换装照常（尾窗容量区底锚下限 1 行）
  });

  it('不稳定尾（段落回流形）不冻结：尾窗化重写底段（42 轮件 A——流式期零滚动）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = 'A' + 'a'.repeat(80 * 14); // 单段落块折 15 行——恒不稳
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([docSlot(text, doc)]);
    io.bytes = '';
    screen.present([docSlot(text, doc)]); // 同文——无冻结面可承接
    // 尾窗化：帧帧只重写尾窗底段（〔8,15) 7 行——零触滚写出）；修前全量整写
    // 15 行触滚 7 行（首行 • A 滚入 scrollback——残卷病灶源）。帽外顶行流式期
    // 暂不可见（mutable tail 语义——42 轮件 A）
    expect(io.bytes).not.toContain('• \x1b[0mA'); // 首行（A 起头）不在尾窗——帽外
    expect(io.bytes).toContain('aaaa'); // 尾窗折行底段在场（重写证据；注⑩ bullet 槽前缀随行 dim）
  });

  it('不稳尾段溢出尾窗化（42 轮件 A 修前红）：表格尾块流式期零滚动沉淀、定稿整表恰一份', () => {
    const { io, screen } = makeScreen();
    screen.start();
    // 30 行表（表头 + 定界 + 28 数据行）——表格尾块恒不稳（列宽回流）、溢出容量 8
    const text =
      '| key | value |\n| --- | ----- |\n' +
      Array.from({ length: 28 }, (_, i) => `| k${i} | v${i} |`).join('\n') +
      '\n';
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([docSlot(text, doc)]);
    io.bytes = '';
    screen.present([docSlot(text, doc)]); // 流式帧二（同文重呈——帧写出观测窗）
    // 修前红：尾段整写全表 30 行 → 头部行 k0 写出（触滚滚入 scrollback 残卷源）
    expect(io.bytes).not.toContain('k0'); // 帽外顶行不写出（尾窗 = 底段〔23,30)）
    expect(io.bytes).toContain('k27'); // 尾窗底段在场（最新行可见性）
    // 定稿换装：整表全量直写（B 段 skip=0——表格未冻）恰一份（合法滚动）
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of(text) }]);
    expect(io.bytes.split('k0').length - 1).toBe(1); // 定稿整表恰一份
  });

  it('尾窗骤缩：截断带 stale 行 EL 清理（D 段覆盖性回归锁——预期落绿）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    // 帧 k：长表尾窗满区（尾窗 7 行占满滚动区）
    const longText =
      '| key | value |\n| --- | ----- |\n' +
      Array.from({ length: 28 }, (_, i) => `| k${i} | v${i} |`).join('\n') +
      '\n';
    const doc = new StreamingMarkdown();
    doc.update(longText);
    screen.present([docSlot(longText, doc)]);
    // 帧 k+1：partial 回缩骤短（4 行表）——前帧尾窗残行须被 EL 清（v1 边界的
    // 清除带须覆盖尾窗截断带——A6 定谳：物理末行 ≤ 逻辑账末行恒成立）
    const shortText = '| key | value |\n| --- | ----- |\n| k0 | v0 |\n';
    doc.update(shortText);
    io.bytes = '';
    screen.present([docSlot(shortText, doc)]);
    expect(io.bytes).toContain('\x1b[K'); // EL 清行在场（stale 尾行擦除）
    expect(io.bytes).toContain('k0'); // 新尾窗内容在场
  });

  it('降档纯文本（doc = null）零冻结：尾窗化底段重写（42 轮件 A——流式期零滚动）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = 'b'.repeat(80 * 12); // 12 行纯文本 > 容量 8
    screen.present([slotBlock(text)]);
    io.bytes = '';
    screen.present([slotBlock(text)]);
    // 尾窗化：帧帧只重写尾窗底段（〔5,12) 7 行——首行 • b 在帽外）；doc 空则
    // freezable 恒 0（零冻结维持）——续行 2 空格前缀形在场（注⑩ bullet 槽）
    expect(io.bytes).toContain('\r  b'); // 尾窗底段重写（降档腿同轴尾窗化）
  });
});

/* ---------------- 溢出释放节律（挖掘 43 轮件 B——releasedSlotLines 账 + Smooth/CatchUp 两档） ---------------- */

/**
 * 节律锁语料族：稳定标题前缀 + 长不稳段落尾（无尾随换行 → 尾块恒不稳）。
 * 不稳段落 ≥ 尾窗帽 → 尾窗全被段落行占据——**未冻稳定行不在尾窗可见域**，
 * 冻结升格时点可由帧词面精确观测（冻则在冻结位恰写一次、未冻则零次）——
 * 纯标题语料下未冻稳定行在尾窗可见，升格时点词面不可分。
 */
const paraText = (headCount: number): string => headingText(headCount) + 'A' + 'a'.repeat(80 * 20);

describe('MainScreen 溢出释放节律（43 轮件 B）', () => {
  /** 节律屏：pacing on（80×10 固定区 2 同基础 rig——now 全经 present 参数注入） */
  const makePacingScreen = (): { io: MemoryTerminalIO; screen: MainScreen } => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    return { io, screen: new MainScreen(io, { fixedHeight: FIXED, streamReleasePacing: true }) };
  };

  it('①Smooth 节奏：溢出期稳定行 +2/帧匀速冻结（开账即全量后接管）', () => {
    const { io, screen } = makePacingScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(paraText(6)); // 6 标题 + 3 空行 = 11 行稳定——首帧开账即全量（零重放）
    screen.present([docSlot(paraText(6), doc)], 0, { now: 0 });
    // 帧2：+2 标题（+4 稳定行）→ 积压 4 → Smooth +2：恰冻 '七'，'八' 留账未升格
    const text2 = paraText(8);
    doc.update(text2);
    io.bytes = '';
    screen.present([docSlot(text2, doc)], 0, { now: 100 });
    expect(io.bytes).toContain('### 七'); // 冻结升格写出（尾窗被段落占——在场即升格）
    expect(io.bytes).not.toContain('### 八'); // 未释放——零写出（非尾窗可见）
    expect(screen.releaseBacklogActive).toBe(true); // 积压观测面在场（tick 排空腿驱动源）
    // 帧3：同文重呈 → Smooth 再 +2 → '八' 升格、账追平
    io.bytes = '';
    screen.present([docSlot(text2, doc)], 0, { now: 116 });
    expect(io.bytes).toContain('### 八');
    expect(screen.releaseBacklogActive).toBe(false); // 追平即归零
  });

  it('②CatchUp 深门：一帧注入 ≥8 行稳定 → 当帧一跳式全量追平', () => {
    const { io, screen } = makePacingScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(paraText(6));
    screen.present([docSlot(paraText(6), doc)], 0, { now: 0 }); // 开账全冻 11 行
    const text2 = paraText(11); // +5 标题（+10 稳定行）→ backlog 10 ≥ 8 深门
    doc.update(text2);
    io.bytes = '';
    screen.present([docSlot(text2, doc)], 0, { now: 100 });
    expect(io.bytes).toContain('### 十一'); // burst 跳到队尾——Smooth 形 '十一' 不可能当帧升格
    expect(screen.releaseBacklogActive).toBe(false); // 一跳即追平
  });

  it('③CatchUp 龄门 + 时戳生命周期：积压 ≥120ms 追平；追平清戳 + null 门重戳（小积压再入仍 Smooth）', () => {
    const { io, screen } = makePacingScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(paraText(6));
    screen.present([docSlot(paraText(6), doc)], 0, { now: 0 }); // 开账全冻；追平清戳 null
    const text2 = paraText(8);
    doc.update(text2);
    screen.present([docSlot(text2, doc)], 0, { now: 100 }); // Smooth +2 → 积压 2、戳 = 100
    // 帧3：同文停流 120ms → 龄门 CatchUp 一跳追平（深门 2 < 8 不触）
    io.bytes = '';
    screen.present([docSlot(text2, doc)], 0, { now: 220 }); // 220 − 100 = 120 ≥ 120
    expect(io.bytes).toContain('### 八'); // 龄门追平升格
    expect(screen.releaseBacklogActive).toBe(false);
    // 帧4：追平后再注 4 行小积压——陈戳已清 + null 门重戳 → 仍 Smooth（+2 非
    // CatchUp）：'九' 升格、'十' 留账。若陈戳残留（=100/220），400 − 戳 ≥ 120
    // → 误 CatchUp → '十' 当帧在场 → 红（陈戳清 + null 门双锁锚）
    const text4 = paraText(10);
    doc.update(text4);
    io.bytes = '';
    screen.present([docSlot(text4, doc)], 0, { now: 400 }); // backlog 4 < 8 深门不触
    expect(io.bytes).toContain('### 九');
    expect(io.bytes).not.toContain('### 十');
  });

  it('④让位与回缩：stableNow 回缩帧零新冻结 + 冻结前缀回缩腿重冻恰一次（账卫生面）', () => {
    const { io, screen } = makePacingScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(paraText(6));
    screen.present([docSlot(paraText(6), doc)], 0, { now: 0 }); // 开账全冻 11 行
    doc.update(paraText(8));
    screen.present([docSlot(paraText(8), doc)], 0, { now: 100 }); // Smooth +2：'七' 冻、积压 2
    // 回缩帧：doc 回 6 标题（11 行稳定）→ stableNow 11 < released 13 → 让位；
    // frozen 13 > stableNow 11 → 冻结前缀回缩腿（durableEndRow 回退——scrollback
    // 旧行副本是 append-only 物理律接受代价）。帧面：零新冻结、无积压
    const text3 = paraText(6);
    doc.update(text3);
    io.bytes = '';
    screen.present([docSlot(text3, doc)], 0, { now: 150 });
    expect(io.bytes).not.toContain('### 八'); // 已裁块零冻结（从未升格——账不越 stableNow）
    expect(screen.releaseBacklogActive).toBe(false); // 让位后无积压（账卫生观测面）
    // 再增长：'七' 经回缩腿退账后重冻恰一次（让位账从 11 起算——无残留虚账）
    doc.update(paraText(7));
    io.bytes = '';
    screen.present([docSlot(paraText(7), doc)], 0, { now: 200 });
    expect(io.bytes.split('### 七').length - 1).toBe(1); // 重冻恰一次
  });

  it('⑤新槽开账即全量：epoch 变更哨兵腿——旧槽回缩小账不跨槽（新槽首帧无积压）', () => {
    const { io, screen } = makePacingScreen();
    screen.start();
    const docA = new StreamingMarkdown();
    docA.update(paraText(6));
    screen.present([docSlot(paraText(6), docA, 1)], 0, { now: 0 }); // 槽 A 开账全冻
    docA.update(paraText(3));
    screen.present([docSlot(paraText(3), docA, 1)], 0, { now: 50 }); // 槽 A 回缩 → released 让位至 5
    // 槽 B（epoch 2）首帧：开账即全量（哨兵 −1 消费）——旧槽小账 5 不跨槽误判
    // 积压；坏形（无开账）released 5 < stableNow 11 → releaseBacklogActive true → 红
    const docB = new StreamingMarkdown();
    docB.update(paraText(6));
    io.bytes = '';
    screen.present([docSlot(paraText(6), docB, 2)], 0, { now: 100 });
    expect(io.bytes).toContain('### 六'); // 开账全量冻结（全稳定前缀当帧升格）
    expect(screen.releaseBacklogActive).toBe(false); // 开账即全量零积压
  });

  it('⑥混合形回归锁（42 轮洞修前红）：不稳尾 > 窗容——冻结写真稳定前缀、定稿零缺行', () => {
    const { io, screen } = makeScreen(); // 缺省 pacing off——正确性修复不受节律门控
    screen.start();
    const text = paraText(4); // 4 闭标题（7 稳定行）+ 21 行不稳段落——42 轮 PoC 几何
    const doc = new StreamingMarkdown();
    doc.update(text);
    io.bytes = '';
    screen.present([docSlot(text, doc)]);
    // 修前（42 轮单调用帽耦合）：effectiveStart 回抬 → 冻结循环写窗底段落行、
    // 标题 0 次写出（PoC 实证红锚）——修后冻结带帽无穷恒取 [frozen, total)
    for (const n of NUMS.slice(0, 4)) {
      expect(io.bytes.split(`### ${n}`).length - 1).toBe(1); // 标题恰写一次（冻结升格）
    }
    expect(io.bytes).not.toContain('• A'); // 段落首行帽外——流式期零段落头部沉淀
    // 定稿换装：frozenSlotLines 真值 → B 段 skip 恰好——标题零重写 + 段落全量直写
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of(text) }]);
    for (const n of NUMS.slice(0, 4)) {
      expect(io.bytes).not.toContain(`### ${n}`); // 已冻全量 skip（修前虚账 skip 过头定稿缺行）
    }
    expect(io.bytes).toContain('aaaa'); // 段落定稿直写（合法滚动）
  });

  it('⑦窗头 = frozen 不变量：混合形帧冻结带首行 = 稳定前缀首行（非段落行）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = paraText(4);
    const doc = new StreamingMarkdown();
    doc.update(text);
    io.bytes = '';
    screen.present([docSlot(text, doc)]);
    // 帧字节序：稳定前缀首行先于任何段落行——修前冻结带写窗底段落行（段落
    // 词面先现或标题缺席）
    const stripped = stripAnsi(io.bytes);
    expect(stripped.indexOf('### 一')).toBeGreaterThanOrEqual(0); // 在场前置（修前 −1）
    expect(stripped.indexOf('### 一')).toBeLessThan(stripped.indexOf('aaaa')); // 前缀先行
  });

  it('⑧pacing off（缺省）+ now 在场：恒全量冻结（42 轮行为零回退）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = paraText(10); // 10 标题 19 稳定行 + 不稳段落尾
    const doc = new StreamingMarkdown();
    doc.update(text);
    io.bytes = '';
    screen.present([docSlot(text, doc)], 0, { now: 500 }); // pacing off 门优先于节拍
    for (const n of NUMS) {
      expect(io.bytes.split(`### ${n}`).length - 1).toBe(1); // 全量冻结恰一次
    }
  });

  it('⑨now 缺席（同步直出档）：时基失效恒全量追平（回退形）', () => {
    const { io, screen } = makePacingScreen(); // pacing on 但 now 缺席——回退形
    screen.start();
    const text = paraText(10);
    const doc = new StreamingMarkdown();
    doc.update(text);
    io.bytes = '';
    screen.present([docSlot(text, doc)]); // 无 opts——+Infinity 时基
    for (const n of NUMS) {
      expect(io.bytes.split(`### ${n}`).length - 1).toBe(1); // 全量追平恰一次
    }
    expect(screen.releaseBacklogActive).toBe(false); // 全量形零积压
  });
});

/* ---------------- 思考前缀冻结面（批 10i R1——stableSlotLineCount 消费） ---------------- */

describe('MainScreen 思考前缀冻结', () => {
  /**
   * 思考槽块（标签行 + doc 行——settled 判据参数化；折叠档 thinkingDoc 不消费）。
   * clock = 注④本地钟双戳（settled 帧传 → 标签 `思考 · Xs` 定稿档；缺席 =
   * 诚实无时长形——对拍语料不涉时长）。
   */
  const thinkSlot = (
    text: string,
    doc: StreamingMarkdown,
    thinking: string,
    settled: boolean,
    clock?: { readonly startAt: number; readonly settledAt: number },
  ): TranscriptBlock => ({
    kind: 'streaming',
    epoch: 1,
    text,
    doc,
    thinking,
    thinkingDoc: null,
    thinkingSettled: settled,
    thinkingExpanded: false,
    thinkingStartAt: clock?.startAt ?? null,
    thinkingSettledAt: clock?.settledAt ?? null,
    theme: DEFAULT_THEME,
    toggleHint: 'ctrl+t',
  });

  it('settled 思考标签行入冻结面（帧二标签零重写——思考行全稳可冻）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(headingText(10)); // 标签 1 行 + doc 19 行 = 20 行 > 容量 8
    screen.present([thinkSlot(headingText(10), doc, '想法', true, { startAt: 1000, settledAt: 4500 })]);
    io.bytes = '';
    doc.update(headingText(11)); // 追加第十一标题（doc 尾续推）
    screen.present([thinkSlot(headingText(11), doc, '想法', true, { startAt: 1000, settledAt: 4500 })]);
    expect(io.bytes).not.toContain('思考 · 3s'); // 标签行已冻——帧间不重写（注④定稿档标签）
    expect(io.bytes).toContain(sg('十一')); // 新尾仍写出（尾段重写）
  });

  it('思考在场未定 → 冻结面整体为空（不稳头行不可跳——前缀连续律；尾窗化底段重写）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const doc = new StreamingMarkdown();
    doc.update(headingText(10)); // 交错形：doc 稳定溢出但末思考块在末文本块后
    screen.present([thinkSlot(headingText(10), doc, '想法', false)]);
    io.bytes = '';
    screen.present([thinkSlot(headingText(10), doc, '想法在继续', false)]); // 流式档标签恒形
    // 尾窗化（42 轮件 A）：零冻结 → 尾窗起点 = total − cap 无跳行——doc 尾段
    // 帧帧重写在场（未冻证据——冻结面前缀连续）；标签行帽外流式期暂不可见
    expect(io.bytes).toContain(sg('十')); // 尾窗底段（doc 尾行）重写——重写域活着
    expect(stripAnsi(io.bytes)).not.toContain('思考中'); // 标签行帽外（mutable tail 语义）
  });

  it('message_end 换装：thinking 块 + markdown 块跳过已冻前缀（含标签行——不重写不重复）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    const text = headingText(10);
    const doc = new StreamingMarkdown();
    doc.update(text);
    screen.present([thinkSlot(text, doc, '想法', true, { startAt: 1000, settledAt: 4500 })]); // 甲案帧一全量冻结（21 行——freezeNow = freezable）
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
    // 42 轮件 A 甲案：帧一已全冻（21 行 = 标签 + gap + doc 全量）→ B 段 skip
    // 全跳——换装帧零块写出（零重写锁：修前「未冻尾恰写一次」观测点随全冻
    // 消失，与帧一恰写一次合取仍锁恰一份且更强）
    expect(io.bytes).not.toContain('思考'); // 已冻标签行不重写（换装块无时长形标签零写出）
    for (const n of ['七', '八', '九', '十']) {
      expect(io.bytes).not.toContain(sg(n)); // 已冻全量不重写
    }
  });

  it('冻结后交错形终值标签（挂账解挂批让位形）：翻回 false 冻结账让位重画 → 再定终值 → 定稿换装收敛', () => {
    const { io, screen } = makeScreen();
    screen.start();
    // 帧一 settled 冻结（批 10i 稳态行为保持不变）：标签 + doc 前缀共 12 行入冻结账
    const doc = new StreamingMarkdown();
    doc.update(headingText(10));
    screen.present([thinkSlot(headingText(10), doc, '想法', true, { startAt: 1000, settledAt: 3000 })]);
    // 帧二交错：后到思考使 settled 翻回 false——已冻标签行变不稳内容，冻结账
    // 为不稳头行让位重算（收缩到稳定面 0）、让位行回换装重写域（尾窗化后重
    // 写域 = 尾窗底段自视口顶起笔——帽外顶行流式期暂不可见；修前红锚迁移：
    // 让位 bug 复发形 = 尾写仍自旧冻账起 → 尾窗空零写出）
    io.bytes = '';
    screen.present([thinkSlot(headingText(10), doc, '想法继续', false)]);
    expect(io.bytes.split(sg('十')).length - 1).toBe(1); // 尾窗底段（doc 尾行）自视口顶起笔重写——让位账清零证据
    expect(io.bytes).not.toContain('思考 · 2s'); // 旧定稿档标签不在让位重画帧
    // 帧三再定终值（文本续推使 settled 翻回 true）：冻结面自让位账重建，标签携
    // 终值时长（注④末次 settled 重戳——5s）入冻
    io.bytes = '';
    doc.update(headingText(11));
    screen.present([thinkSlot(headingText(11), doc, '想法继续延伸', true, { startAt: 1000, settledAt: 6000 })]);
    expect(io.bytes).toContain('思考 · 5s'); // 终值标签可见（修前红：旧冻账不清、终值标签永被跳过）
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
    expect(io.bytes).not.toContain('思考'); // 已冻终值标签不重写（换装收口）
    expect(io.bytes).not.toContain(sg('十一')); // 甲案帧三已全冻——换装帧零重写（恰一份之零重复侧）
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
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0mD'); // 新块不漏写（相对块数对账在 trim 后误判零新增）
    expect(io.bytes).not.toContain('\x1b[0m' + 'A'); // 裁块不重写（已交 scrollback 物理不可回改）
    expect(io.bytes).not.toContain('\x1b[0m' + 'B'); // 在场旧块不重写（增量语义）
  });

  it('repaint 携 blocksOffset：裁块后全量重写不含已裁前缀账漏写', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('A'), userBlock('B')], 0);
    io.bytes = '';
    screen.repaint([userBlock('B'), userBlock('C')], 1); // 切焦重画（trim 已裁 A）
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0mB');
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0mC');
    expect(io.bytes).not.toContain('\x1b[0m' + 'A');
  });

  /* ---- 41 轮件 I：repaint 清 scrollback（purge）+ trimmed 垫行 ---- */

  it('【件 I 修前红】repaint 清 scrollback：r+2J+H+3J 单写（重画=权威重建——scrollback 镜像最新重建）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.repaint([userBlock('内容')]);
    // 修前红：CLEAR_SCREEN（2J+H）不清 scrollback——无 r 前置无 3J 尾随
    expect(io.bytes).toContain('\x1b[r\x1b[2J\x1b[H\x1b[3J');
  });

  it('【件 I 修前红】repaint 携 blocksOffset>0：全量重建帧首垫 dim 提示行（trimmed 补偿告知）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.repaint([userBlock('B'), userBlock('C')], 2); // 全量重建帧（账重置 → start=0）+ 两块裁前史
    // 修前红：超帽 trimmed 前史唯一物理载体是 scrollback（purge 已清）——无补偿告知
    expect(io.bytes).toContain('── 前史已省 2 块 · /history 查看全量 ──');
    expect(io.bytes).toContain('\x1b[2m── 前史已省 2 块'); // dim 形（buildSgr dim 位——弱化非正文语义）
    // 提示行自身即分隔：其后首块剥通用外垫（R-1 豁免位延伸）——user 块内包
    // 夹空行是块内行保留——恰一空行间隔非两空行（外垫未剥形 = 外素垫 + 内
    // 包夹双空行）
    expect(io.bytes).toContain('──\x1b[0m\n\r\n\r\x1b[1;2m› \x1b[0mB');
    expect(io.bytes).not.toContain('──\x1b[0m\n\r\n\r\n\r\x1b[1;2m› \x1b[0mB');
  });

  it('【件 I 防回归守卫】增量帧（start>0）与无裁块帧不垫提示行', () => {
    const { io, screen } = makeScreen();
    screen.start();
    screen.present([userBlock('A'), userBlock('B'), userBlock('C')], 0);
    io.bytes = '';
    // 触帽 trim 形：前缀裁一块 + 尾增新块——start=2 增量帧只写新块（防每新块帧重复刷屏）
    screen.present([userBlock('B'), userBlock('C'), userBlock('D')], 1);
    expect(io.bytes).not.toContain('前史已省');
    expect(io.bytes).toContain('\x1b[1;2m› \x1b[0mD'); // 新块照写（对照 trim 语义锁）
    // 无裁块全量重建帧：offset=0 恒不垫（blocksOffset>0 是垫行前提）
    io.bytes = '';
    screen.repaint([userBlock('A')], 0);
    expect(io.bytes).not.toContain('前史已省');
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

/* ---------------- 渲染热路径 D1：槽呈现走尾窗 ---------------- */

describe('槽呈现尾窗化（渲染热路径 D1——冻结前缀不重渲染）', () => {
  it('冻结后续帧字节面零漂移：冻结前缀行只写一次、后续帧只写尾段（既有冻结测试族之上的双写负断言）', () => {
    // 80×10、固定区 2 → 滚动区 8 行；超视口长 doc 触发冻结升格
    const { io, screen } = makeScreen();
    const longDoc = new StreamingMarkdown();
    longDoc.update(Array.from({ length: 30 }, (_, i) => `第${i}行稳定段落`).join('\n\n'));
    const slot: TranscriptBlock = {
      kind: 'streaming',
      epoch: 1,
      text: '',
      doc: longDoc,
      thinking: '',
      thinkingDoc: null,
      thinkingSettled: true,
      thinkingExpanded: false,
      thinkingStartAt: null,
      thinkingSettledAt: null,
      theme: DEFAULT_THEME,
      toggleHint: 'ctrl+t',
    };
    screen.present([slot], 0);
    const frame1 = io.bytes;
    io.bytes = ''; // 收帧边界（逐帧记录语义——本文件同律）
    // 冻结区内样本：块 10-19（行 20-38，深在首帧冻结前缀内部——非尾段过渡带）
    expect((frame1.match(/第1[0-9]行稳定段落/g) ?? []).length).toBe(10); // 冻结确发生（非伪绿）
    // 续帧：doc 再增长——已冻行不得再写（append-only 物理律：冻结行永不再写；
    // 尾段行重写与「尾段新冻升格」是换装域正常语义，不在本负断言样本内）
    longDoc.update(Array.from({ length: 31 }, (_, i) => `第${i}行稳定段落`).join('\n\n') + '\n\n尾段新行');
    screen.present([slot], 0);
    const frame2 = io.bytes;
    expect((frame2.match(/第1[0-9]行稳定段落/g) ?? []).length).toBe(0); // 冻结前缀内部零重写
    expect(frame2).toContain('尾段新行'); // 尾段照常整写
  });

  it('词法锁：present 槽渲染走尾窗单源（renderSlotTailLines 恰三处 = import + 冻结带/尾窗带双消费；旧全量私法除名）', () => {
    const src = readFileSync(new URL('./main-screen.ts', import.meta.url), 'utf8');
    // 43 轮件 B 分离双渲染：冻结带（帽无穷恒取全段——混合形洞根杀）与尾窗带
    // （帽 = 区底余量）各消费一次——观测点随消费位迁移翻新（恰两处 → 三处）
    expect((src.match(/renderSlotTailLines/g) ?? []).length).toBe(3);
    expect((src.match(/renderSlotLines\(/g) ?? []).length).toBe(0); // 修前红锚：旧私法在场
  });
});

/* 挖掘 29 轮件 6：空态引导「放不下不写」守卫按 durable 末折算（头卡占位同缺席）。
 * 几何：15 行屏 × 固定区 6 → 区底 = 15−6−1−1 = 7（行 0..7 共 8 行）；头卡 5 行
 * （行 0..4，durableEndRow=4）+ 引导 5 行（行 4..8）——末行越区底 7 触滚头卡上移；
 * 旧守卫只按全高（5 > 8 否）误放行。同几何无头卡（起笔行 0，末行 4 ≤ 7）照常
 * 在场——同屏对照锁非全局缺席。 */
describe('空态引导守卫扣 durable 末（挖掘 29 轮件 6——R-7 头卡占位后紧几何诚实缺席）', () => {
  /** 头卡块（R-7 durable 首块——renderBlockLines 走 5 行框形） */
  const headerBlock: TranscriptBlock = {
    kind: 'session-header',
    version: '0.1.1',
    model: 'm1',
    directory: '/d',
  };

  it('头卡占位后引导越区底诚实缺席（修前红：旧守卫按全高放行——末行写越区底触滚头卡上移漂账）', () => {
    const io = new MemoryTerminalIO(COLS, 15);
    const screen = new MainScreen(io, { fixedHeight: 6 });
    screen.start();
    screen.present([headerBlock]); // 头卡 5 行落账（durableEndRow=4）
    expect(io.bytes).toContain('berry-agent'); // 头卡确在场（防误锁假绿——占位前提确达）
    io.bytes = ''; // 收帧边界（逐帧记录语义——本文件同律）
    screen.setEmptyGuide(['引导一', '引导二', '引导三', '引导四', '引导五']);
    screen.present([headerBlock]); // 零对话块 + 头卡在场——drawEmptyGuide 判几何
    expect(io.bytes).not.toContain('引导一'); // 修前红位：末行（行 8）越区底（7）——诚实缺席零画出
  });

  it('同几何无头卡照常在场（对照锁：缺席归因于 durable 末占位非全局缺席）', () => {
    const io = new MemoryTerminalIO(COLS, 15);
    const screen = new MainScreen(io, { fixedHeight: 6 });
    screen.start();
    screen.setEmptyGuide(['引导一', '引导二', '引导三', '引导四', '引导五']);
    screen.present([]); // 零块零头卡——起笔行 0 末行 4 全在区内
    expect(io.bytes).toContain('引导一'); // 全高容得下（8 行 ≥ 5 行）——照常在场
  });
});

describe('主屏直写链接全链（挖掘 36 轮〔5〕OSC-8——组合根真装配锁）', () => {
  it('markdown 链接块直写：OSC-8 ST 终界在场存活 + 全输出零 BEL【修前红：现行零 OSC-8 发射】', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of('见 [文档](https://example.com/page)') }]);
    // ST 终界形开链在场（writeLine ESC 保留律——\x1b\\ 两字节双双存活）
    expect(io.bytes).toContain('\x1b]8;;https://example.com/page\x1b\\');
    expect(io.bytes).toContain('\x1b]8;;\x1b\\'); // 闭链在场
    expect(io.bytes).not.toContain('\x07'); // BEL 零在场——ST 终界定谳的物理依据钉死（writeLine 剥除域）
  });

  it('裸 URL 文本行同发（markdown 裸段后注元数据同链化——仅元数据零观感变）【修前红】', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of('见 https://example.com/a. 后续') }]);
    expect(io.bytes).toContain('\x1b]8;;https://example.com/a\x1b\\'); // 尾随 '.' 剥离后目标
  });

  it('非 web scheme 零链发射（mailto 链接不产 OSC-8——诚实不链；回归锁）', () => {
    const { io, screen } = makeScreen();
    screen.start();
    io.bytes = '';
    screen.present([{ kind: 'markdown', doc: MarkdownDoc.of('[邮件](mailto:a@b.c)') }]);
    expect(io.bytes).not.toMatch(/\x1b\]8;/); // 零开链零闭链（label underline 照常）
  });
});
