/**
 * 状态行件（07 §4.1 呈现面件 3——批 10d-4；V-3 注⑧③ 忙态族整役退役）。
 *
 * - 忙态呈现归件 12 任务状态行（09-30 UX 批迁移定谳）——本件忙态族
 *   （转轮/工具名/速度段/启停 API）生产零调用系死路，随 V-3 净除：
 *   renderSplit/renderLegacy 忙态分支、SPINNER_FRAMES 转轮、busy/
 *   busyText/toolName/frameIndex/speedText 字段与 start/stop/setTool/
 *   tick/attachSpeedText/isBusy/frame 全族；
 * - 存留面：闲态文案（setStatus last-writer-wins——件 6 usage/aborted
 *   尾注与 ctx.ui.setStatus 同载体的回执行）+ footer 常驻段（secondary
 *   弱化——常驻信息退后，层级 = 状态信息 > footer 段；setTheme 派生
 *   重建同律）；
 * - onChange 通知：状态任何变更（换文案/换 footer）触发——装配层接重绘。
 */
import type { CellBuffer, CellStyle, Region, Renderable } from '../../engine/index.js';
import { ellipsize, stringWidth } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/** 状态行件（量高恒 1 行——底部固定区状态行；闲态文案 + footer 分栏） */
export class StatusLine implements Renderable {
  /** 状态变更通知（装配层接重绘请求——setStatus/setFooter） */
  onChange?: () => void;
  /** 闲态文案（setStatus last-writer-wins——件 6 尾注/回执行同载体） */
  private idleText = '';
  /**
   * footer 常驻段样式（secondary 次文键——界面美化役 2026-10-01：常驻
   * 拼段是底噪信息，全亮度呈现会抢状态信息的层级；setTheme 派生重建）。
   */
  private footerStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.secondary });
  /** 常驻 footer 段（空串 = 无 footer 旧形零扰动） */
  private footerText = '';

  /** 主题换装（backend 注入——secondary 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.footerStyle = Object.freeze({ fg: theme.secondary });
  }

  /** 量高：恒 1（状态行单行制） */
  measure(width: number): number {
    void width;
    return 1;
  }

  /** 落位：footer 缺席 = 旧形（闲态文案居左）；在场 = 左右分栏（footer 左/闲态文案右对齐） */
  render(buffer: CellBuffer, region: Region): void {
    if (this.footerText === '') {
      // 旧形（footer 缺席——零扰动锚）
      if (this.idleText !== '') buffer.writeText(region.row, region.col, this.idleText);
      return;
    }
    if (this.idleText === '') {
      // 闲态无右段——左段独占（R6「闲态左段独占」条款）
      buffer.writeText(region.row, region.col, this.fitFooter(region.width), this.footerStyle);
      return;
    }
    // 闲态右段剩余宽帽（B-render 批帽律承袭）：idleText 无界时右对齐起点
    // = col + width - idleWidth 可为负——writeText 逐字素被网格边界静默吞
    // 头部（cell 面 col<0 吸收），且 footer 剩余宽 ≤ 0 整段消失。帽 =
    // width - 2：间隔 1 列 + footer 至少留 1 列截断形——截断后起点恒 ≥
    // region.col；截断形走 ellipsize … 尾缀（截断省略号全域统一律）
    const idle = ellipsize(this.idleText, Math.max(0, region.width - 2));
    const idleWidth = stringWidth(idle);
    buffer.writeText(region.row, region.col, this.fitFooter(region.width - idleWidth - 1), this.footerStyle);
    buffer.writeText(region.row, region.col + region.width - idleWidth, idle);
  }

  /** footer 适配剩余宽（超宽整字截断 + 省略号；非超宽原样——0 宽早退由 ellipsize 单源守卫吸收） */
  private fitFooter(max: number): string {
    return ellipsize(this.footerText, max);
  }

  /** 闲态文案（last-writer-wins——usage 行与自定义状态同载体共存） */
  setStatus(text: string): void {
    this.idleText = text;
    this.onChange?.();
  }

  /** 常驻 footer 段（装配注入拼段——缺席段缩位不虚报在装配侧拼段时执法）；空串清除回旧形 */
  setFooter(text: string): void {
    this.footerText = text;
    this.onChange?.();
  }
}
