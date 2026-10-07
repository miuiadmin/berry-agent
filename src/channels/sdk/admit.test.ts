/**
 * 幂等 admit 判定测试（03 §10.6 线协议④ + 05 §3.5 durable 承载条——批 13a）。
 *
 * 锁三档语义 + 两词一字段两面（messageId 受理时即落账为 data.dedupeKey——
 * 键域同一无变换，本函数以 messageId 直查）。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admitContentKey, admitKeyFromStored, admitMessage } from './admit.js';

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

describe('admitMessage images 逐件等比（03 §10.4 ① SDK 线同批扩形——admit 幂等内容比较含图）', () => {
  // 两件不同图（data/mimeType 各异）——等比测试素材
  const IMG_A = { data: 'aGVsbG8=', mimeType: 'image/png' };
  const IMG_B = { data: 'eW91', mimeType: 'image/webp' };

  it('同键同文同图同序 = duplicate（data 与 mimeType 逐件全等才算重复）', () => {
    // 受理侧账 = admitContentKey 产物单源种入（canonical 字面形由下个
    // describe 直锁——此处锁判定语义）
    const known = new Map([['m-img', admitContentKey('看图', [IMG_A, IMG_B])]]);
    expect(admitMessage(known, 'm-img', '看图', [IMG_A, IMG_B])).toEqual({ status: 'duplicate' });
  });

  it('异序 = 非重复（图序是比较基准的一部分——[A,B] 与 [B,A] 不同消息）', () => {
    const known = new Map([['m-img', admitContentKey('看图', [IMG_A, IMG_B])]]);
    expect(admitMessage(known, 'm-img', '看图', [IMG_B, IMG_A])).toEqual({
      status: 'conflict',
      code: 'SDK_MESSAGE_CONFLICT',
    });
  });

  it('异图（同 mime 异 data / 同 data 异 mime）/异件数/有无图互变 = 非重复', () => {
    const known = new Map([['m-img', admitContentKey('看图', [IMG_A])]]);
    // 同 mime 异 data
    expect(admitMessage(known, 'm-img', '看图', [{ data: 'bmV3', mimeType: IMG_A.mimeType }])).toEqual({
      status: 'conflict',
      code: 'SDK_MESSAGE_CONFLICT',
    });
    // 同 data 异 mime
    expect(admitMessage(known, 'm-img', '看图', [{ data: IMG_A.data, mimeType: 'image/jpeg' }])).toEqual({
      status: 'conflict',
      code: 'SDK_MESSAGE_CONFLICT',
    });
    // 异件数（少一件）
    expect(admitMessage(known, 'm-img', '看图', [])).toEqual({ status: 'conflict', code: 'SDK_MESSAGE_CONFLICT' });
    // 有无图互变（重发不带图）
    expect(admitMessage(known, 'm-img', '看图')).toEqual({ status: 'conflict', code: 'SDK_MESSAGE_CONFLICT' });
  });

  it('无图消息零漂移：账存原文串、判参无 images——既有全等比较不变', () => {
    const known = new Map([['m-1', '纯文本']]);
    expect(admitMessage(known, 'm-1', '纯文本')).toEqual({ status: 'duplicate' });
    expect(admitMessage(known, 'm-1', '纯文本', [])).toEqual({ status: 'duplicate' }); // 空数组 = 无图同档
    expect(admitMessage(known, 'm-1', '改口')).toEqual({ status: 'conflict', code: 'SDK_MESSAGE_CONFLICT' });
  });
});

describe('admit canonical 键 ref 形 + durable 重建同源（03 §10.4 ① serve 线收口——ref 形 canonical）', () => {
  const IMG_A = { data: 'aGVsbG8=', mimeType: 'image/png' };
  const IMG_B = { data: 'eW91', mimeType: 'image/webp' };

  /** data → 内容寻址 ref（受理链同式：sha256(解码字节)——小写 hex） */
  const refOf = (data: string): string =>
    'sha256:' + createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');

  it('有图键 = canonical JSON {content, images:[{ref, mimeType}]}（字段序与键序直锁；ref = sha256(解码字节)——durable 无原始 base64 唯有 ref 可同源）', () => {
    expect(admitContentKey('看图', [IMG_A, IMG_B])).toBe(
      JSON.stringify({
        content: '看图',
        images: [
          { ref: refOf(IMG_A.data), mimeType: 'image/png' },
          { ref: refOf(IMG_B.data), mimeType: 'image/webp' },
        ],
      }),
    );
  });

  it('同图异 base64 拼写同键（ref 按解码字节——填充/空白形差异不裂键）；mimeType 归一（trim + 小写）不裂键', () => {
    // 解码后同字节：'aGVsbG8=' 与去填充形 'aGVsbG8' 解码等值
    expect(admitContentKey('看图', [{ data: 'aGVsbG8', mimeType: 'image/png' }])).toBe(
      admitContentKey('看图', [IMG_A]),
    );
    // 声明 MIME 大小写/空白归一——与受理链核验归一同式
    expect(admitContentKey('看图', [{ data: IMG_A.data, mimeType: '  IMAGE/PNG ' }])).toBe(
      admitContentKey('看图', [IMG_A]),
    );
  });

  it('durable 重建恒等：admitKeyFromStored(块数组) === admitContentKey(文, 图)——跨重启查重同源（serve 线 lookupDedupeKey 喂线核 known 账）', () => {
    const blocks = [
      { type: 'text', text: '看图' },
      { type: 'image-ref', ref: refOf(IMG_A.data), mimeType: 'image/png', bytes: 5 },
      { type: 'image-ref', ref: refOf(IMG_B.data), mimeType: 'image/webp', bytes: 3 },
    ];
    expect(admitKeyFromStored(blocks)).toBe(admitContentKey('看图', [IMG_A, IMG_B]));
    // 重建键直进 admit 判定：同文同图重发 = duplicate（跨重启幂等的行为证）
    const known = new Map([['m-img', admitKeyFromStored(blocks)]]);
    expect(admitMessage(known, 'm-img', '看图', [IMG_A, IMG_B])).toEqual({ status: 'duplicate' });
  });

  it('重建三档：纯文本串原样 / image-only content 空 / 无引用块数组 = 拼接文本（无图档——不造 {content,images:[]} 噪音形）', () => {
    expect(admitKeyFromStored('纯文本')).toBe('纯文本');
    expect(admitKeyFromStored([{ type: 'image-ref', ref: refOf(IMG_A.data), mimeType: 'image/png', bytes: 5 }])).toBe(
      admitContentKey('', [IMG_A]),
    );
    expect(
      admitKeyFromStored([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
  });

  it('坏形兜底：非串非数组 → 空串（serve 线未知形态不炸——空串与真实键不误撞）', () => {
    expect(admitKeyFromStored(42)).toBe('');
    expect(admitKeyFromStored(null)).toBe('');
  });
});
