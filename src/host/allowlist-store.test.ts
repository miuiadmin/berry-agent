/**
 * host/allowlist-store 测试——跨会话策略表文件读写三律（04 §9 粘性第 3 款
 * 定形块；批 12f-4；2026-09-11 审批分档批六字段行形扩——deny 面/deny 无
 * TTL 坏形/旧三字段形升格读入）。
 *
 * 真盘临时目录（文件 IO 件全栈惯例）：读侧缺席/好形/文件级坏形/行级坏形
 * 四态 + 写侧追加/幂等/坏形拒写三态 + 原子替换不留 tmp 残。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { appendAllowlistEntry, readAllowlist } from './allowlist-store.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新临时目录速记 */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** warn 捕获速记 */
function captureWarn(): { warnings: string[]; warn: (m: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (m) => void warnings.push(m) };
}

describe('readAllowlist 读侧（04 §9 定形块读侧律）', () => {
  it('缺席 = 空清单零负担（healthy——首启零文件）', () => {
    const dir = tmpDir('al-absent-');
    const io = captureWarn();
    const load = readAllowlist(dir, io);
    expect(load.entries).toEqual([]);
    expect(load.healthy).toBe(true);
    expect(io.warnings).toEqual([]);
  });

  it('好形载入：旧三字段形升格读入（decision 缺席归一 allow）', () => {
    const dir = tmpDir('al-ok-');
    writeFileSync(
      join(dir, 'allowlist.json'),
      JSON.stringify({
        entries: [
          { tool: 'write', pattern: '/w/a.md' },
          { tool: 'bash', pattern: 'git push', expiresAt: 1893456000000 },
        ],
      }),
    );
    const load = readAllowlist(dir);
    expect(load.healthy).toBe(true);
    expect(load.entries).toEqual([
      { tool: 'write', pattern: '/w/a.md', decision: 'allow' },
      { tool: 'bash', pattern: 'git push', decision: 'allow', expiresAt: 1893456000000 },
    ]);
  });

  it('六字段全形载入（审批分档批③）：deny/effect/reason 全字段直读', () => {
    const dir = tmpDir('al-six-');
    writeFileSync(
      join(dir, 'allowlist.json'),
      JSON.stringify({
        entries: [
          { tool: 'deploy', pattern: '', decision: 'deny', reason: '生产环境禁部署' },
          { tool: 'write', pattern: '/w/src', decision: 'allow', effect: 'write' },
          { tool: 'deploy', decision: 'deny', effect: 'exec' }, // pattern 缺席 = 整名族合法形
        ],
      }),
    );
    const load = readAllowlist(dir);
    expect(load.healthy).toBe(true);
    expect(load.entries).toEqual([
      { tool: 'deploy', pattern: '', decision: 'deny', reason: '生产环境禁部署' },
      { tool: 'write', pattern: '/w/src', decision: 'allow', effect: 'write' },
      { tool: 'deploy', decision: 'deny', effect: 'exec' },
    ]);
  });

  it.each([
    { label: 'JSON 解析失败', content: '{ Oops' },
    { label: '顶层非对象', content: '[]' },
    { label: 'entries 非数组', content: '{"entries": {}}' },
  ])('文件级坏形（$label）= warn + 视同空清单 + unhealthy（回写拒依据）', ({ content }) => {
    const dir = tmpDir('al-bad-');
    writeFileSync(join(dir, 'allowlist.json'), content);
    const io = captureWarn();
    const load = readAllowlist(dir, io);
    expect(load.entries).toEqual([]);
    expect(load.healthy).toBe(false);
    expect(io.warnings.length).toBe(1);
    expect(io.warnings[0]).toContain('视同空清单');
  });

  it('行级坏形剔行 + warn 点名（文件未改动——机器永不改写用户手写面）', () => {
    const dir = tmpDir('al-rowbad-');
    const raw = JSON.stringify({
      entries: [
        { tool: 'write', pattern: '/w/ok.md' }, // 好行（旧形——升格 allow 存活）
        { tool: '', pattern: '/w/x' }, // tool 空
        { tool: 'bash', pattern: 123 }, // pattern 非字符串
        { tool: 'write', pattern: '/w/y', expiresAt: 'soon' }, // expiresAt 非数值
        { tool: 'write', pattern: '/w/z', note: '用户注' }, // 未知键
        'not-an-object', // 非对象行
      ],
    });
    writeFileSync(join(dir, 'allowlist.json'), raw);
    const io = captureWarn();
    const load = readAllowlist(dir, io);
    expect(load.healthy).toBe(true); // 行级坏形不降级整文件
    expect(load.entries).toEqual([{ tool: 'write', pattern: '/w/ok.md', decision: 'allow' }]); // 好行存活
    expect(io.warnings.length).toBe(5); // 五坏行逐行点名
    expect(readFileSync(join(dir, 'allowlist.json'), 'utf8')).toBe(raw); // 原文未动
  });

  it('审批分档批新坏形族剔行：decision/effect 闭集外 + deny 带 expiresAt（方向性坏形）', () => {
    const dir = tmpDir('al-rowbad2-');
    writeFileSync(
      join(dir, 'allowlist.json'),
      JSON.stringify({
        entries: [
          { tool: 'write', pattern: '/w/ok.md', decision: 'allow' }, // 好行
          { tool: 'deploy', pattern: '', decision: 'maybe' }, // decision 闭集外
          { tool: 'deploy', pattern: '', decision: 'allow', effect: 'dangerous' }, // effect 闭集外
          { tool: 'deploy', pattern: '', decision: 'deny', expiresAt: 1893456000000 }, // deny 带 TTL = 方向性坏形
          { tool: 'deploy', pattern: '', decision: 'allow', reason: 42 }, // reason 非字符串
        ],
      }),
    );
    const io = captureWarn();
    const load = readAllowlist(dir, io);
    expect(load.healthy).toBe(true);
    expect(load.entries).toEqual([{ tool: 'write', pattern: '/w/ok.md', decision: 'allow' }]);
    expect(io.warnings.length).toBe(4);
    expect(io.warnings.join('\n')).toContain('deny 无 TTL');
  });
});

describe('appendAllowlistEntry 写侧（04 §9 定形块写侧律——唯一正门）', () => {
  it('追加落盘：新条目 append + JSON 全形重写 + 幂等去重', () => {
    const dir = tmpDir('al-append-');
    expect(appendAllowlistEntry(dir, { tool: 'write', pattern: '/w/a.md' })).toBe('appended');
    const first = readAllowlist(dir);
    // 机器写入恒带 decision:'allow'（写侧唯一正门只产 allow 条目——deny 唯用户手写）
    expect(first.entries).toEqual([{ tool: 'write', pattern: '/w/a.md', decision: 'allow' }]);
    expect(first.healthy).toBe(true);
    // 幂等：同 tool+pattern 不二写
    expect(appendAllowlistEntry(dir, { tool: 'write', pattern: '/w/a.md' })).toBe('duplicate');
    expect(readAllowlist(dir).entries).toHaveLength(1);
    // 异 pattern 追加共存
    expect(appendAllowlistEntry(dir, { tool: 'bash', pattern: 'git push' })).toBe('appended');
    expect(readAllowlist(dir).entries).toHaveLength(2);
    // 原子替换不留 tmp 残
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('坏形期回写拒（rejected——机器不在坏文件上追加，修复归用户手面）', () => {
    const dir = tmpDir('al-reject-');
    const raw = '{ Oops';
    writeFileSync(join(dir, 'allowlist.json'), raw);
    expect(appendAllowlistEntry(dir, { tool: 'write', pattern: '/w/a.md' })).toBe('rejected');
    expect(readFileSync(join(dir, 'allowlist.json'), 'utf8')).toBe(raw); // 原文未动
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('行级坏形期仍可追加（healthy 文件——追加走读侧好行全量重写，坏行自然清除）', () => {
    const dir = tmpDir('al-rowappend-');
    writeFileSync(
      join(dir, 'allowlist.json'),
      JSON.stringify({
        entries: [
          { tool: 'write', pattern: '/w/ok.md' },
          { tool: '', pattern: '/w/x' },
        ],
      }),
    );
    expect(appendAllowlistEntry(dir, { tool: 'bash', pattern: 'npm test' })).toBe('appended');
    expect(readAllowlist(dir).entries).toEqual([
      { tool: 'write', pattern: '/w/ok.md', decision: 'allow' },
      { tool: 'bash', pattern: 'npm test', decision: 'allow' },
    ]); // 坏行不进重写产物（读侧已剔——写侧只见好行）
  });
});

describe('fence 佐证（allowlist.json 属数据目录族）', () => {
  it('装配侧只经本件写：文件在数据目录（carve-out 恒拒模型直写——04 §7/§8 执法归 gate 域测）', () => {
    const dir = tmpDir('al-fence-');
    appendAllowlistEntry(dir, { tool: 'write', pattern: '/w/a.md' });
    expect(existsSync(join(dir, 'allowlist.json'))).toBe(true); // 数据目录内（gate 恒排除位拦截模型直写路径）
  });
});
