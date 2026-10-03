/**
 * host/session-tier-copy 短词两表全键值对直锁（lane-C 件3——值漂移即红）。
 *
 * MODE_SHORT / SANDBOX_MODE_SHORT 的三档值此前只有 workspace-write→Auto 经
 * 真装配被锁（tui-entry.test footer 行1 锚），计划/YOLO 两档全部由测试自注入
 * 绕过换词表——两表值互换全门禁不红。本组直锁两表全键值对（用户口述定词，
 * 07 §4.1 注⑪② 单源）：it.each 逐档一一对应 + 整表 toEqual 双锚（后者兼锁
 * 键集全集——Record<SandboxMode, string> 编译期锁缺键，运行期锁多键/漏键）。
 * 真装配面（MODE_SHORT[danger] → footer 行1）由 tui-entry.test footer 档位段
 * 装配锁补 YOLO 锚承接（07 §4.1 注⑪③「两行都保留原词」的两表示一致性）。
 */
import { describe, expect, it } from 'vitest';

import { MODE_SHORT, SANDBOX_MODE_SHORT } from './session-tier-copy.js';

describe('短词两表全键值对直锁（MODE_SHORT 换词 / SANDBOX_MODE_SHORT 原词——值漂移即红）', () => {
  // 逐档一一对应：行1 模式词（换词表）与行2 沙箱原词（原词表）同档双锁
  it.each([
    ['read-only', '计划', '只读'],
    ['workspace-write', 'Auto', '工作区写'],
    ['danger', 'YOLO', '无沙箱'],
  ] as const)('档 %s：MODE_SHORT=%s + SANDBOX_MODE_SHORT=%s', (mode, modeShort, sandboxShort) => {
    expect(MODE_SHORT[mode]).toBe(modeShort);
    expect(SANDBOX_MODE_SHORT[mode]).toBe(sandboxShort);
  });

  it('MODE_SHORT 整表全等（换词表——计划/Auto/YOLO 用户口述定词单源）', () => {
    expect(MODE_SHORT).toEqual({ 'read-only': '计划', 'workspace-write': 'Auto', danger: 'YOLO' });
  });

  it('SANDBOX_MODE_SHORT 整表全等（原词表——行2 沙箱原词 + picker 档位名单源）', () => {
    expect(SANDBOX_MODE_SHORT).toEqual({ 'read-only': '只读', 'workspace-write': '工作区写', danger: '无沙箱' });
  });
});
