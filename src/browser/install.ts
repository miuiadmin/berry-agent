/**
 * 引擎下载件（03 §10.3 引擎发现序条——`/browser install` 的下载原语）。
 *
 * - **下载原语不进模型工具面**（spec 明裁）：显式命令（TUI/CLI）专用，
 *   模型不可触发 150MB 级下载。
 * - **域白名单钉 Chromium for Testing 官方两域**：元数据
 *   googlechromelabs.github.io + 工件 storage.googleapis.com——元数据给出
 *   的下载 URL 同样过白名单（元数据被改也出不了白名单域）。
 * - **流式落盘 + 摘要账本 TOFU 锚定**：首装计算 zip sha256 锚进
 *   `dataDir/browser/engine/ledger.json`；同版本重装摘要不符即拒执行
 *   （BROWSER_DIGEST_MISMATCH——fail-loud 不动盘）。
 * - **手写 unzip 零新增依赖**：EOCD 反扫 → 中央目录遍历 → 本地头跳位 →
 *   store/deflate 两法解压（zlib.inflateRawSync）；zip-slip 防御（拒绝
 *   `..` 与绝对路径条目）+ unix 属性行 chmod（可执行位——macOS app 内
 *   helper 二进制族需要）。
 * - 平台映射 v1 收三席：mac-arm64 / mac-x64 / linux64（win32 与其余
 *   诚实缺席——同发现序 win32 知名位缺席同律，指路显式 executablePath）。
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { BaseError } from '../contracts/index.js';
import type { BrowserFsFace, BrowserLoggerFace } from './types.js';

/* ---------------- 常量（域白名单与元数据单源） ---------------- */

/** CfT「最后已知良好版本」元数据（Stable 通道 + 全平台下载位） */
export const BROWSER_METADATA_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

/** 下载域白名单（元数据域 + 工件域——两域之外一律拒） */
export const BROWSER_DOWNLOAD_HOSTS: readonly string[] = ['googlechromelabs.github.io', 'storage.googleapis.com'];

/** 引擎安装根（数据目录下——发现序第③步消费） */
export const BROWSER_ENGINE_DIRNAME = 'engine';

/** 摘要账本文件名（发现序③与 TOFU 锚定共用） */
export const BROWSER_LEDGER_NAME = 'ledger.json';

/** zip 体积帽（1.5GiB——防元数据被改指向巨型载荷的 sanity 防线） */
export const BROWSER_ZIP_MAX_BYTES = 1.5 * 1024 * 1024 * 1024;

/* ---------------- 窄面与结果 ---------------- */

/** 流式下载窄面（生产 = 全局 fetch 包装；测试注入桩） */
export interface BrowserDownloadFace {
  /** 流式取（状态码 + 字节流；域白名单由 install 逻辑执法——face 只管字节） */
  fetchBinary(url: string): Promise<{ status: number; bytes: AsyncIterable<Uint8Array> }>;
}

/** 安装依赖（全窄面注入） */
export interface BrowserInstallDeps {
  readonly fs: BrowserFsFace;
  readonly download: BrowserDownloadFace;
  readonly platform: NodeJS.Platform;
  /** 进程架构（process.arch 注入——darwin 双架构分叉判据） */
  readonly arch: string;
  readonly dataDir: string;
  readonly logger?: BrowserLoggerFace;
  /** 元数据 URL（缺省钉常量——测试注入位） */
  readonly metadataUrl?: string;
  /** zip 体积帽（缺省钉常量——测试注入位：真测超帽中止腿） */
  readonly maxZipBytes?: number;
}

/** 安装回执（命令面呈现 + 账本镜像） */
export interface BrowserInstallResult {
  readonly version: string;
  readonly zipSha256: string;
  readonly executableRel: string;
  /** 绝对路径（发现序③同形——供回执直接可用） */
  readonly executablePath: string;
  /** 幂等命中（同版本在装且可执行在场——零下载零写盘） */
  readonly alreadyInstalled: boolean;
  /** zip 实收字节数（alreadyInstalled 时为 0） */
  readonly bytes: number;
}

/** 摘要账本形（发现序③只读 executableRel；TOFU 比对 version + zipSha256） */
export interface BrowserEngineLedger {
  readonly version: string;
  readonly zipSha256: string;
  readonly executableRel: string;
  /** 工件平台名（mac-arm64/mac-x64/linux64——诊断面） */
  readonly artifact: string;
  readonly installedAt: string;
  readonly bytes: number;
}

/* ---------------- 平台映射 ---------------- */

/** 平台 + 架构 → CfT 工件名（v1 三席；缺席 = 平台不支持显式下载） */
export function platformArtifact(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'mac-arm64';
    if (arch === 'x64') return 'mac-x64';
    return undefined;
  }
  if (platform === 'linux' && arch === 'x64') return 'linux64';
  return undefined; // win32/其余：v1 诚实缺席（发现序同律——指路显式 executablePath）
}

/** 工件名 → zip 根目录内可执行相对位 */
function executableRelOf(artifact: string): string {
  if (artifact === 'linux64') return 'chrome-linux64/chrome';
  // macOS：app bundle 内主二进制（CfT 命名「Google Chrome for Testing」）
  return `chrome-${artifact}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
}

/* ---------------- 下载面（生产适配） ---------------- */

/** 生产下载面（Node ≥22 全局 fetch——web 流转异步迭代） */
export function defaultDownloadFace(): BrowserDownloadFace {
  return {
    async fetchBinary(url) {
      const res = await fetch(url);
      if (res.body === null) {
        // 无体应答（3xx 等）：空流形——状态码由调用方执法
        return { status: res.status, bytes: (async function* () {})() };
      }
      const body = res.body;
      return {
        status: res.status,
        // web ReadableStream 在 Node ≥22 可异步迭代（for await 直读）
        bytes: (async function* () {
          for await (const chunk of body) yield chunk as Uint8Array;
        })(),
      };
    },
  };
}

/* ---------------- 手写 unzip（EOCD → 中央目录 → 本地头 → 解压） ---------------- */

/** zip 中央目录条目（解压所需子集） */
interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly externalAttrs: number;
  readonly localHeaderOffset: number;
}

/** EOCD 签名与最小长（含注释最大反扫窗 64KiB + 22） */
const EOCD_SIG = 0x06054b50;
const EOCD_MIN = 22;
const EOCD_SCAN = 65_557;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/** 小端读（Buffer.readUInt32LE 的直写形——偏移自校验由调用方保证） */
const u16 = (b: Buffer, o: number): number => b.readUInt16LE(o);
const u32 = (b: Buffer, o: number): number => b.readUInt32LE(o);

/** 解析 EOCD → {中央目录偏移, 条目数}（ZIP64 形 v1 诚实不支持） */
function parseEocd(zip: Buffer): { cdOffset: number; entryCount: number } {
  const scanStart = Math.max(0, zip.length - EOCD_SCAN);
  for (let i = zip.length - EOCD_MIN; i >= scanStart; i--) {
    if (u32(zip, i) !== EOCD_SIG) continue;
    const entryCount = u16(zip, i + 10);
    const cdOffset = u32(zip, i + 16);
    // 多卷/ZIP64 形拒收：盘号/目录盘非零，或条目数与目录偏移触 0xFFFF/
    // 0xFFFFFFFF 上界标记（EOCD 布局——尾字段注释长是 u16，勿读 u32 越界）
    if (u16(zip, i + 4) !== 0 || u16(zip, i + 6) !== 0 || entryCount === 0xffff || cdOffset === 0xffffffff) {
      throw new Error('引擎 zip 含多卷/ZIP64 形——v1 不支持（Chromium for Testing 工件不应出现此形）');
    }
    return { cdOffset, entryCount };
  }
  throw new Error('引擎 zip 缺 EOCD（非 zip 形或截断）');
}

/** 遍历中央目录（条目子集抽取；签名不符即拒——坏形不猜） */
function readCentralDirectory(zip: Buffer): ZipEntry[] {
  const { cdOffset, entryCount } = parseEocd(zip);
  const entries: ZipEntry[] = [];
  let off = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > zip.length || u32(zip, off) !== CD_SIG) {
      throw new Error(`引擎 zip 中央目录坏形（第 ${i + 1} 条签名不符）`);
    }
    const method = u16(zip, off + 10);
    const compressedSize = u32(zip, off + 20);
    const nameLen = u16(zip, off + 28);
    const extraLen = u16(zip, off + 30);
    const commentLen = u16(zip, off + 32);
    const externalAttrs = u32(zip, off + 38);
    const localHeaderOffset = u32(zip, off + 42);
    const name = zip.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, externalAttrs, localHeaderOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** zip-slip 防御：条目名须为相对净形（拒 `..` 段与绝对形） */
function safeEntryName(name: string): string {
  if (name.startsWith('/') || name.includes('\\')) {
    throw new Error(`zip-slip 防御拒绝条目：${JSON.stringify(name)}（绝对形/反斜杠）`);
  }
  for (const seg of name.split('/')) {
    if (seg === '..') throw new Error(`zip-slip 防御拒绝条目：${JSON.stringify(name)}（.. 段）`);
  }
  return name;
}

/** 解压单条目（本地头跳位 → store/deflate → Buffer） */
function extractEntry(zip: Buffer, entry: ZipEntry): Buffer {
  const off = entry.localHeaderOffset;
  if (off + 30 > zip.length || u32(zip, off) !== LFH_SIG) {
    throw new Error(`引擎 zip 本地头坏形：${entry.name}`);
  }
  const nameLen = u16(zip, off + 26);
  const extraLen = u16(zip, off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = zip.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw); // store
  if (entry.method === 8) return inflateRawSync(raw); // deflate（raw 形）
  throw new Error(`引擎 zip 条目用不支持压缩法 ${entry.method}：${entry.name}`);
}

/**
 * 解压引擎 zip 到目标目录（手写最小 unzip——零依赖条款）。
 * @returns 解出的文件条目数（目录条目不计）
 */
export async function unzipTo(zip: Buffer, destDir: string, fs: BrowserFsFace): Promise<number> {
  let files = 0;
  for (const entry of readCentralDirectory(zip)) {
    const name = safeEntryName(entry.name);
    const target = `${destDir}/${name}`;
    if (name.endsWith('/')) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    // 父目录链先建（中央目录目录条目不保证先行）
    const parent = name.lastIndexOf('/') === -1 ? destDir : `${destDir}/${name.slice(0, name.lastIndexOf('/'))}`;
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(target, extractEntry(zip, entry));
    files += 1;
    // unix 属性行 chmod（高 16 位 mode；常规文件位在场才算——可执行位保
    // macOS app 内 helper 二进制族）。chmod 面缺席静默跳过（窄面可选）。
    const attrs = entry.externalAttrs >>> 16;
    const mode = attrs & 0o7777;
    if (mode !== 0 && (attrs & 0o170000) === 0o100000) {
      await fs.chmod?.(target, mode);
    }
  }
  return files;
}

/* ---------------- 安装主流程 ---------------- */

/** URL → 域（形态防御：非 http(s) 直拒） */
function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.host;
  } catch {
    return '';
  }
}

/** 读既有账本（缺席/坏形 → undefined——坏账本当未装过，重锚 TOFU） */
async function readLedger(fs: BrowserFsFace, path: string): Promise<BrowserEngineLedger | undefined> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const v = JSON.parse(raw) as Partial<BrowserEngineLedger>;
    if (
      typeof v.version === 'string' &&
      typeof v.zipSha256 === 'string' &&
      typeof v.executableRel === 'string' &&
      v.version !== '' &&
      v.zipSha256 !== '' &&
      v.executableRel !== ''
    ) {
      return {
        version: v.version,
        zipSha256: v.zipSha256,
        executableRel: v.executableRel,
        artifact: v.artifact ?? '',
        installedAt: v.installedAt ?? '',
        bytes: v.bytes ?? 0,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 元数据 JSON → Stable 版本 + 本平台工件 URL（白名单外 URL 响亮拒） */
function artifactUrlFromMetadata(raw: string, artifact: string): { version: string; url: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CfT 元数据非 JSON——上游形变或被劫持');
  }
  const channels = (parsed as { channels?: Record<string, unknown> }).channels;
  const stable = channels?.Stable as { version?: unknown; downloads?: Record<string, unknown> } | undefined;
  const version = stable?.version;
  const list = stable?.downloads?.chrome;
  if (typeof version !== 'string' || !Array.isArray(list)) {
    throw new Error('CfT 元数据缺 Stable.chrome 下载面——上游形变');
  }
  for (const item of list as Array<{ platform?: unknown; url?: unknown }>) {
    if (item?.platform === artifact && typeof item.url === 'string') {
      return { version, url: item.url };
    }
  }
  throw new Error(`CfT 元数据无 ${artifact} 工件——平台工件缺席`);
}

/**
 * 安装引擎（显式命令专用原语——/browser install 的执行体）。
 *
 * TOFU 语义：首装锚摘要；同版本重装摘要不符 = BROWSER_DIGEST_MISMATCH 拒
 * 执行（不动盘）；同版本在装且可执行在场 = 幂等零下载。
 */
export async function installBrowserEngine(deps: BrowserInstallDeps): Promise<BrowserInstallResult> {
  const artifact = platformArtifact(deps.platform, deps.arch);
  if (artifact === undefined) {
    throw new Error(
      `当前平台（${deps.platform}/${deps.arch}）无 Chromium for Testing 工件——v1 显式下载缺席。` +
        '替代路径：安装系统 Chrome（发现序②自动发现）或经 config browser.executablePath / BERRY_AGENT_BROWSER_PATH 显式指定',
    );
  }
  const engineDir = `${deps.dataDir}/browser/${BROWSER_ENGINE_DIRNAME}`;
  const ledgerPath = `${engineDir}/${BROWSER_LEDGER_NAME}`;
  const executableRel = executableRelOf(artifact);

  // 元数据取（域白名单第一执法位——常量本身钉白名单域）
  const metadataUrl = deps.metadataUrl ?? BROWSER_METADATA_URL;
  if (!BROWSER_DOWNLOAD_HOSTS.includes(hostOf(metadataUrl))) {
    throw new Error(`元数据 URL 域不在白名单：${metadataUrl}`);
  }
  const metaRes = await deps.download.fetchBinary(metadataUrl);
  if (metaRes.status !== 200) throw new Error(`CfT 元数据取失败（HTTP ${metaRes.status}）`);
  let metaRaw = '';
  for await (const chunk of metaRes.bytes) metaRaw += Buffer.from(chunk).toString('utf8');
  const { version, url } = artifactUrlFromMetadata(metaRaw, artifact);
  // 元数据给出的工件 URL 同过白名单（元数据被改也出不了白名单域）
  if (!BROWSER_DOWNLOAD_HOSTS.includes(hostOf(url))) {
    throw new Error(`工件 URL 域不在白名单：${url}（元数据可疑）`);
  }

  // TOFU 预检：同版本在装且可执行在场 → 幂等回执（零下载零写盘）
  const existing = await readLedger(deps.fs, ledgerPath);
  if (existing !== undefined && existing.version === version) {
    const installed = `${engineDir}/${existing.executableRel}`;
    try {
      if ((await deps.fs.stat(installed)).isFile()) {
        return {
          version,
          zipSha256: existing.zipSha256,
          executableRel: existing.executableRel,
          executablePath: installed,
          alreadyInstalled: true,
          bytes: 0,
        };
      }
    } catch {
      // 可执行缺席（文件被删）——落修复安装腿（下载重验摘要）
    }
  }

  // 流式下载 + 增量摘要（帽执法防巨型载荷）
  const maxBytes = deps.maxZipBytes ?? BROWSER_ZIP_MAX_BYTES;
  const res = await deps.download.fetchBinary(url);
  if (res.status !== 200) throw new Error(`引擎工件取失败（HTTP ${res.status}）`);
  const hash = createHash('sha256');
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of res.bytes) {
    const buf = Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > maxBytes) {
      throw new Error(`引擎 zip 超体积帽（> ${maxBytes} 字节）——中止下载`);
    }
    hash.update(buf);
    parts.push(buf);
  }
  const zipSha256 = hash.digest('hex');
  const zip = Buffer.concat(parts);

  // TOFU 执法：同版本重装摘要不符 = 拒执行（fail-loud 不动盘）
  if (existing !== undefined && existing.version === version && existing.zipSha256 !== zipSha256) {
    throw new BaseError(
      'BROWSER_DIGEST_MISMATCH',
      `同版本重装摘要不符（version ${version}：账本 ${existing.zipSha256} ≠ 实测 ${zipSha256}）——` +
        'TOFU 锚定拒绝执行；既有安装未动。请核查网络通路或清除账本后重装（后果自担）',
    );
  }

  // 落盘：解压 + 可执行位 + 账本
  await deps.fs.mkdir(engineDir, { recursive: true });
  const files = await unzipTo(zip, engineDir, deps.fs);
  const executablePath = `${engineDir}/${executableRel}`;
  let executableOk = false;
  try {
    executableOk = (await deps.fs.stat(executablePath)).isFile();
  } catch {
    executableOk = false;
  }
  if (!executableOk) {
    throw new Error(`解压后可执行缺席：${executablePath}（工件形与预期不符）`);
  }
  await deps.fs.chmod?.(executablePath, 0o755); // 主二进制显式可执行（属性行之外的双保险）
  const ledger: BrowserEngineLedger = {
    version,
    zipSha256,
    executableRel,
    artifact,
    installedAt: new Date().toISOString(),
    bytes,
  };
  await deps.fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
  deps.logger?.info?.(
    `browser 引擎已安装：Chromium for Testing ${version}（${artifact}，${files} 文件，${bytes} 字节）→ ${executablePath}`,
  );
  return { version, zipSha256, executableRel, executablePath, alreadyInstalled: false, bytes };
}
