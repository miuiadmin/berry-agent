/**
 * host/boot-failures — 启动失败点名账本（03 §5.7 失败三档②的记账面）。
 *
 * 行级装载失败的用户插件记入 `<dataDir>/boot-failures.json`：`{id, version,
 * count}` 点名——count 随每次启动失败累加（启动横幅聚合 warn 的数据源）；
 * 装载成功即清名（横幅只报当下仍坏的行）。core: 行不适用（fail-loud 拒启
 * 狗粮纪律，§5.7）；清单校验失败属档①拒换、不进本账本。
 *
 * fs 动作全注入（内存 Map 可测）；文件形 = 单 JSON 对象 `{ failures:
 * Record<id, {version, count}> }`（人读可改——诊断面友好）。
 *
 * 写面互斥与原子写（03 §5.7 75 轮件4——§5.3 律文件域第六员）：两写动词
 * 「读账本→改→写回」整段入编辑锁（原语单源消费 plugins/exec edit-lock 同步
 * 形）+ 锁内重读施增量 + tmp（pid 后缀）+ rename 原子写。写者两端 = 活宿主
 * boot/重装载（持标记）与无标记诊断装配（plugins list / dump-config 起真
 * dataDir 照跑 boot 序）——并存交错丢跨 boot 续账；直写非原子（半写窗他
 * 进程读折空账）。锁忙/写失败同折「写侧守卫」吞错降级律（见下）。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

import { withEditLock } from '../../plugins/exec/index.js';

/** 账本条目（点名行——version 取清单/包面版本，缺席记 ''） */
export interface BootFailureEntry {
  readonly version: string;
  readonly count: number;
  /**
   * 最近一次失败文本（`[码] 报文` 形，**帽 500 字符**——03 §5.7② obs-a 定形注；
   * 缺席容错读：obs-a 前旧形条目无此字段照常解析，不迁移）。
   */
  readonly lastError?: string;
  /** 最近一次失败时点（ISO 形——obs-a；缺席容错读） */
  readonly lastFailedAt?: string;
}

/**
 * 失败细节面（obs-a——lastError 的数据源）：装载行失败 {code, message}
 * （loader 的 FailedPlugin 子集形——结构满足即可，不依赖具体类型）。
 */
export interface BootFailureDetail {
  readonly code: string;
  readonly message: string;
}

/**
 * `[码] 报文` 形单源铸造（2026-09-13 复盘发现 ⑪——修前六处手抄：warn 横幅
 * ×2 / CLI·TUI plugins list 失败行 / reload 行级失败清单 / plugin_boot 工具
 * 面失败行 / 本件 lastError 账本）。回执、账本、横幅同一形——变格式只改此
 * 处；结构满足 BootFailureDetail 即可喂入（id 徽记位由各消费面自拼）。
 */
export function formatPluginFailureText(failure: BootFailureDetail): string {
  return `[${failure.code}] ${failure.message}`;
}

/** 账本文件形（顶层 failures 键——为后续聚合面预留扩展位） */
export interface BootFailureDoc {
  readonly failures: Readonly<Record<string, BootFailureEntry>>;
}

/**
 * fs 注入面（缺省真盘 read/write/锁四腿——测试注内存 Map）。read/write 之外
 * 的锁原语四腿与 rename 腿（75 轮件4）：结构满足锁原语 EditLockFs 最小面
 * （read/openExclusive/unlink/mkdir——plugin-store 同消费先例），rename 供
 * tmp+rename 原子写。
 */
export interface BootFailuresFs {
  readonly read: (path: string) => string | null; // 缺席 = null（ENOENT 同义）
  readonly write: (path: string, text: string) => void;
  /** O_EXCL 独占建文件（true = 建成即持锁；false = 在场 EEXIST 折档不抛） */
  readonly openExclusive: (path: string, text: string) => boolean;
  /** 删单文件（锁释放位——缺席静默 force 语义） */
  readonly unlink: (path: string) => void;
  /** 递归建目录（锁文件同目录先在——首启零文件形） */
  readonly mkdir: (path: string, options: { readonly recursive: true }) => void;
  /** 原子写 rename 腿（tmp → 终名） */
  readonly rename: (from: string, to: string) => void;
}

/**
 * 缺省真盘实现（读失败一律 null——账本残缺不拦启动序，视同空账本）；导出 =
 * 适配面复用（plugin-boot 的 PluginBootFs→BootFailuresFs 适配器锁腿缺席时
 * 折本实现——真盘单源，先例 createPluginStoreFs）。
 */
export function createBootFailuresFs(): BootFailuresFs {
  return {
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null; // ENOENT / 坏权限——空账本语义（宁空勿炸：账本是诊断面非真相源）
      }
    },
    write: (path, text) => writeFileSync(path, text),
    // O_EXCL 探测：EEXIST 折 false（在场探测非异常档）；其余照抛
    openExclusive: (path, text) => {
      try {
        writeFileSync(path, text, { flag: 'wx' });
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw err;
      }
    },
    unlink: (path) => rmSync(path, { force: true }),
    mkdir: (path, options) => mkdirSync(path, options),
    rename: (from, to) => renameSync(from, to),
  };
}

/** 缺省真盘（createBootFailuresFs 的别名消费位——record/clear 参数缺省值） */
function defaultFs(): BootFailuresFs {
  return createBootFailuresFs();
}

/**
 * 原子写（tmp+rename——75 轮件4）：tmp 名带 pid 后缀（同目录同卷保 rename
 * 原子性 + 并行写者 tmp 互不踩）；写直写非原子的半写窗会让他进程读折空账。
 * mode 随族（boot-failures.json 不在 05 §6.6 敏感产物 0600 扩列族——内容为
 * 错误文本诊断面非凭证，无 0600 位律，不造 per-caller mode 分叉）。
 */
function writeAtomic(fs: BootFailuresFs, path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  fs.write(tmp, text);
  fs.rename(tmp, path);
}

/**
 * 读账本（坏 JSON 视同空——账本非真相源，残缺不拦启动）。
 * fs 面窄化到 read 单腿（读侧零写依赖——PluginBootFs 等两位注入面直传）。
 */
export function readBootFailures(path: string, fs: Pick<BootFailuresFs, 'read'> = defaultFs()): BootFailureDoc {
  const text = fs.read(path);
  if (text === null) return { failures: {} };
  try {
    const doc = JSON.parse(text) as Partial<BootFailureDoc>;
    if (doc === null || typeof doc !== 'object' || typeof doc.failures !== 'object' || doc.failures === null) {
      return { failures: {} };
    }
    const failures: Record<string, BootFailureEntry> = {};
    for (const [id, entry] of Object.entries(doc.failures)) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as BootFailureEntry).version === 'string' &&
        typeof (entry as BootFailureEntry).count === 'number'
      ) {
        // obs-a 扩形字段容错携带：字符串在场即带出，非字符串/缺席静默剥除
        // （旧形条目照常解析——缺席容错读，不迁移）
        failures[id] = {
          version: (entry as BootFailureEntry).version,
          count: (entry as BootFailureEntry).count,
          ...(typeof (entry as BootFailureEntry).lastError === 'string'
            ? { lastError: (entry as BootFailureEntry).lastError }
            : {}),
          ...(typeof (entry as BootFailureEntry).lastFailedAt === 'string'
            ? { lastFailedAt: (entry as BootFailureEntry).lastFailedAt }
            : {}),
        };
      }
    }
    return { failures };
  } catch {
    return { failures: {} }; // 坏 JSON——空账本语义
  }
}

/**
 * 记一次启动失败（count 累加；version 就地刷新为本次版本；lastError/lastFailedAt
 * 刷新为最近一次——03 §5.7② obs-a）——读改写整账本。
 *
 * 互斥与原子写（75 轮件4）：「读→改→写回」整段入编辑锁 + 锁内重读施增量
 * （锁外旧读整覆写即丢他进程记账）+ tmp（pid 后缀）+rename。
 *
 * 写侧守卫（与读侧「宁空勿炸：账本是诊断面非真相源」哲学对齐）：锁拒绝与
 * fs 抛错（EditLockBusy / EACCES/EROFS/ENOSPC——dataDir 不可写或盘满窗）
 * 同档吞掉降级、返回内存计算值——调用位全在启动序内（plugin-boot 记账/
 * 清名），写失败上浮即裸 fs 错误炸整启；本 boot 的横幅/清单呈现不受牵连
 * （跨 boot 的点名续账丢失属诊断面损失，非真相源损失）。
 */
export function recordBootFailure(
  path: string,
  id: string,
  version: string,
  failure: BootFailureDetail,
  fs: BootFailuresFs = defaultFs(),
): BootFailureDoc {
  /** 纯计算：账本 + 本笔 → 新账本（锁内/降级两路共用单源） */
  const compute = (doc: BootFailureDoc): BootFailureDoc => {
    const prev = doc.failures[id];
    const next: Record<string, BootFailureEntry> = { ...doc.failures };
    // lastError = `[码] 报文` 形帽 500 字符（obs-a 定形注——防账本膨胀；超长截断；
    // 格式单源 = formatPluginFailureText——发现 ⑪）
    const text = formatPluginFailureText(failure);
    next[id] = {
      version,
      count: (prev?.count ?? 0) + 1,
      lastError: text.length > 500 ? text.slice(0, 500) : text,
      lastFailedAt: new Date().toISOString(),
    };
    return { failures: next };
  };
  let written: BootFailureDoc | undefined;
  try {
    written = withEditLock(fs, path, () => {
      // 锁内重读施增量（RMW 全程互斥——勿持锁外旧读）
      const next = compute(readBootFailures(path, fs));
      writeAtomic(fs, path, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
  } catch {
    // 静默吞（锁拒绝与 fs 抛错同档）——见函数头「写侧守卫」注：账本写失败/锁
    // 不可得不炸启动序；锁拒绝绝不退化为无锁写（宁丢本笔记账不丢他进程更新）
  }
  // 降级：锁未取得/写失败——按无锁读计算内存值返回（横幅/清单呈现不受牵连）
  return written ?? compute(readBootFailures(path, fs));
}

/**
 * 清名（装载成功即报捷——横幅只报仍坏行）。
 *
 * 条目缺席即跳写（消正常 boot 对每个 activated 插件的无条件重写放大面——
 * 零失败 boot 原先也要逐插件整账本重写一次盘）；缺席判定在锁内（锁外判行
 * 后他进程记入本 id 的竞窗即「跳写吞账」）；互斥/原子写/写侧守卫同
 * recordBootFailure（75 轮件4）。
 */
export function clearBootFailure(path: string, id: string, fs: BootFailuresFs = defaultFs()): BootFailureDoc {
  /** 纯计算：账本 − id → 新账本（锁内/降级两路共用单源；缺席 = 原样 + 跳写标记） */
  const compute = (doc: BootFailureDoc): { next: BootFailureDoc; changed: boolean } => {
    if (doc.failures[id] === undefined) return { next: doc, changed: false }; // 无该行即无变更——不写文件不造账
    const { [id]: _removed, ...rest } = doc.failures;
    return { next: { failures: rest }, changed: true };
  };
  let written: BootFailureDoc | undefined;
  try {
    written = withEditLock(fs, path, () => {
      const { next, changed } = compute(readBootFailures(path, fs)); // 锁内重读施增量
      if (changed) writeAtomic(fs, path, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
  } catch {
    // 静默吞（锁拒绝与 fs 抛错同档）——见 recordBootFailure「写侧守卫」注
  }
  if (written !== undefined) return written;
  // 降级：锁未取得/写失败——按无锁读计算内存值返回
  return compute(readBootFailures(path, fs)).next;
}
