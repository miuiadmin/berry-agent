/**
 * 工具卡渲染测试（批 10i R4——纯函数直锁）。
 *
 * 覆盖：三态卡头（✓/✗/⏹ 语义色 + 名/简述 dim）、折叠尾 5 行预览（整面
 * dim）/ 展开全量、cardBodyOf 尾留帽与截断标记、edit diff 档（1 删 1 增词级
 * 红绿、孤立行整行红绿、meta dim、超宽截断游程钳制）、插件卡体（renderResult
 * 消费——2026-09-17 TUI 余量收官批③：命中/回落恒在/卡头恒宿主/tone 语义键
 * 着色/折叠预览与卡体帽同律/纯函数纪律）、构造位消毒（B-render 批：tab 记宽
 * 1 发射展开 2 空格——构造位先消毒再测宽截断）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { colorRgb, stringWidth } from '../../engine/index.js';
import { DARK_PALETTE, DEFAULT_THEME, resolveTheme } from '../theme/index.js';
import { registerToolRenderer } from '../../renderers.js';
import { styledLineToAnsi } from '../backend/ansi-rows.js';
import { renderBlockLines, type TranscriptBlock } from '../backend/transcript.js';
import {
  CARD_BODY_MAX_LINES,
  CARD_PREVIEW_LINES,
  cardBodyOf,
  renderToolCardStyledLines,
  type ToolCardView,
} from './tool-card.js';

const card = (over: Partial<ToolCardView>): ToolCardView => ({
  name: 'read',
  brief: '(path)',
  status: 'success',
  body: ['行一', '行二', '行三'],
  diff: false,
  expanded: false,
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+o',
  ...over,
});

describe('工具卡三态卡头', () => {
  it('success 卡头：✓ 符号 success 色 + 名平前景（不 dim——界面美化役批②）+ 简述 dim', () => {
    const lines = renderToolCardStyledLines(card({}), 40);
    expect(lines[0]!.plain).toBe(' ✓ 读取文件(path)');
    expect(lines[0]!.runs).toEqual([
      // ✓ 符号段恒加 bold（⑤——终态符号族 ✓/✗ bold；⏹ 维持次文档不加）
      { start: 0, end: 2, style: { fg: DEFAULT_THEME.success, bold: true } },
      // 简述段 dim 起于名段之后（意图锚——美化役批②「名不被 dim 淹没」）：
      // ' ✓ ' 前缀 3 code units + '读取文件' 4 code units（CJK 显示宽 8 列但
      // UTF-16 长 4）→ start = 3+4 = 7；端点 = UTF-16 下标（ansi-rows.ts 定
      // 语义），名段变化由 plain 断言承载
      { start: 7, end: 13, style: { dim: true } },
    ]);
  });

  it('error / aborted 卡头分档：✗ error 色 / ⏹ secondary（次文同档弱存在感）', () => {
    const err = renderToolCardStyledLines(card({ status: 'error' }), 40)[0]!;
    expect(err.plain).toContain('✗');
    expect(err.runs[0]).toMatchObject({ style: { fg: DEFAULT_THEME.error } });
    const aborted = renderToolCardStyledLines(card({ status: 'aborted' }), 40)[0]!;
    expect(aborted.plain).toContain('⏹');
    expect(aborted.runs[0]).toMatchObject({ style: { fg: DEFAULT_THEME.secondary } });
  });

  it('内建工具族名用户面中文化（07 §4.1 V-0 注⑤——裸签名 agent/write 禁）：映射词渲染位转写', () => {
    // 修前红锚：产出「 ✓ agent(…)」裸签名——呈现层转写（数据面保原始名：
    // exec 判断 card.name==='bash' 与插件腿查表 lookupToolRenderer 均依赖原名）
    const agent = renderToolCardStyledLines(card({ name: 'agent', brief: '(任务=扫描, 后台=true)' }), 60)[0]!;
    expect(agent.plain).toBe(' ✓ 子代理(任务=扫描, 后台=true)');
    const read = renderToolCardStyledLines(card({ name: 'read', brief: '(path=x)' }), 60)[0]!;
    expect(read.plain).toContain(' ✓ 读取文件');
  });

  it('无映射工具英文直呈兜底（插件/未来内建不虚译——映射集外零转写）', () => {
    const lines = renderToolCardStyledLines(card({ name: 'custom_probe' }), 40)[0]!;
    expect(lines.plain).toContain('custom_probe');
  });

  it('bash 卡头动词 Ran 例外不动（2026-09-30 复刻位——中文化射界外）', () => {
    // exec 卡族 = Ran 先例（V-0 注⑤射界注）——名不转写（bash 词判断保持原名路）
    const lines = renderToolCardStyledLines(
      card({
        name: 'bash',
        brief: '',
        renderInput: {
          toolCallId: 'tc',
          arguments: { command: 'ls -la' },
          content: [],
          isError: false,
          aborted: false,
        },
      }),
      60,
    );
    expect(lines[0]!.plain).toContain('Ran');
    expect(lines[0]!.plain).not.toContain('命令执行');
  });
});

describe('卡面染色带（TUI 对标 Codex 五件批 C 件 R4——toolCardBg 整卡铺底）', () => {
  /** 探测在场板（truecolor + 探测 bg → dark 混白 8% 铸 toolCardBg——修前红锚位） */
  const probed = resolveTheme(DARK_PALETTE, 'truecolor', { r: 100, g: 100, b: 100 });

  it('整卡铺底：卡头既有前景游程并入 bg + 名段洞补裸 bg 游程（前景律维持）', () => {
    expect(probed.toolCardBg).toEqual(colorRgb('#707070')); // 修前红：键缺席 undefined
    const lines = renderToolCardStyledLines(card({ theme: probed }), 40);
    const header = lines[0]!;
    // 符号段 fg 并入 bg（分档维持——⑤ ✓ 恒 bold）；名段（平前景洞）补裸 bg；简述段 dim 并入 bg
    expect(header.runs).toEqual([
      { start: 0, end: 2, style: { fg: probed.success, bold: true, bg: probed.toolCardBg } },
      { start: 2, end: 7, style: { bg: probed.toolCardBg } },
      { start: 7, end: 13, style: { dim: true, bg: probed.toolCardBg } },
    ]);
    // 卡体裸行（折叠档——addDim 先行、bg 后并入）→ 整行单游程 dim+bg 并存
    //（带覆文本 extent——非全宽，与 user 块带同设计语言；施加序锁：bg 并入不洗 dim）
    expect(lines[1]!.runs).toEqual([
      { start: 0, end: lines[1]!.plain.length, style: { dim: true, bg: probed.toolCardBg } },
    ]);
  });

  it('空卡体行裸行无带 + 缺省主题（16 档）零 bg 回落（既有 runs 形维持）', () => {
    const lines = renderToolCardStyledLines(card({ theme: probed, body: ['行一', '', '行三'] }), 40);
    const empty = lines.find((line) => line.plain === '');
    expect(empty).toBeDefined();
    expect(empty!.runs).toEqual([]); // 空行无带——user 块包夹空行同形
    // 缺省主题 = dark@16 无探测 → toolCardBg undefined → 零 bg 游程（回落恒在）
    expect(renderToolCardStyledLines(card({}), 40)[0]!.runs).toEqual([
      { start: 0, end: 2, style: { fg: DEFAULT_THEME.success, bold: true } },
      { start: 7, end: 13, style: { dim: true } },
    ]);
  });

  it('组卡收敛行同律铺底（洞补 + bold 段并入——出口统一施加变体零遗漏；⑤ 折叠收敛单行）', () => {
    const group = renderToolCardStyledLines(
      card({
        theme: probed,
        group: {
          count: 2,
          commands: [
            { command: 'ls', status: 'success' },
            { command: 'pwd', status: 'success' },
          ],
        },
      }),
      40,
    );
    // ⑤ 收敛单行 ` • Ran 2 commands · ctrl+o 展开`：• 段（最差态色）、洞、
    // Ran bold 段、中段洞、` · hint 展开` dim 段——五游程全 bg（无终态符号位）
    expect(group).toHaveLength(1);
    expect(group[0]!.plain).toBe(' • Ran 2 commands · ctrl+o 展开');
    expect(group[0]!.runs).toEqual([
      { start: 0, end: 2, style: { fg: probed.success, bg: probed.toolCardBg } },
      { start: 2, end: 3, style: { bg: probed.toolCardBg } },
      { start: 3, end: 6, style: { bold: true, bg: probed.toolCardBg } },
      { start: 6, end: 17, style: { bg: probed.toolCardBg } },
      { start: 17, end: 29, style: { dim: true, bg: probed.toolCardBg } },
    ]);
  });

  it('diff 档行 bg 优先：fillBg 行整行跳过卡面铺底（diff bg 带 = 卡面 bg 上的局部覆盖）', () => {
    const diff = renderToolCardStyledLines(
      card({
        theme: probed,
        diff: true,
        expanded: true,
        body: ['*** Update File: a.ts', '-旧', '+新'],
        diffStartLines: [undefined],
      }),
      40,
    );
    // 卡头行照常铺底（toolCardBg）；diff 行 fillBg 在场 → 整行跳过 withCardBg
    expect(diff[0]!.runs.every((r) => r.style.bg === probed.toolCardBg)).toBe(true);
    expect(diff[1]!.fillBg).toBe(probed.diffRemovedBg);
    expect(diff[1]!.runs.every((r) => r.style.bg === probed.diffRemovedBg)).toBe(true);
    expect(diff[2]!.fillBg).toBe(probed.diffAddedBg);
  });
});

describe('卡体两档与存账帽', () => {
  it('折叠 = 中段截断预览（头 2 + 省略行 + 尾 2——UX 五问题批⑤）且整面 dim；展开 = 全量正常亮度', () => {
    const body = Array.from({ length: 12 }, (_, i) => `第 ${i} 行`);
    const collapsed = renderToolCardStyledLines(card({ body }), 40);
    expect(collapsed).toHaveLength(1 + CARD_PREVIEW_LINES); // 卡头 + 总帽 5
    // 中段截断形：头 2（首行在场——修前尾滑窗只见尾）+ 省略行 + 尾 2
    expect(collapsed[1]!.plain).toBe('第 0 行');
    expect(collapsed[2]!.plain).toBe('第 1 行'); // 头 2 次行
    expect(collapsed[3]!.plain).toContain('已省 8 行'); // 12 - 4 = 8 行省略
    expect(collapsed[3]!.plain).toContain('ctrl+o'); // 展开键提示（真键位随册）
    expect(collapsed[collapsed.length - 1]!.plain).toBe('第 11 行'); // 尾 2 末行
    expect(collapsed.slice(1).every((l) => l.runs.every((r) => r.style.dim === true))).toBe(true); // 预览 dim
    const expanded = renderToolCardStyledLines(card({ body, expanded: true }), 40);
    expect(expanded).toHaveLength(1 + 12);
    expect(expanded.slice(1).every((l) => l.runs.every((r) => r.style.dim !== true))).toBe(true);
  });

  it('折叠预览行数 ≤ 帽时原样全显（无省略行）', () => {
    const collapsed = renderToolCardStyledLines(card({ body: ['仅一行'] }), 40);
    expect(collapsed.map((l) => l.plain)).toEqual([' ✓ 读取文件(path)', '仅一行']);
  });

  it('cardBodyOf 尾留帽：超帽截头保尾 + 截断标记首行', () => {
    const lines = Array.from({ length: CARD_BODY_MAX_LINES + 30 }, (_, i) => `L${i}`);
    const body = cardBodyOf(lines.join('\n'));
    expect(body).toHaveLength(CARD_BODY_MAX_LINES + 1); // 标记行 + 尾留 200
    expect(body[0]).toContain('前文已省 30 行');
    expect(body[body.length - 1]).toBe('L229'); // 尾行保住
  });

  it('护栏注记呈现层转写（V-2 笔2 注④双轨分层）：剥字节注记行 + 前置 ⋯ +N 行', () => {
    // 保尾产物 3 行 + 尾注记行（含外溢路径形）→ 首行 `⋯ +3 行`、注记零残留
    const guarded =
      'tail-a\ntail-b\ntail-c\n\n[输出 63087 字节超 65536 字节上限，已保尾截断；全文外溢至 /tmp/tool-output-x-abc-1.txt（可用 read/grep 从外溢文件取段）]';
    const body = cardBodyOf(guarded);
    expect(body[0]).toBe('⋯ +3 行');
    expect(body.join('\n')).not.toContain('[输出');
    expect(body.join('\n')).not.toContain('外溢');
    expect(body).toContain('tail-c'); // 保尾产物完好
    // 无注记文本原样（regex 不中零转写——非护栏产物不受影响）
    expect(cardBodyOf('普通\n结果')).toEqual(['普通', '结果']);
  });

  it('注记转写只剥注记邻接空行：正文空行保留 + N 按实际保留行数计（全量去空行越界修）', () => {
    // 产物正文自带空行（'a\n\nb\n\nc'）+ 注记自带排版空行（\n\n 形位）——只
    // 剥注记邻接的那一段；修前 `line !== ''` 全量去空行把正文空行一并抹除
    // 且 N 只计非空行（3）失真——期望正文空行在场、N = 5
    const guarded =
      'a\n\nb\n\nc\n\n[输出 63087 字节超 65536 字节上限，已保尾截断；全文外溢至 /tmp/tool-output-x-abc-1.txt（可用 read/grep 从外溢文件取段）]';
    const body = cardBodyOf(guarded);
    expect(body[0]).toBe('⋯ +5 行');
    expect(body.slice(1)).toEqual(['a', '', 'b', '', 'c']);
  });

  it('多行空行段随注记整体剥（段内 continue 下探）——N 按实际保留行数计（V-4 收尾批锚）', () => {
    // 生产形：pipeline 注记恒以 \n\n 拼接 tail 后，tail 自带尾换行时注记前成
    // 多行连续空行段（JSDoc「tail 末自带 \n 时注记前成段多行同剥」）——段内
    // 空行距注记隔 2+ 空行，判词须穿过整段下探（continue）才见注记；坏形
    // （只查紧邻一行）下段首空行漏剥、N 失真为 4
    const guarded =
      'a\nb\n\n\n\n[输出 63087 字节超 65536 字节上限，已保尾截断；全文外溢至 /tmp/tool-output-x-abc-1.txt（可用 read/grep 从外溢文件取段）]';
    const body = cardBodyOf(guarded);
    expect(body.slice(1)).toEqual(['a', 'b']); // 3 连空行段随注记整体剥——正文 ['a','b'] 保留
    expect(body[0]).toBe('⋯ +2 行'); // N = 实际保留行数（2）
  });

  it('下方全空行防御位：注记后文末空行非邻接段——保留不误剥（V-4 收尾批锚）', () => {
    // 注记行之后的空行下方直到文末全是空行（无注记可通）——noteAdjacent
    // 段尽返 false 防御位：该空行非邻接段，正文空行保留（勿因「下方全空」
    // 误入剥除面——kept 行数与空行本体都不失真）
    const guarded =
      'a\n\n[输出 63087 字节超 65536 字节上限，已保尾截断；全文外溢至 /tmp/tool-output-x-abc-1.txt（可用 read/grep 从外溢文件取段）]\n';
    expect(cardBodyOf(guarded)).toEqual(['⋯ +2 行', 'a', '']);
  });
});

describe('edit diff 档（⑥ 行几何与 bg 双通道——R-5 件 C）', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.ts',
    ' const same = 1;',
    '-const old = 2;',
    '+const new = 3;',
    '-孤行删除',
    '*** End Patch',
  ].join('\n');
  /** truecolor 板（bg 键在场——16 档 DEFAULT_THEME bg 降采缺席，缺席腿测用） */
  const themeTc = resolveTheme(DARK_PALETTE, 'truecolor');
  /** 成功 update 卡（startLine=2：hunk 首行〔ctx〕在原文件第 2 行） */
  const diffCard = (over: Partial<ToolCardView> = {}): ToolCardView =>
    card({
      name: 'edit',
      brief: '(patch)',
      diff: true,
      body: patch.split('\n'),
      expanded: true,
      diffStartLines: [2],
      theme: themeTc,
      ...over,
    });

  it('卡头：• dim + 动词 bold + 路径 + 计数括号（+N 绿/−M 红/括号默认色）', () => {
    const lines = renderToolCardStyledLines(diffCard(), 80);
    // 单文件 update：动词 Edited + 路径 + (+1 −2)；Begin/End meta 行退役不呈现
    expect(lines[0]!.plain).toBe('• Edited a.ts (+1 −2)');
    expect(lines[0]!.runs).toEqual([
      { start: 0, end: 2, style: { dim: true } }, // '• '
      { start: 2, end: 8, style: { bold: true } }, // 'Edited'
      { start: 15, end: 17, style: { fg: themeTc.diffAdded } }, // '+1'
      { start: 18, end: 20, style: { fg: themeTc.diffRemoved } }, // '−2'
    ]);
    expect(lines).toHaveLength(5); // 头 + 4 行体（meta 不呈现）
  });

  it('行几何：4 空格缩进 + 右对齐行号槽 + 符号列（ctx 双计数同进、del 旧侧/add 新侧）', () => {
    const lines = renderToolCardStyledLines(diffCard(), 80);
    // startLine=2：ctx 显 2；对行 del 旧侧 3 / add 新侧 3；孤 del 旧侧 4
    expect(lines[1]!.plain).toBe('    2  const same = 1;'); // ctx 符号列空格
    expect(lines[2]!.plain).toBe('    3 -const old = 2;');
    expect(lines[3]!.plain).toBe('    3 +const new = 3;');
    expect(lines[4]!.plain).toBe('    4 -孤行删除');
    expect(lines[1]!.runs).toEqual([]); // ctx 行裸
  });

  it('bg 双通道：del/add 行 fillBg 色带 + 文本 extent 内 runs 并 bg', () => {
    expect(themeTc.diffAddedBg).toEqual(colorRgb('#213a2b'));
    expect(themeTc.diffRemovedBg).toEqual(colorRgb('#4a221d'));
    const lines = renderToolCardStyledLines(diffCard(), 80);
    // 对行 del：词级变字段段 fg + 洞补裸 bg（gutter/sign/锚段）+ fillBg 尾腿铺屏宽
    expect(lines[2]!.fillBg).toBe(themeTc.diffRemovedBg);
    expect(lines[2]!.runs).toEqual([
      { start: 0, end: 13, style: { bg: themeTc.diffRemovedBg } }, // gutter+sign+'const '（洞补）
      { start: 13, end: 16, style: { fg: themeTc.diffRemoved, bg: themeTc.diffRemovedBg } }, // 'old'
      { start: 16, end: 19, style: { bg: themeTc.diffRemovedBg } }, // ' = '
      { start: 19, end: 21, style: { fg: themeTc.diffRemoved, bg: themeTc.diffRemovedBg } }, // '2;'
    ]);
    expect(lines[3]!.fillBg).toBe(themeTc.diffAddedBg);
    expect(lines[4]!.fillBg).toBe(themeTc.diffRemovedBg);
    // 孤立 del 整行红（R4 前景律维持）+ bg 并入（'    4 -孤行删除' = 11 units）
    expect(lines[4]!.runs).toEqual([
      { start: 0, end: 11, style: { fg: themeTc.diffRemoved, bg: themeTc.diffRemovedBg } },
    ]);
  });

  it('bg 缺席腿：16 档降采 bg 键缺席 → 前景独行可读（无 fillBg、runs 无 bg）', () => {
    // DEFAULT_THEME = 16 档解析（bg 键降采缺席——resolve 件设计）；fg 键仍在
    expect(DEFAULT_THEME.diffAddedBg).toBeUndefined();
    expect(DEFAULT_THEME.diffRemoved).toBeDefined();
    const lines = renderToolCardStyledLines(diffCard({ theme: DEFAULT_THEME }), 80);
    expect(lines[2]!.fillBg).toBeUndefined();
    expect(lines[2]!.runs).toEqual([
      { start: 13, end: 16, style: { fg: DEFAULT_THEME.diffRemoved } },
      { start: 19, end: 21, style: { fg: DEFAULT_THEME.diffRemoved } },
    ]);
    // 板缺键腿同形（truecolor 板显式去 bg 键——colors 层缺席）
    const boardless = resolveTheme(
      { ...DARK_PALETTE, colors: { ...DARK_PALETTE.colors, diffAddedBg: undefined, diffRemovedBg: undefined } },
      'truecolor',
    );
    expect(boardless.diffRemovedBg).toBeUndefined();
    const lines2 = renderToolCardStyledLines(diffCard({ theme: boardless }), 80);
    expect(lines2[2]!.fillBg).toBeUndefined();
  });

  it('失败卡：通用头维持（✗ 符号位保留——失败可见性优先）+ 行号槽整列空白（诚实缺席）', () => {
    const lines = renderToolCardStyledLines(diffCard({ status: 'error', diffStartLines: undefined }), 80);
    expect(lines[0]!.plain).toBe(' ✗ 编辑文件(patch)');
    // 无 startLines：行号槽空（gutter 空槽 1 + 分隔 1）符号列照常——前缀 6 空格
    expect(lines[2]!.plain).toBe('      -const old = 2;');
    expect(lines[3]!.plain).toBe('      +const new = 3;');
  });

  it('折叠档 fillBg 保形（挖掘 29 轮件 1 修前红：addDim 重建行对象丢 fillBg——diff 行自持 bg 面被卡面覆写）：整面 dim 并入 + fillBg 尾腿透传 + withCardBg 整行跳过', () => {
    // 长补丁（体 > CARD_PREVIEW_LINES=5 触发 previewWindow 头 2 + 省略 + 尾 2）
    const longPatch = [
      '*** Begin Patch',
      '*** Update File: a.ts',
      ' const ctx0 = 0;',
      '-const del0 = 0;',
      '+const add0 = 0;',
      ' const ctx1 = 1;',
      '-const del1 = 1;',
      '+const add1 = 1;',
      '*** End Patch',
    ].join('\n');
    const lines = renderToolCardStyledLines(
      diffCard({ body: longPatch.split('\n'), diffStartLines: [3], expanded: false }),
      80,
    );
    // 折叠窗 = 头 2 体行 + 省略行 + 尾 2 体行（+ 卡头）；头 2 = ctx0 / del0
    expect(lines).toHaveLength(6);
    expect(lines[2]!.plain).toBe('    4 -const del0 = 0;'); // 窗首 del 行（防空洞断言——startLine=3：ctx0=3、del0=4）
    // 修前红位：addDim 丢 fillBg → withCardBg 以卡面 bg 覆写（diff 局部覆盖律破）
    expect(lines[2]!.fillBg).toBe(themeTc.diffRemovedBg);
    // 整面 dim 并入（折叠预览档语义保持——fg 段携 dim；'del0' 词级变字段段 13..17）
    expect(lines[2]!.runs).toContainEqual({
      start: 13,
      end: 17,
      style: { fg: themeTc.diffRemoved, bg: themeTc.diffRemovedBg, dim: true },
    });
    // 尾 2 = add1（add 行）同律保形
    expect(lines[5]!.fillBg).toBe(themeTc.diffAddedBg);
    // 省略行（marker）无 fillBg——dim 单游程（省略行非 diff 行）
    expect(lines[3]!.plain).toContain('已省 2 行'); // 体 6 行 − 窗 4（头 2 + 尾 2）= 省略 2
    expect(lines[3]!.fillBg).toBeUndefined();
  });

  it('多文件：Edited N files + 总计数 + `  └` 段头 + 段间空行；add 段行号自 1', () => {
    const multi = [
      '*** Begin Patch',
      '*** Update File: a.ts',
      '-x',
      '+y',
      '*** Add File: b.txt',
      '+n1',
      '+n2',
      '*** End Patch',
    ].join('\n');
    const lines = renderToolCardStyledLines(diffCard({ body: multi.split('\n'), diffStartLines: [3, undefined] }), 80);
    expect(lines[0]!.plain).toBe('• Edited 2 files (+3 −1)');
    expect(lines[0]!.runs).toEqual([
      { start: 0, end: 2, style: { dim: true } },
      { start: 2, end: 8, style: { bold: true } },
      { start: 18, end: 20, style: { fg: themeTc.diffAdded } },
      { start: 21, end: 23, style: { fg: themeTc.diffRemoved } },
    ]);
    // 段头：'  └ ' dim + 路径裸 + 计数红绿
    expect(lines[1]!.plain).toBe('  └ a.ts (+1 −1)');
    expect(lines[1]!.runs).toEqual([
      { start: 0, end: 4, style: { dim: true } },
      { start: 10, end: 12, style: { fg: themeTc.diffAdded } },
      { start: 13, end: 15, style: { fg: themeTc.diffRemoved } },
    ]);
    // a.ts 段：startLine 3 → del 3 / add 3
    expect(lines[2]!.plain).toBe('    3 -x');
    expect(lines[3]!.plain).toBe('    3 +y');
    // 段间空行
    expect(lines[4]!.plain).toBe('');
    // b.txt 段头 + add 段行号 1..N
    expect(lines[5]!.plain).toBe('  └ b.txt (+2 −0)');
    expect(lines[6]!.plain).toBe('    1 +n1');
    expect(lines[7]!.plain).toBe('    2 +n2');
  });

  it('单文件动词随段：Added（add 段行号自 1）/ Deleted（无计数括号——无行体无计数）', () => {
    const addOnly = ['*** Begin Patch', '*** Add File: fresh.txt', '+line1', '+line2', '*** End Patch'].join('\n');
    const addLines = renderToolCardStyledLines(
      diffCard({ body: addOnly.split('\n'), diffStartLines: [undefined] }),
      80,
    );
    expect(addLines[0]!.plain).toBe('• Added fresh.txt (+2 −0)');
    expect(addLines[1]!.plain).toBe('    1 +line1');
    expect(addLines[2]!.plain).toBe('    2 +line2');
    const delOnly = ['*** Begin Patch', '*** Delete File: gone.ts', '*** End Patch'].join('\n');
    const delLines = renderToolCardStyledLines(diffCard({ body: delOnly.split('\n') }), 80);
    expect(delLines[0]!.plain).toBe('• Deleted gone.ts'); // delete 段无行体 → 无计数括号
    expect(delLines).toHaveLength(1); // 纯删除卡只有卡头行
  });

  it('超宽硬折行：内容列硬切 + 续行对齐内容列 + 游程跨折行边界保留（整字截断退役）', () => {
    const long = ['*** Begin Patch', '*** Update File: w.ts', '-' + 'a'.repeat(15), '*** End Patch'].join('\n');
    const lines = renderToolCardStyledLines(diffCard({ body: long.split('\n'), diffStartLines: [1] }), 20);
    // 内容列宽 = 20 − 7 = 13：首行 13 a + 续行 2 a（续行 = 4 空格 + 空号槽 1 + 2 空格对齐内容列）
    expect(lines[1]!.plain).toBe('    1 -' + 'a'.repeat(13));
    expect(lines[2]!.plain).toBe('       ' + 'a'.repeat(2));
    // 孤立 del 整行红跨折行保留 + bg 色带随折行延伸
    expect(lines[1]!.runs).toEqual([
      { start: 0, end: 20, style: { fg: themeTc.diffRemoved, bg: themeTc.diffRemovedBg } },
    ]);
    expect(lines[2]!.runs).toEqual([
      { start: 0, end: 9, style: { fg: themeTc.diffRemoved, bg: themeTc.diffRemovedBg } },
    ]);
    expect(lines[2]!.fillBg).toBe(themeTc.diffRemovedBg);
  });

  it('行内 tab 展开 4 空格档（diff 位专用——全域缺省 2 维持）', () => {
    const tabby = ['*** Begin Patch', '*** Update File: t.ts', '-\tsx', '*** End Patch'].join('\n');
    const lines = renderToolCardStyledLines(diffCard({ body: tabby.split('\n'), diffStartLines: [1] }), 40);
    expect(lines[1]!.plain).toBe('    1 -    sx'); // 4 空格缩进 + 号槽 + '-' + tab→4 空格
  });

  it('非段形回落：无 *** 段头的 body → 通用头 + plain 体（不装 diff 几何）', () => {
    const lines = renderToolCardStyledLines(diffCard({ body: ['-旧一行', '+新一行'], diffStartLines: undefined }), 80);
    expect(lines[0]!.plain).toBe(' ✓ 编辑文件(patch)');
    expect(lines[1]!.plain).toBe('-旧一行');
    expect(lines[2]!.plain).toBe('+新一行');
  });
});

/* ---------------- 2026-09-17 TUI 余量收官批③：插件卡体（renderResult 消费） ---------------- */

/** 插件渲染腿载荷速构（toolName 单源 = card.name——载荷不含名） */
const renderInputOf = (over: Partial<NonNullable<ToolCardView['renderInput']>> = {}) => ({
  toolCallId: 'tc1',
  arguments: { pattern: 'x' },
  content: [{ type: 'text', text: '命中 3 处' }],
  isError: false,
  aborted: false,
  ...over,
});

describe('插件卡体（renderResult 消费——回落恒在律）', () => {
  // 模块级注册表——逐笔 dispose 防跨用例串扰（afterEach 收口）
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('命中非空行集 → 插件卡体替换宿主缺省卡体；卡头恒宿主形（不可覆写）', () => {
    const received: unknown[] = [];
    disposers.push(
      registerToolRenderer('plug_card', {
        renderResult: (result) => {
          received.push(result);
          return [[{ text: '插件行一' }], [{ text: '插件行二' }]];
        },
      }),
    );
    const withPlugin = renderToolCardStyledLines(
      card({ name: 'plug_card', body: ['宿主体'], expanded: true, renderInput: renderInputOf() }),
      40,
    );
    // 卡头恒宿主形：与无渲染腿渲染的卡头逐字段相等（插件不可覆写断言）
    const hostOnly = renderToolCardStyledLines(card({ name: 'plug_card', body: ['宿主体'], expanded: true }), 40);
    expect(withPlugin[0]).toEqual(hostOnly[0]);
    // 卡体 = 插件行集非宿主缺省体
    expect(withPlugin.slice(1).map((line) => line.plain)).toEqual(['插件行一', '插件行二']);
    expect(hostOnly.slice(1).map((line) => line.plain)).toEqual(['宿主体']);
    // renderResult 收定稿期全量事实（toolName 单源 = 卡名）
    expect(received).toEqual([
      {
        toolCallId: 'tc1',
        toolName: 'plug_card',
        arguments: { pattern: 'x' },
        content: [{ type: 'text', text: '命中 3 处' }],
        isError: false,
        aborted: false,
      },
    ]);
  });

  it('tone 五值语义键直取着色（text/缺省无前景——正文恒随终端）', () => {
    disposers.push(
      registerToolRenderer('plug_tone', {
        renderResult: () => [
          [
            { text: '错', tone: 'error' },
            { text: '成', tone: 'success' },
            { text: '焦', tone: 'accent' },
            { text: '次', tone: 'secondary' },
            { text: '中', tone: 'text' },
            { text: '裸' },
          ],
        ],
      }),
    );
    const lines = renderToolCardStyledLines(
      card({ name: 'plug_tone', body: [], expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(lines[1]!.plain).toBe('错成焦次中裸');
    expect(lines[1]!.runs).toEqual([
      { start: 0, end: 1, style: { fg: DEFAULT_THEME.error } },
      { start: 1, end: 2, style: { fg: DEFAULT_THEME.success } },
      { start: 2, end: 3, style: { fg: DEFAULT_THEME.accent } },
      { start: 3, end: 4, style: { fg: DEFAULT_THEME.secondary } },
      // tone 'text' 与缺省段无前景游程（DEFAULT_THEME.text = undefined——终端缺省前景）
    ]);
  });

  it('回落恒在律三形：抛错 / 空行集 / 未注册——恒宿主缺省卡体', () => {
    const hostBody = ['宿主一', '宿主二'];
    // 同名宿主基线（卡头含名——逐形对照）
    const hostLinesOf = (name: string) => renderToolCardStyledLines(card({ name, body: hostBody, expanded: true }), 40);
    // 形一：抛错
    disposers.push(
      registerToolRenderer('plug_throw', {
        renderResult: () => {
          throw new Error('插件炸了');
        },
      }),
    );
    const thrown = renderToolCardStyledLines(
      card({ name: 'plug_throw', body: hostBody, expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(thrown).toEqual(hostLinesOf('plug_throw')); // 抛错回落（插件渲染器结构性不可劣化呈现面）
    // 形二：空行集
    disposers.push(registerToolRenderer('plug_empty', { renderResult: () => [] }));
    const empty = renderToolCardStyledLines(
      card({ name: 'plug_empty', body: hostBody, expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(empty).toEqual(hostLinesOf('plug_empty'));
    // 形三：未注册（查表未命中）
    const missed = renderToolCardStyledLines(
      card({ name: 'plug_miss', body: hostBody, expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(missed).toEqual(hostLinesOf('plug_miss'));
  });

  it('载荷缺席（renderInput 无）→ 钩子不触发走宿主缺省（渲染器在场亦然）', () => {
    let invoked = 0;
    disposers.push(
      registerToolRenderer('plug_no_input', {
        renderResult: () => {
          invoked++;
          return [[{ text: '不该出现' }]];
        },
      }),
    );
    const lines = renderToolCardStyledLines(card({ name: 'plug_no_input', body: ['宿主'], expanded: true }), 40);
    expect(invoked).toBe(0); // 无定稿期事实即无现调
    expect(lines.slice(1).map((line) => line.plain)).toEqual(['宿主']);
  });

  it('折叠预览 N=5 与卡体帽 200 行对插件行集同律（尾留 + 截断标记首行）', () => {
    // 扁平行集（每元素一行 = 段序列——[[段]] 嵌套是行集的行集属坏形）
    const many = Array.from({ length: CARD_BODY_MAX_LINES + 30 }, (_, i) => [{ text: `L${i}` }]);
    disposers.push(registerToolRenderer('plug_cap', { renderResult: () => many }));
    const expanded = renderToolCardStyledLines(
      card({ name: 'plug_cap', body: [], expanded: true, renderInput: renderInputOf() }),
      40,
    );
    // 卡头 + 截断标记 + 尾留 200（cardBodyOf 同语义）
    expect(expanded).toHaveLength(1 + 1 + CARD_BODY_MAX_LINES);
    expect(expanded[1]!.plain).toContain('前文已省 30 行');
    expect(expanded[expanded.length - 1]!.plain).toBe(`L${many.length - 1}`); // 尾行保住
    // 折叠档 = 卡头 + 尾 5 视觉行且整面 dim（同宿主卡体律）
    const collapsed = renderToolCardStyledLines(
      card({ name: 'plug_cap', body: [], expanded: false, renderInput: renderInputOf() }),
      40,
    );
    expect(collapsed).toHaveLength(1 + CARD_PREVIEW_LINES);
    expect(collapsed[collapsed.length - 1]!.plain).toBe(`L${many.length - 1}`);
    expect(collapsed.slice(1).every((line) => line.runs.every((run) => run.style.dim === true))).toBe(true);
  });

  it('纯函数纪律：同输入两次现调同行集（不缓存——每次渲染重新调用）', () => {
    let invoked = 0;
    disposers.push(
      registerToolRenderer('plug_pure', {
        renderResult: () => {
          invoked++;
          return [[{ text: '确定行' }]];
        },
      }),
    );
    const input = card({ name: 'plug_pure', body: [], expanded: true, renderInput: renderInputOf() });
    const first = renderToolCardStyledLines(input, 40);
    const second = renderToolCardStyledLines(input, 40);
    expect(invoked).toBe(2); // 定稿渲染与 repaint 重渲各一次现调——零缓存
    expect(second).toEqual(first); // 同输入同行集
  });

  it('超宽段截断 + 游程钳制（插件行几何同 diff 档——游程几何保简）', () => {
    disposers.push(
      registerToolRenderer('plug_wide', {
        renderResult: () => [[{ text: 'a'.repeat(30), tone: 'error' }, { text: 'b'.repeat(10) }]],
      }),
    );
    const lines = renderToolCardStyledLines(
      card({ name: 'plug_wide', body: [], expanded: true, renderInput: renderInputOf() }),
      12,
    );
    expect(lines[1]!.plain).toBe('a'.repeat(12)); // 12 列帽——越界段丢弃
    for (const run of lines[1]!.runs) expect(run.end).toBeLessThanOrEqual(lines[1]!.plain.length);
    expect(lines[1]!.runs).toEqual([{ start: 0, end: 12, style: { fg: DEFAULT_THEME.error } }]);
  });
});

describe('卡头屏宽帽（2026-09-20 TUI 修复组 1 批 F6；界面美化役批①——截断走 `…`）', () => {
  it('超长名：卡头截到屏宽-1 追 …、符号游程保位（名段平前景无跨界段）', () => {
    const lines = renderToolCardStyledLines(card({ name: 'n'.repeat(60), brief: '' }), 30);
    const header = lines[0]!;
    // 3 前缀 + 26 n + …（宽 1）= 30 恰满帽——被切行与真实行尾可辨
    expect(header.plain).toBe(' ✓ ' + 'n'.repeat(26) + '…');
    expect(header.plain.length).toBe(30);
    expect(header.runs).toEqual([{ start: 0, end: 2, style: { fg: DEFAULT_THEME.success, bold: true } }]);
  });

  it('未超帽卡头原样（同形不受帽影响）', () => {
    const lines = renderToolCardStyledLines(card({}), 40);
    expect(lines[0]!.plain).toBe(' ✓ 读取文件(path)');
  });

  it('帽内窄宽截断整字丢弃不产半字（宽字名末位）+ 裸省略号', () => {
    // 名 = '中'×20（宽 2）+ 帽 12：前缀 ' ✓ ' 占 3，余 8 列容 4 个「中」（8 列）
    // + …（1 列）恰满 12——第 5 个「中」跨界整字丢弃
    const lines = renderToolCardStyledLines(card({ name: '中'.repeat(20), brief: '' }), 12);
    const header = lines[0]!;
    expect(header.plain).toBe(' ✓ ' + '中'.repeat(4) + '…');
    expect(header.runs).toEqual([{ start: 0, end: 2, style: { fg: DEFAULT_THEME.success, bold: true } }]);
  });

  it('尾段覆盖截断点 → 省略号随段既有着色（简述段 dim 延伸吞 …）', () => {
    // 名 3 字符 + 简述超长：截断点落在简述段内——尾段（dim）延伸一格吞省略号
    const lines = renderToolCardStyledLines(card({ name: 'abc', brief: 'b'.repeat(40) }), 20);
    const header = lines[0]!;
    expect(header.plain).toBe(' ✓ abc' + 'b'.repeat(13) + '…'); // 6 前缀名 + 13 b + … = 20
    expect(header.runs).toEqual([
      { start: 0, end: 2, style: { fg: DEFAULT_THEME.success, bold: true } },
      { start: 6, end: 20, style: { dim: true } }, // 简述段跨截断点延伸吞 …（' ✓ ' 3 + 名 'abc' 3 = 6 起——名末字符不入 dim）
    ]);
  });
});

/* ---------------- B-render 批：构造位消毒（tab 记宽 1 发射展开 2 空格） ---------------- */

/** 发射行剥 SGR 后的显示宽（发射位消毒已展开 tab——剥样式后测真宽） */
function emittedWidth(line: string): number {
  return stringWidth(line.replace(/\x1b\[[0-9;]*m/g, ''));
}

describe('构造位消毒：tab 记宽 1 发射展开 2 空格（修前截断记宽放行超帽行）', () => {
  // 模块级注册表——逐笔 dispose 防跨用例串扰
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('edit 孤立增行含 tab：真管线发射行宽 ≤ 帽（tab 4 档展开 + 折行段各 ≤ 帽）', () => {
    const block: Extract<TranscriptBlock, { kind: 'tool-card' }> = {
      kind: 'tool-card',
      name: 'edit',
      brief: '(patch)',
      status: 'success',
      body: ['*** Update File: tab.ts', '+' + '\t'.repeat(10) + '0123456789'],
      diff: true,
      expanded: true,
      theme: DEFAULT_THEME,
      toggleHint: 'ctrl+o',
    };
    for (const line of renderBlockLines(block, 20)) {
      expect(emittedWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  it('词级对行含 tab（4 档展开）：发射宽 ≤ 帽（极窄形整行帽兜底截断）', () => {
    const lines = renderToolCardStyledLines(
      card({
        name: 'edit',
        diff: true,
        expanded: true,
        body: ['*** Update File: t.ts', '-' + '\t'.repeat(4), '+' + '\t'.repeat(4) + 'x'],
        diffStartLines: [1],
      }),
      6,
    );
    for (const line of lines) {
      expect(emittedWidth(styledLineToAnsi(line))).toBeLessThanOrEqual(6);
    }
  });

  it('插件行段含 tab：发射宽 ≤ 帽（修前 15 tab 截到 10 记宽、发射展开 20 空格 > 10）', () => {
    disposers.push(
      registerToolRenderer('plug_tab', { renderResult: () => [[{ text: '\t'.repeat(15), tone: 'error' }]] }),
    );
    const lines = renderToolCardStyledLines(
      card({ name: 'plug_tab', body: [], expanded: true, renderInput: renderInputOf() }),
      10,
    );
    for (const line of lines) {
      expect(emittedWidth(styledLineToAnsi(line))).toBeLessThanOrEqual(10);
    }
  });

  it('卡头名含 tab：发射宽 ≤ 帽（修前帽按 tab=1 记宽、发射展开超帽）', () => {
    const lines = renderToolCardStyledLines(card({ name: '\t'.repeat(30), brief: '' }), 10);
    expect(emittedWidth(styledLineToAnsi(lines[0]!))).toBeLessThanOrEqual(10);
  });

  it('tab 语义展开全域缺省 2 维持（diff 位 4 档不外溢——卡头名 2 档）', () => {
    const lines = renderToolCardStyledLines(card({ name: 'a\tb', brief: '' }), 40);
    expect(lines[0]!.plain).toContain('a  b'); // 卡头名 tab → 2 空格（全域缺省档）
  });
});

/* ---------------- UX 五问题批①/③：exec 卡头复刻与状态行 ---------------- */

describe('exec 卡头复刻（UX 五问题批①——bash 族）', () => {
  /** bash 卡速构（命令经 renderInput.arguments.command 携带——数据面事实只读） */
  const bashCard = (command: string, over: Partial<ToolCardView> = {}): ToolCardView =>
    card({ name: 'bash', body: ['Exit code: 0'], renderInput: renderInputOf({ arguments: { command } }), ...over });

  it('Ran 动词 bold + 符号语义色 + `$` 命令位 dim（注⑩）+ `bash -lc` 外壳剥除（一层外引号同剥）', () => {
    const lines = renderToolCardStyledLines(bashCard(`bash -lc 'echo hi'`), 40);
    expect(lines[0]!.plain).toBe(' ✓ Ran $ echo hi'); // 外壳动词与引号剥除——`$ ` 命令位前缀（注⑩）
    // 符号段（含首空格）语义色 + 动词段 Ran bold（成功/失败同词）+ `$` 段 dim
    // （命令位符弱存在感）；命令段词法高亮游程自 col 9 起（词色具体值不锁——
    // 高亮表面内聚）
    expect(lines[0]!.runs[0]).toEqual({ start: 0, end: 2, style: { fg: DEFAULT_THEME.success, bold: true } });
    expect(lines[0]!.runs[1]).toEqual({ start: 3, end: 6, style: { bold: true } });
    expect(lines[0]!.runs[2]).toEqual({ start: 7, end: 8, style: { dim: true } }); // $ 段 dim（注⑩）
    for (const run of lines[0]!.runs.slice(3)) expect(run.start).toBeGreaterThanOrEqual(9);
  });

  it('失败腿同词 Ran：✗ 符号 error 色（动词段不动）', () => {
    const lines = renderToolCardStyledLines(bashCard('echo hi', { status: 'error' }), 40);
    expect(lines[0]!.plain).toBe(' ✗ Ran $ echo hi');
    expect(lines[0]!.runs[0]).toEqual({ start: 0, end: 2, style: { fg: DEFAULT_THEME.error, bold: true } });
    expect(lines[0]!.runs[1]).toEqual({ start: 3, end: 6, style: { bold: true } });
    expect(lines[0]!.runs[2]).toEqual({ start: 7, end: 8, style: { dim: true } }); // $ 段 dim 同律
  });

  it('中止腿：⏹ 符号 secondary（次文同档弱存在感）', () => {
    const lines = renderToolCardStyledLines(bashCard('echo hi', { status: 'aborted' }), 40);
    expect(lines[0]!.plain.startsWith(' ⏹ Ran $ ')).toBe(true);
    expect(lines[0]!.runs[0]).toEqual({ start: 0, end: 2, style: { fg: DEFAULT_THEME.secondary } });
  });

  it('命令折行帽 2 + 超出省略行（⑦ 续行 `  │ ` 独立窄槽 dim + 真实行数明示）', () => {
    // 宽 19：首行预算 19−9=10（` ✓ Ran $ ` 前缀让位）、续行预算 19−4=15（⑦
    // 独立窄槽——不对齐命令起始列）：'a'×10 首行 + 余量 'b'×16+'cccc' 续 2 行
    //（'b'×15 / 'bcccc'）→ 帽 2 收口省 1 行
    const lines = renderToolCardStyledLines(bashCard('a'.repeat(10) + 'b'.repeat(16) + 'cccc'), 19);
    // 头 2 视觉行 + 省略行 + 卡体输出窗 1 行（④ └ 形——body 单行 ≤ 帽、无
    // durationMs 无状态行）
    expect(lines).toHaveLength(4);
    expect(lines[0]!.plain).toBe(' ✓ Ran $ ' + 'a'.repeat(10));
    expect(lines[1]!.plain).toBe('  │ ' + 'b'.repeat(15)); // 续行 │ 轨道线（⑦ 窄槽宽 15）
    expect(lines[1]!.runs[0]).toEqual({ start: 0, end: 4, style: { dim: true } }); // │ 槽前缀 dim（⑦）
    expect(lines[1]!.runs.some((r) => r.style.bold === true)).toBe(false); // 续行无动词段
    // 省略行同获 │ 槽（⑦——槽前缀 + 文案整行 dim；文案与 ④ 输出窗省略行
    // `⋯ +N 行` 同族单源：`  │ ⋯ +1 行` 11 列 ≤ 19 自洽〔修前长文案
    // `⋯（命令已省 N 行）` 宽 22 越帽——锚勘正〕）
    expect(lines[2]!.plain).toBe('  │ ⋯ +1 行');
    expect(lines[2]!.runs).toEqual([{ start: 0, end: lines[2]!.plain.length, style: { dim: true } }]);
    expect(lines[3]!.plain).toBe('  └ Exit code: 0'); // ④ exec 输出窗首行 └ 形
  });

  it('命令缺席/非字符串 → 回落常量卡头（generic 形）', () => {
    const noCmd = renderToolCardStyledLines(card({ name: 'bash', renderInput: renderInputOf({ arguments: {} }) }), 40);
    expect(noCmd[0]!.plain).toBe(' ✓ bash(path)'); // 常量卡头（名平前景 + 简述）
    const badType = renderToolCardStyledLines(
      card({ name: 'bash', renderInput: renderInputOf({ arguments: { command: 42 } }) }),
      40,
    );
    expect(badType[0]!.plain).toBe(' ✓ bash(path)'); // 非字符串命令同回落
  });
});

/* ---------------- exec 折叠组卡（07 §4.1 V-3 注⑩ 符号册——组级形渲染） ---------------- */

describe('exec 折叠组卡（组级形——卡头 • Ran N commands + 最差态符号）', () => {
  /** 组卡速构（命令条目 → 组数据；count = 条目数） */
  const groupCard = (
    commands: ReadonlyArray<{ command: string; status?: 'success' | 'error' | 'aborted'; exitCode?: number }>,
    over: Partial<ToolCardView> = {},
  ): ToolCardView =>
    card({
      name: 'bash',
      brief: '',
      body: [],
      group: {
        count: commands.length,
        commands: commands.map((c) => ({ command: c.command, status: c.status ?? 'success', exitCode: c.exitCode })),
      },
      ...over,
    });

  it('⑤ 折叠收敛单行：` • Ran N commands · hint 展开`——• 最差态色（不加 bold）+ Ran 动词段 bold + hint 段 dim、无终态符号位', () => {
    const ok = renderToolCardStyledLines(groupCard([{ command: 'ls' }, { command: 'pwd' }, { command: 'date' }]), 40);
    expect(ok).toHaveLength(1); // 收敛单行（「组头+逐条摘要」折叠态退役）
    expect(ok[0]!.plain).toBe(' • Ran 3 commands · ctrl+o 展开');
    expect(ok[0]!.runs).toEqual([
      { start: 0, end: 2, style: { fg: DEFAULT_THEME.success } }, // • 段（含首空格——最差态语义色非新键、不 bold〔终态符号族 bold 只辖 ✓/✗〕）
      { start: 3, end: 6, style: { bold: true } }, // Ran 动词段（exec 单卡先例）
      { start: 17, end: ok[0]!.plain.length, style: { dim: true } }, // ` · hint 展开` 段 dim（` • Ran 3 commands` = 17 字起）
    ]);
    const err = renderToolCardStyledLines(
      groupCard([{ command: 'ls' }, { command: 'npm test', status: 'error', exitCode: 1 }, { command: 'pwd' }]),
      40,
    );
    // 失败组不收敛（⑤——失败可见性优先）：恒逐条展开形，头 ` ✗ • Ran N commands` 维持
    expect(err).toHaveLength(1 + 3);
    expect(err[0]!.plain).toBe(' ✗ • Ran 3 commands');
    expect(err[0]!.runs[0]).toEqual({ start: 0, end: 2, style: { fg: DEFAULT_THEME.error, bold: true } });
    expect(err.slice(1).map((l) => l.plain)).toEqual(['$ ls', '$ npm test (1)', '$ pwd']); // 逐条全量（无折叠帽）
    const aborted = renderToolCardStyledLines(
      groupCard([{ command: 'ls' }, { command: 'pwd' }, { command: 'date', status: 'aborted' }]),
      40,
    );
    // 未完成组（中止）同不收敛——⏹ 次文段维持不加 bold（⑤ 终态符号族 bold 只辖 ✓/✗）
    expect(aborted).toHaveLength(1 + 3);
    expect(aborted[0]!.plain).toBe(' ⏹ • Ran 3 commands');
    expect(aborted[0]!.runs[0]).toEqual({ start: 0, end: 2, style: { fg: DEFAULT_THEME.secondary } });
  });

  it('⑤ 展开态逐条形维持：ctrl+o 展开组卡 = 头 ` ✓ • Ran N commands` + 逐条全量（✓ 恒 bold）', () => {
    const lines = renderToolCardStyledLines(
      groupCard([{ command: 'ls' }, { command: 'pwd' }, { command: 'date' }], { expanded: true }),
      40,
    );
    expect(lines).toHaveLength(1 + 3);
    expect(lines[0]!.plain).toBe(' ✓ • Ran 3 commands');
    expect(lines[0]!.runs[0]).toEqual({ start: 0, end: 2, style: { fg: DEFAULT_THEME.success, bold: true } });
    expect(lines[0]!.runs[1]).toEqual({ start: 5, end: 8, style: { bold: true } }); // Ran 动词段
    expect(lines.slice(1).map((l) => l.plain)).toEqual(['$ ls', '$ pwd', '$ date']);
  });

  it('卡体各命令一行摘要（⑤ 展开态——折叠收敛后逐条行归展开态承载）：`$ ` 前缀 dim + 命令文本（`bash -lc` 外壳剥除同 exec 单卡头）', () => {
    const lines = renderToolCardStyledLines(
      groupCard([{ command: `bash -lc 'ls -la'` }, { command: 'pwd' }, { command: 'date' }], { expanded: true }),
      60,
    );
    expect(lines.slice(1).map((l) => l.plain)).toEqual(['$ ls -la', '$ pwd', '$ date']);
    expect(lines[1]!.runs).toEqual([{ start: 0, end: 1, style: { dim: true } }]); // `$` 位符弱存在感（注⑩ 命令位）
  });

  it('命令文本截断走 ellipsize 单源（长命令收 `…` 且行显示宽 ≤ 帽——退出码位让位；⑤ 展开态承载）', () => {
    const lines = renderToolCardStyledLines(groupCard([{ command: 'a'.repeat(80) }], { expanded: true }), 20);
    expect(lines[1]!.plain).toBe('$ ' + 'a'.repeat(17) + '…'); // 预算 20-2=18 → 17 字 + …
    expect(stringWidth(lines[1]!.plain)).toBeLessThanOrEqual(20);
  });

  it('退出码位：失败腿非零码 ` (N)` 后缀 error 色；成功零码不显（UX 批④ 同律——信息零值不占屏）', () => {
    const lines = renderToolCardStyledLines(
      groupCard(
        [
          { command: 'npm test', status: 'error', exitCode: 1 },
          { command: 'ls', exitCode: 0 },
          { command: 'grep x', status: 'error' }, // 错误族无码形（EXEC_TIMEOUT 等）——无后缀
        ],
        { expanded: true }, // 展开档断游程——折叠档预览整面 dim（下则律）
      ),
      60,
    );
    expect(lines[1]!.plain).toBe('$ npm test (1)');
    expect(lines[1]!.runs).toEqual([
      { start: 0, end: 1, style: { dim: true } },
      { start: 11, end: 14, style: { fg: DEFAULT_THEME.error } }, // ' (1)' 退出码段（失败可辨定位）
    ]);
    expect(lines[2]!.plain).toBe('$ ls'); // 零码不显
    expect(lines[3]!.plain).toBe('$ grep x'); // 无码形同裸收尾
  });

  it('折叠/展开走 ctrl+o 既有律（⑤ 翻档）：折叠 = 收敛单行（previewWindow 帽路在组卡退役）；展开 = 逐条全量', () => {
    const commands = Array.from({ length: 8 }, (_, i) => ({ command: `cmd-${i}` }));
    const collapsed = renderToolCardStyledLines(groupCard(commands), 40);
    expect(collapsed).toHaveLength(1); // 收敛单行（「头 2+省略+尾 2」折叠预览帽形退役）
    expect(collapsed[0]!.plain).toBe(' • Ran 8 commands · ctrl+o 展开');
    const expanded = renderToolCardStyledLines(groupCard(commands, { expanded: true }), 40);
    expect(expanded).toHaveLength(1 + 8); // 全量逐条（无中段截断帽）
  });

  it('卡体帽 200 行同律：超帽截头保尾 + 截断标记首行（词条——卡体帽 200 同律）', () => {
    const commands = Array.from({ length: CARD_BODY_MAX_LINES + 10 }, (_, i) => ({ command: `c${i}` }));
    const lines = renderToolCardStyledLines(groupCard(commands, { expanded: true }), 40);
    expect(lines).toHaveLength(1 + 1 + CARD_BODY_MAX_LINES);
    expect(lines[1]!.plain).toContain('前文已省 10 行');
    expect(lines[lines.length - 1]!.plain).toBe(`$ c${commands.length - 1}`); // 尾行保住
  });
});

describe('exec 卡体状态行（UX 五问题批③——bash 卡族卡体首行）', () => {
  const bashCard = (over: Partial<ToolCardView>): ToolCardView =>
    card({ name: 'bash', body: ['Exit code: 1', '输出行'], durationMs: 1500, ...over });

  it('失败腿：`(退出码) · {时长}` 整行 dim（折行帽内——注⑩ 括号段串接符 ·）', () => {
    const lines = renderToolCardStyledLines(bashCard({ status: 'error' }), 40);
    expect(lines[1]!.plain).toBe('(1) · 1.50s');
    expect(lines[1]!.runs).toEqual([{ start: 0, end: '(1) · 1.50s'.length, style: { dim: true } }]);
  });

  it('成功腿：不显退出码（Exit code: 0 渲染层不显）——仅时长', () => {
    const lines = renderToolCardStyledLines(bashCard({ status: 'success', body: ['Exit code: 0'] }), 40);
    expect(lines[1]!.plain).toBe('• 1.50s');
  });

  it('信号终止 null 形：`（信号终止）` 段替代退出码', () => {
    const lines = renderToolCardStyledLines(bashCard({ status: 'error', body: ['Exit code: null（信号终止）'] }), 40);
    expect(lines[1]!.plain).toBe('（信号终止） · 1.50s');
  });

  it('错误族无码形（EXEC_TIMEOUT 等）仅时长；时长格式四档（ms/秒/分/时）', () => {
    const timeout = renderToolCardStyledLines(bashCard({ status: 'error', body: ['[EXEC_TIMEOUT] 超时'] }), 40);
    expect(timeout[1]!.plain).toBe('• 1.50s'); // 无 Exit code 行——空码段
    const ms = renderToolCardStyledLines(bashCard({ durationMs: 250 }), 40);
    expect(ms[1]!.plain).toBe('• 250ms'); // < 1s → ms 形
    const min = renderToolCardStyledLines(bashCard({ durationMs: 75_000 }), 40);
    expect(min[1]!.plain).toBe('• 1m 15s'); // < 60m → 分秒形
    const hour = renderToolCardStyledLines(bashCard({ durationMs: 3_660_000 }), 40);
    expect(hour[1]!.plain).toBe('• 1h 01m'); // ≥ 60m → 时分形
  });

  it('折叠/展开两档恒在（钉卡头之后预览窗之前）；非 bash 卡无状态行', () => {
    const collapsed = renderToolCardStyledLines(
      bashCard({ status: 'error', body: ['Exit code: 1', ...Array.from({ length: 12 }, (_, i) => `第 ${i} 行`)] }),
      40,
    );
    expect(collapsed[1]!.plain).toBe('(1) · 1.50s'); // 折叠档状态行在场
    expect(collapsed[2]!.plain).toBe('  └ Exit code: 1'); // 输出窗紧随（④——└ 首行 = 窗首行）
    expect(collapsed[3]!.plain).toBe('    第 0 行'); // 头 2 次行（④ 4 空格槽）
    const expanded = renderToolCardStyledLines(
      bashCard({ status: 'error', body: ['Exit code: 1'], expanded: true }),
      40,
    );
    expect(expanded[1]!.plain).toBe('(1) · 1.50s'); // 展开档同形
    // 非 bash 卡（grep）恒无状态行——退出码是 exec 专属呈现
    const grep = renderToolCardStyledLines(card({ name: 'grep', durationMs: 500, status: 'error' }), 40);
    expect(grep[1]!.plain).toBe('行一'); // 无状态行——卡体直接开始
    // durationMs 缺席（孤儿/旧投影形）= 无状态行
    const noDur = renderToolCardStyledLines(card({ name: 'bash', status: 'error', body: ['Exit code: 1'] }), 40);
    expect(noDur[1]!.plain).toBe('  └ Exit code: 1'); // 输出窗按名施用（卡头形无关——④）
  });

  it('exec 输出窗折叠档（④）：帽 5 头 2 + 省略行 + 尾 2——整窗 dim + 省略行 4 空格槽 `⋯ +N 行`', () => {
    // 顶层 card 直构（无 durationMs → 无状态行；输出窗按名施用与卡头形无关）
    const body = ['第一行', ...Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 行`)];
    const lines = renderToolCardStyledLines(card({ name: 'bash', body }), 40); // 卡头 1 + 窗 5
    expect(lines).toHaveLength(6);
    expect(lines[1]!.plain).toBe('  └ 第一行'); // 首行 └ 形（dim）
    expect(lines[1]!.runs).toEqual([{ start: 0, end: lines[1]!.plain.length, style: { dim: true } }]); // 整窗 dim（前缀与内容同档）
    expect(lines[2]!.plain).toBe('    第 1 行'); // 头 2 次行（4 空格槽）
    expect(lines[3]!.plain).toBe('    ⋯ +5 行'); // 省略行 4 空格槽（9 行 − 4 = 5——文案不含展开键提示）
    expect(lines[3]!.runs).toEqual([{ start: 0, end: lines[3]!.plain.length, style: { dim: true } }]);
    expect(lines[4]!.plain).toBe('    第 7 行'); // 尾 2（body 尾 = 第一行 + 第 1..8 行共 9 行——尾 2 即第 7/8 行）
    expect(lines[5]!.plain).toBe('    第 8 行');
    expect(lines.slice(1).every((l) => l.runs.every((r) => r.style.dim === true))).toBe(true); // 整窗 dim
  });

  it('exec 输出窗空输出形（④）：`  └ (no output)` dim 单行', () => {
    const lines = renderToolCardStyledLines(card({ name: 'bash', body: [''] }), 40);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.plain).toBe('  └ (no output)');
    expect(lines[1]!.runs).toEqual([{ start: 0, end: '  └ (no output)'.length, style: { dim: true } }]);
  });

  it('exec 输出窗展开档（④）：全量窗行 └ 首行 + 槽续行、两档皆 dim（整窗 DIM 档翻档）', () => {
    const lines = renderToolCardStyledLines(card({ name: 'bash', body: ['甲', '乙'], expanded: true }), 40);
    expect(lines).toHaveLength(3);
    expect(lines[1]!.plain).toBe('  └ 甲');
    expect(lines[2]!.plain).toBe('    乙'); // 续行 4 空格槽
    expect(lines.slice(1).every((l) => l.runs.every((r) => r.style.dim === true))).toBe(true);
  });
});
