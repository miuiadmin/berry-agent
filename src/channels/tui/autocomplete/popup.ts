/**
 * 补全弹层件（07 §4.1 引擎节件 6（组件与呈现装配件））：候选列表浮层——按多行输入件
 * 坐标定位（定位由主屏固定区槽位装配承载——fixed-budget 弹层槽；弹出位 =
 * 编辑器下方〔2026-10-10 Codex 样式复刻批翻档——段序见 renderFixed〕；锚定注册表
 * 形已判死路清除〔fx2-D〕；本件是纯内容——只画列表）。
 *
 * - 结果落位驱动：R6 批 10j 异步形——backend 持防抖调度器（AutocompleteCompleter），
 *   onResult 回调调 applyResult 注入（null 收层不显；空条目弹「无匹配」
 *   空态行——2026-10-04 空态反馈批，键面见 handleEvent 空态注）；候选窗口
 *   8 行帽（弹层族一致律——2026-10-10 Codex 样式复刻批 10→8）+ 高亮跟随滚动；
 * - 观感（2026-10-10 Codex 样式复刻批）：选中行 = 整行所有 span accent bold
 *   （弃 inverse 反色与 › 光标前缀符——未选中行 2 空格缩进维持）；空态行
 *   dim + italic（accent 空态档退役）；desc 列对齐制——起列 = 全集条目
 *   max(label 显示宽) + 2（全集基准滚动不挪列；右对齐制退役）、段右界帽
 *   ≤ 区域宽 70%、desc 段 dim（选中行整行 accent bold 覆盖 dim）；
 * - 键面：↑/↓ 循环换高亮、enter/tab 应用、escape 关本轮（后续输入再发新查
 *   重开；关层回调 onDismiss——backend 撤防抖窗作废在途，堵迟到 fire 重开
 *   闪回——2026-09-20 TUI 视觉品质战役·组 2）；其余键不消费（穿透回
 *   Editor 继续输入——弹层随下次落位重算）；
 *   enter 的全量输入穿透律——token 已是高亮项全文时 enter 不消费（穿透提交，
 *   归编辑器——2026-09-13 真模型五轮实测定罪补；2026-10-02 尾空白容差——
 *   参数位铸造形 replacement 惯携尾空格，精确比对被差一击穿即吞提交键）、
 *   tab 恒应用；
 * - 陈旧窗守卫（R6 批 10j）：20ms 防抖窗内弹层可持上轮 result（输入已变更、
 *   新查未发），enter/tab 应用陈旧 replaceStart/End 会劈坏文本——应用前对拍
 *   光标 token 现区间，陈旧即收层穿透；
 * - 应用 = 整 token 代换（模型 replaceToken 原语——replacement 含触发前缀
 *   与引号形）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region, Renderable } from '../../engine/index.js';
import { ellipsize, stringWidth } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import type { EditorModel } from '../editor/editor-model.js';
import type { AutocompleteResult } from './provider.js';
import { tokenAtCursor } from './token.js';

/** 弹层可见条目帽（弹层族一致律 8 行——超出窗口滚动跟随高亮） */
const MAX_VISIBLE_ITEMS = 8;

/** 未选中行首缩进（选中行同形——光标前缀符已退役，全行统一 2 空格） */
const ROW_INDENT = '  ';

/** desc 段右界帽系数（≤ 区域宽 70%——desc 短说明位不霸屏） */
const DESC_RIGHT_RATIO = 0.7;

/** 空态行样式（dim + italic——「无匹配」弱反馈，accent 空态档已退役） */
const EMPTY_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true, italic: true });

/** desc 段常态样式（dim——选中行整行 accent bold 覆盖位由 render 分派） */
const DETAIL_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/** 弹层件：结果落位面 + 模型代换原语调用（provider 归 backend 调度器持有） */
export class AutocompletePopup implements Renderable {
  private result: AutocompleteResult | null = null;
  private activeIndex = 0;
  private windowStart = 0;
  private readonly model: EditorModel;
  /**
   * 选中行样式（整行 accent bold——主题派生，setTheme 重建；codex 形：
   * 弃 inverse 反色与 › 光标前缀符）
   */
  private activeStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.accent, bold: true });
  /**
   * escape 关层通知（2026-09-20 TUI 视觉品质战役·组 2）：popup 消费 escape
   * 关本轮时回调——backend 接线 autocompleteCompleter.cancel()（撤 20ms 防
   * 抖窗 + 在途作废），堵「关层后窗内迟到 fire 重开弹层」的建议框闪回
   * （kitty 轨 escape 即达即决，20ms 窗内已武装的查询会迟到落层）。仅
   * escape 路回调——enter 应用即隐属新轮编舞、陈旧守卫收层是穿透过渡，
   * 都不算「用户撤销本轮」。
   */
  onDismiss?: () => void;

  constructor(model: EditorModel) {
    this.model = model;
  }

  /** 主题换装（OSC 11 probe 裁定后 backend 注入——accent 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.activeStyle = Object.freeze({ fg: theme.accent, bold: true });
  }

  /** 弹层在场态（无补全不显） */
  get visible(): boolean {
    return this.result !== null;
  }

  /** 高亮下标（测试观测面） */
  get activeItemIndex(): number {
    return this.activeIndex;
  }

  /** 结果落位（backend 防抖调度器 onResult 注入——无补全自然隐藏；高亮归零） */
  applyResult(result: AutocompleteResult | null): void {
    this.result = result;
    this.activeIndex = 0;
    this.windowStart = 0;
  }

  /** 量高：可见条目数（不可见 = 0——浮层不占布局；空结果占 1——空态行） */
  measure(width: number): number {
    void width;
    if (this.result === null) return 0; // 不在场零高（浮层不占布局）
    // 空条目也占一行（空态行也是信息——「无匹配」诚实反馈，model-picker
    // 「（无匹配…）」行同律）：量 0 会被 fixed-budget 归零、backend 段四
    // `budget.popup > 0` 门控跳渲染——render 的空分支成死路（打错前缀静默
    // 无反馈），修前即此结构性不可达形
    return Math.max(1, Math.min(this.result.items.length, MAX_VISIBLE_ITEMS));
  }

  /** 落位：铺底空格 → 可见窗条目行（选中整行 accent bold + desc 列对齐） */
  render(buffer: CellBuffer, region: Region): void {
    if (this.result === null) return;
    // 铺底空格（写格覆盖——未写格会透出主树文字；补全弹窗不吃底色——menu
    // surface 族分立在案，与 select/审批面板两类面分立）
    for (let r = 0; r < region.height; r++) {
      for (let c = 0; c < region.width; c++) {
        buffer.setCell(region.row + r, region.col + c, ' ');
      }
    }
    const items = this.result.items;
    if (items.length === 0) {
      buffer.writeText(region.row, region.col, '无匹配', EMPTY_STYLE);
      return;
    }
    // desc 起列（全集基准——滚动不挪列）：缩进 2 + max(label 显示宽) + 间隔 2
    const descCol = ROW_INDENT.length + Math.max(...items.map((item) => stringWidth(item.label))) + ROW_INDENT.length;
    // desc 段右界帽 ≤ 区域宽 70%——起列已越帽的极长 label 形 desc 诚实不显
    const descAvail = Math.floor(region.width * DESC_RIGHT_RATIO) - descCol;
    const end = Math.min(items.length, this.windowStart + MAX_VISIBLE_ITEMS);
    for (let i = this.windowStart; i < end; i++) {
      const row = region.row + (i - this.windowStart);
      const item = items[i]!;
      const active = i === this.activeIndex;
      // label 帽 = 行宽 − 缩进（… 收口）；选中行整行 accent bold（含 desc 段）
      const label = ellipsize(`${ROW_INDENT}${item.label}`, region.width);
      buffer.writeText(row, region.col, label, active ? this.activeStyle : undefined);
      if (descAvail > 0 && item.detail !== undefined && item.detail !== '') {
        const detail = ellipsize(item.detail, descAvail);
        buffer.writeText(row, region.col + descCol, detail, active ? this.activeStyle : DETAIL_STYLE);
      }
    }
  }

  /** 事件分发（弹层可见才有意义）：↑/↓ / enter / tab / escape，其余穿透 */
  handleEvent(event: InputEvent): boolean {
    if (this.result === null) return false; // 不在场不挡键
    if (event.kind !== 'key') return false; // 文本 / IME / 粘贴穿透回输入件
    if (event.phase === 'release') return false;
    if (event.ctrl || event.alt || event.shift || event.meta) return false; // 修饰组合穿透（编辑键面）
    // 空态行键面（2026-10-04 空态反馈批——provider 空条目透传形，items 恒空）：
    // ↑/↓ / enter / tab 全穿透。enter 穿透是硬语义——「无匹配」在场时回车必须
    // 归编辑器走提交（吞键把打错前缀逼成「先收层再回车」双 enter 形，与下方
    // 全量输入穿透律同族）；tab 无可选可应用（编辑器未绑 tab 归终局）、↑/↓ 无
    // 候选可导航（moveActive 空转吞箭头会堵编辑器历史回溯/光标键）——同回编辑
    // 器键面。escape 例外落下方关层分支：空态行也是信息层，用户可显式收层。
    if (this.result.items.length === 0 && event.key !== 'escape') return false;
    if (event.key === 'up') {
      this.moveActive(-1);
      return true;
    }
    if (event.key === 'down') {
      this.moveActive(1);
      return true;
    }
    if (event.key === 'enter' || event.key === 'tab') {
      // 陈旧窗守卫（R6 批 10j）：防抖窗内弹层可持上轮 result——陈旧区间上
      // 代换会劈坏文本（'/help l' 形）。对拍光标 token 现区间，陈旧即收层
      // 穿透（enter 走提交语义、tab 回编辑器键面）。
      if (this.resultStale()) {
        this.applyResult(null);
        return false;
      }
      // 全量输入穿透律（2026-09-13 真模型五轮实测定罪修复）：当前 token 已是
      // 高亮项 replacement 全文时，enter 的「应用」是无净代换的空动作——吞键
      // 会把完整输入的斜杠命令逼成「先应用再提交」双 enter 形（且第二次输入
      // 与残留拼接进模型）。此处 enter 穿透回编辑器走提交语义；tab 专职填充
      // 无提交歧义、恒应用（键面分离）。
      if (event.key === 'enter' && this.selectionAlreadyTyped()) return false;
      this.applySelection();
      return true;
    }
    if (event.key === 'escape') {
      this.applyResult(null); // 关本轮（后续输入再发新查重开）
      // 关层联动通知：backend 撤防抖窗 + 作废在途——否则 kitty 轨 escape 即达
      // 即决后，窗内已武装的查询迟到 fire 会重开刚关的弹层（闪回）
      this.onDismiss?.();
      return true;
    }
    return false; // 其余键穿透（backspace / 字符等继续编辑——弹层随下次 refresh 重算）
  }

  /** 高亮循环移动 + 窗口跟随（10 行帽外的条目滚动入窗） */
  private moveActive(delta: number): void {
    const count = this.result?.items.length ?? 0;
    if (count === 0) return;
    this.activeIndex = (this.activeIndex + delta + count) % count;
    if (this.activeIndex < this.windowStart) this.windowStart = this.activeIndex;
    if (this.activeIndex >= this.windowStart + MAX_VISIBLE_ITEMS) {
      this.windowStart = this.activeIndex - MAX_VISIBLE_ITEMS + 1;
    }
  }

  /** 应用选中项：整 token 代换（模型原语——光标落代换尾） */
  private applySelection(): void {
    const result = this.result;
    if (result === null || result.items.length === 0) return;
    const item = result.items[this.activeIndex]!;
    this.result = null; // 应用即隐（先隐后代换——代换的 notify 可能再触发 refresh 重开，属新轮）
    const cursor = this.model.getCursor();
    this.model.replaceToken(cursor.line, result.replaceStart, result.replaceEnd, item.replacement);
  }

  /**
   * 全量输入判定：光标 token 现文本 === 高亮项 replacement 全文（enter 路径
   * 已过陈旧守卫——result 区间与 token 现区间一致，slice 取值即新鲜）。
   *
   * 尾空白容差（2026-10-02 e2e Enter 间歇丢失定罪修复）：活体/静态参数位
   * （会话 id / 检查点 / plugins / goal / 静态子动词枚举）铸造 replacement
   * 惯携尾空格——应用后直进下一 token 位。精确比对会被这一个尾空格击穿，
   * enter 被「无净代换的应用」吞掉：代换仅追加不可见尾空格（视觉零变化），
   * 命令永不提交（/resume e2ehist + Enter 间歇失效真凶——弹层 20ms 防抖后
   * 在场即吞，竞速成败随风距）。比对前剥 replacement 尾空白——token 已是
   * 替换文全文（含续打位铸造形）即穿透，提交语义归编辑器；tab 不走本判
   * 恒应用（补尾空格进续打位——键面分离）。
   */
  private selectionAlreadyTyped(): boolean {
    const result = this.result;
    if (result === null || result.items.length === 0) return false;
    const item = result.items[this.activeIndex]!;
    const line = this.model.getLines()[this.model.getCursor().line];
    if (line === undefined) return false;
    const want = item.replacement.replace(/[ ]+$/, ''); // 尾空白容差（续打位铸造形）
    return line.slice(result.replaceStart, result.replaceEnd) === want;
  }

  /**
   * 陈旧判定（R6 批 10j）：result 代换区间对拍光标 token 现区间。防抖窗内
   * 输入已变更而新查未发——token 现区间与上轮 result 区间失配即陈旧；
   * 无 token（光标在空白段）也判陈旧（上轮区间必不匹配空段）。
   */
  private resultStale(): boolean {
    const result = this.result;
    if (result === null) return false; // 不在场无陈旧可言（handleEvent 已挡）
    const cursor = this.model.getCursor();
    const line = this.model.getLines()[cursor.line] ?? '';
    const token = tokenAtCursor(line, cursor.col);
    return token === null || token.start !== result.replaceStart || token.end !== result.replaceEnd;
  }
}
