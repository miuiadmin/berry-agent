/**
 * 审计流测试（U3-2 persist 笔——05 §9 audit_events）。
 *
 * 四面：词汇闸（未注册词/非 log-only 词三类别红 + 审计词绿）/ 读写往返
 * （假钟注入·同词尾条胜〔撤位空数组形 fold 语义〕·id 单调·listRecent
 * 逆序帽）/ 真库迁移腿（v1 缺口库带链重开 v8——备份件在场 + headVersion +
 * 写读成立；全新库直带链同验）/ 读侧损坏行 fail-loud（非法 JSON 与合法
 * JSON 非对象形两档 PERSIST_DATA_CORRUPT）。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { AUDIT_MIGRATION, createAuditFace, type AuditFace } from './audit.js';
import { openStore, type Store } from './index.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-audit-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 开内存库并构造审计面（audit_events 表由迁移链建就；clock 缺省真钟） */
function openMemoryFace(clock?: () => number): AuditFace {
  const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
  stores.push(store);
  return createAuditFace(store.connection, clock);
}

describe('审计流词汇闸（append 前置 fail-loud——普通 Error 编程错误档）', () => {
  it('未注册词拒：先注册再落账', () => {
    const face = openMemoryFace();
    expect(() => face.append('not/registered', {})).toThrow(/未在词汇注册表/);
    // 拒笔未落库（闸先于任何库操作）
    expect(face.listRecent()).toHaveLength(0);
  });

  it('非 log-only 词拒：surface/snapshot/structure 三类别同拒', () => {
    const face = openMemoryFace();
    expect(() => face.append('user/message', { text: 'x' })).toThrow(/log-only/);
    expect(() => face.append('request/header', {})).toThrow(/log-only/);
    expect(() => face.append('turn/start', {})).toThrow(/log-only/);
    expect(face.listRecent()).toHaveLength(0);
  });

  it('两审计词绿：plugin/opens·capability/used 过闸落库', () => {
    const face = openMemoryFace();
    expect(() => face.append('plugin/opens', { pluginId: 'demo', opens: [] })).not.toThrow();
    expect(() => face.append('capability/used', { pluginId: 'demo', capability: 'channels.ui-backend' })).not.toThrow();
    expect(face.listRecent()).toHaveLength(2);
  });
});

describe('审计流读写往返（假钟注入·直写即证据）', () => {
  it('append → lastOf 各词各取、time/data 原样往返；未落词 undefined', () => {
    let now = 1_000;
    const face = openMemoryFace(() => now);
    face.append('plugin/opens', { pluginId: 'demo', opens: ['channels.ui-backend'] });
    now = 2_000;
    face.append('capability/used', { pluginId: 'demo', capability: 'channels.ui-backend' });

    const opens = face.lastOf('plugin/opens');
    expect(opens?.time).toBe(1_000);
    expect(opens?.data).toEqual({ pluginId: 'demo', opens: ['channels.ui-backend'] });
    const used = face.lastOf('capability/used');
    expect(used?.time).toBe(2_000);
    expect(used?.data).toEqual({ pluginId: 'demo', capability: 'channels.ui-backend' });
    // 注册在册但从未落账的 log-only 词 → undefined（幂等 diff 判据源）
    expect(face.lastOf('approval/asked')).toBeUndefined();
  });

  it('同词多笔尾条胜（撤位空数组形 fold 语义）+ id 全局单调', () => {
    const face = openMemoryFace();
    face.append('plugin/opens', { pluginId: 'demo', opens: ['channels.ui-backend'] });
    const first = face.lastOf('plugin/opens')!;
    // 撤位：opens 空数组形收口（U3-0 定形——fold = 尾条 = 当前有效授予面）
    face.append('plugin/opens', { pluginId: 'demo', opens: [] });
    const last = face.lastOf('plugin/opens')!;
    expect(last.data).toEqual({ pluginId: 'demo', opens: [] });
    expect(last.id).toBeGreaterThan(first.id);
  });

  it('listRecent 逆序帽：limit 生效 + 缺省帽全量', () => {
    const face = openMemoryFace();
    for (let i = 0; i < 5; i++) {
      face.append('capability/used', { pluginId: 'demo', capability: `cap-${i}` });
    }
    const top3 = face.listRecent(3);
    expect(top3).toHaveLength(3);
    // id 降序（最新在前）
    expect(top3.map((r) => r.data.capability)).toEqual(['cap-4', 'cap-3', 'cap-2']);
    // 缺省帽 100 → 全量 5 条
    expect(face.listRecent()).toHaveLength(5);
  });
});

describe('审计流真库迁移腿 v8（05 §6.4——scheduler v2/goal v3/memory v4-6/credentials v7 之后）', () => {
  it('v1 缺口库带链重开：headVersion=8 + 备份件在场 + 审计写读成立', () => {
    const dbPath = join(dir, 'gap.db');
    // ① 无链开基线 v1 库（迁移前世界），随即关库
    const v1 = openStore({ dbPath, dataDir: join(dir, 'data') });
    stores.push(v1);
    v1.close();
    // ② 带 AUDIT_MIGRATION 重开——缺口备份 + v1→v8 升级
    const v8 = openStore({ dbPath, dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(v8);
    expect(v8.headVersion).toBe(8);
    // 迁移前备份件在场（05 §6.4：version < head 时先备份库文件再动刀）
    expect(existsSync(`${dbPath}.bak-v1`)).toBe(true);
    // 审计表建就且可写读
    const face = createAuditFace(v8.connection);
    face.append('plugin/opens', { pluginId: 'demo', opens: [] });
    expect(face.lastOf('plugin/opens')?.data).toEqual({ pluginId: 'demo', opens: [] });
  });

  it('全新库直带链（宿主真实路径 bootstrap v1 → v8）——写读成立', () => {
    const dbPath = join(dir, 'fresh.db');
    const store = openStore({ dbPath, dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(store);
    expect(store.headVersion).toBe(8);
    const face = createAuditFace(store.connection);
    face.append('capability/used', { pluginId: 'demo', capability: 'channels.ui-backend' });
    expect(face.lastOf('capability/used')?.data.capability).toBe('channels.ui-backend');
  });
});

describe('审计流读侧损坏行 fail-loud（宁崩不误读）', () => {
  it('data 非法 JSON → PERSIST_DATA_CORRUPT（lastOf 与 listRecent 同拒）', () => {
    const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(store);
    const face = createAuditFace(store.connection);
    face.append('plugin/opens', { pluginId: 'demo', opens: [] });
    // 物理 SQL 造坏行（手编库/断电半写档——外因损坏不经过词汇闸）
    store.connection
      .prepare(`INSERT INTO audit_events (time, type, data) VALUES (?, ?, ?)`)
      .run(1, 'plugin/opens', '{oops');
    try {
      face.lastOf('plugin/opens');
      expect.unreachable('坏行须 fail-loud');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('PERSIST_DATA_CORRUPT');
    }
    expect(() => face.listRecent()).toThrow(BaseError);
  });

  it('data 合法 JSON 但非对象形（串）→ 同码拒读', () => {
    const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(store);
    const face = createAuditFace(store.connection);
    store.connection
      .prepare(`INSERT INTO audit_events (time, type, data) VALUES (?, ?, ?)`)
      .run(1, 'plugin/opens', '"plain-string"');
    try {
      face.lastOf('plugin/opens');
      expect.unreachable('非对象形须 fail-loud');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('PERSIST_DATA_CORRUPT');
    }
  });
});

describe('CLI+daemon 双写者并存形（audit_events 跨连接不变式）', () => {
  it('同库两连接交替 append：id 全局单调无重复 + listRecent 互见对方条目 + lastOf 跨连接一致读', () => {
    const dbPath = join(dir, 'dual-writer.db');
    // 两连接同库（daemon 常开连接 + CLI 惰性开库的结构形——plugins 命令
    // lifecycleAuditOf 与常驻进程的 audit 写是结构性并存的第二写者窗口）
    const storeDaemon = openStore({ dbPath, dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(storeDaemon);
    const storeCli = openStore({ dbPath, dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(storeCli);
    const faceDaemon = createAuditFace(storeDaemon.connection, () => 1_000);
    const faceCli = createAuditFace(storeCli.connection, () => 1_000);
    // 交替记账（daemon 记 opens、CLI 记 used，三轮交替；每次经「对方连接」
    // 尾读取回刚落的 id——顺带即证跨连接立即可见）
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      faceDaemon.append('plugin/opens', { pluginId: 'daemon', opens: [`capability-${i}`] });
      ids.push(faceCli.listRecent(1)[0]!.id);
      faceCli.append('capability/used', { pluginId: 'cli', capability: `capability-${i}` });
      ids.push(faceDaemon.listRecent(1)[0]!.id);
    }
    // id 全局单调严格递增（INTEGER PRIMARY KEY 自增跨连接不变式——无重复无回跳）
    for (let i = 1; i < ids.length; i++) expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
    expect(new Set(ids).size).toBe(ids.length);
    // 两连接各读全量：互见对方全部条目（六条各半，id 集一致）
    const fromDaemon = faceDaemon.listRecent();
    const fromCli = faceCli.listRecent();
    expect(fromDaemon).toHaveLength(6);
    expect(fromCli).toHaveLength(6);
    expect(new Set(fromDaemon.map((row) => row.id))).toEqual(new Set(fromCli.map((row) => row.id)));
    // 尾读一致：各自 lastOf 能读到只有对方写过的词
    expect(faceDaemon.lastOf('capability/used')?.data.pluginId).toBe('cli');
    expect(faceCli.lastOf('plugin/opens')?.data.pluginId).toBe('daemon');
  });
});
