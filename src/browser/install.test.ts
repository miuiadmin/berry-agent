/**
 * install 件测试（手搓 zip 构造器往返 + TOFU 执法 + 白名单防线 + 幂等腿）。
 *
 * zip 构造器在测试内手写本地头/中央目录/EOCD 三段（store 与 deflate 两法、
 * unix 属性位）——与解压器互证；非用三方 zip 库（零依赖纪律同律）。
 */
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { defaultDownloadFace, installBrowserEngine, platformArtifact, unzipTo } from './install.js';
import type { BrowserDownloadFace, BrowserInstallDeps } from './install.js';
import { discoverEngine } from './discover.js';
import type { BrowserFsFace } from './types.js';

/* ---------------- 手搓 zip 构造器 ---------------- */

interface ZipInput {
  name: string;
  data?: Buffer; // 缺省 = 目录条目（name 以 / 结尾）
  method?: 0 | 8; // 缺省 store
  /** unix mode（外部属性高 16 位——0 = 不设） */
  unixMode?: number;
}

/** 单条 zip 构造（本地头 + 数据；返回两段与中央目录条目） */
function buildZip(inputs: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const input of inputs) {
    const nameBuf = Buffer.from(input.name, 'utf8');
    const isDir = input.data === undefined;
    const method = input.method ?? 0;
    const raw: Buffer = isDir ? Buffer.alloc(0) : input.data!;
    const payload: Buffer = method === 8 && raw.length > 0 ? deflateRawSync(raw) : raw;

    // 本地头（0x04034b50：版本 20 / 旗 0 / 法 / 时间 0 / 日期 0 / CRC 0（中央
    // 目录裁决制——本构造器只喂自家解压器，其读偏移不校验 CRC））
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(0, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    locals.push(lfh, nameBuf, payload);

    // 中央目录条目（0x02014b50）
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4); // 产出版本
    cdh.writeUInt16LE(20, 6); // 需求版本
    cdh.writeUInt16LE(0, 8); // 旗
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(0, 16); // CRC
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra
    cdh.writeUInt16LE(0, 32); // comment
    cdh.writeUInt16LE(0, 34); // 盘号
    cdh.writeUInt16LE(0, 36); // 内部属性
    // unix 属性高 16 位 = 型位 | 权限位（真 zip 惯例：S_IFREG 在场解压器才 chmod）
    const attrs = isDir ? (0o40755 << 16) >>> 0 : (((0o100000 | (input.unixMode ?? 0o644)) as number) << 16) >>> 0;
    cdh.writeUInt32LE(attrs, 38);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + payload.length;
  }
  // EOCD（0x06054b50）
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // 盘号
  eocd.writeUInt16LE(0, 6); // 中央目录起始盘
  eocd.writeUInt16LE(inputs.length, 8);
  eocd.writeUInt16LE(inputs.length, 10);
  eocd.writeUInt32LE(Buffer.concat(centrals).length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/* ---------------- 桩 ---------------- */

/** 内存 fs（可执行性以 files 集为准） */
function makeFs() {
  const files = new Map<string, string | Uint8Array>();
  const dirs = new Set<string>();
  const chmods: Array<{ path: string; mode: number }> = [];
  const fs: BrowserFsFace = {
    access: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
    },
    readFile: async (p, _enc) => {
      void _enc;
      const f = files.get(p);
      if (f === undefined) throw new Error(`ENOENT ${p}`);
      return Buffer.from(f).toString('utf8');
    },
    writeFile: async (p, data) => {
      files.set(p, data);
    },
    mkdir: async (p) => {
      dirs.add(p);
    },
    readdir: async () => [],
    stat: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return { isFile: () => true };
    },
    unlink: async () => {},
    chmod: async (p, mode) => {
      chmods.push({ path: p, mode });
    },
  };
  return { fs, files, dirs, chmods };
}

/** 下载桩（URL → {status, bytes}；调用记账） */
function makeDownload(
  routes: Record<string, { status: number; bytes?: Buffer }>,
): BrowserDownloadFace & { hits: string[] } {
  const hits: string[] = [];
  const face: BrowserDownloadFace = {
    fetchBinary: async (url) => {
      hits.push(url);
      const route = routes[url];
      if (route === undefined) return { status: 404, bytes: (async function* () {})() };
      const bytes = route.bytes ?? Buffer.alloc(0);
      return {
        status: route.status,
        bytes: (async function* () {
          // 分两块流式（流式消费面互证）
          const mid = Math.floor(bytes.length / 2);
          if (mid > 0) yield bytes.subarray(0, mid);
          if (bytes.length - mid > 0) yield bytes.subarray(mid);
        })(),
      };
    },
  };
  return Object.assign(face, { hits });
}

const META_URL = 'https://googlechromelabs.github.io/chrome-for-testing/test-meta.json';
const ARTIFACT_URL =
  'https://storage.googleapis.com/chrome-for-testing-public/138.0.0.0/mac-arm64/chrome-mac-arm64.zip';

/** CfT 元数据（mac-arm64 工件指 ARTIFACT_URL） */
function metadataJson(url = ARTIFACT_URL): string {
  return JSON.stringify({
    channels: { Stable: { version: '138.0.0.0', downloads: { chrome: [{ platform: 'mac-arm64', url }] } } },
  });
}

/** macOS 工件 zip（主二进制 + helper 带可执行位 + README 普通位） */
function macZip(): Buffer {
  const rel = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  return buildZip([
    { name: 'chrome-mac-arm64/' },
    { name: 'chrome-mac-arm64/README', data: Buffer.from('readme'), method: 8 },
    { name: rel, data: Buffer.from('Mach-O 假二进制'), unixMode: 0o755 },
    {
      name: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/helper',
      data: Buffer.from('helper'),
      method: 8,
      unixMode: 0o755,
    },
  ]);
}

/** 标准安装束（mac arm64 + 好元数据 + 好工件） */
function makeDeps(zipBytes: Buffer, metaRaw: string = metadataJson()) {
  const fsEnv = makeFs();
  const download = makeDownload({
    [META_URL]: { status: 200, bytes: Buffer.from(metaRaw) },
    [ARTIFACT_URL]: { status: 200, bytes: zipBytes },
  });
  const deps: BrowserInstallDeps = {
    fs: fsEnv.fs,
    download,
    platform: 'darwin',
    arch: 'arm64',
    dataDir: '/data',
    metadataUrl: META_URL,
  };
  return { deps, fsEnv, download };
}

describe('platformArtifact', () => {
  it('三席映射 + 诚实缺席（win32/其余架构）', () => {
    expect(platformArtifact('darwin', 'arm64')).toBe('mac-arm64');
    expect(platformArtifact('darwin', 'x64')).toBe('mac-x64');
    expect(platformArtifact('linux', 'x64')).toBe('linux64');
    expect(platformArtifact('win32', 'x64')).toBeUndefined();
    expect(platformArtifact('linux', 'arm64')).toBeUndefined();
    expect(platformArtifact('darwin', 'unknown')).toBeUndefined();
  });
});

describe('unzipTo', () => {
  it('三段往返：store/deflate 两法 + 目录条目 + unix 属性行 chmod', async () => {
    const fsEnv = makeFs();
    const files = await unzipTo(macZip(), '/engine', fsEnv.fs);
    expect(files).toBe(3); // 目录条目不计
    const rel = '/engine/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
    expect(Buffer.from(fsEnv.files.get(rel)!).toString()).toBe('Mach-O 假二进制');
    expect(Buffer.from(fsEnv.files.get('/engine/chrome-mac-arm64/README')!).toString()).toBe('readme');
    // 属性行 chmod：两枚 0o755（主二进制 + helper）
    expect(fsEnv.chmods.filter((c) => c.mode === 0o755)).toHaveLength(2);
  });

  it('zip-slip 防御：.. 段与绝对形响亮拒', async () => {
    const fsEnv = makeFs();
    const evil = buildZip([{ name: '../evil.txt', data: Buffer.from('x') }]);
    await expect(unzipTo(evil, '/engine', fsEnv.fs)).rejects.toThrow('zip-slip');
    const evil2 = buildZip([{ name: '/etc/passwd', data: Buffer.from('x') }]);
    await expect(unzipTo(evil2, '/engine', fsEnv.fs)).rejects.toThrow('zip-slip');
    expect(fsEnv.files.size).toBe(0); // 防线在前——零落盘
  });

  it('坏形响亮拒：截断 EOCD 缺席 / 中央目录签名不符', async () => {
    const fsEnv = makeFs();
    await expect(unzipTo(Buffer.from('not a zip'), '/engine', fsEnv.fs)).rejects.toThrow('EOCD');
    const zip = buildZip([{ name: 'a', data: Buffer.from('x') }]);
    const broken = Buffer.from(zip);
    broken.writeUInt32LE(0, zip.length - 22); // 砸 EOCD 签名
    await expect(unzipTo(broken, '/engine', fsEnv.fs)).rejects.toThrow();
  });
});

describe('installBrowserEngine', () => {
  it('全链：元数据 → 白名单工件 → 流式下载解压 → 可执行位 → 账本 TOFU 锚定 → 发现序③可发现', async () => {
    const { deps, fsEnv, download } = makeDeps(macZip());
    const r = await installBrowserEngine(deps);
    expect(r.version).toBe('138.0.0.0');
    expect(r.alreadyInstalled).toBe(false);
    expect(r.bytes).toBe(macZip().length);
    expect(r.executablePath).toBe(
      '/data/browser/engine/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    );
    // 主二进制显式 0o755 双保险
    expect(fsEnv.chmods.some((c) => c.path === r.executablePath && c.mode === 0o755)).toBe(true);
    // 账本锚定（版本 + 摘要 + 相对位）
    const ledger = JSON.parse(fsEnv.files.get('/data/browser/engine/ledger.json')!.toString()) as Record<
      string,
      unknown
    >;
    expect(ledger.version).toBe('138.0.0.0');
    expect(ledger.zipSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.executableRel).toContain('chrome-mac-arm64/');
    // 发现序③：dataDir 源可发现（install 产物与发现真接——非只各自为绿）
    const d = await discoverEngine({
      fs: deps.fs,
      readEnv: () => undefined,
      platform: 'darwin',
      homeDir: '/h',
      dataDir: '/data',
    });
    expect(d.source).toBe('dataDir');
    expect(d.path).toBe(r.executablePath);
    // 流式消费互证：工件一次取、分块进摘要
    expect(download.hits).toEqual([META_URL, ARTIFACT_URL]);
  });

  it('幂等腿：同版本在装且可执行在场 → 零下载零写盘', async () => {
    const { deps, download } = makeDeps(macZip());
    await installBrowserEngine(deps);
    const second = await installBrowserEngine(deps);
    expect(second.alreadyInstalled).toBe(true);
    expect(second.bytes).toBe(0);
    // 第二轮只取元数据（版本判定需要）——工件零再取
    expect(download.hits.filter((u) => u === ARTIFACT_URL)).toHaveLength(1);
  });

  it('TOFU 执法：同版本重装摘要不符 = BROWSER_DIGEST_MISMATCH 且不动盘', async () => {
    // 元数据指同一 URL 但两轮工件内容不同（中途被替换的供给面）
    const fsEnv = makeFs();
    const zipA = macZip();
    const zipB = buildZip([
      {
        name: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        data: Buffer.from('被替换的载荷'),
      },
    ]);
    let round = 0;
    const download: BrowserDownloadFace = {
      fetchBinary: async (url) => {
        if (url === META_URL)
          return {
            status: 200,
            bytes: (async function* () {
              yield Buffer.from(metadataJson());
            })(),
          };
        round += 1;
        const zip = round === 1 ? zipA : zipB;
        return {
          status: 200,
          bytes: (async function* () {
            yield zip;
          })(),
        };
      },
    };
    const deps: BrowserInstallDeps = {
      fs: fsEnv.fs,
      download,
      platform: 'darwin',
      arch: 'arm64',
      dataDir: '/data',
      metadataUrl: META_URL,
    };
    const first = await installBrowserEngine(deps);
    expect(first.zipSha256).not.toBe('');
    // 造「可执行被删」落修复安装腿（同版本重装——TOFU 比对生效）
    fsEnv.files.delete(first.executablePath);
    await expect(installBrowserEngine(deps)).rejects.toMatchObject({ code: 'BROWSER_DIGEST_MISMATCH' });
    // 不动盘：账本未被覆盖、被替换载荷未落盘
    const ledger = JSON.parse(fsEnv.files.get('/data/browser/engine/ledger.json')!.toString()) as { zipSha256: string };
    expect(ledger.zipSha256).toBe(first.zipSha256);
    expect([...fsEnv.files.keys()].some((p) => p.includes('被替换'))).toBe(false);
  });

  it('域白名单：元数据工件 URL 出白名单即拒（元数据被改出不了白名单域）', async () => {
    const evilUrl = 'https://evil.example.com/chrome.zip';
    const { deps } = makeDeps(macZip(), metadataJson(evilUrl));
    await expect(installBrowserEngine(deps)).rejects.toThrow('白名单');
  });

  it('非 200 响亮拒：元数据与工件两腿', async () => {
    const fsEnv = makeFs();
    const download = makeDownload({ [META_URL]: { status: 503 }, [ARTIFACT_URL]: { status: 403 } });
    const deps: BrowserInstallDeps = {
      fs: fsEnv.fs,
      download,
      platform: 'darwin',
      arch: 'arm64',
      dataDir: '/data',
      metadataUrl: META_URL,
    };
    await expect(installBrowserEngine(deps)).rejects.toThrow('HTTP 503');
    // 元数据好了工件 403
    const download2 = makeDownload({
      [META_URL]: { status: 200, bytes: Buffer.from(metadataJson()) },
      [ARTIFACT_URL]: { status: 403 },
    });
    const deps2: BrowserInstallDeps = {
      fs: fsEnv.fs,
      download: download2,
      platform: 'darwin',
      arch: 'arm64',
      dataDir: '/data',
      metadataUrl: META_URL,
    };
    await expect(installBrowserEngine(deps2)).rejects.toThrow('HTTP 403');
  });

  it('平台不支持：零网络即拒（指路显式路径）', async () => {
    const { deps, download } = makeDeps(macZip());
    const winDeps: BrowserInstallDeps = { ...deps, platform: 'win32' };
    await expect(installBrowserEngine(winDeps)).rejects.toThrow('无 Chromium for Testing 工件');
    expect(download.hits).toHaveLength(0);
  });

  it('坏账本当未装过（重锚 TOFU）+ 元数据缺平台工件响亮拒', async () => {
    const fsEnv = makeFs();
    await fsEnv.fs.writeFile('/data/browser/engine/ledger.json', '{坏形');
    const { deps } = makeDeps(macZip());
    const deps2: BrowserInstallDeps = { ...deps, fs: fsEnv.fs };
    const r = await installBrowserEngine(deps2);
    expect(r.alreadyInstalled).toBe(false); // 坏账本不阻新装
    // 平台工件缺席（x64 请求但元数据只有 mac-arm64）
    const { deps: deps3 } = makeDeps(macZip());
    await expect(installBrowserEngine({ ...deps3, arch: 'x64' })).rejects.toThrow('无 mac-x64 工件');
  });

  it('体积帽：超帽中止下载且零落盘（帽注入位——真测执法腿）', async () => {
    const big = Buffer.alloc(1024, 1); // 1024 > 帽 100
    const fsEnv = makeFs();
    const download = makeDownload({
      [META_URL]: { status: 200, bytes: Buffer.from(metadataJson()) },
      [ARTIFACT_URL]: { status: 200, bytes: big },
    });
    const deps: BrowserInstallDeps = {
      fs: fsEnv.fs,
      download,
      platform: 'darwin',
      arch: 'arm64',
      dataDir: '/data',
      metadataUrl: META_URL,
      maxZipBytes: 100,
    };
    await expect(installBrowserEngine(deps)).rejects.toThrow('超体积帽');
    // 中止在下载腿——零解压零账本
    expect(fsEnv.files.size).toBe(0);
  });
});

describe('defaultDownloadFace', () => {
  it('真进程回环腿：全局 fetch → 流式字节（localhost 真服务——零真网络先例）', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/artifact.bin') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.write(Buffer.from('hello '));
        res.end(Buffer.from('world'));
        return;
      }
      res.writeHead(404); // 无体应答腿（/none——状态码透传 + 空流形）
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const face = defaultDownloadFace();
      const r = await face.fetchBinary(`http://127.0.0.1:${port}/artifact.bin`);
      expect(r.status).toBe(200);
      let text = '';
      for await (const chunk of r.bytes) text += Buffer.from(chunk).toString('utf8');
      expect(text).toBe('hello world');
      // 无体应答：空流形 + 状态码透传
      const r2 = await face.fetchBinary(`http://127.0.0.1:${port}/none`);
      expect(r2.status).toBe(404);
      let count = 0;
      for await (const _ of r2.bytes) {
        void _;
        count += 1;
      }
      expect(count).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
