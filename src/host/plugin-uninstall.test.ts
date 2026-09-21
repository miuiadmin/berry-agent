/**
 * host/plugin-uninstall 卸载四段清算测试（成熟度缺口 #10 装机面落码批 10c）。
 *
 * 真 Persistence.open + HOST_MIGRATION_TAIL 全链开库（短命进程与运行时同库
 * 同链——链尾单源防短链降级）；域表/store_state/审计流全真 SQLite 落盘。
 *
 * 覆盖：inspect 全字段（引用计数/域面清单/体量三源/诚实缺席面）、execute
 * keep 四段序（物删账删/域表 DROP/store_state 留/data 留/审计落账）、purge
 * 追加段（data/<id> 删 + 域键连带删/兄弟插件域不动）、防线档（installPath
 * 逃逸收口 ok:false 非裸崩）、core: 前缀/查无/坏账本各拒、local 源物不删、
 * npm 锚依赖记录剥除（package.json/.package-lock.json——已卸包不得经锚
 * 记录被后续 npm 装机复活）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { Persistence } from '../persist/index.js';
import { createAuditFace, createLoadHistoryFace } from '../persist/index.js';

import { executeUninstall, inspectUninstall } from './plugin-uninstall.js';
import type { UninstallDeps } from './plugin-uninstall.js';
import { createPluginStoreFs, mountRow, readLedger, upsertLedgerEntry } from './plugin-store.js';
import type { PluginLedgerEntry } from './plugin-store.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';

/** 测试根 tmp（vitest 每文件钉数据目录纪律——自管 tmp 收尾自清） */
const testRoot = mkdtempSync(join(tmpdir(), 'berry-uninstall-test-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** 场景件：一次卸载测试所需的全部现场（库 + 账本 + 启用行 + 装机物 + 域面） */
class UninstallStage {
  readonly dataDir: string;
  readonly persistence: Persistence;
  private readonly fs = createPluginStoreFs();

  private constructor(dataDir: string, persistence: Persistence) {
    this.dataDir = dataDir;
    this.persistence = persistence;
  }

  static open(name: string): UninstallStage {
    const dataDir = join(testRoot, name);
    mkdirSync(dataDir, { recursive: true });
    const persistence = Persistence.open({ dataDir, migrations: HOST_MIGRATION_TAIL, warn: () => undefined });
    return new UninstallStage(dataDir, persistence);
  }

  get deps(): UninstallDeps {
    return { dataDir: this.dataDir, fs: this.fs, db: this.persistence.store.sqlite() };
  }

  /** 账本条目落账（相对 installPath = npm 形；绝对 = local 形） */
  seedEntry(overrides: Partial<PluginLedgerEntry> & { readonly id: string }): void {
    upsertLedgerEntry(
      this.dataDir,
      {
        source: 'npm',
        ref: `npm:${overrides.id}`,
        installedAt: '2026-09-09T00:00:00.000Z',
        installPath: join('plugins', 'node_modules', overrides.id),
        declaredEvents: [],
        ...overrides,
      },
      this.fs,
    );
  }

  /** 启用行挂载 */
  seedRow(id: string): void {
    expect(mountRow(this.dataDir, id, undefined, this.fs).ok).toBe(true);
  }

  /** 装机物目录（package.json 占位） */
  seedInstallDir(id: string): string {
    const dir = join(this.dataDir, 'plugins', 'node_modules', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}');
    return dir;
  }

  /** 域表 + 域行（域面连带清算判据源） */
  seedDomain(table: string): void {
    this.persistence.store.sqlite().exec(`CREATE TABLE IF NOT EXISTS "${table}" (k TEXT PRIMARY KEY)`);
    this.persistence.store.sqlite().prepare(`INSERT OR IGNORE INTO "${table}" (k) VALUES ('x')`).run();
  }

  /** store_state 域键（last_accessed_at NOT NULL——LRU 逐出依据列必填） */
  seedStoreState(key: string): void {
    this.persistence.store
      .sqlite()
      .prepare('INSERT OR REPLACE INTO store_state (key, value, last_accessed_at) VALUES (?, ?, ?)')
      .run(key, 'v', 0);
  }

  /** 数据域文件 */
  seedDataFile(id: string): string {
    const dir = join(this.dataDir, 'data', id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'blob.txt');
    writeFileSync(file, 'payload');
    return file;
  }

  /** 审计尾读（plugin/uninstalled 落账断言） */
  lastUninstalled(): { data: Record<string, unknown> } | undefined {
    return createAuditFace(this.persistence.store.sqlite()).lastOf('plugin/uninstalled');
  }

  /** sqlite_master 域表在场判定 */
  hasTable(table: string): boolean {
    const row = this.persistence.store
      .sqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    return row !== undefined;
  }

  /** store_state 键在场判定 */
  hasStoreKey(key: string): boolean {
    const row = this.persistence.store.sqlite().prepare('SELECT key FROM store_state WHERE key = ?').get(key);
    return row !== undefined;
  }

  /** 账本条目 id 集 */
  ledgerIds(): readonly string[] {
    const read = readLedger(this.dataDir, this.fs);
    expect(read.ok).toBe(true);
    return read.ok ? read.entries.map((e) => e.id) : [];
  }

  async close(): Promise<void> {
    await this.persistence.close();
  }
}

/** 标准场景：demo（全面在场）+ other（兄弟插件——域面隔离判据） */
function seedFullStage(stage: UninstallStage): void {
  stage.seedEntry({ id: 'demo' });
  stage.seedEntry({ id: 'other' });
  stage.seedRow('demo');
  stage.seedInstallDir('demo');
  stage.seedInstallDir('other');
  stage.seedDomain('demo__t1');
  stage.seedDomain('other__t2');
  stage.seedStoreState('demo__k1');
  stage.seedStoreState('other__k1');
  stage.seedDataFile('demo');
}

describe('inspect（只读零副作用）', () => {
  it('全字段：引用计数零/域面清单/体量三源合计/装载史有源零（无世代）', async () => {
    const stage = UninstallStage.open('inspect-full');
    try {
      seedFullStage(stage);
      const outcome = inspectUninstall(stage.deps, 'demo');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const r = outcome.report;
      expect(r.id).toBe('demo');
      expect(r.source).toBe('npm');
      expect(r.enabledRows).toBe(1);
      expect(r.installPaths).toHaveLength(1);
      expect(r.installPaths[0]!.sharedWith).toEqual([]);
      expect(r.installPaths[0]!.willDelete).toBe(true);
      expect(r.domainTables).toEqual(['demo__t1']);
      expect(r.storeStateKeys).toBe(1);
      expect(r.dataSizeBytes).toBeGreaterThan(0); // 文件域 + 域表页 + 域键值三源
      expect(r.affectedSessionCounts).toEqual({ available: true, count: 0 }); // 有源零（h-4——无世代诚实 0 非缺席）
      // 文本面：execute 指路行在场
      expect(outcome.text).toContain('--confirm');
      // 零副作用：各面原样
      expect(stage.ledgerIds()).toContain('demo');
      expect(stage.hasTable('demo__t1')).toBe(true);
    } finally {
      await stage.close();
    }
  });

  it('引用计数：同 installPath 双条目 → willDelete false + 文本呈共享面', async () => {
    const stage = UninstallStage.open('inspect-shared');
    try {
      stage.seedEntry({ id: 'demo' });
      stage.seedEntry({ id: 'alias-x', installPath: join('plugins', 'node_modules', 'demo') });
      const shared = inspectUninstall(stage.deps, 'demo');
      expect(shared.ok && shared.report.installPaths[0]!.sharedWith).toEqual(['alias-x']);
      expect(shared.ok && shared.report.installPaths[0]!.willDelete).toBe(false);
      expect(shared.ok && shared.text).toContain('共享引用');
    } finally {
      await stage.close();
    }
  });

  it('core: 前缀专报拒；查无拒（uninstall 吃装机 id）；local 源 willDelete false', async () => {
    const stage = UninstallStage.open('inspect-refuse');
    try {
      const core = inspectUninstall(stage.deps, 'core:webui');
      expect(core.ok).toBe(false);
      if (!core.ok) expect(core.message).toContain('非 uninstall 对象');
      const missing = inspectUninstall(stage.deps, 'ghost');
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.message).toContain('未装机');
      // local 直引：物不删
      const localDir = join(testRoot, 'local-src');
      mkdirSync(localDir, { recursive: true });
      stage.seedEntry({ id: 'local-x', source: 'local', ref: `local:${localDir}`, installPath: localDir });
      const local = inspectUninstall(stage.deps, 'local-x');
      expect(local.ok && local.report.installPaths[0]!.willDelete).toBe(false);
      expect(local.ok && local.text).toContain('local 直引');
    } finally {
      await stage.close();
    }
  });
});

describe('execute（四段清算）', () => {
  it('keep 缺省：行删+物删+域表 DROP+账删；store_state/data 留；审计落账', async () => {
    const stage = UninstallStage.open('exec-keep');
    try {
      seedFullStage(stage);
      const outcome = executeUninstall(stage.deps, 'demo'); // dataAction 缺省 keep
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // ① 启用行删
      const yaml = readFileSync(join(stage.dataDir, 'enabled.yaml'), 'utf8');
      expect(yaml.includes('demo')).toBe(false);
      // ② 装机物删 + 域表连带 DROP + 账本条目删
      expect(existsSync(join(stage.dataDir, 'plugins', 'node_modules', 'demo'))).toBe(false);
      expect(stage.hasTable('demo__t1')).toBe(false);
      expect(stage.hasTable('other__t2')).toBe(true); // 兄弟插件域不动
      expect(stage.ledgerIds()).toEqual(['other']);
      // ③ keep：data/<id> 留 + store_state 域键留（LRU 域）
      expect(existsSync(join(stage.dataDir, 'data', 'demo'))).toBe(true);
      expect(stage.hasStoreKey('demo__k1')).toBe(true);
      // ④ 审计：plugin/uninstalled 落账（dataAction keep + 有源 affected 计数形）
      const audited = stage.lastUninstalled();
      expect(audited).toBeDefined();
      expect(audited!.data).toMatchObject({ id: 'demo', source: 'npm', dataAction: 'keep' });
      expect(audited!.data['affected']).toEqual({ available: true, count: 0 });
      // 兄弟插件全景未动
      expect(existsSync(join(stage.dataDir, 'plugins', 'node_modules', 'other'))).toBe(true);
    } finally {
      await stage.close();
    }
  });

  it('purge：data/<id> 删 + 域键连带删；兄弟插件域键留；幂等重跑收敛', async () => {
    const stage = UninstallStage.open('exec-purge');
    try {
      seedFullStage(stage);
      const outcome = executeUninstall(stage.deps, 'demo', 'purge');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(existsSync(join(stage.dataDir, 'data', 'demo'))).toBe(false);
      expect(stage.hasStoreKey('demo__k1')).toBe(false);
      expect(stage.hasStoreKey('other__k1')).toBe(true);
      expect(stage.lastUninstalled()!.data['dataAction']).toBe('purge');
      // 幂等重跑：查无拒（残迹收尾式——重跑不造错误面）
      const again = executeUninstall(stage.deps, 'demo', 'purge');
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.message).toContain('未装机');
    } finally {
      await stage.close();
    }
  });

  it('引用计数在：物保留只删账（最后引用删尽才删物）', async () => {
    const stage = UninstallStage.open('exec-shared');
    try {
      stage.seedEntry({ id: 'demo' });
      stage.seedEntry({ id: 'alias-x', installPath: join('plugins', 'node_modules', 'demo') });
      const dir = stage.seedInstallDir('demo');
      const outcome = executeUninstall(stage.deps, 'demo');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(existsSync(dir)).toBe(true); // 物保留
      expect(stage.ledgerIds()).toEqual(['alias-x']); // 只删账
      // 最后引用删尽 → 再卸 alias-x 物才删
      const last = executeUninstall(stage.deps, 'alias-x');
      expect(last.ok).toBe(true);
      expect(existsSync(dir)).toBe(false);
    } finally {
      await stage.close();
    }
  });

  it('local 源：物不删（用户目录）+ 账删 + 审计落账 source local', async () => {
    const stage = UninstallStage.open('exec-local');
    try {
      const localDir = join(testRoot, 'local-src-2');
      mkdirSync(localDir, { recursive: true });
      writeFileSync(join(localDir, 'package.json'), '{}');
      stage.seedEntry({ id: 'local-x', source: 'local', ref: `local:${localDir}`, installPath: localDir });
      const outcome = executeUninstall(stage.deps, 'local-x', 'purge');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(existsSync(join(localDir, 'package.json'))).toBe(true); // 用户目录永不删
      expect(stage.ledgerIds()).toEqual([]);
      expect(stage.lastUninstalled()!.data['source']).toBe('local');
    } finally {
      await stage.close();
    }
  });

  it('防线档：installPath 逃逸（../evil）→ ok:false 收口非裸崩（PLUGIN_UNINSTALL_REFUSED）', async () => {
    const stage = UninstallStage.open('exec-escape');
    try {
      stage.seedEntry({ id: 'evil', installPath: join('..', 'evil') });
      stage.seedRow('evil');
      const outcome = executeUninstall(stage.deps, 'evil');
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.message).toContain('PLUGIN_UNINSTALL_REFUSED');
        expect(outcome.message).toContain('逸出装机子树');
      }
      // 收口后账本原样（拒删不改真相面）
      expect(stage.ledgerIds()).toContain('evil');
    } finally {
      await stage.close();
    }
  });
});

describe('装载史共现计数（03 §5.5 ④——h-4 有源化）', () => {
  it('世代激活窗 ∩ 会话存活窗 → inspect 有源计数 + 文案；execute 后世代行留（对已卸插件同源可考）', async () => {
    const stage = UninstallStage.open('affected');
    try {
      stage.seedEntry({ id: 'demo' });
      stage.seedRow('demo');
      stage.seedInstallDir('demo');
      // 会话存活窗两形：横跨当下的活窗（相交）+ 早已闭合的历史窗（不相交）
      const now = Date.now();
      const insertSession = stage.persistence.store
        .sqlite()
        .prepare('INSERT INTO sessions (id, origin, created_at, updated_at, last_seq) VALUES (?, ?, ?, ?, 0)');
      insertSession.run('sess-live', 'conversation', now - 60_000, now + 60_000);
      insertSession.run('sess-dead', 'conversation', now - 120_000, now - 90_000);
      // 当代世代：demo ∈ activated（boot 完成尾同款快照形）
      createLoadHistoryFace(stage.persistence.store.sqlite()).recordLoadGeneration({
        activated: [{ id: 'demo', tools: [] }],
        skipped: [],
        failed: [],
      });
      const outcome = inspectUninstall(stage.deps, 'demo');
      expect(outcome.ok && outcome.report.affectedSessionCounts).toEqual({ available: true, count: 1 });
      expect(outcome.ok && outcome.text).toContain('装载过该插件的会话 1 个');
      // execute 后世代行不随 uninstall 删（立题档裁决 4——已卸插件回执同源可考）
      const done = executeUninstall(stage.deps, 'demo');
      expect(done.ok).toBe(true);
      expect(createLoadHistoryFace(stage.persistence.store.sqlite()).querySessionsWithPlugin('demo')).toBe(1);
    } finally {
      await stage.close();
    }
  });
});

describe('段② 判据锚 installPath 表示形（03 §9.6 mp-3 B2 定形注）', () => {
  it('market 布局相对路径（source local）= 装机子树内必删——inspect true + execute 真删（修前红：source 词特判下恒 false）', async () => {
    const stage = UninstallStage.open('market-local-delete');
    try {
      // B2 市场拷贝腿账本形：source 'local'（源真相）+ market 段相对 installPath
      const marketPath = join('plugins', 'market', 'alpha', 'hello-plugin');
      stage.seedEntry({
        id: 'hello-plugin',
        source: 'local',
        ref: `local:${join(stage.dataDir, 'marketplaces', 'alpha')}`,
        installPath: marketPath,
      });
      const dir = join(stage.dataDir, marketPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), '{}');
      // inspect：相对表示形 = 装机子树内 → willDelete true
      const inspect = inspectUninstall(stage.deps, 'hello-plugin');
      expect(inspect.ok && inspect.report.installPaths[0]!.willDelete).toBe(true);
      // execute：段②真删 market 段目录（缓存之外的装机物独立落位）
      const outcome = executeUninstall(stage.deps, 'hello-plugin');
      expect(outcome.ok).toBe(true);
      expect(existsSync(dir)).toBe(false);
      expect(stage.ledgerIds()).toEqual([]);
    } finally {
      await stage.close();
    }
  });

  it('local 直引绝对路径不删（既有表示形零改绿回归位——market 注记在场不改直引语义）', async () => {
    const stage = UninstallStage.open('direct-local-keep');
    try {
      const localDir = join(testRoot, 'direct-local-src');
      mkdirSync(localDir, { recursive: true });
      writeFileSync(join(localDir, 'package.json'), '{}');
      stage.seedEntry({
        id: 'direct-x',
        source: 'local',
        ref: `local:${localDir}`,
        installPath: localDir,
      });
      const outcome = executeUninstall(stage.deps, 'direct-x');
      expect(outcome.ok).toBe(true);
      expect(existsSync(localDir)).toBe(true); // 子树外不删——只删账本条目
      expect(stage.ledgerIds()).toEqual([]);
    } finally {
      await stage.close();
    }
  });
});

/* ---------------- 段② npm 锚依赖记录剥除（host-plugins#4 回归锁） ---------------- */

/**
 * npm 装机锚现场：runNpmInstall 以 `npm install --prefix --save-exact` 把
 * 依赖记录写进 plugins/package.json（dependencies）+ plugins/.package-lock.json
 * （packages/dependencies 两段）。锚记录含：目标包 demo、兄弟插件 other、
 * scoped 形 @scope/pkg、demo 私有嵌套依赖与顶层传递依赖同名键（left-pad
 * 两落位——剥除判据须只剥 demo 自身键与其私有嵌套键，顶层传递依赖键保留）。
 */
function seedNpmAnchorTree(dataDir: string): void {
  const pluginsDir = join(dataDir, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(
    join(pluginsDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'berry-agent-plugin-tree',
        private: true,
        dependencies: { demo: '1.0.0', other: '2.0.0', '@scope/pkg': '3.0.0' },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(pluginsDir, '.package-lock.json'),
    `${JSON.stringify(
      {
        name: 'berry-agent-plugin-tree',
        lockfileVersion: 3,
        packages: {
          '': { name: 'berry-agent-plugin-tree' },
          'node_modules/demo': { version: '1.0.0', integrity: 'sha512-demo' },
          'node_modules/demo/node_modules/left-pad': { version: '1.3.0' },
          'node_modules/other': { version: '2.0.0' },
          'node_modules/left-pad': { version: '1.3.0' },
          'node_modules/@scope/pkg': { version: '3.0.0' },
        },
        dependencies: {
          demo: { version: '1.0.0', requires: { 'left-pad': '^1.3.0' } },
          other: { version: '2.0.0' },
        },
      },
      null,
      2,
    )}\n`,
  );
}

/** 锚 package.json dependencies 键集（文件缺席抛——测试现场已 seed） */
function anchorDependencyKeys(dataDir: string): string[] {
  const text = readFileSync(join(dataDir, 'plugins', 'package.json'), 'utf8');
  const parsed = JSON.parse(text) as { dependencies?: Record<string, string> };
  return Object.keys(parsed.dependencies ?? {});
}

/** 锚 lock packages 段键集 */
function anchorLockPackageKeys(dataDir: string): string[] {
  const text = readFileSync(join(dataDir, 'plugins', '.package-lock.json'), 'utf8');
  const parsed = JSON.parse(text) as { packages?: Record<string, unknown> };
  return Object.keys(parsed.packages ?? {});
}

/** 锚 lock 旧版 dependencies 段键集（lockfileVersion 1 兼容段） */
function anchorLockDependencyKeys(dataDir: string): string[] {
  const text = readFileSync(join(dataDir, 'plugins', '.package-lock.json'), 'utf8');
  const parsed = JSON.parse(text) as { dependencies?: Record<string, unknown> };
  return Object.keys(parsed.dependencies ?? {});
}

describe('段② npm 锚依赖记录剥除（已卸包不得经锚记录被后续 npm 装机复活）', () => {
  it('npm 布局卸载连带剥 package.json/.package-lock.json 该包记录；兄弟记录与顶层传递依赖键不动', async () => {
    const stage = UninstallStage.open('exec-npm-anchor');
    try {
      seedFullStage(stage); // demo + other 双插件现场
      seedNpmAnchorTree(stage.dataDir);
      const outcome = executeUninstall(stage.deps, 'demo');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // 锚 package.json：demo 剥除；兄弟 other 与 scoped 形保留
      const depKeys = anchorDependencyKeys(stage.dataDir);
      expect(depKeys).not.toContain('demo');
      expect(depKeys).toContain('other');
      expect(depKeys).toContain('@scope/pkg');
      // 锚 lock packages 段：包自身键 + 私有嵌套键剥除；兄弟/顶层传递依赖/scoped 键保留
      const packageKeys = anchorLockPackageKeys(stage.dataDir);
      expect(packageKeys).not.toContain('node_modules/demo');
      expect(packageKeys).not.toContain('node_modules/demo/node_modules/left-pad');
      expect(packageKeys).toContain('node_modules/other');
      expect(packageKeys).toContain('node_modules/left-pad');
      expect(packageKeys).toContain('node_modules/@scope/pkg');
      // 锚 lock 旧版 dependencies 段：demo 剥（嵌套子树随父键整体走）；other 留
      const legacyKeys = anchorLockDependencyKeys(stage.dataDir);
      expect(legacyKeys).not.toContain('demo');
      expect(legacyKeys).toContain('other');
      // 回执面点名锚剥（痕迹可清算）
      expect(outcome.text).toContain('锚依赖记录');
    } finally {
      await stage.close();
    }
  });

  it('scoped 布局（plugins/node_modules/@scope/pkg）同剥——账本 id 与包名解耦，判据锚 installPath', async () => {
    const stage = UninstallStage.open('exec-npm-anchor-scoped');
    try {
      stage.seedEntry({ id: 'scoped-x', installPath: join('plugins', 'node_modules', '@scope', 'pkg') });
      const dir = join(stage.dataDir, 'plugins', 'node_modules', '@scope', 'pkg');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), '{}');
      seedNpmAnchorTree(stage.dataDir);
      const outcome = executeUninstall(stage.deps, 'scoped-x');
      expect(outcome.ok).toBe(true);
      expect(anchorDependencyKeys(stage.dataDir)).not.toContain('@scope/pkg');
      expect(anchorDependencyKeys(stage.dataDir)).toContain('demo'); // 他人记录不动
      expect(anchorLockPackageKeys(stage.dataDir)).not.toContain('node_modules/@scope/pkg');
    } finally {
      await stage.close();
    }
  });

  it('共享引用在：锚记录随物保留（最后引用删尽才连带剥）', async () => {
    const stage = UninstallStage.open('exec-npm-anchor-shared');
    try {
      stage.seedEntry({ id: 'demo' });
      stage.seedEntry({ id: 'alias-x', installPath: join('plugins', 'node_modules', 'demo') });
      stage.seedInstallDir('demo');
      seedNpmAnchorTree(stage.dataDir);
      // 首卸：物保留（共享引用在）——锚记录同保留（记录属物理树，物在锚在）
      const first = executeUninstall(stage.deps, 'demo');
      expect(first.ok).toBe(true);
      expect(anchorDependencyKeys(stage.dataDir)).toContain('demo');
      // 末卸（最后引用删尽）：物删 + 锚剥
      const last = executeUninstall(stage.deps, 'alias-x');
      expect(last.ok).toBe(true);
      expect(existsSync(join(stage.dataDir, 'plugins', 'node_modules', 'demo'))).toBe(false);
      expect(anchorDependencyKeys(stage.dataDir)).not.toContain('demo');
    } finally {
      await stage.close();
    }
  });

  it('非 npm 布局（market 拷贝腿）零锚无作——锚两文件字节不动', async () => {
    const stage = UninstallStage.open('exec-npm-anchor-market');
    try {
      const marketPath = join('plugins', 'market', 'alpha', 'hello-plugin');
      stage.seedEntry({
        id: 'hello-plugin',
        source: 'local',
        ref: `local:${join(stage.dataDir, 'marketplaces', 'alpha')}`,
        installPath: marketPath,
      });
      const dir = join(stage.dataDir, marketPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), '{}');
      seedNpmAnchorTree(stage.dataDir);
      const anchorBefore = readFileSync(join(stage.dataDir, 'plugins', 'package.json'), 'utf8');
      const lockBefore = readFileSync(join(stage.dataDir, 'plugins', '.package-lock.json'), 'utf8');
      const outcome = executeUninstall(stage.deps, 'hello-plugin');
      expect(outcome.ok).toBe(true);
      expect(readFileSync(join(stage.dataDir, 'plugins', 'package.json'), 'utf8')).toBe(anchorBefore);
      expect(readFileSync(join(stage.dataDir, 'plugins', '.package-lock.json'), 'utf8')).toBe(lockBefore);
    } finally {
      await stage.close();
    }
  });

  it('锚 package.json 坏 JSON = fail-loud 拒（PLUGIN_UNINSTALL_REFUSED 收口；剥侧先行——装机物未动）', async () => {
    const stage = UninstallStage.open('exec-npm-anchor-corrupt');
    try {
      stage.seedEntry({ id: 'demo' });
      const dir = stage.seedInstallDir('demo');
      const pluginsDir = join(stage.dataDir, 'plugins');
      mkdirSync(pluginsDir, { recursive: true });
      writeFileSync(join(pluginsDir, 'package.json'), 'not-json{');
      const outcome = executeUninstall(stage.deps, 'demo');
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.message).toContain('PLUGIN_UNINSTALL_REFUSED');
        expect(outcome.message).toContain('坏 JSON');
      }
      // 剥侧先行于删物：拒后装机物原样（修锚/删锚文件后重跑收敛）
      expect(existsSync(dir)).toBe(true);
      expect(stage.ledgerIds()).toContain('demo');
    } finally {
      await stage.close();
    }
  });
});
