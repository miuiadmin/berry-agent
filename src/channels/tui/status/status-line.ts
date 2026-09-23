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
import { ellipsize, stringWidth, truncateToWidth } from '../../engine/index.js';
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
  /**
   * 忙态速度段供字器（三反馈批B——件 6 批C speedView 的忙态消费位）：每帧
   * 现拉（'' = 缺席缩位）；backend 注入格式化闭包，本件零速度知识。
   */
  private speedText: (() => string) | null = null;

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
      // 转轮后文案段（rest 自带前导空格——起点 = 转轮格 +1；工具段优先 + 速度段
      // 尾拼 ` · `——三反馈批B，两缺席段各自缩位）
      const rest = this.busyRest();
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
      // 忙态右段剩余宽帽（2026-09-20 TUI 修复组 1 批 F4）：rest 无界时
      // spinnerCol = col + width - 1 - restWidth 可为负——转轮写出被网格
      // 边界吞掉、右段尾截断错位；帽 = width - 1（至少给转轮留 1 列），
      // 整字截断后 spinnerCol 恒 ≥ region.col
      const raw = this.busyRest();
      const rest = raw === '' ? '' : truncateToWidth(raw, Math.max(0, region.width - 1));
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
    // 闲态右段剩余宽帽（B-render 批——同忙态 F4 帽律）：idleText 无界时
    // 右对齐起点 = col + width - idleWidth 可为负——writeText 逐字素被网格
    // 边界静默吞头部（cell 面 col<0 吸收），且 footer 剩余宽 ≤ 0 整段消失。
    // 帽 = width - 2：间隔 1 列 + footer 至少留 1 列截断形（忙态帽的 -1 是
    // 给转轮列，闲态无转轮故让此列给 footer）——截断后起点恒 ≥ region.col
    const idle = truncateToWidth(this.idleText, Math.max(0, region.width - 2));
    const idleWidth = stringWidth(idle);
    buffer.writeText(region.row, region.col, this.fitFooter(region.width - idleWidth - 1));
    buffer.writeText(region.row, region.col + region.width - idleWidth, idle);
  }

  /** footer 适配剩余宽（超宽整字截断 + 省略号；非超宽原样——0 宽早退由 ellipsize 单源守卫吸收） */
  private fitFooter(max: number): string {
    return ellipsize(this.footerText, max);
  }

  /**
   * 忙态右段文案（自带前导空格；'' = 空）：基础段（工具段 `⚙ 名 …` 优先 /
   * 活动文案让位）+ 速度段尾拼 ` · `（三反馈批B——speedView 现拉 running
   * average，缺席 '' 缩位）。两形（旧形/分栏）单源消费本拼装。
   */
  private busyRest(): string {
    const base = this.toolName !== null ? `⚙ ${this.toolName} …` : this.busyText !== '' ? this.busyText : '';
    const speed = this.speedText !== null ? this.speedText() : '';
    if (base === '' && speed === '') return '';
    return ` ${[base, speed].filter((segment) => segment !== '').join(' · ')}`;
  }

  /**
   * 忙态速度段供字器注入（三反馈批B——backend 消费位）：provider 返 '' =
   * 缺席缩位；每帧渲染现拉（速度随 tick 推进 = running average 活值）。
   */
  attachSpeedText(provider: () => string): void {
    this.speedText = provider;
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
