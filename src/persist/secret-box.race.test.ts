/**
 * secret-box 首启自举竞态测试（G2 回归锁——loadOrCreateSecretKey 败者窗）。
 *
 * 败者窗确定性造法：existsSync 注入谎报（vi.mock node:fs 单函数覆写——其余
 * passthrough 真身）。胜者钥先落盘 + existsSync 谎报缺席 = 双进程并发首启的
 * 败者窗（check-then-write 间隙被胜者插入写）。修前红：败者 writeFileSync
 * 无 wx 静默覆盖胜者钥（后写者赢——胜者此前所铸密文永久 PERSIST_SECRET_
 * UNREADABLE）；修后：wx（O_EXCL）收 EEXIST → 复读胜者钥收敛（先到者赢）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrCreateSecretKey, SECRET_KEY_BASENAME } from './secret-box.js';

/** mock 工厂可引用的 hoisted 态（败者窗开关 + 谎报锚串——工厂内禁引外层变量） */
const { raceWindow, KEY_BASENAME } = vi.hoisted(() => ({
  raceWindow: { lying: false },
  KEY_BASENAME: 'secret.key',
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      // 谎报只针对密钥文件（败者窗）——其余路径（tmpdir 等）真身直通
      if (raceWindow.lying && path.includes(KEY_BASENAME)) return false;
      return actual.existsSync(path);
    },
  };
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-secret-race-'));
  raceWindow.lying = false;
});

afterEach(() => {
  raceWindow.lying = false;
  rmSync(dir, { recursive: true, force: true });
});

describe('loadOrCreateSecretKey 并发首启竞态（wx 原子自举）', () => {
  it('败者窗：胜者钥已在盘 + existsSync 谎报缺席 → 败者收 EEXIST 复读胜者钥收敛（不覆盖）', () => {
    // 胜者先落盘（32 字节 0600——跨进程首启的先到者）
    const winner = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 11) % 256));
    const keyPath = join(dir, SECRET_KEY_BASENAME);
    writeFileSync(keyPath, winner, { mode: 0o600 });
    // 开败者窗：败者 check（existsSync）落在胜者 write 之前——看见缺席
    raceWindow.lying = true;
    const got = loadOrCreateSecretKey(dir, () => undefined);
    // 修前红锚①：败者生成的异钥直接返回（got ≠ 胜者钥）
    expect(got.equals(winner)).toBe(true);
    // 修前红锚②：盘上胜者钥被后写者覆盖（密文不可逆解的根因位）
    expect(readFileSync(keyPath).equals(winner)).toBe(true);
  });

  it('无窗真身直通不受 mock 影响（首启生成 + 幂等复用原语义保持）', () => {
    const first = loadOrCreateSecretKey(dir, () => undefined);
    expect(first).toHaveLength(32);
    expect(existsSync(join(dir, SECRET_KEY_BASENAME))).toBe(true);
    // 二次加载同钥（幂等——胜者路径不经 wx 分支）
    expect(loadOrCreateSecretKey(dir, () => undefined).equals(first)).toBe(true);
  });
});
