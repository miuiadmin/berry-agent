/**
 * host/plugin-market/translate —— 源翻译层：五形条目源 → 三源 ref 矩阵
 * （03 §9.6 源翻译层与装机咬合节）。
 *
 * 核心律：**ref 词法单源**——翻译产物 ref 恒可被既有 plugin-install
 * parsePluginRef 解析（往返一致，零第二词法）；拷贝腿（git-subdir 形/相对串
 * 形）产物带 subpath，mp-3 装机咬合消费（staging 拷贝 + rename 落位）。
 *
 * 供应链防线（§9.6 防线表——缓存/布局路径注入面全执法）：
 *  - 相对源/git-subdir path：段级逃逸拒（'..' 出界段；'..x' 合法目录名不误伤）；
 *  - npm package：'..' 段 / '#' / 空白 / 空段 / '-' 起头拒（spec 槽位落
 *    argv 尾参位会被 npm 按旗标解析——nopt last-wins 可掀 '--ignore-scripts'
 *    / '--prefix' 重定向装机树）+ '@' 位执法（仅首段首位许
 *    @scope 作用域前缀，其余任何位含 '@' 拒——防 'foo@next' 混入包名域）；
 *  - npm version：'..' / 空白 / '#' / '.' 或 '-' 起头拒 + '@' 全位拒（'@' 是
 *    ref 分隔位——版本域含即拒，防 '1.0.0@x' 混入）；
 *  - sha：7-40 位十六进制；git ref：空白 / '#' / '..' / 空串 / '-' 起头拒
 *    （'-b'/'--detach' 形落 checkout 位置参数会被 git 解析为选项位）；
 *  - url：'#' 是 ref 分隔符位——url 内含即拒（保 lastIndexOf 往返）；
 *    '-' 起头拒（'-oX://y' 形落 clone 位置参数会被 git 解析为选项位——
 *    argv 注入面，npm spec 槽位同族威胁）；
 *  - direct 腿 git url：须带 '://' 协议位（installPathForGit 布局解析前提）
 *    ——scp 直通形（git@host:path）前置拒指路完整形；拷贝腿不解析 url 不受限。
 */
import { expandGitUri, sanitizeMarketText } from './classify.js';
import { foldRelativeSegments, resolveRelativeSubpath } from './catalog.js';
import type { TranslatedInstallTarget, TranslateInput } from './types.js';

/** 翻译产物：result 面（ok=false 时 message 归因指路） */
export type TranslateResult =
  { readonly ok: true; readonly target: TranslatedInstallTarget } | { readonly ok: false; readonly message: string };

/** sha 词法：7-40 位十六进制（omp 短 sha 同形） */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/** git ref/tag 词法：非空、无空白、无 '#'（ref 分隔符位）、无 '..'（段逃逸同源面）、不以 '-' 起头（选项位混淆拒） */
function isValidGitRefTag(ref: string): boolean {
  return ref !== '' && !/\s/.test(ref) && !ref.includes('#') && !ref.includes('..') && !ref.startsWith('-');
}

/**
 * npm 包名词法：段级执法——无空白、无 '#'、每段非空且非 '.'/'..'（装机路径
 * 拼接注入面）；'@' 位执法——仅首段**首位**允许（@scope 作用域前缀形），其余
 * 任何位含 '@' 即拒（'foo@next' 混入包名域 = dist-tag 语义静默漂移，同拒）。
 */
function isValidNpmPackage(pkg: string): boolean {
  if (pkg === '' || /\s/.test(pkg) || pkg.includes('#') || pkg.startsWith('-')) return false;
  const segments = pkg.split('/');
  // '@' 位执法：首段只许第 0 位是 '@'（indexOf > 0 = 位错拒）；非首段任何 '@' 拒
  const atMisplaced = segments.some((segment, index) =>
    index === 0 ? segment.indexOf('@') > 0 : segment.includes('@'),
  );
  if (atMisplaced) return false;
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** npm version 词法：非空、无空白、无 '#'、无 '..'、不以 '.' 或 '-' 起头（半成品形拒）；'@' 全位拒（ref 分隔位——版本域含即拒） */
function isValidNpmVersion(version: string): boolean {
  if (version === '' || /\s/.test(version) || version.includes('#') || version.includes('..')) return false;
  if (version.includes('@')) return false; // '1.0.0@x' 混入形——'@' 属 ref 分隔位非版本字符
  return !version.startsWith('.') && !version.startsWith('-');
}

/**
 * git url 直通词法：非空、无空白、无 '#'、无 '.'/'..' 段值（点段穿越拒
 * ——§9.6 布局段四处全验的翻译位前置防线：段值点形经布局层 join 内折可吞
 * 父树〔`https://evil.com/../..` → `plugins` 本身〕，翻译位前置拒省白花网络；
 * '..x' 等非点形段不误伤）；'-' 起头拒（'-oX://y' 形落 clone 位置参数会被
 * git 解析为选项位——argv 选项位混淆拒，与 ref/npm spec 槽位同族防线）。
 */
function isValidGitUrl(url: string): boolean {
  if (url === '' || /\s/.test(url) || url.includes('#') || url.startsWith('-')) return false;
  const segments = url.split('/');
  return segments.every((segment) => segment !== '.' && segment !== '..');
}

/**
 * git ref 后缀拼装：sha 优先于 ref（供应链钉位优先——sha 不可变）；两者皆
 * 缺席 = 裸 url 形（装机时默认分支——浮动，呈现面提示即可）。
 */
function pinSuffix(
  sha: string | undefined,
  ref: string | undefined,
): { readonly ok: true; readonly suffix: string } | { readonly ok: false; readonly message: string } {
  if (sha !== undefined) {
    if (!SHA_RE.test(sha)) {
      return { ok: false, message: `sha 坏词法（"${sha}"）——须 7-40 位十六进制` };
    }
    return { ok: true, suffix: `#${sha}` };
  }
  if (ref !== undefined) {
    if (!isValidGitRefTag(ref)) {
      return { ok: false, message: `git ref 坏词法（"${ref}"）——空白/#/../空串/'-'起头拒` };
    }
    return { ok: true, suffix: `#${ref}` };
  }
  return { ok: true, suffix: '' };
}

/**
 * 源翻译主函数（纯函数——语境全注入）：五形 → TranslatedInstallTarget。
 * 矩阵（§9.6 翻译表逐行）：
 *  - npm 形 → `npm:<pkg>[@<ver>]` direct；
 *  - github / url 形 → `git:<url>[#<sha|ref>]` direct（github repo 短手展开；
 *    sha 优先）；
 *  - git-subdir 形 → git ref + subpath 拷贝腿；
 *  - 相对串·git/github 语境 → `git:<市场仓 url>#<catalog commit>` + subpath
 *    拷贝腿（commit 缺席拒——浮动 ref 不可复算）；
 *  - 相对串·local 语境 → `local:<缓存目录>` + subpath 拷贝腿（B2 定形）；
 *  - 相对串·url 语境 → 结构性不可解析诚实拒（URL 源无仓结构）。
 *
 * 拒绝报文消毒（§9.6 mp 收尾批 security ③）：拒绝报文内插 catalog 原始字段
 * （package/version/sha/url/path/相对源串）——单出口剥控制字符后出函数
 * （报文经 CLI writeErr 入终端 = OSC/标题/伪行注入面；CLI 位另有 sanitizeLine
 * 皮带作纵深，构造位是主防线）。
 */
export function translateEntrySource(input: TranslateInput): TranslateResult {
  const result = translateEntrySourceInner(input);
  return result.ok ? result : { ok: false, message: sanitizeMarketText(result.message) };
}

/** 翻译真身（报文未消毒——消毒在导出位单出口包扎，勿绕过导出面直调） */
function translateEntrySourceInner(input: TranslateInput): TranslateResult {
  const { entrySource, pluginRoot } = input;

  // —— 对象形：判别字段分形 ——
  if (typeof entrySource === 'object') {
    // 形 5：npm——生态主道，ref 直装腿
    if (entrySource.source === 'npm') {
      if (!isValidNpmPackage(entrySource.package)) {
        return {
          ok: false,
          message: `npm 包名坏词法（"${entrySource.package}"）——'..'段/#/空白/空段/'-'起头拒（spec 槽位落 argv 尾参位会被 npm 按旗标解析——last-wins 掀 '--ignore-scripts'/'--prefix'）；'@' 位错拒（仅首段首位许 @scope 作用域前缀）`,
        };
      }
      if (entrySource.version !== undefined && !isValidNpmVersion(entrySource.version)) {
        return {
          ok: false,
          message: `npm 版本坏词法（"${entrySource.version}"）——空白/#/../'.'或'-'起头拒；'@' 全位拒（ref 分隔位）`,
        };
      }
      const ref =
        entrySource.version === undefined
          ? `npm:${entrySource.package}`
          : `npm:${entrySource.package}@${entrySource.version}`;
      return { ok: true, target: { ref, leg: 'direct' } };
    }

    // 形 2/3/4：github / url / git-subdir——git 直通族共用 url 展开与钉位
    let rawUrl: string;
    let subpath: string | undefined; // git-subdir 独有——拷贝腿参数
    if (entrySource.source === 'github') {
      rawUrl = entrySource.repo; // 短手展开位（owner/repo 形）
    } else if (entrySource.source === 'url') {
      rawUrl = entrySource.url; // 直通形（展开层兼容无协议短手）
    } else {
      // git-subdir：url + path 双执法
      rawUrl = entrySource.url;
      if (entrySource.path.startsWith('/')) {
        return { ok: false, message: `git-subdir path 须相对仓根（"${entrySource.path}" 是绝对路径）` };
      }
      const folded = foldRelativeSegments(entrySource.path);
      if (folded === null) {
        return { ok: false, message: `git-subdir path 逃逸拒（"${entrySource.path}"）` };
      }
      if (folded.length === 0) {
        return { ok: false, message: `git-subdir path 解析为空——拒（"${entrySource.path}"）` };
      }
      subpath = folded.join('/');
    }
    // url 展开/直通（含词法防线）+ 钉位（sha 优先）
    const expanded = expandGitUri(rawUrl);
    if (!expanded.ok) {
      return { ok: false, message: `git url 坏形（${expanded.message}）` };
    }
    if (!isValidGitUrl(expanded.url)) {
      return {
        ok: false,
        message: `git url 坏词法（"${expanded.url}"）——空白/#/'-'起头拒（'-oX://y' 形落 clone 位置参数会被 git 解析为选项位）`,
      };
    }
    const pin = pinSuffix(entrySource.sha, entrySource.ref);
    if (!pin.ok) {
      return { ok: false, message: pin.message };
    }
    const ref = `git:${expanded.url}${pin.suffix}`;
    // direct 腿产物将被 installPathForGit 按 '://' 协议位剥壳定位布局——scp
    // 直通形（git@host:path）缺协议位会装机腿断链（add/discover 绿而 install
    // 红）；前置拒指路完整形。拷贝腿不解析 url 定布局（staging 拷贝），不受限。
    if (subpath === undefined && !expanded.url.includes('://')) {
      return {
        ok: false,
        message: `direct 腿 git url 须带 '://' 协议位——scp 直通形（"${expanded.url}"）请换 https:// 或 ssh:// 完整形（git-subdir 拷贝腿不受限）`,
      };
    }
    // direct（github/url 形）或 subdir-copy（git-subdir 形）
    return subpath === undefined
      ? { ok: true, target: { ref, leg: 'direct' } }
      : { ok: true, target: { ref, subpath, leg: 'subdir-copy' } };
  }

  // —— 字符串形：相对串（市场仓内子目录）——语境分叉 ——
  const sub = resolveRelativeSubpath(entrySource, pluginRoot);
  if (!sub.ok) {
    return { ok: false, message: `相对源坏形（${sub.message}）` };
  }
  if (input.marketplaceSourceType === 'url') {
    // URL 源只存 catalog 单文件、无仓结构——相对串结构性不可解析
    return {
      ok: false,
      message: '相对源条目在 URL 市场源下结构性不可解析（URL 源无仓结构）——请对该市场换用 git 地址重新 add',
    };
  }
  if (input.marketplaceSourceType === 'local') {
    // B2 定形：本地市场仓相对源 → local 缓存目录 + 拷贝腿（缓存即真相）
    return {
      ok: true,
      target: { ref: `local:${input.marketCacheDir}`, subpath: sub.subpath, leg: 'subdir-copy' },
    };
  }
  // git/github 语境：锁 catalog commit（ref 可独立复算——一致性红利）
  if (input.catalogCommit === undefined) {
    return { ok: false, message: 'git 语境相对源须 catalog commit 锁定——源清单 commit 位缺席（坏形）' };
  }
  if (!SHA_RE.test(input.catalogCommit)) {
    return { ok: false, message: `catalog commit 坏词法（"${input.catalogCommit}"）——须 7-40 位十六进制` };
  }
  const expanded = expandGitUri(input.marketplaceUri);
  if (!expanded.ok) {
    return { ok: false, message: `市场仓 url 坏形（${expanded.message}）` };
  }
  return {
    ok: true,
    target: { ref: `git:${expanded.url}#${input.catalogCommit}`, subpath: sub.subpath, leg: 'subdir-copy' },
  };
}
