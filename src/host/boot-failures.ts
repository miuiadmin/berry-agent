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
 */
import { readFileSync, writeFileSync } from 'node:fs';

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

/** 账本文件形（顶层 failures 键——为后续聚合面预留扩展位） */
export interface BootFailureDoc {
  readonly failures: Readonly<Record<string, BootFailureEntry>>;
}

/** fs 注入面（缺省真盘 readFileSync/writeFileSync——测试注内存 Map） */
export interface BootFailuresFs {
  readonly read: (path: string) => string | null; // 缺席 = null（ENOENT 同义）
  readonly write: (path: string, text: string) => void;
}

/** 缺省真盘实现（读失败一律 null——账本残缺不拦启动序，视同空账本） */
function defaultFs(): BootFailuresFs {
  return {
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null; // ENOENT / 坏权限——空账本语义（宁空勿炸：账本是诊断面非真相源）
      }
    },
    write: (path, text) => writeFileSync(path, text),
  };
}

/**
 * 读账本（坏 JSON 视同空——账本非真相源，残缺不拦启动）。
 */
export function readBootFailures(path: string, fs: BootFailuresFs = defaultFs()): BootFailureDoc {
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
 */
export function recordBootFailure(
  path: string,
  id: string,
  version: string,
  failure: BootFailureDetail,
  fs: BootFailuresFs = defaultFs(),
): BootFailureDoc {
  const doc = readBootFailures(path, fs);
  const prev = doc.failures[id];
  const next: Record<string, BootFailureEntry> = { ...doc.failures };
  // lastError = `[码] 报文` 形帽 500 字符（obs-a 定形注——防账本膨胀；超长截断）
  const text = `[${failure.code}] ${failure.message}`;
  next[id] = {
    version,
    count: (prev?.count ?? 0) + 1,
    lastError: text.length > 500 ? text.slice(0, 500) : text,
    lastFailedAt: new Date().toISOString(),
  };
  const written: BootFailureDoc = { failures: next };
  fs.write(path, `${JSON.stringify(written, null, 2)}\n`);
  return written;
}

/**
 * 清名（装载成功即报捷——横幅只报仍坏行）。
 */
export function clearBootFailure(path: string, id: string, fs: BootFailuresFs = defaultFs()): BootFailureDoc {
  const doc = readBootFailures(path, fs);
  const { [id]: _removed, ...rest } = doc.failures;
  const written: BootFailureDoc = { failures: rest };
  fs.write(path, `${JSON.stringify(written, null, 2)}\n`);
  return written;
}
