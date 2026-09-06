/**
 * 幂等 admit 判定测试（03 §10.6 线协议④ + 05 §3.5 durable 承载条——批 13a）。
 *
 * 锁三档语义 + 两词一字段两面（messageId 受理时即落账为 data.dedupeKey——
 * 键域同一无变换，本函数以 messageId 直查）。
 */
import { describe, expect, it } from 'vitest';
import { admitMessage } from './admit.js';

describe('admitMessage 三档判定', () => {
  it('无同键 = fresh（受理新跑）', () => {
    const known = new Map([['m-1', '旧内容']]);
    expect(admitMessage(known, 'm-2', '新消息')).toEqual({ status: 'fresh' });
  });

  it('同键同内容 = duplicate（幂等重收执——回执即既存事件经 after 重放可取、不重跑）', () => {
    const known = new Map([['m-1', '同一段内容']]);
    expect(admitMessage(known, 'm-1', '同一段内容')).toEqual({ status: 'duplicate' });
  });

  it('同键异内容 = conflict（SDK_MESSAGE_CONFLICT——误判超时重发零副用的反面执法位）', () => {
    const known = new Map([['m-1', '原内容']]);
    expect(admitMessage(known, 'm-1', '改口内容')).toEqual({
      status: 'conflict',
      code: 'SDK_MESSAGE_CONFLICT',
    });
  });

  it('内容全等比对无归一化（空白差异即异内容）', () => {
    const known = new Map([['m-1', 'a b']]);
    expect(admitMessage(known, 'm-1', 'a  b')).toEqual({
      status: 'conflict',
      code: 'SDK_MESSAGE_CONFLICT',
    });
  });

  it('两词一字段两面：键域即 messageId（两键同内容互不干扰——键身份唯一）', () => {
    const known = new Map([
      ['m-1', '同文'],
      ['m-2', '同文'],
    ]);
    expect(admitMessage(known, 'm-1', '同文')).toEqual({ status: 'duplicate' });
    expect(admitMessage(known, 'm-3', '同文')).toEqual({ status: 'fresh' });
  });
});
