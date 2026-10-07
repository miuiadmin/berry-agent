/**
 * 附件库读写面测试（03 篇 §10.4 ③ 2026-10-08 剪贴板附件批——Lane B）。
 *
 * 八面：常量形（白名单四族 + ext→MIME 全覆盖恰一行）/ 写幂等（同字节两写
 * 同 ref·二次跳写〔盘上篡改后二写不覆写——跳写实锤〕·异字节异 ref·回执
 * {ref, bytes}）/ 落盘形（<dataDir>/attachments/<hex>.<ext> 结构锁）/ 读
 * 命中往返（png 首位 + webp 尾位——遍历序非首槽命中实证）/ 坏 ref 拒（前
 * 缺失·短 hex·大写 hex·穿越形·空串）/ 缺文件 null（含目录不在场）/ ext
 * 白名单外拒（svg 禁入）/ 写失败原样上抛（fail-loud——系统错误 code 在场
 * 非本域拒形态）。
 *
 * 字节 fixture 任意造（嗅探在受理链 03 §10.4 ②——本面信任入参字节与 ext，
 * 不验魔数；白名单执法仅为纵深）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  ATTACHMENT_EXT_WHITELIST,
  ATTACHMENT_MIME_BY_EXT,
  createAttachmentStore,
  type AttachmentExt,
  type AttachmentStore,
} from './attachment-store.js';

let dir: string;
let store: AttachmentStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-attachment-store-test-'));
  store = createAttachmentStore(join(dir, 'data'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 伪图像字节（任意字节即可——本面不嗅探，见文件头注） */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 9, 8, 7]);

/** 从回执 ref 提 hex（测试内定位盘上文件用——落盘形结构锁的白盒侧） */
function hexOf(ref: string): string {
  return ref.slice('sha256:'.length);
}

describe('常量形（单源锁）', () => {
  it('白名单恰四族 png/jpeg/gif/webp（序即读回遍历序）', () => {
    expect([...ATTACHMENT_EXT_WHITELIST]).toEqual(['png', 'jpeg', 'gif', 'webp']);
  });

  it('ext→MIME 映射白名单全覆盖恰一行（增族两处同笔锁）', () => {
    for (const ext of ATTACHMENT_EXT_WHITELIST) {
      expect(ATTACHMENT_MIME_BY_EXT[ext]).toMatch(/^image\//);
    }
    expect(Object.keys(ATTACHMENT_MIME_BY_EXT)).toHaveLength(ATTACHMENT_EXT_WHITELIST.length);
  });
});

describe('写幂等（03 §10.4 ③）', () => {
  it('同字节两写同 ref、回执 {ref, bytes}；异字节异 ref（内容寻址）', () => {
    const first = store.write(PNG_BYTES, 'png');
    const second = store.write(PNG_BYTES, 'png');
    // 同字节 → 同 ref（同图重复粘贴同 ref 去重——内容寻址本征）
    expect(second.ref).toBe(first.ref);
    expect(first.ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.bytes).toBe(PNG_BYTES.byteLength);
    expect(second.bytes).toBe(PNG_BYTES.byteLength);
    // 异字节 → 异 ref
    const other = store.write(GIF_BYTES, 'gif');
    expect(other.ref).not.toBe(first.ref);
  });

  it('二次跳写实锤：盘上篡改后同字节再写不覆写（在场即跳）', () => {
    const first = store.write(PNG_BYTES, 'png');
    const path = join(dir, 'data', 'attachments', `${hexOf(first.ref)}.png`);
    const tampered = new Uint8Array([0xde, 0xad]);
    writeFileSync(path, tampered);
    const second = store.write(PNG_BYTES, 'png');
    expect(second.ref).toBe(first.ref);
    // 篡改内容存活 = 二次写未触盘（在场跳写；内容寻址信任在场文件）
    expect([...readFileSync(path)]).toEqual([...tampered]);
  });

  it('落盘形结构锁：<dataDir>/attachments/<hex>.<ext>', () => {
    const { ref } = store.write(PNG_BYTES, 'png');
    expect(readFileSync(join(dir, 'data', 'attachments', `${hexOf(ref)}.png`))).toEqual(Buffer.from(PNG_BYTES));
  });
});

describe('读命中往返', () => {
  it('png 往返：bytes/ext/mimeType 三位齐（mimeType 单源派生）', () => {
    const { ref } = store.write(PNG_BYTES, 'png');
    const record = store.read(ref);
    expect(record).not.toBeNull();
    expect([...record!.bytes]).toEqual([...PNG_BYTES]);
    expect(record!.ext).toBe('png');
    expect(record!.mimeType).toBe('image/png');
  });

  it('webp 尾位命中：遍历序越过非首槽（png/jpeg 缺席不误 null）', () => {
    const { ref } = store.write(PNG_BYTES, 'webp');
    const record = store.read(ref);
    expect(record).not.toBeNull();
    expect(record!.ext).toBe('webp');
    expect(record!.mimeType).toBe('image/webp');
  });
});

describe('坏 ref 拒（词法先于寻位——读回端点 400 轨）', () => {
  it.each([
    ['前缀缺失', `${'a'.repeat(64)}`],
    ['hex 短位', `sha256:${'a'.repeat(63)}`],
    ['hex 长位', `sha256:${'a'.repeat(65)}`],
    ['大写 hex 拒（词法单源小写）', `sha256:${'A'.repeat(64)}`],
    ['非十六进制字符', `sha256:${'g'.repeat(64)}`],
    ['路径穿越形', 'sha256:../../etc/passwd'],
    ['空串', ''],
  ])('%s → throw（文案含「格式不正确」）', (_label, ref) => {
    expect(() => store.read(ref)).toThrow(/格式不正确/);
  });
});

describe('缺文件 null（读回端点 404 轨——与坏形 400 分立）', () => {
  it('词法合形但库内无此文件 → null', () => {
    store.write(PNG_BYTES, 'png'); // 目录建就（缺席目录另腿覆盖）
    expect(store.read(`sha256:${'b'.repeat(64)}`)).toBeNull();
  });

  it('attachments 目录整体不在场 → null（构造期零 fs 副作用——未写过即无目录）', () => {
    const fresh = createAttachmentStore(join(dir, 'fresh-data'));
    expect(fresh.read(`sha256:${'c'.repeat(64)}`)).toBeNull();
  });
});

describe('ext 白名单外拒（纵深——嗅探在受理链，本面再执法）', () => {
  it('svg（结构性禁入族）→ throw（文案含「白名单」）', () => {
    // JS 调用方坏形模拟：类型面收窄被绕过的运行时执法
    expect(() => store.write(PNG_BYTES, 'svg' as unknown as AttachmentExt)).toThrow(/白名单/);
  });
});

describe('写失败原样上抛（fail-loud——受理 500 轨）', () => {
  it('attachments 位被同名文件占位（mkdir 系统错误）→ 原样上抛不包不吞', () => {
    // 占位文件让目录建链必败——系统错误（code 在场）非本域拒形态
    mkdirSync(join(dir, 'blocked-data'), { recursive: true });
    writeFileSync(join(dir, 'blocked-data', 'attachments'), 'not-a-dir');
    const blocked = createAttachmentStore(join(dir, 'blocked-data'));
    let caught: NodeJS.ErrnoException | undefined;
    try {
      blocked.write(PNG_BYTES, 'png');
    } catch (err) {
      caught = err as NodeJS.ErrnoException;
    }
    expect(caught).toBeDefined();
    // 系统错误原样（code 属性在场）——非「白名单」/「格式不正确」本域拒文案
    expect(typeof caught!.code).toBe('string');
    expect(String(caught!.message)).not.toMatch(/白名单|格式不正确/);
  });
});
