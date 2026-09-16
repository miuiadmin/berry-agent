/**
 * host/plugin-market/ttl —— 24h TTL 惰性刷新判据纯函数（03 §9.6 源清单与
 * 缓存节·失效降级）。
 *
 * 惰性刷新语义：discover/装机触发时点查 `updatedAt` 过龄才建议刷新（无后台
 * 定时器——无人值守形态下刷新是读侧顺带动作）。`>=` 语义（恰 24h 即过龄，
 * omp 同律）；坏 ISO 时间戳一律判 stale（刷新更安全——防坏形永不过龄）。
 * stale **照用**（离线 OK）：判据只驱动提示/顺带刷新，不阻塞呈现。
 */

/** TTL 常量：24 小时（毫秒） */
export const MARKETPLACE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 判过龄：`nowMs - updatedAt >= MARKETPLACE_TTL_MS`（≥ 语义——边界即过龄）。
 * 坏 ISO / 空串 = stale（刷新更安全）。
 */
export function isCatalogStale(updatedAt: string, nowMs: number): boolean {
  const at = Date.parse(updatedAt);
  if (Number.isNaN(at)) return true; // 坏时间戳——刷新比沿用更安全
  return nowMs - at >= MARKETPLACE_TTL_MS;
}
