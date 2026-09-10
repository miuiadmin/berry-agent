/**
 * L3 safety — 危险工具闸（04 §13：不可逆外部写的预授权执法）。
 *
 * 定位：审批对的无人值守对偶——§9 审批对管「模型发起动作、人在场实时裁决」；
 * 本闸管「不可逆外部写」（git push / 开 PR / 发评论……）在无人值守编排中的
 * 放行：无人值守场景无应答者（headless unavailable 拒），代之以**预授权契约
 * + 逐动作过闸执法 + 全量审计**四要素（Vibe-Trading live 安全件同构借形）：
 * 1. **frozen 契约（mandate）**：量化授权闭包 `{ actions, targets, maxPerDay }`
 *    ——原料全部来自用户配置层（mount config，模型写不进配置面），装配期
 *    normalize 后冻结只读注入；闸对 mandate 取规范化哈希（canonical JSON：
 *    递归键字典序、无空白——consent 绑定与门检两侧同函数单源）。targets
 *    **保序即身份**（同集异序 = 漂移即死，fail-closed 向假阳性——用户重签
 *    一次即解）。
 * 2. **consent token**：人面唯写（/danger approve）、哈希绑批、过期即死、
 *    漂移即死；缺席 = fail-closed 缺省（闸落地零配置零行为变化——deny 路径
 *    即原「阻塞转人审」语义）。
 * 3. **HALT 文件哨兵**：<dataDir>/HALT 存在性判、内容不解析（损坏仍
 *    tripped、stat 不可达按在场）——touch 即全停、删即恢复，独立于 LLM 与
 *    事件面；fired-once latch（HALT.fired）改造为审计观测位（曾拦过痕迹，
 *    不自动删；latch 落盘失败 = warn 降级不阻断拒回执）。
 * 4. **hash-chain 审计账本**：<dataDir>/danger-ledger.jsonl 每闸决策一 JSON
 *    行（ALLOW 与 DENY 全记）；recordHash = SHA-256(seq‖prevHash‖规范化载荷)、
 *    首笔 prevHash = 64 个十六进制零字符；追加前自链首重算全链、链坏拒续写
 *    （DANGER_LEDGER_CORRUPT）；逐写 fsync + 首建目录 fsync；日帽计数源 =
 *    账本派生无第二状态（UTC 日界——03 §10.8「存储客观、呈现主观」同律）；
 *    verdict 三值 allow-succeeded / allow-failed / deny（日计数只在确认成功
 *    后递增——防「失败重试烧帽」与「虚计数」两向失真）。
 *
 * 闸序（fail-closed，任何一步不过零外联）：0 账本链健康 → 1 HALT 不在场
 * （kill switch 最优先呈报）→ 2 mandate 在场（结构保证——构造器必填）→
 * 3 consent 三查 → 4 值域 → 5 日帽 → 6 执行 + 回执后记账。adjudication→
 * 执行→append 整段经进程内互斥串行（promise 链——§7 写串行链同族先例，
 * 防并发双过步 5 超帽的 fail-open 缝）。
 *
 * 归宿纪律：零新席零新边（07 §1.1 safety 行职能枚举第六项）——文件 IO 走
 * node:fs（NODE_BUILTIN 全局放行不占边）；dataDir 经装配必填注入
 * （installSafetyGate dataDir 同款先例）。v1 唯一消费方 core:issue 经装配
 * 窄面注入（IssueDangerFace 词面归 issue 侧 types.ts——issue 不 import
 * safety、结构兼容编译期即验，GoalJobsFace 同句式）。
 */

import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BaseError } from '../contracts/index.js';

/* ---------------- 常量（04 §13 定形——数据目录文件族单源） ---------------- */

/** v1 动作闭集两值（扩值随真实消费件立题——闭集律，定形不扩） */
export const DANGER_V1_ACTIONS: readonly string[] = ['push', 'create-pr'];

/** consent 文件名（map 形 `{ consumers: { [consumerId]: {...} } }`） */
export const DANGER_CONSENT_FILE = 'danger-consent.json';

/** HALT 哨兵文件名（存在性判、内容不解析） */
export const DANGER_HALT_FILE = 'HALT';

/** HALT fired-once latch 文件名（审计观测位——曾拦过痕迹，不自动删） */
export const DANGER_HALT_LATCH_FILE = 'HALT.fired';

/** hash-chain 审计账本文件名（每闸决策一 JSON 行） */
export const DANGER_LEDGER_FILE = 'danger-ledger.jsonl';

/** 链首 prevHash（64 个十六进制零字符） */
export const DANGER_GENESIS_HASH = '0'.repeat(64);

/** mandate 缺省日成功帽（04 §13：v1 = issue 件 maxDeliveriesPerDay 缺省 10） */
export const DANGER_MAX_PER_DAY_DEFAULT = 10;

/* ---------------- frozen 契约（mandate） ---------------- */

/** frozen 契约形（三键定形——normalize 产物，坏形不入此形） */
export interface DangerMandate {
  /** 动作类型闭集值域（v1 = push / create-pr） */
  readonly actions: readonly string[];
  /** 目标值域（v1 = issue 件 repos 白名单原样——与触发面同值；保序即身份） */
  readonly targets: readonly string[];
  /** 日成功帽（正整数——定量帽是必要件非可选项） */
  readonly maxPerDay: number;
}

/**
 * 归一 mandate（装配期调用——坏形 {ok:false, message} 响亮拒由装配位折
 * ISSUE_CONFIG_INVALID 行级失败）。normalize 细则 = 缺省填充 + 坏形拒，
 * **无重排操作**：targets 数组保序即身份。
 */
export function normalizeDangerMandate(
  raw: unknown,
): { ok: true; mandate: DangerMandate } | { ok: false; message: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, message: `danger mandate 须对象形（得 ${typeof raw}）` };
  }
  const obj = raw as Record<string, unknown>;

  // actions：缺省 v1 闭集两值；在场须闭集子集非空（预建空位 = 预发明闸）
  let actions: string[];
  if (obj.actions === undefined) {
    actions = [...DANGER_V1_ACTIONS];
  } else {
    if (!Array.isArray(obj.actions) || obj.actions.length === 0) {
      return { ok: false, message: 'danger mandate actions 须非空数组（v1 闭集值域 push/create-pr）' };
    }
    actions = [];
    for (const a of obj.actions) {
      if (typeof a !== 'string' || !DANGER_V1_ACTIONS.includes(a)) {
        return {
          ok: false,
          message: `danger mandate actions 元素越闭集（得 ${JSON.stringify(a)}——v1 值域 push/create-pr，扩值随真实消费件立题）`,
        };
      }
      actions.push(a);
    }
  }

  // targets：必填非空字符串数组（保序——序即身份，无重排）
  if (!Array.isArray(obj.targets) || obj.targets.length === 0) {
    return { ok: false, message: 'danger mandate targets 须非空数组（目标值域）' };
  }
  const targets: string[] = [];
  for (const t of obj.targets) {
    if (typeof t !== 'string' || t === '') {
      return { ok: false, message: `danger mandate targets 元素须非空串（得 ${JSON.stringify(t)}）` };
    }
    targets.push(t);
  }

  // maxPerDay：缺省 10；正整数（空帽即坏形律——0/负数/坏形拒；彻底关停走
  // HALT 哨兵或撤 consent，不走空帽）
  let maxPerDay = DANGER_MAX_PER_DAY_DEFAULT;
  if (obj.maxPerDay !== undefined) {
    const n = obj.maxPerDay;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100_000) {
      return {
        ok: false,
        message: `danger mandate maxPerDay 须 1..100000 正整数（得 ${JSON.stringify(n)}——彻底关停走 HALT 哨兵或撤 consent，不走空帽）`,
      };
    }
    maxPerDay = n;
  }

  return { ok: true, mandate: { actions, targets, maxPerDay } };
}

/* ---------------- 规范化哈希（canonical JSON——单源两消费：consent 绑定与门检） ---------------- */

/**
 * canonical JSON（04 §13 frozen 条）：递归键字典序、无空白、undefined 键跳过
 * （缺席即不在身份里）。数组保序（元素序是值的一部分——targets 保序即身份
 * 的哈希面承载）。
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 十六进制（账本与 mandate 哈希共用底座） */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/* ---------------- 目标值域匹配（与触发面同值同函数语义） ---------------- */

/**
 * 单 pattern 判定：精确串全等 / 含 `*` 的 glob 段级通配锚定全配。
 * 与 issue 件 repoMatchesGlob 同算法独立持有（词面独立律——safety 与 issue
 * 零 DAG 边；漂移由对拍测试互证，webui/security 同款先例）。
 */
export function dangerTargetMatches(target: string, pattern: string): boolean {
  if (!pattern.includes('*')) return pattern === target;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(target);
}

/* ---------------- 账本与 consent 数据形 ---------------- */

/** 账本行（每闸决策一 JSON 行——ALLOW 与 DENY 全记） */
export interface DangerLedgerRecord {
  readonly seq: number;
  readonly prevHash: string;
  readonly recordHash: string;
  /** ISO UTC（日帽 UTC 日界的存储面） */
  readonly at: string;
  readonly consumer: string;
  readonly action: string;
  readonly target: string;
  readonly verdict: 'allow-succeeded' | 'allow-failed' | 'deny';
  /** deny 携码（02 §5.3 DANGER_ 族） */
  readonly code?: string;
  readonly detail?: string;
}

/** consent 文件 map 形 */
interface ConsentFileShape {
  consumers: Record<string, { mandateHash: string; approvedAt: number; expiresAt: number }>;
}

/** 过闸请求（adjudication 输入——action/target 进账本，detail 为审计明细） */
export interface DangerGuardRequest {
  readonly action: string;
  readonly target: string;
  readonly detail?: string;
}

/** consent 签发结果（人面唯写动词的回执形） */
export type DangerApproveResult =
  | { readonly ok: true; readonly mandateHash: string; readonly approvedAt: number; readonly expiresAt: number }
  | { readonly ok: false; readonly message: string };

/** /danger status 呈现源（运维单命令面——mandate/consent/HALT/帽/账本五呈） */
export interface DangerGateStatus {
  readonly consumer: string;
  readonly mandateHash: string;
  readonly mandate: DangerMandate;
  readonly consent: {
    readonly state: 'absent' | 'valid' | 'expired' | 'drifted';
    readonly approvedAt?: string;
    readonly expiresAt?: string;
  };
  readonly halt: {
    readonly tripped: boolean;
    readonly firstFiredAt?: string;
  };
  readonly cap: {
    /** 当日 allow-succeeded 笔数（UTC 日）；链坏 = null（不可派生——拒面恒在） */
    readonly used: number | null;
    readonly max: number;
    readonly day: string;
  };
  readonly ledger: {
    readonly healthy: boolean;
    readonly total: number;
  };
}

/** 危险闸公开面（装配位组合 IssueDangerFace——消费件只见窄面不见裸腿） */
export interface DangerGate {
  readonly consumerId: string;
  /** 活体 mandate 规范化哈希（consent 绑定面） */
  readonly mandateHash: string;
  /**
   * 过闸执行（闸包裹的执行腿）：闸序 0-5 全过 → await execute() → 回执后
   * 记账 allow-succeeded 返回其值；execute 抛 → 记账 allow-failed 原错误直
   * 传；任一步不过 → 记账 deny（携码）+ BaseError 携 `DANGER_` 族码上抛、
   * **零外联**（execute 不被调用——先查后执行，SSRF 守卫同律）。
   * adjudication→执行→append 整段经进程内互斥串行（防并发双过步 5）。
   */
  runGuarded<T>(req: DangerGuardRequest, execute: () => Promise<T>): Promise<T>;
  /** consent 签发（人面唯写——/danger approve 承载；绑当前活体 mandate 哈希） */
  approve(ttlDays?: number): Promise<DangerApproveResult>;
  /** 运维呈现（/danger status 承载） */
  status(): Promise<DangerGateStatus>;
}

/** 闸构造选项 */
export interface DangerGateOptions {
  /** 消费方标识（v1 唯一 'core:issue'——consent map 键与账本 consumer 位） */
  readonly consumerId: string;
  /** frozen 契约（normalizeDangerMandate 产物——装配期冻结只读注入） */
  readonly mandate: DangerMandate;
  /** 宿主状态根（consent/HALT/latch/账本四文件落点——恒注入非自取） */
  readonly dataDir: string;
  /** warn 日志面（缺省 no-op——测试静默） */
  readonly warn?: (message: string) => void;
  /** 挂钟注入（缺省 Date.now——测试翻日/过期用） */
  readonly now?: () => number;
}

/** 组危险工具闸（进程内单实例——与 §1 单活跃机一致，单写者纪律） */
export function createDangerGate(opts: DangerGateOptions): DangerGate {
  const warn = opts.warn ?? (() => undefined);
  const now = opts.now ?? Date.now;
  const consumerId = opts.consumerId;
  const mandate = opts.mandate;
  const consentPath = join(opts.dataDir, DANGER_CONSENT_FILE);
  const haltPath = join(opts.dataDir, DANGER_HALT_FILE);
  const latchPath = join(opts.dataDir, DANGER_HALT_LATCH_FILE);
  const ledgerPath = join(opts.dataDir, DANGER_LEDGER_FILE);
  const mandateHash = sha256Hex(canonicalJson(mandate));

  /* ---- 互斥串行（promise 链：adjudication→执行→append 整段排队） ---- */
  let tail: Promise<unknown> = Promise.resolve();
  function serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /* ---- 原子写底座（tmp + rename + fsync——consent/latch 同族纪律） ---- */

  /** 目录 fsync（崩溃撕裂防线——平台/文件系统不支持则尽力而为） */
  async function fsyncDir(dir: string): Promise<void> {
    try {
      const dh = await open(dir, 'r');
      try {
        await dh.sync();
      } finally {
        await dh.close();
      }
    } catch {
      // 目录 fsync 平台差异面（不构成拒因——文件级 fsync 已足）
    }
  }

  /** tmp+rename 原子写 JSON（写前 fsync tmp、写后 fsync 目录） */
  async function atomicWriteJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    const fh = await open(tmp, 'w');
    try {
      await writeFile(fh, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
    await fsyncDir(dirname(path));
  }

  /* ---- 账本读写（追加前验证全链——账本完整性先于可用性） ---- */

  /** 账本载荷（recordHash 输入——seq/prevHash/recordHash 三位不入自身哈希） */
  function payloadOf(record: {
    at: string;
    consumer: string;
    action: string;
    target: string;
    verdict: DangerLedgerRecord['verdict'];
    code?: string;
    detail?: string;
  }): Record<string, unknown> {
    return {
      at: record.at,
      consumer: record.consumer,
      action: record.action,
      target: record.target,
      verdict: record.verdict,
      ...(record.code !== undefined ? { code: record.code } : {}),
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
    };
  }

  /** 读账本 + 自链首重算全链（v1 量级毫秒级合理——检查点/增量验证随规模立题） */
  async function loadLedger(): Promise<DangerLedgerRecord[]> {
    let text: string;
    try {
      text = await readFile(ledgerPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; // 未建 = 空链健康
      throw new BaseError(
        'DANGER_LEDGER_CORRUPT',
        `[DANGER_LEDGER_CORRUPT] 账本不可读（${(err as Error).message}）——按链坏拒续写处理（fail-closed）`,
      );
    }
    const records: DangerLedgerRecord[] = [];
    let prevHash = DANGER_GENESIS_HASH;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line === '') continue; // 尾行空行（末笔 \n 产物）非记录
      let parsed: Partial<DangerLedgerRecord> & Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Partial<DangerLedgerRecord>;
      } catch (err) {
        throw new BaseError(
          'DANGER_LEDGER_CORRUPT',
          `[DANGER_LEDGER_CORRUPT] 账本第 ${i + 1} 行坏 JSON（${(err as Error).message}）——链坏拒续写，修复归人手（截断/重建是人工决策）`,
        );
      }
      const record = parsed as DangerLedgerRecord;
      const seq = records.length + 1;
      if (
        record.seq !== seq ||
        record.prevHash !== prevHash ||
        typeof record.recordHash !== 'string' ||
        record.recordHash !== sha256Hex(`${seq}|${prevHash}|${canonicalJson(payloadOf(record))}`)
      ) {
        throw new BaseError(
          'DANGER_LEDGER_CORRUPT',
          `[DANGER_LEDGER_CORRUPT] 账本第 ${seq} 笔链验证红（seq/prevHash/recordHash 任一不符——改/删历史行则哈希传播破坏其后全部）——链坏拒续写，修复归人手（截断/重建是人工决策）`,
        );
      }
      records.push(record);
      prevHash = record.recordHash;
    }
    return records;
  }

  /** 追加一笔（调用方已在互斥段内持最新全链 records——「追加前验证」由 loadLedger 承担） */
  async function appendRecord(
    records: readonly DangerLedgerRecord[],
    entry: {
      action: string;
      target: string;
      verdict: DangerLedgerRecord['verdict'];
      code?: string;
      detail?: string;
    },
    nowMs: number,
  ): Promise<void> {
    const prevHash = records.length === 0 ? DANGER_GENESIS_HASH : records[records.length - 1]!.recordHash;
    const seq = records.length + 1;
    const payload = payloadOf({
      at: new Date(nowMs).toISOString(),
      consumer: consumerId,
      action: entry.action,
      target: entry.target,
      verdict: entry.verdict,
      ...(entry.code !== undefined ? { code: entry.code } : {}),
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    });
    const recordHash = sha256Hex(`${seq}|${prevHash}|${canonicalJson(payload)}`);
    const line = `${JSON.stringify({ seq, prevHash, recordHash, ...payload })}\n`;
    await mkdir(opts.dataDir, { recursive: true });
    const fh = await open(ledgerPath, 'a');
    try {
      await fh.write(line);
      await fh.sync(); // 逐写 fsync（崩溃撕裂防线）
    } finally {
      await fh.close();
    }
    if (records.length === 0) await fsyncDir(opts.dataDir); // 首建（或空链重建）目录 fsync
  }

  /** 当日 allow-succeeded 计数（UTC 日界——账本派生无第二状态） */
  function countTodayAllowSucceeded(records: readonly DangerLedgerRecord[], nowMs: number): number {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    return records.filter(
      (r) => r.verdict === 'allow-succeeded' && r.consumer === consumerId && r.at.slice(0, 10) === day,
    ).length;
  }

  /* ---- HALT 哨兵与 latch ---- */

  /** 哨兵在场判定（存在性判、内容不解析；stat 不可达按在场处理同向） */
  async function haltTripped(): Promise<boolean> {
    try {
      await stat(haltPath);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code !== 'ENOENT';
    }
  }

  /** latch 读（best-effort——坏形/缺席返回 undefined，不构成拒因） */
  async function readLatch(): Promise<string | undefined> {
    try {
      const parsed = JSON.parse(await readFile(latchPath, 'utf8')) as { firstFiredAt?: unknown };
      return typeof parsed?.firstFiredAt === 'string' ? parsed.firstFiredAt : undefined;
    } catch {
      return undefined;
    }
  }

  /** latch 落盘（首次因 HALT 拒时——审计观测位：不自动删、失败 = warn 降级） */
  async function writeLatchOnce(nowMs: number): Promise<void> {
    try {
      await stat(latchPath);
      return; // 已在场——firstFiredAt 保持首笔（观测位语义）
    } catch {
      // 不在场——落盘（其余 stat 错误也让位于下方写失败的 warn 降级）
    }
    try {
      await atomicWriteJson(latchPath, { firstFiredAt: new Date(nowMs).toISOString() });
    } catch (err) {
      warn(`HALT.fired latch 落盘失败（warn 降级——拒已成立，观测位尽力而为）：${(err as Error).message}`);
    }
  }

  /* ---- consent 读写 ---- */

  /** 读本 consumer 的 consent 条目（缺席/坏形/不可读 = undefined——fail-closed 向） */
  async function readConsentEntry(): Promise<
    { mandateHash: string; approvedAt: number; expiresAt: number } | undefined
  > {
    let text: string;
    try {
      text = await readFile(consentPath, 'utf8');
    } catch {
      return undefined; // 缺席（ENOENT）或不可读——均按缺席（拒面同向）
    }
    try {
      const parsed = JSON.parse(text) as Partial<ConsentFileShape>;
      const entry = parsed?.consumers?.[consumerId];
      if (entry === null || typeof entry !== 'object') return undefined;
      const { mandateHash: hash, approvedAt, expiresAt } = entry as Record<string, unknown>;
      if (typeof hash !== 'string' || typeof approvedAt !== 'number' || typeof expiresAt !== 'number') {
        warn('danger-consent.json 本 consumer 条目坏形——按缺席处理（重签即解）');
        return undefined;
      }
      return { mandateHash: hash, approvedAt, expiresAt };
    } catch {
      warn('danger-consent.json 坏形——按缺席处理（用户资产可手改；重签即解）');
      return undefined;
    }
  }

  /* ---- 闸序执行（0-6——serialized 段内） ---- */

  /**
   * deny 记账 + 上抛（决策已成立——记账失败 = warn 降级不吞拒：拒回执优先，
   * 账本侧告警归人检）。HALT 分支先落 latch（观测位尽力而为）。
   */
  async function denyAndThrow(
    records: readonly DangerLedgerRecord[],
    req: DangerGuardRequest,
    code: string,
    message: string,
    nowMs: number,
    options?: { readonly latch?: boolean },
  ): Promise<never> {
    if (options?.latch === true) await writeLatchOnce(nowMs);
    try {
      await appendRecord(
        records,
        { action: req.action, target: req.target, verdict: 'deny', code, detail: req.detail },
        nowMs,
      );
    } catch (err) {
      warn(`危险闸 deny 记账失败（决策已成立——账本侧告警）：${(err as Error).message}`);
    }
    throw new BaseError(code, message);
  }

  function runGuarded<T>(req: DangerGuardRequest, execute: () => Promise<T>): Promise<T> {
    return serialized(async () => {
      const nowMs = now();
      const dataDirNote = opts.dataDir;

      /* 步 0：账本链健康（前置不变式——链坏 = 全拒，后续判定一概不发生） */
      const records = await loadLedger();

      /* 步 1：HALT 哨兵不在场（kill switch 最优先呈报——全停理由先于一切门检） */
      if (await haltTripped()) {
        await denyAndThrow(
          records,
          req,
          'DANGER_HALTED',
          `[DANGER_HALTED] 危险闸 HALT 哨兵在场——全部危险动作拒（存在性执法：删除 ${join(dataDirNote, DANGER_HALT_FILE)} 文件即恢复）`,
          nowMs,
          { latch: true },
        );
      }

      /* 步 2：mandate 在场——结构保证（构造器必填冻结注入），无运行期判定 */

      /* 步 3：consent 三查（在场 + 哈希绑批 + 未过期——任一不满足即拒） */
      const consent = await readConsentEntry();
      if (consent === undefined) {
        await denyAndThrow(
          records,
          req,
          'DANGER_CONSENT_ABSENT',
          '[DANGER_CONSENT_ABSENT] 危险闸 consent 缺席（fail-closed 缺省）——TUI 运行 /danger approve 签发后重试（「全自动」双层显式 opt-in：mode auto + consent 各自独立拒）',
          nowMs,
        );
      } else if (consent.mandateHash !== mandateHash) {
        await denyAndThrow(
          records,
          req,
          'DANGER_CONSENT_INVALID',
          `[DANGER_CONSENT_INVALID] 危险闸 consent 漂移（mandate 哈希不符——批了 A 契约不等于批了 B 契约）——重跑 /danger approve 重签（活体哈希 ${mandateHash}）`,
          nowMs,
        );
      } else if (nowMs >= consent.expiresAt) {
        await denyAndThrow(
          records,
          req,
          'DANGER_CONSENT_INVALID',
          '[DANGER_CONSENT_INVALID] 危险闸 consent 过期（不自动续、不静默宽限——重签唯一出路）——重跑 /danger approve',
          nowMs,
        );
      }

      /* 步 4：动作可解析且在值域（action ∈ actions、target 匹配 targets） */
      if (!mandate.actions.includes(req.action)) {
        await denyAndThrow(
          records,
          req,
          'DANGER_TARGET_DENIED',
          `[DANGER_TARGET_DENIED] 动作不在 mandate 值域（action=${req.action}——v1 闭集 ${mandate.actions.join('/')}）`,
          nowMs,
        );
      }
      if (!mandate.targets.some((pattern) => dangerTargetMatches(req.target, pattern))) {
        await denyAndThrow(
          records,
          req,
          'DANGER_TARGET_DENIED',
          `[DANGER_TARGET_DENIED] 目标不在 mandate 值域（target=${req.target}——值域 ${mandate.targets.join(', ')}）`,
          nowMs,
        );
      }

      /* 步 5：日帽未超（当日 allow-succeeded 笔数 < maxPerDay——账本派生） */
      const used = countTodayAllowSucceeded(records, nowMs);
      if (used >= mandate.maxPerDay) {
        await denyAndThrow(
          records,
          req,
          'DANGER_CAP_EXCEEDED',
          `[DANGER_CAP_EXCEEDED] 当日成功帽已满（${used}/${mandate.maxPerDay}，UTC 日界恢复）——次日重试或提帽后重签 consent`,
          nowMs,
        );
      }

      /* 步 6：执行外部写 → 回执后记账（verdict 按成败落；失败上抛 = allow-failed 原错误直传）。
       * 记账失败 = warn 降级（denyAndThrow 同律对称——决策与执行已成立，账本侧 IO
       * 失败不改变回执语义：成功尾不折假失败〔外部写已发生〕、失败腿原错误不被
       * 记账错误顶替；链完整性由下次 loadLedger 的追加前验证承担）。 */
      let result: T;
      try {
        result = await execute();
      } catch (err) {
        try {
          await appendRecord(
            records,
            {
              action: req.action,
              target: req.target,
              verdict: 'allow-failed',
              detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
            },
            nowMs,
          );
        } catch (accErr) {
          warn(`危险闸 allow-failed 记账失败（原错误优先上报——账本侧告警）：${(accErr as Error).message}`);
        }
        throw err;
      }
      try {
        await appendRecord(records, { action: req.action, target: req.target, verdict: 'allow-succeeded' }, nowMs);
      } catch (accErr) {
        warn(`危险闸 allow-succeeded 记账失败（外部写已发生——回执不降级，账本侧告警）：${(accErr as Error).message}`);
      }
      return result;
    });
  }

  const gate: DangerGate = {
    consumerId,
    mandateHash,

    runGuarded,

    async approve(ttlDays = 30): Promise<DangerApproveResult> {
      if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 3650) {
        return { ok: false, message: `ttlDays 须 1..3650 正整数（得 ${JSON.stringify(ttlDays)}）` };
      }
      const nowMs = now();
      const approvedAt = nowMs;
      const expiresAt = nowMs + ttlDays * 86_400_000;
      // 读全图保留他 consumer 条目（map 形——多消费方形态随第三方面立题）
      let map: ConsentFileShape = { consumers: {} };
      try {
        const parsed = JSON.parse(await readFile(consentPath, 'utf8')) as Partial<ConsentFileShape>;
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          parsed.consumers !== null &&
          typeof parsed.consumers === 'object'
        ) {
          map = parsed as ConsentFileShape;
        }
      } catch {
        // 缺席/坏形——重建（consent 是用户资产可手改；签发即覆写本条目）
      }
      map.consumers[consumerId] = { mandateHash, approvedAt, expiresAt };
      await atomicWriteJson(consentPath, map);
      return { ok: true, mandateHash, approvedAt, expiresAt };
    },

    async status(): Promise<DangerGateStatus> {
      const nowMs = now();
      let records: DangerLedgerRecord[] = [];
      let healthy = true;
      try {
        records = await loadLedger();
      } catch {
        healthy = false; // 链坏——呈现诚实（deliver 步 0 恒拒）
      }
      const entry = await readConsentEntry();
      let state: 'absent' | 'valid' | 'expired' | 'drifted' = 'absent';
      if (entry !== undefined) {
        if (entry.mandateHash !== mandateHash) state = 'drifted';
        else if (nowMs >= entry.expiresAt) state = 'expired';
        else state = 'valid';
      }
      const tripped = await haltTripped();
      const firstFiredAt = await readLatch(); // 独立呈现——删 HALT 恢复后「曾拦过」痕迹仍在
      return {
        consumer: consumerId,
        mandateHash,
        mandate,
        consent: {
          state,
          ...(entry !== undefined
            ? {
                approvedAt: new Date(entry.approvedAt).toISOString(),
                expiresAt: new Date(entry.expiresAt).toISOString(),
              }
            : {}),
        },
        halt: { tripped, ...(firstFiredAt !== undefined ? { firstFiredAt } : {}) },
        cap: {
          used: healthy ? countTodayAllowSucceeded(records, nowMs) : null,
          max: mandate.maxPerDay,
          day: new Date(nowMs).toISOString().slice(0, 10),
        },
        ledger: { healthy, total: records.length },
      };
    },
  };
  return gate;
}
