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
import { ansiColor } from '../../engine/index.js';
import { ACCENT_INDEX } from '../theme.js';

/** 转轮帧序（braille 十帧——accent 呈现形态随组件批定形，本批定形） */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** 转轮样式（accent 定值——theme 单源） */
const SPINNER_STYLE: Readonly<CellStyle> = Object.freeze({ fg: ansiColor(ACCENT_INDEX) });

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

  /** 量高：恒 1（状态行单行制） */
  measure(width: number): number {
    void width;
    return 1;
  }

  /** 落位：忙态 = 转轮（accent）+ 工具段/活动文案；闲态 = 文案行（空则空行） */
  render(buffer: CellBuffer, region: Region): void {
    if (this.busy) {
      const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!;
      buffer.writeText(region.row, region.col, frame, SPINNER_STYLE);
      // 转轮后文案段（rest 自带前导空格——起点 = 转轮格 +1；工具名优先——件 3 语义）
      const rest = this.toolName !== null ? ` ⚙ ${this.toolName} …` : this.busyText !== '' ? ` ${this.busyText}` : '';
      if (rest !== '') buffer.writeText(region.row, region.col + 1, rest);
    } else if (this.idleText !== '') {
      buffer.writeText(region.row, region.col, this.idleText);
    }
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
