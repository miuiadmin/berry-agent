/**
 * host/plugin-market/fetch 测试——mp-4 网络抓取真身（03 §9.6 供应链与安全面
 * URL fetch 新外联面防线全接线）。
 *
 * 零网络纪律：url 腿注桩 FetchLike/resolveDns（卫生件消费律经
 * createSsrfGuardedFetch 真跑——桩只停传输位）；git 腿注假 spawn（对拍
 * plugin-install 既有假件模式——clone 目标写真实 fixture 文件，git 通道编舞
 * 零真网络）。安全面逐线锁：pinnedFetch 同包/dns-pin 私网拒/超时帽（url+git
 * 两腿）/大小帽/内容类型/重定向逐跳复检/跳帽。
 *
 * 真仓形状锚定：fixture 按 anthropics/claude-plugins-official 探针真身造形
 * （2026-09-17：.claude-plugin/marketplace.json、297 条目、相对串 52 / url 带
 * sha 155 / git-subdir 带 path+sha 90、version 仅 14 条目声明、$schema/
 * renames/category/strict 等未知字段在场——零解读零拒绝）。
 *
 * 网络真测腿：describe.skipIf（env BERRY_AGENT_MP_REMOTE_E2E 在场才跑——
 * 测试门控 env 非产品旋钮，07 §2.1 零新增律不破）。
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createMarketFetchFace, MARKET_CATALOG_MAX_BYTES } from './fetch.js';
import { parseMarketplaceCatalog } from './catalog.js';
import { addMarketplaceSource } from './add.js';
import { createMarketFs } from './fs.js';
import { discoverMarketplaces } from './discover.js';
import type { MarketFetchFace } from './types.js';
import type { SpawnRunner } from '../plugin-install.js';
import type { DnsResolver, FetchLike } from '../../web/types.js';

/** 测试根 tmp（自管收尾自清） */
const testRoot = mkdtempSync(join(tmpdir(), 'berry-market-fetch-test-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** 公网 DNS 桩应答（93.184.216.34 = example.com 段公网地址——非私网非保留） */
const PUBLIC_DNS: DnsResolver = () => Promise.resolve(['93.184.216.34']);

/** 真仓形状锚定 fixture（探针缩样——见文件头注） */
const REAL_SHAPE_CATALOG = {
  $schema: 'https://json.schemastore.org/example-marketplace.json',
  name: 'official-shape',
  description: '真仓形状锚定 fixture',
  owner: { name: 'Probe Owner', email: 'probe@example.com' },
  renames: { 'old-name': 'new-name' },
  plugins: [
    {
      name: 'relative-plugin',
      description: '相对串源条目（真仓 52 条此形）',
      category: 'development',
      source: './plugins/relative-plugin',
    },
    {
      name: 'url-plugin',
      description: 'url 形源条目（真仓 155 条此形全带 sha）',
      source: {
        source: 'url',
        url: 'https://github.com/example/url-plugin.git',
        sha: '09bf1539d41f9ff355ba3eb5d05d4a75813423bb',
      },
    },
    {
      name: 'subdir-plugin',
      description: 'git-subdir 形（真仓 90 条 path+sha 全带）',
      strict: true,
      version: '1.0.0',
      source: {
        source: 'git-subdir',
        url: 'https://github.com/example/monorepo.git',
        path: 'plugins/subdir-plugin',
        ref: 'v1.5.5',
        sha: '30287f5e3f122a646d1ac5ca3ab96e130c52a3ad',
      },
    },
    {
      name: 'versioned-plugin',
      displayName: '带版本条目',
      version: '1.2.3',
      keywords: ['demo'],
      source: { source: 'npm', package: 'versioned-plugin' },
    },
  ],
};
const REAL_SHAPE_TEXT = `${JSON.stringify(REAL_SHAPE_CATALOG, null, 2)}\n`;

describe('url 腿——SSRF 守卫消费律 + 传输帽（注桩零网络）', () => {
  /** 记录 init 的桩 fetch（守卫消费链真跑——dispatcher/redirect/signal 断言面） */
  function recordingFetch(respond: (url: string) => Response): {
    readonly fetchImpl: FetchLike;
    readonly calls: { url: string; init: Record<string, unknown> }[];
  } {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init: { ...(init as Record<string, unknown>) } });
      return Promise.resolve(respond(url));
    };
    return { fetchImpl, calls };
  }

  it('成功腿：application/json 认 + 手动重定向位 + 单例 dispatcher 携带 + 文本往返', async () => {
    const { fetchImpl, calls } = recordingFetch(
      () =>
        new Response(REAL_SHAPE_TEXT, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }),
    );
    const face = createMarketFetchFace({ fetchImpl, resolveDns: PUBLIC_DNS });
    const fetched = await face.fetchUrlCatalog('https://example.com/marketplace.json');
    expect(fetched.text).toBe(REAL_SHAPE_TEXT);
    // 安全面锁：redirect 手动位 + dns-pin 单例 dispatcher 携带（连接级钉死消费律）
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.redirect).toBe('manual');
    expect(calls[0]!.init.dispatcher).toBeDefined();
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('内容类型校验：text/html 拒（HTML 错误页不冒充 catalog）/ 头缺席宽容（JSON.parse 终 gate）', async () => {
    const htmlFace = createMarketFetchFace({
      fetchImpl: () =>
        Promise.resolve(new Response('<html>404</html>', { status: 200, headers: { 'content-type': 'text/html' } })),
      resolveDns: PUBLIC_DNS,
    });
    await expect(htmlFace.fetchUrlCatalog('https://example.com/cat.json')).rejects.toThrow(/内容类型/);
    const absentFace = createMarketFetchFace({
      // 流体 Response 不带缺省 content-type（字符串体会被 Node 补 text/plain）——锁「头缺席宽容」真形
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"x":1}'));
                controller.close();
              },
            }),
            { status: 200 },
          ),
        ),
      resolveDns: PUBLIC_DNS,
    });
    await expect(absentFace.fetchUrlCatalog('https://example.com/cat.json')).resolves.toEqual({ text: '{"x":1}' });
  });

  it('私网拒（SSRF 红线——DNS 应答私网地址时零外联）', async () => {
    const { fetchImpl, calls } = recordingFetch(() => new Response('{}', { status: 200 }));
    const face = createMarketFetchFace({ fetchImpl, resolveDns: () => Promise.resolve(['10.0.0.5']) });
    await expect(face.fetchUrlCatalog('https://internal.example.com/cat.json')).rejects.toThrow(/私网/);
    expect(calls).toHaveLength(0); // 拒在 fetch 之前——零外联
  });

  it('协议白名单：非 http/https 拒（守卫消费律承载）', async () => {
    const face = createMarketFetchFace({
      fetchImpl: recordingFetch(() => new Response('{}')).fetchImpl,
      resolveDns: PUBLIC_DNS,
    });
    await expect(face.fetchUrlCatalog('ftp://example.com/cat.json')).rejects.toThrow(/白名单/);
  });

  it('重定向逐跳跟随：每跳目标复检（跳到私网字面地址即拒、已花一跳才拒）', async () => {
    const { fetchImpl, calls } = recordingFetch((url) =>
      url.startsWith('https://cdn.')
        ? new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/cat.json' } }),
    );
    const okFace = createMarketFetchFace({ fetchImpl, resolveDns: PUBLIC_DNS });
    await expect(okFace.fetchUrlCatalog('https://example.com/cat.json')).resolves.toEqual({ text: '{"ok":1}' });
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/cat.json', 'https://cdn.example.com/cat.json']);

    // 跳目标 = 私网字面地址（169.254.169.254 云元数据端点）——第二跳前拒
    const { fetchImpl: hopFetch, calls: hopCalls } = recordingFetch(
      () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    );
    const evilFace = createMarketFetchFace({ fetchImpl: hopFetch, resolveDns: PUBLIC_DNS });
    await expect(evilFace.fetchUrlCatalog('https://example.com/cat.json')).rejects.toThrow(/私网/);
    expect(hopCalls).toHaveLength(1); // 私网拒发生在跳目标 fetch 之前
  });

  it('重定向跳帽：6 跳拒（帽值 5——DEFAULT_WEB_LIMITS 同值）', async () => {
    let n = 0;
    const { fetchImpl } = recordingFetch(
      () => new Response(null, { status: 302, headers: { location: `https://example.com/hop-${(n += 1)}` } }),
    );
    const face = createMarketFetchFace({ fetchImpl, resolveDns: PUBLIC_DNS });
    await expect(face.fetchUrlCatalog('https://example.com/cat.json')).rejects.toThrow(/重定向/);
  });

  it('非成功态拒：404 终态拒（不把错误页文本当 catalog）', async () => {
    const face = createMarketFetchFace({
      fetchImpl: () => Promise.resolve(new Response('not found', { status: 404 })),
      resolveDns: PUBLIC_DNS,
    });
    await expect(face.fetchUrlCatalog('https://example.com/cat.json')).rejects.toThrow(/404/);
  });

  it('大小帽：响应体超帽拒（截断 catalog = 坏 JSON——拒比宽容截断诚实）', async () => {
    const face = createMarketFetchFace({
      fetchImpl: () =>
        Promise.resolve(
          new Response('x'.repeat(MARKET_CATALOG_MAX_BYTES + 1), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      resolveDns: PUBLIC_DNS,
    });
    await expect(face.fetchUrlCatalog('https://example.com/cat.json')).rejects.toThrow(/大小帽/);
  });

  it('超时帽：传输悬挂在帽内中止（注入桩不响应 signal——外层竞速执法面）', async () => {
    const face = createMarketFetchFace({
      fetchImpl: () => new Promise(() => {}) as Promise<Response>, // 永不 resolve 的桩
      resolveDns: PUBLIC_DNS,
      fetchTimeoutMs: 60,
    });
    await expect(face.fetchUrlCatalog('https://example.com/cat.json')).rejects.toThrow(/超时/);
  });
});

describe('git 腿——git 执行腿同族复用（假 spawn 零真网络）', () => {
  /** 假 spawn：clone 目标（argv 尾参）物化真实 fixture 文件 + rev-parse 回 HEAD */
  function gitFakeSpawn(opts: {
    readonly headCommit: string;
    readonly writeCatalog?: (cloneDir: string) => void;
    readonly hangOnClone?: boolean;
  }): { readonly spawn: SpawnRunner; readonly argvLog: string[][] } {
    const argvLog: string[][] = [];
    const spawn: SpawnRunner = {
      run: (cmd, args) => {
        argvLog.push([cmd, ...args]);
        if (cmd !== 'git') return Promise.reject(new Error(`假 spawn 不受理 ${cmd}`));
        if (args[0] === 'clone') {
          if (opts.hangOnClone === true) return new Promise(() => {}) as Promise<{ stdout: string; stderr: string }>;
          const cloneDir = args[args.length - 1]!;
          opts.writeCatalog?.(cloneDir);
          return Promise.resolve({ stdout: '', stderr: '' });
        }
        if (args[2] === 'rev-parse') return Promise.resolve({ stdout: `${opts.headCommit}\n`, stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    };
    return { spawn, argvLog };
  }

  function writeClaudeCatalog(cloneDir: string, text: string = REAL_SHAPE_TEXT): void {
    mkdirSync(join(cloneDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(cloneDir, '.claude-plugin', 'marketplace.json'), text);
  }

  it('成功腿：--depth 1 浅克隆编舞 + 双路径读序命中 + commit 锁定 + 真仓形状解析', async () => {
    const { spawn, argvLog } = gitFakeSpawn({
      headCommit: '76c85b7366c8be78ce3ac67dd21945b3960d1a8c',
      writeCatalog: (d) => writeClaudeCatalog(d),
    });
    const face = createMarketFetchFace({ spawn, tmpRoot: testRoot });
    const fetched = await face.fetchGitCatalog('https://github.com/example/official.git');
    // 编舞锁：clone --depth 1（catalog 只需 HEAD 快照——装机腿另走全史克隆）→ rev-parse HEAD
    expect(argvLog).toHaveLength(2);
    expect(argvLog[0]!.slice(0, 4)).toEqual(['git', 'clone', '--depth', '1']);
    expect(argvLog[0]![4]).toBe('https://github.com/example/official.git');
    expect(argvLog[1]).toEqual(['git', '-C', fetched.cloneDir, 'rev-parse', 'HEAD']);
    expect(fetched.catalogPath).toBe('.claude-plugin/marketplace.json');
    expect(fetched.commit).toBe('76c85b7366c8be78ce3ac67dd21945b3960d1a8c');
    expect(fetched.text).toBe(REAL_SHAPE_TEXT);
    // 真仓形状锚定：fixture 过 catalog 解析全绿（未知字段零解读零拒绝）
    const parsed = parseMarketplaceCatalog(fetched.text, 'fixture');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.catalog.name).toBe('official-shape');
      expect(parsed.catalog.plugins).toHaveLength(4);
    }
    rmSync(fetched.cloneDir, { recursive: true, force: true }); // 清场归调用方（add 编舞）
  });

  it('双路径读序：仅 .omp-plugin 在场同样命中（优先序 mp-2 同源）', async () => {
    const { spawn } = gitFakeSpawn({
      headCommit: 'abc0001',
      writeCatalog: (d) => {
        mkdirSync(join(d, '.omp-plugin'), { recursive: true });
        writeFileSync(
          join(d, '.omp-plugin', 'marketplace.json'),
          JSON.stringify({ name: 'omp-one', owner: { name: 'o' }, plugins: [] }),
        );
      },
    });
    const face = createMarketFetchFace({ spawn, tmpRoot: testRoot });
    const fetched = await face.fetchGitCatalog('https://example.com/repo.git');
    expect(fetched.catalogPath).toBe('.omp-plugin/marketplace.json');
    rmSync(fetched.cloneDir, { recursive: true, force: true });
  });

  it('catalog 双路径全缺席 = 拒 + tmp 自清（失败位不残留克隆目录）', async () => {
    const { spawn } = gitFakeSpawn({ headCommit: 'abc0002', writeCatalog: () => undefined });
    const face = createMarketFetchFace({ spawn, tmpRoot: testRoot });
    await expect(face.fetchGitCatalog('https://example.com/empty.git')).rejects.toThrow(/catalog 缺席/);
    // tmp 自清锁：testRoot 下无克隆目录残留
    expect(readdirSync(testRoot).some((n) => n.startsWith('berry-market-clone-'))).toBe(false);
  });

  it('clone 失败传播 + tmp 自清', async () => {
    const spawn: SpawnRunner = {
      run: (cmd) => Promise.reject(new Error(`${cmd}: repository not found`)),
    };
    const face = createMarketFetchFace({ spawn, tmpRoot: testRoot });
    await expect(face.fetchGitCatalog('https://example.com/gone.git')).rejects.toThrow(/not found/);
    expect(readdirSync(testRoot).filter((n) => n.startsWith('berry-market-clone-'))).toHaveLength(0);
  });

  it('超时帽：clone 悬挂在帽内中止 + tmp 自清（omp 30min 收紧定值执法位）', async () => {
    const { spawn } = gitFakeSpawn({ headCommit: 'x', hangOnClone: true });
    const face = createMarketFetchFace({ spawn, tmpRoot: testRoot, cloneTimeoutMs: 60 });
    await expect(face.fetchGitCatalog('https://example.com/huge.git')).rejects.toThrow(/超时/);
    expect(readdirSync(testRoot).filter((n) => n.startsWith('berry-market-clone-'))).toHaveLength(0);
  });

  // 主机校验位注记（mp 收尾批 sec ②§9.6 裁决）：git 腿克隆目标 = 用户手打 add
  // 源 url（market/用户两分裁决的用户侧——显式动作豁免，与直装腿同律）；恶
  // 形协议/'-' 起头在 add 分类位 fail-closed 拒（classify 五规则序不识即拒），
  // 不达本面。catalog 条目（攻击者可控 url）的克隆守卫在装机腿
  // plugin-install.test.ts「git 克隆目标主机校验」describe 锁。
});

describe.skipIf(process.env.BERRY_AGENT_MP_REMOTE_E2E === undefined)(
  '网络真测腿（BERRY_AGENT_MP_REMOTE_E2E 在场才跑——默认 skip）',
  () => {
    const OFFICIAL_REPO = 'https://github.com/anthropics/claude-plugins-official';
    const OFFICIAL_RAW =
      'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';
    const e2eRoot = mkdtempSync(join(tmpdir(), 'berry-market-fetch-e2e-'));
    afterAll(() => {
      rmSync(e2eRoot, { recursive: true, force: true });
    });

    it('git 腿真仓：浅克隆 + catalog 定位 + commit 锁定（真仓锚定验收）', async () => {
      const face = createMarketFetchFace({ tmpRoot: e2eRoot });
      const fetched = await face.fetchGitCatalog(OFFICIAL_REPO);
      expect(fetched.catalogPath).toBe('.claude-plugin/marketplace.json');
      expect(fetched.commit).toMatch(/^[0-9a-f]{40}$/);
      const parsed = parseMarketplaceCatalog(fetched.text, 'official');
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.catalog.name).toBe('claude-plugins-official');
        // 真身体量锚（297 @ 2026-09-17 探针——只锁下界防上游增删漂移误红）
        expect(parsed.catalog.plugins.length).toBeGreaterThanOrEqual(100);
      }
      rmSync(fetched.cloneDir, { recursive: true, force: true });
    });

    it('url 腿真仓：raw JSON 直答 + 解析同真身', async (ctx) => {
      // fake-IP 代理环境前置探测：本机 DNS 把域名应答到 IANA 基准保留段
      // （198.18.0.0/15——fake-IP 代理特征段）时，SSRF 守卫的保留段拒是
      // 正确执法而非缺陷——本用例在该环境 skip（真绿验收以无代理环境/CI
      // 为准；git 腿走系统 git 不经守卫不受影响）。探测失败不拦用例——
      // 留给 fetch 阶段自然失败，归因更准。
      const dns = await import('node:dns/promises');
      try {
        const addr = await dns.lookup('raw.githubusercontent.com', { all: true });
        const inBenchmarkRange = addr.some((a) => {
          const m = /^(\d+)\.(\d+)\./.exec(a.address);
          if (!m) return false;
          const hi = Number(m[1]);
          return hi === 198 && (Number(m[2]) === 18 || Number(m[2]) === 19);
        });
        if (inBenchmarkRange) {
          console.log(
            `[skip] fake-IP 代理环境：DNS 应答 ${addr.map((a) => a.address).join(',')} 命中 198.18.0.0/15——SSRF 守卫正确拒，url 腿验收以无代理环境/CI 为准`,
          );
          ctx.skip();
          return;
        }
      } catch {
        // DNS 探测失败不拦——见上注
      }
      const face = createMarketFetchFace({ tmpRoot: e2eRoot });
      const fetched = await face.fetchUrlCatalog(OFFICIAL_RAW);
      const parsed = parseMarketplaceCatalog(fetched.text, 'official-raw');
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.catalog.name).toBe('claude-plugins-official');
    });

    it('真仓 add→discover 全链（真 fs + 真 fetch——spec mp-4 验收线「真仓 discover 绿」）', async () => {
      const dataDir = join(e2eRoot, 'data');
      const face: MarketFetchFace = createMarketFetchFace({ tmpRoot: e2eRoot });
      const added = await addMarketplaceSource(
        { dataDir, fs: createMarketFs(), now: () => new Date(), fetch: face },
        OFFICIAL_REPO,
      );
      expect(added.ok).toBe(true);
      // discover 已改 async（TTL 惰性刷新腿）——此处须 await；fetch 缺席 = 纯读
      const discovered = await discoverMarketplaces(
        { dataDir, fs: createMarketFs(), now: () => new Date() },
        'claude-plugins-official',
      );
      const row = discovered.sources[0];
      expect(row !== undefined && row.status === 'ok').toBe(true);
      if (row !== undefined && row.status === 'ok') expect(row.entries.length).toBeGreaterThanOrEqual(100);
    });
  },
);
