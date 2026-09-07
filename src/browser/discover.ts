/**
 * 引擎发现序（03 §10.3——四步：显式覆盖 → 系统 Chrome 知名位 + PATH →
 * 数据目录专用引擎 → 诚实缺席）。
 *
 * 全缺席 = 诚实缺席：抛 BROWSER_ENGINE_NOT_FOUND 附安装指引——**不自动下载**
 * （150MB 级惊喜下载不可接受；下载 = 显式命令 /browser install，归 install 件）。
 * 显式覆盖（config executablePath / `BERRY_AGENT_BROWSER_PATH`）指名路径缺席
 * 同码 fail-loud——显式误配不静默回退（回退会掩盖配置错误）。
 */
import { BaseError } from '../contracts/index.js';
import type { BrowserFsFace } from './types.js';

/** 发现产物（source = 命中步——诊断面与回执可见） */
export interface DiscoveredEngine {
  readonly path: string;
  readonly source: 'config' | 'env' | 'wellknown' | 'path' | 'dataDir';
}

/** 发现依赖（全窄面——可测性 + 词面独立） */
export interface DiscoverEngineDeps {
  readonly fs: BrowserFsFace;
  readonly readEnv: (name: string) => string | undefined;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly dataDir: string;
  /** 行 config 显式覆盖（缺席走 env 腿） */
  readonly executablePath?: string;
}

/** macOS 系统 Chrome 知名位（系统级 + 用户级两形） */
function wellKnownDarwin(homeDir: string): readonly string[] {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${homeDir}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ];
}

/** Linux 系统 Chrome 知名位（发行版包名族 + snap 形） */
function wellKnownLinux(): readonly string[] {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome-beta',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

/** 系统 Chrome 知名位（win32 v1 诚实缺席——03 §10.3 明裁） */
export function wellKnownPaths(platform: NodeJS.Platform, homeDir: string): readonly string[] {
  if (platform === 'darwin') return wellKnownDarwin(homeDir);
  if (platform === 'linux') return wellKnownLinux();
  return []; // win32：知名位 v1 诚实缺席（PATH 探测腿仍活）
}

/** PATH 探测可执行名（win32 走 .exe；其余四名通扫） */
function pathProbeNames(platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32') return ['chrome.exe'];
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

/** PATH 分隔符（win32 ';' 其余 ':'） */
function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':';
}

/** 存在且为普通文件（access + stat isFile 双腿——目录形不算引擎） */
async function isFileAt(fs: BrowserFsFace, path: string): Promise<boolean> {
  try {
    const st = await fs.stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * 四步发现序。返回首个命中步的绝对路径；全缺席抛 BROWSER_ENGINE_NOT_FOUND。
 */
export async function discoverEngine(deps: DiscoverEngineDeps): Promise<DiscoveredEngine> {
  const { fs, readEnv, platform, homeDir, dataDir } = deps;

  // ① 显式覆盖：行 config executablePath 或 BERRY_AGENT_BROWSER_PATH（config
  // 优先——行面覆盖环境面）。指名即验：缺席不回退（显式误配 fail-loud）。
  const explicit = deps.executablePath ?? readEnv('BERRY_AGENT_BROWSER_PATH');
  if (explicit !== undefined && explicit !== '') {
    if (await isFileAt(fs, explicit)) {
      return { path: explicit, source: deps.executablePath !== undefined ? 'config' : 'env' };
    }
    throw new BaseError(
      'BROWSER_ENGINE_NOT_FOUND',
      `显式指定的浏览器引擎路径不存在：${explicit}（config browser.executablePath / BERRY_AGENT_BROWSER_PATH 显式误配不静默回退——请修正路径或移除显式配置）`,
    );
  }

  // ② 系统 Chrome 知名位（macOS/Linux；win32 v1 诚实缺席）→ PATH 探测
  for (const candidate of wellKnownPaths(platform, homeDir)) {
    if (await isFileAt(fs, candidate)) return { path: candidate, source: 'wellknown' };
  }
  const pathEnv = readEnv('PATH');
  if (pathEnv !== undefined && pathEnv !== '') {
    for (const dir of pathEnv.split(pathDelimiter(platform))) {
      if (dir === '') continue;
      for (const name of pathProbeNames(platform)) {
        const candidate = `${dir.endsWith('/') ? dir.slice(0, -1) : dir}/${name}`;
        if (await isFileAt(fs, candidate)) return { path: candidate, source: 'path' };
      }
    }
  }

  // ③ 数据目录专用引擎（/browser install 产物——账本记相对可执行位）
  const ledgerPath = `${dataDir}/browser/engine/ledger.json`;
  try {
    const raw = await fs.readFile(ledgerPath, 'utf8');
    const ledger = JSON.parse(raw) as { executableRel?: unknown };
    if (typeof ledger.executableRel === 'string' && ledger.executableRel !== '') {
      const candidate = `${dataDir}/browser/engine/${ledger.executableRel}`;
      if (await isFileAt(fs, candidate)) return { path: candidate, source: 'dataDir' };
    }
  } catch {
    // 账本缺席/坏形——install 未跑过即无专用引擎，静默落第④步（诚实缺席）
  }

  // ④ 全缺席 = 诚实缺席（附安装指引——不自动下载）
  throw new BaseError(
    'BROWSER_ENGINE_NOT_FOUND',
    '未发现可用的浏览器引擎（系统 Chrome 知名位 / PATH / 数据目录专用引擎均缺席）。' +
      '安装路径三选一：① 在会话中执行 /browser install 下载 Chromium for Testing 到数据目录；' +
      '② 安装系统 Chrome（macOS/Linux 知名位或 PATH 可见即自动发现）；' +
      '③ 经 config browser.executablePath 或 BERRY_AGENT_BROWSER_PATH 显式指定引擎路径',
  );
}
