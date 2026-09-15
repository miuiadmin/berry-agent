/**
 * testkit 假宿主 channels-ui 受局面测试（W2——四问评估落地批）。
 *
 * 修前红锚：规范已定 ctx.ui.notify 无会话位恒可（docs/plugin-development.md
 * §ctx 能力面交互行），但 harness 的 bootOptions 八键未注 channelsUi 受局面
 * ——插件 apply 期调 ctx.ui.notify 即炸 CONTEXT_SERVICE_MISSING（受局面缺席）
 * → PLUGIN_APPLY_FAILED 进 failed 面。本批补假受局面最小注入：
 * - notify 收件入账（harness.ui.notifies() 可断言）；
 * - hasAudience 恒 false（假宿主无真人观众——诚实值）；
 * - hasSession 恒 false（假宿主零在册会话——阻塞三件/单向原语按真判序
 *   诚实拒/降档，不静默全开）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createPluginHarness } from './harness.js';

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 真盘试件插件目录速记（entry 源码由用例给定——真 jiti 求值） */
function makePluginDir(entrySource: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'testkit-ui-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
  );
  writeFileSync(join(dir, 'entry.js'), entrySource);
  return dir;
}

describe('testkit 假宿主 channels-ui 受局面（W2——notify 无会话位恒可的 testkit 对齐）', () => {
  it('apply 期 ctx.ui.notify 装载成功且收件可断言（修前红：受局面缺席炸 apply）', async () => {
    const dir = makePluginDir(
      'export default async (ctx) => { ctx.ui.notify("装载完成", { level: "success" }); };',
      'ui-notify-demo',
    );
    const h = createPluginHarness({ pluginDir: dir });
    await h.install();
    h.mountRow();
    const boot = await h.boot();
    // 装载成功：apply 内 notify 不炸（档位 1 无会话位恒可——受局面在场）
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toContain(h.pluginId);
    // 收件入账可断言（假受局面记录面——message + level 正序）
    expect(h.ui.notifies()).toEqual([{ message: '装载完成', level: 'success' }]);
    await h.dispose();
  });

  it('假受局面诚实面：hasAudience 恒 false + apply 期单向原语无锚 no-op warn', async () => {
    const warns: string[] = [];
    const dir = makePluginDir(
      'export default async (ctx) => { ctx.ui.notify(`audience=${ctx.ui.hasAudience()}`); ctx.ui.setStatus("busy"); };',
      'ui-degrade-demo',
    );
    const h = createPluginHarness({ pluginDir: dir, warn: (m) => warns.push(m) });
    await h.install();
    h.mountRow();
    const boot = await h.boot();
    // 单向原语无锚降档不炸装载（apply 期结构性无自动锚——ALS 遮蔽内）
    expect(boot.report.activated.map((a) => a.id)).toContain(h.pluginId);
    // 降档 warn 走 harness warn 出口（uiWarn 与 warn 同汇——不噪缺省静默面）
    expect(warns.some((w) => w.includes('setStatus') && w.includes('no-op'))).toBe(true);
    // 探针诚实值：假宿主无真人观众恒 false（notify 收件照常可断言）
    expect(h.ui.notifies().map((n) => n.message)).toEqual(['audience=false']);
    await h.dispose();
  });

  it('apply 期阻塞三件无锚拒 UI_ASK_UNANCHORED → 行级隔离进 failed 面（不静默全开）', async () => {
    const dir = makePluginDir('export default async (ctx) => { await ctx.ui.confirm("继续?"); };', 'ui-confirm-demo');
    const h = createPluginHarness({ pluginDir: dir });
    await h.install();
    h.mountRow();
    const boot = await h.boot();
    // 假受局面不静默放行阻塞问询：装载期无锚即拒（fail-loud 非 fake resolve；
    // 归一为 PLUGIN_APPLY_FAILED，内层固定文案「无会话锚」= UI_ASK_UNANCHORED 面）
    const fail = boot.report.failed.find((f) => f.id === h.pluginId);
    expect(fail?.code).toBe('PLUGIN_APPLY_FAILED');
    expect(fail?.message).toContain('无会话锚');
    await h.dispose();
  });
});
