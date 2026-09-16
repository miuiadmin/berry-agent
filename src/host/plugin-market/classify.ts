/**
 * host/plugin-market/classify —— 源分类五规则序 + github 短手展开 + `~/`
 * 展开（03 §9.6 源分类节；adopt omp classifySource 形）。
 *
 * 五规则序（首中即胜——协议/模式检查先于路径检查）：
 *  1. `https?://` + `.json` 尾 → url 源（单文件 catalog）；否则 `https?://`
 *     → git 源（URL 构造抛的坏串兜底 git——克隆腿自会诚实失败）；
 *  2. `git@` / `ssh://` 前缀 → git 源（先于路径判——防 Windows 盘符形误判
 *     local）；
 *  3. `owner/repo` 短手恰一斜线 → github 源（大小写宽容——展开时再执法）；
 *  4/5. `./`、`~/`、绝对路径前缀 → local 源；
 *  其余不识形 fail-loud 拒（报文指路两候选——本地路径形与短手形）。
 */
import type { MarketplaceSourceType } from './types.js';

/** 分类产物：result 面（ok=false 时 message 含两候选指路） */
export type ClassifyResult =
  { readonly ok: true; readonly sourceType: MarketplaceSourceType } | { readonly ok: false; readonly message: string };

/** http/https 协议前缀判（大小写宽容） */
const HTTP_RE = /^https?:\/\//i;

/**
 * 源分类五规则序（add 解析位——产物直落源清单 sourceType 位）。
 * 不识形拒报文同时指路 `./` 本地路径形与 `owner/repo` 短手两候选。
 */
export function classifyMarketplaceSource(source: string): ClassifyResult {
  // 规则 1：http(s) 协议——.json 尾单文件 catalog → url；否则整仓克隆 → git
  if (HTTP_RE.test(source)) {
    try {
      if (new URL(source).pathname.endsWith('.json')) {
        return { ok: true, sourceType: 'url' };
      }
    } catch {
      // 坏 URL 串（如空 host 形）——兜底 git：克隆腿自会给出真失败报文
    }
    return { ok: true, sourceType: 'git' };
  }
  // 规则 2：git@ / ssh:// 前缀 → git（先于路径判，防 Windows 盘符形误判）
  if (source.startsWith('git@') || source.startsWith('ssh://')) {
    return { ok: true, sourceType: 'git' };
  }
  // 规则 3：恰一斜线的 owner/repo 短手 → github（路径前缀形除外）
  if (
    source.includes('/') &&
    !source.startsWith('/') &&
    !source.startsWith('./') &&
    !source.startsWith('~/') &&
    source.split('/').length === 2
  ) {
    return { ok: true, sourceType: 'github' };
  }
  // 规则 4/5：./ ~/ 绝对路径 → local
  if (source.startsWith('./') || source.startsWith('~/') || source.startsWith('/')) {
    return { ok: true, sourceType: 'local' };
  }
  // 不识形 fail-loud——报文指路两候选（本地路径形 / 短手形）
  return {
    ok: false,
    message: `无法识别的源形（"${source}"）——本地市场请用 "./" 相对路径、"~/" 或绝对路径；远端市场请用 owner/repo 短手或 git URL`,
  };
}

/** github 短手段词法：字母数字起止，中段宽容点/连字符/下划线 */
const SHORTHAND_SEGMENT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * github 短手展开：`owner/repo` → `https://github.com/owner/repo.git`。
 * 坏短手（多段/空段/逃逸段/含空白或 #）抛——调用方 catch 呈现（翻译层与
 * add 层共用同一执法单源）。
 */
export function githubShorthandToUrl(repo: string): string {
  const parts = repo.split('/');
  if (parts.length !== 2) {
    throw new Error(`github 短手形须恰一斜线（owner/repo）："${repo}"`);
  }
  for (const part of parts) {
    if (!SHORTHAND_SEGMENT_RE.test(part)) {
      throw new Error(`github 短手段坏词法（"${part}"）——字母数字起止、点连字符下划线中段`);
    }
  }
  return `https://github.com/${repo}.git`;
}

/**
 * git 直通 url 形判：带协议分隔或 git@ scp 形即直通（否则按短手展开）。
 * 直通形只做词法防线（# 是 ref 分隔符、空白破坏 CLI 词法——两者拒）。
 */
export function expandGitUri(
  uri: string,
): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string } {
  if (uri.includes('://') || uri.startsWith('git@')) {
    if (/\s/.test(uri) || uri.includes('#')) {
      return { ok: false, message: `git url 坏词法（"${uri}"）——空白与 # 拒（# 是 ref 分隔符位）` };
    }
    return { ok: true, url: uri };
  }
  // 无协议形——按 github 短手展开（坏形由短手执法抛出）
  try {
    return { ok: true, url: githubShorthandToUrl(uri) };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** `~` / `~/` 前缀展开到 home 根；其余形原样直通（home 注入纯函数——真身 os.homedir()） */
export function expandHomePath(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`;
  return path;
}
