/**
 * persist — ENOSPC（磁盘满）真注入测试（W4 异常矩阵三缺口之二）。
 *
 * 现状背景：磁盘满路径此前只有合成形——checkpoint/gate.test.ts :56 用中文
 * 假抛「磁盘满」覆盖判据分支逻辑；真文件系统写满后的物理行为（better-sqlite3
 * 报错形态、写链熔断路径、库是否被腐蚀）零实证（评估实测：ENOSPC 真注入
 * 全为零）。
 *
 * 本文件补真注入形（macOS 免 sudo 面）：hdiutil 造 2MB HFS+ 磁盘镜像并挂载
 * 为数据目录 → 真库（Persistence.open 显式 dbPath/dataDir）循环写大载荷事件
 * 直到卷满 → 断言物理行为：
 *  - fail-loud 熔断：ENOSPC（SQLITE_FULL）经 write-behind 三连退避重试后
 *    熔断 PERSIST_WRITE_EXHAUSTED——flush 抛错、后续 append 诚实拒写
 *    （不静默、不假写）；
 *  - 报错不腐蚀库：卸卷重挂后同一库文件可开可读，已提交前缀完好（seq
 *    连续、内容逐笔保真、sessions.last_seq 对齐——宁拒勿删的物理面）；
 *  - 回归后读写面恢复：重挂开库后 loadSession 正常（磁盘满不留下打不开
 *    的残卷——WAL 残卷由重开自动恢复）。
 *
 * 平台口径：macOS 腿真跑（hdiutil 出厂在场）；非 mac / hdiutil 缺席 → skip
 * 诚实（CI macos 腿实跑真注入、linux 腿 skip——CI 矩阵两腿各取所长）。
 * gate.test.ts :56 的中文假抛保持不动：合成形覆盖判据分支逻辑、本文件覆盖
 * 物理行为——两层分工不混装（真形物理面归 persist 层，不回灌 gate 判据面）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';
import { Persistence } from './persistence.js';

/* ---------------- 平台闸（mac + hdiutil 在场才真跑） ---------------- */

/** hdiutil 可用性探针（一次探定——缺席即整文件 skip；注意 -version 非法动词，用 help） */
const hdiutilAvailable = (() => {
  if (process.platform !== 'darwin') return false;
  const probe = spawnSync('hdiutil', ['help'], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
})();

// 非真跑平台 skip（描述内注明诚实理由——CI linux 腿走此分支）
const maybeDescribe = hdiutilAvailable ? describe : describe.skip;

/* ---------------- 卷生命周期（hdiutil 免 sudo 面） ---------------- */

/** 已挂载点登记 + 临时目录登记（单一 afterAll 定序清场：先卸卷再删目录——
 *  vitest afterAll 属 LIFO 序，分两个钩子会把 rmSync 排到卸卷前撞挂载点） */
const mountedDirs: string[] = [];
const dirs: string[] = [];
afterAll(() => {
  // 先卸卷（-force 兜底——失败路径不留挂载残卷）
  for (const dir of mountedDirs.splice(0)) {
    try {
      execFileSync('hdiutil', ['detach', dir, '-force'], { stdio: 'ignore' });
    } catch {
      // 已卸/异常——兜卸幂等
    }
  }
  // 再删目录（镜像文件随目录清——零残留）
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * 造卷并挂载：2MB HFS+ 镜像（固定尺寸——保证必然写满）+ 显式 mountpoint
 * （不进 /Volumes 命名空间，路径确定性不依赖卷名）。
 * @returns 挂载点（即数据目录）
 */
function createAndMountVolume(workDir: string): string {
  const imagePath = join(workDir, 'enospc.dmg');
  const mountDir = join(workDir, 'mnt');
  // HFS+（非日志形——WAL 所需共享内存面任何 POSIX 文件系统皆有）
  execFileSync('hdiutil', ['create', '-size', '2m', '-fs', 'HFS+', '-volname', 'enospc-test', imagePath], {
    stdio: 'ignore',
  });
  mkdirSync(mountDir, { recursive: true });
  execFileSync('hdiutil', ['attach', imagePath, '-mountpoint', mountDir, '-nobrowse'], { stdio: 'ignore' });
  mountedDirs.push(mountDir);
  return mountDir;
}

/** 卸卷 → 重挂（同镜像同挂载点——模拟磁盘满后的重挂恢复场景） */
function remountVolume(workDir: string, mountDir: string): void {
  execFileSync('hdiutil', ['detach', mountDir, '-force'], { stdio: 'ignore' });
  const index = mountedDirs.indexOf(mountDir);
  if (index !== -1) mountedDirs.splice(index, 1);
  execFileSync('hdiutil', ['attach', join(workDir, 'enospc.dmg'), '-mountpoint', mountDir, '-nobrowse'], {
    stdio: 'ignore',
  });
  mountedDirs.push(mountDir);
}

/* ---------------- 真注入断言族 ---------------- */

maybeDescribe('ENOSPC 真注入（hdiutil 2MB 卷写满）', () => {
  it('写满 → 熔断 fail-loud；卸卷重挂 → 库可开可读、前缀不腐蚀', async () => {
    const workDir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'enospc-test-')));
    dirs.push(workDir);
    const mountDir = createAndMountVolume(workDir);
    const dbPath = join(mountDir, 'sessions.db');

    // ── 阶段一：真库写满（生产路径 Persistence + write-behind）──
    const persistence = Persistence.open({ dbPath, dataDir: mountDir });
    const log = persistence.createSession({ origin: 'conversation', workspaceRoot: '/enospc' });
    const sessionId = log.sessionId;
    // 48KiB/笔载荷（60KiB 内容帽内）：events 行 + FTS 行双份 ≈ 96KiB/笔，
    // 2MB 卷 ~20 笔内写满——循环帽 64 兜底（超出仍无错 = 注入失效，断言抓）
    const PAYLOAD = 'x'.repeat(48 * 1024);
    let exhausted: BaseError | undefined;
    for (let i = 0; i < 64; i++) {
      try {
        log.append('user/message', { content: `enospc-${i}-${PAYLOAD}`, source: 'user' });
        await persistence.flush();
      } catch (err) {
        exhausted = err as BaseError;
        break;
      }
    }
    // fail-loud 断言①：写满错误必然到达（64 笔内）
    expect(exhausted).toBeInstanceOf(BaseError);
    expect(exhausted!.code).toBe('PERSIST_WRITE_EXHAUSTED');
    // 物理根因断言：cause 恒 SQLITE_FULL（ENOSPC 的 SQLite 映射码）。
    // 早期实测曾得两形（b 形 = COMMIT 边界失败后 write-behind 内部重试被
    // 连续性断言误诊 PERSIST_DATA_CORRUPT——游标随失败事务推进、真因盘满
    // 被遮蔽）；store.ts 游标推进改到事务成功后（见 store.test.ts 回归锁
    // 「写失败游标不推进」），b 形结构性闭死——断言随之收紧为单值，防回退。
    const cause = exhausted!.cause as { code?: string } | undefined;
    expect(cause?.code).toBe('SQLITE_FULL');

    // fail-loud 断言②：熔断后诚实拒写（假写零容忍——append 即抛，不静默丢）
    let refused: unknown;
    try {
      log.append('user/message', { content: 'should-be-refused', source: 'user' });
    } catch (err) {
      refused = err;
    }
    expect((refused as BaseError | undefined)?.code).toBe('PERSIST_WRITE_EXHAUSTED');

    // 收口：物理层直接关库（Persistence.close 会因熔断 flush 抛错——此形态
    // 下走 store.close：checkpoint 在满卷上失败会内部降级 warn，db.close 直通）
    persistence.store.close();

    // ── 阶段二：卸卷重挂 → 库可开可读（报错不腐蚀）──
    remountVolume(workDir, mountDir);
    const reopened = Persistence.open({ dbPath, dataDir: mountDir });
    try {
      expect(reopened.hasSession(sessionId)).toBe(true);
      const loaded = reopened.loadSession(sessionId);
      const events = [...loaded.log.events()];
      // 已提交前缀完好：至少一笔落定（写满前有充足提交窗）且 seq 连续无洞
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
      // 内容逐笔保真（enstral 前缀 + 48KiB 精确长度对拍）
      for (const event of events) {
        const content = (event.data as { content: string }).content;
        const index = Number.parseInt(content.slice('enospc-'.length).split('-')[0]!, 10);
        expect(content).toBe(`enospc-${index}-${PAYLOAD}`);
      }
      // sessions.last_seq 与前缀对齐（宁拒勿删——无越前缀的幻影推进）
      expect(loaded.row.lastSeq).toBe(events.length - 1);
    } finally {
      reopened.store.close();
    }
  }, 120_000);
});
