/**
 * 状态行动画件（07 §4.1 呈现面件 3——批 10d-4）。
 *
 * - 转轮帧动画：braille 十帧（accent 着色——引擎节件 3 着色纪律的两个
 *   accent 载体之一：对话输入件焦点边框与本件转轮）；帧推进 = `tick()`
 *   （装配层定时驱动——件内零自驱时钟，测试确定性前提）；
 * - 工具名实时显示：`tool_execution_start` 消费点 → ` ⚙ <工具名> …`
 *   （状态面消费——正文面零渲染不变）；
 * - 启停驱动：agent_start → start()、agent_end → stop()；
 * - 与 setStatus last-writer-wins 共存（件 6 usage 行与 ctx.ui.setStatus
 *   同一载体的闲态文案）：忙态显转轮段、闲态显文案行；
 * - onChange 通知：状态任何变更（启停/换工具/换文案/推帧）触发——装配层
 *   接重绘请求。
 */
import type { CellBuffer, CellStyle, Region, Renderable } from '../../engine/index.js';
import { stringWidth, truncateToWidth } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/** 转轮帧序（braille 十帧——accent 呈现形态随组件批定形，本批定形） */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** 状态行动画件（量高恒 1 行——底部固定区状态行） */
export class StatusLine implements Renderable {
  /** 状态变更通知（装配层接重绘请求——start/stop/setTool/setStatus/tick） */
  onChange?: () => void;
  private busy = false;
  /** 忙态文案（agent_start 附带的活动描述——工具名在场时让位） */
  private busyText = '';
  /** 闲态文案（setStatus last-writer-wins——忙时写入挂起、闲时呈现） */
  private idleText = '';
  /** 实时工具名（tool_execution_start 写入；null = 无工具在场） */
  private toolName: string | null = null;
  private frameIndex = 0;
  /** 转轮样式（accent 派生——主题单源，setTheme 整体重建） */
  private spinnerStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.accent });
  /** 常驻 footer 段（R6 批 10k——装配注入 cwd 短名/模型名/会话短 id 拼段；空串 = 无 footer 旧形零扰动） */
  private footerText = '';

  /** 主题换装（OSC 11 probe 裁定后 backend 注入——accent 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.spinnerStyle = Object.freeze({ fg: theme.accent });
  }

  /** 量高：恒 1（状态行单行制） */
  measure(width: number): number {
    void width;
    return 1;
  }

  /** 落位：footer 缺席 = 旧形（忙态转轮+文案居左 / 闲态文案居左——既有测试全锚此态） */
  render(buffer: CellBuffer, region: Region): void {
    if (this.footerText === '') {
      this.renderLegacy(buffer, region);
      return;
    }
    this.renderSplit(buffer, region);
  }

  /** 旧形落位（footer 缺席——R6 批 10k 前行为原样，零扰动锚） */
  private renderLegacy(buffer: CellBuffer, region: Region): void {
    if (this.busy) {
      const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!;
      buffer.writeText(region.row, region.col, frame, this.spinnerStyle);
      // 转轮后文案段（rest 自带前导空格——起点 = 转轮格 +1；工具名优先——件 3 语义）
      const rest = this.toolName !== null ? ` ⚙ ${this.toolName} …` : this.busyText !== '' ? ` ${this.busyText}` : '';
      if (rest !== '') buffer.writeText(region.row, region.col + 1, rest);
    } else if (this.idleText !== '') {
      buffer.writeText(region.row, region.col, this.idleText);
    }
  }

  /**
   * 分栏落位（R6 批 10k——footer 在场）：左段 = footer 常驻信息 col 0；右段
   * = 忙态（转轮 accent + 工具段/活动文案）或闲态文案，**右对齐**；闲态无
   * 右段文案 = 左段独占整行。重叠防护：footer 按剩余宽整字截断加省略号
   * （CJK 双宽不产半字——truncateToWidth 整字三原语）。
   */
  private renderSplit(buffer: CellBuffer, region: Region): void {
    if (this.busy) {
      const rest = this.toolName !== null ? ` ⚙ ${this.toolName} …` : this.busyText !== '' ? ` ${this.busyText}` : '';
      const restWidth = stringWidth(rest);
      const spinnerCol = region.col + region.width - 1 - restWidth;
      buffer.writeText(region.row, region.col, this.fitFooter(region.width - 1 - restWidth - 1));
      buffer.writeText(
        region.row,
        spinnerCol,
        SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!,
        this.spinnerStyle,
      );
      if (rest !== '') buffer.writeText(region.row, spinnerCol + 1, rest);
      return;
    }
    if (this.idleText === '') {
      // 闲态无右段——左段独占（R6「闲态左段独占」条款）
      buffer.writeText(region.row, region.col, this.fitFooter(region.width));
      return;
    }
    const idleWidth = stringWidth(this.idleText);
    buffer.writeText(region.row, region.col, this.fitFooter(region.width - idleWidth - 1));
    buffer.writeText(region.row, region.col + region.width - idleWidth, this.idleText);
  }

  /** footer 适配剩余宽（超宽整字截断 + 省略号；非超宽原样） */
  private fitFooter(max: number): string {
    if (max <= 0) return '';
    return stringWidth(this.footerText) <= max ? this.footerText : `${truncateToWidth(this.footerText, max - 1)}…`;
  }

  /** 进入忙态（agent_start 驱动；text = 可选活动描述） */
  start(text = ''): void {
    this.busy = true;
    this.busyText = text;
    this.toolName = null;
    this.onChange?.();
  }

  /** 退出忙态（agent_end 驱动——工具名一并清） */
  stop(): void {
    this.busy = false;
    this.toolName = null;
    this.onChange?.();
  }

  /** 忙态观测（装配层布防抖逻辑用） */
  get isBusy(): boolean {
    return this.busy;
  }

  /** 实时工具名（tool_execution_start → name；null 清——工具退场） */
  setTool(name: string | null): void {
    this.toolName = name;
    this.onChange?.();
  }

  /** 闲态文案（last-writer-wins——usage 行与自定义状态同载体共存） */
  setStatus(text: string): void {
    this.idleText = text;
    this.onChange?.();
  }

  /**
   * 常驻 footer 段（R6 批 10k）：装配注入拼段（cwd 短名 · 模型名 · 会话短
   * id——缺席段缩位不虚报在装配侧拼段时执法）；空串清除回旧形。
   */
  setFooter(text: string): void {
    this.footerText = text;
    this.onChange?.();
  }

  /** 推帧（装配层定时驱动——仅忙态有意义；闲态推帧零变化零通知） */
  tick(): void {
    if (!this.busy) return;
    this.frameIndex++;
    this.onChange?.();
  }

  /** 当前转轮帧观测面（测试断言帧推进用） */
  get frame(): string {
    return SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!;
  }
}
