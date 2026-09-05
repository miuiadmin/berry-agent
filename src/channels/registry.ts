/**
 * 多会话注册表与焦点编排（07 §4.1 通道契约——2026-09-06 channels 纵切批）。
 *
 * 职责：会话在场集合 + 焦点位（聚焦者全渲染/非聚焦摘要行的判定源）+
 * 焦点切换清屏重画（拉投影 → repaint 回调——投影拉取经装配注入，
 * channels 不 import session 是 02 §4.1 边表的刻意设计）。
 *
 * 焦点切换不自动回退：聚焦会话注销后焦点空悬（focused=null——非聚焦态
 * 全体），下一焦点由用户动作显式给（切焦编舞归 TUI 呈现批）。
 */

export class SessionChannels<TProjection> {
  private readonly sessions = new Set<string>();
  private currentFocus: string | null = null;

  constructor(
    private readonly fetchProjection: ((sessionId: string) => Promise<readonly TProjection[]>) | undefined,
    private readonly repaint: (sessionId: string, projection: readonly TProjection[]) => void,
  ) {}

  /** 会话入场（幂等；焦点不自动变更——显式 focus 才切） */
  registerSession(sessionId: string): void {
    this.sessions.add(sessionId);
  }

  /** 会话退场：在场集移除；若正是聚焦者 → 焦点空悬（不自动接续） */
  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.currentFocus === sessionId) this.currentFocus = null;
  }

  /** 当前聚焦会话（null = 焦点空悬——全体非聚焦态） */
  get focusedId(): string | null {
    return this.currentFocus;
  }

  isFocused(sessionId: string): boolean {
    return this.currentFocus === sessionId;
  }

  /** 在场判定（emit 路由前置——不在场会话的信封仍可分流，呈现裁剪归后端） */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 焦点切换（07 §4.1：清屏重画）：置位 → 拉投影 → repaint。
   * 投影拉取缺席 → 空投影重画（诚实缺席：装配缺真源是可观察态，不静默假装
   * 有历史）；拉取异常向上抛（fail-loud——投影真源故障不降级为「无历史」谎言）。
   * 未注册会话 focus 视同注册（焦点即活跃声明——幂等）。
   */
  async focus(sessionId: string): Promise<void> {
    this.registerSession(sessionId);
    this.currentFocus = sessionId;
    const projection = await (this.fetchProjection?.(sessionId) ?? []);
    // 焦点可能在拉投影期间被再切（快速切焦）——只为本焦点落画（迟到的旧画弃）
    if (this.currentFocus === sessionId) {
      this.repaint(sessionId, projection);
    }
  }
}
