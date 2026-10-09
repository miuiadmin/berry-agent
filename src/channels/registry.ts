/**
 * 多会话注册表与焦点编排（07 §4.1 通道契约——2026-09-06 channels 纵切批）。
 *
 * 职责：会话在场集合 + 焦点位（聚焦者全渲染/非聚焦摘要行的判定源）+
 * 焦点切换清屏重画（拉投影 → repaint 回调——投影拉取经装配注入，
 * channels 不 import session 是 02 §4.1 边表的刻意设计）+ 命令完成尾
 * 强制重画（refresh——聚焦者投影已变即时呈现位，07 B2 定形注销账）。
 *
 * 焦点切换不自动回退：聚焦会话注销后焦点空悬（focused=null——非聚焦态
 * 全体），下一焦点由用户动作显式给（切焦编舞归 TUI 呈现批）。
 */

export class SessionChannels<TProjection> {
  private readonly sessions = new Set<string>();
  private currentFocus: string | null = null;
  /** 曾有焦点位（挖掘 27 轮 [10] headless 焦点误判防线）：focus 首调置位永不清 */
  private everFocused = false;

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

  /**
   * 曾有焦点位读取（挖掘 27 轮 [10]）：headless（focus 生产位全在 TUI 路径）
   * 下 focusedId===null 是常态而非「刚被清」——消费位区分「从未聚焦」与
   * 「聚焦后被注销」须读本位，不能从 focusedId 反推。
   */
  get hasEverFocused(): boolean {
    return this.everFocused;
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
    // 曾有焦点位置位（永不清——注销只清 currentFocus 不清本位）：headless
    // 焦点误判防线的真源（见 hasEverFocused 注释）
    this.everFocused = true;
    const projection = await (this.fetchProjection?.(sessionId) ?? []);
    // 焦点可能在拉投影期间被再切（快速切焦）——只为本焦点落画（迟到的旧画弃）
    if (this.currentFocus === sessionId) {
      this.repaint(sessionId, projection);
    }
  }

  /**
   * 命令完成尾强制重画（07 §4.1 ZCode TUI 对标批 B2 定形注挂账销账——
   * B2R）：投影已变想即时可见的消费位调用（/compact 成功档等）。与 focus
   * 的「视同注册」分职——refresh 是纯呈现位非活跃声明：入口判
   * currentFocus !== sessionId 即 return（非聚焦/焦点空悬 no-op，不注册
   * 不置位）；拉投影后复检焦点仍同（拉取期间可切——「迟到的旧画弃」同律）
   * 才 repaint。投影拉取缺席 → 空投影重画、异常上抛（focus 同律）。
   */
  async refresh(sessionId: string): Promise<void> {
    if (this.currentFocus !== sessionId) return; // 守卫归核双检形之一：入口位
    const projection = await (this.fetchProjection?.(sessionId) ?? []);
    // 双检形之二：拉取期间焦点可能被切走——只为仍聚焦的本会话落画
    if (this.currentFocus === sessionId) {
      this.repaint(sessionId, projection);
    }
  }
}
