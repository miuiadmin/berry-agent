/**
 * checkpoint 域错误码目录锁（70 轮件D——description 帽语义勘正红锁）：
 * CHECKPOINT_CAPTURE_FAILED 修前 description 只提「walk 超文件帽」，65 轮
 * 件D 落字节双帽（walk.ts 枚举面 stat 先行执法：单文件帽 + 单快照总量帽）
 * 后语义滞后——勘正为含「超文件帽与字节双帽」。本锁钉住 description 不再
 * 回退到单帽语义（改码面执法维须同步改目录语义）。
 */
import { describe, expect, it } from 'vitest';

import { getErrorCodeInfo } from '../../src/contracts/index.js';
// 注册纪律：import 发生才注册（codes.ts 由本测试直引触发四码入册）
import './codes.js';

describe('checkpoint 错误码目录（70 轮件D——CAPTURE_FAILED 帽语义勘正锁）', () => {
  it('CHECKPOINT_CAPTURE_FAILED description 含字节双帽语义（修前红：只提「含 walk 超文件帽」）', () => {
    const info = getErrorCodeInfo('CHECKPOINT_CAPTURE_FAILED');
    expect(info?.module).toBe('checkpoint'); // 目录条目在册（注册面不动）
    // 修前红锚：65 轮件D 字节双帽执法已成而 description 无「字节」字样
    expect(info?.description).toContain('字节');
    // 勘正语义 = 超文件帽与字节双帽并列（防「帽」泛词假绿——两维执法都须入语义）
    expect(info?.description).toContain('超文件帽与字节双帽');
  });
});
