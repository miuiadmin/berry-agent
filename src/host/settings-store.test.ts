/**
 * host/settings-store 测试——数据目录用户配置文件读写件（04 §9 ⑥·M3 兜缝
 * ——ap-3）。覆盖：读侧缺席/好形/文件级坏 JSON 降级/键级坏值忽略点名/
 * 未知键 warn 不动文件；写侧合并保留未知键/原子替换不留 tmp 残/坏形期拒写。
 *
 * 真盘临时目录（文件 IO 件全栈惯例——tool-policy-store.test 同形）。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { readHostSettings, readRawCustomProviders, SETTINGS_BASENAME, writeHostSettings } from './settings-store.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function captureWarn(): { warnings: string[]; warn: (m: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (m) => void warnings.push(m) };
}

describe('readHostSettings（读侧——缺席零负担 + 坏形降级）', () => {
  it('文件缺席 = {} + healthy（零负担首启）', () => {
    const dir = tmpDir('settings-absent-');
    const load = readHostSettings(dir);
    expect(load.settings).toEqual({});
    expect(load.healthy).toBe(true);
  });
  it('好形两键读入', () => {
    const dir = tmpDir('settings-good-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ sandboxMode: 'read-only', approvalPolicy: 'ask' }));
    const load = readHostSettings(dir);
    expect(load.settings).toEqual({ sandboxMode: 'read-only', approvalPolicy: 'ask' });
    expect(load.healthy).toBe(true);
  });
  it('文件级坏 JSON = 降级 {} + unhealthy + warn 点名（回写拒依据）', () => {
    const dir = tmpDir('settings-badjson-');
    writeFileSync(join(dir, SETTINGS_BASENAME), '{not json');
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings).toEqual({});
    expect(load.healthy).toBe(false);
    expect(warnings.some((w) => w.includes('JSON 解析失败'))).toBe(true);
  });
  it('顶层非对象 = 坏形同降级', () => {
    const dir = tmpDir('settings-array-');
    writeFileSync(join(dir, SETTINGS_BASENAME), '[1,2]');
    const { warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.healthy).toBe(false);
    expect(load.settings).toEqual({});
  });
  it('键级坏值 = 忽略该键 + warn 点名（好键照常生效）', () => {
    const dir = tmpDir('settings-badkey-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ sandboxMode: 'yolo', approvalPolicy: 'never' }));
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.healthy).toBe(true);
    expect(load.settings).toEqual({ approvalPolicy: 'never' });
    expect(warnings.some((w) => w.includes('sandboxMode 值域外'))).toBe(true);
  });
  it('未知键 = warn 不动文件（读侧不消费不剔除）', () => {
    const dir = tmpDir('settings-unknown-');
    const raw = JSON.stringify({ sandboxMode: 'danger', futureKnob: 42 });
    writeFileSync(join(dir, SETTINGS_BASENAME), raw);
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings).toEqual({ sandboxMode: 'danger' });
    expect(warnings.some((w) => w.includes('futureKnob'))).toBe(true);
    // 文件未被动——原始字节往返保真
    expect(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')).toBe(raw);
  });
  it('theme 键三值域读入（批 10g——dark/light/auto）；值域外忽略点名好键照常', () => {
    const dir = tmpDir('settings-theme-');
    for (const theme of ['dark', 'light', 'auto'] as const) {
      writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme }));
      expect(readHostSettings(dir).settings).toEqual({ theme });
    }
    // 值域外：忽略该键 + warn 点名（本面零行为耦合——只存取与值域校验）。
    // /themes 批值域扩后 'blue' 已属合法自定义主题名——值域外例改路径形
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: 'a/b', approvalPolicy: 'ask' }));
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings).toEqual({ approvalPolicy: 'ask' });
    expect(warnings.some((w) => w.includes('theme 值域外'))).toBe(true);
  });

  it('theme 键自定义主题名读入（/themes 批——合法名收、非法名拒点名）', () => {
    const dir = tmpDir('settings-theme-custom-');
    // 合法自定义名（文件名即主题名——本面不探测文件在场，只验名合法形）
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: 'my-theme' }));
    expect(readHostSettings(dir).settings).toEqual({ theme: 'my-theme' });
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: 'A1._-x' }));
    expect(readHostSettings(dir).settings).toEqual({ theme: 'A1._-x' });
    // 非法名（路径形/首点/空档/超帽）= 值域外同拒
    for (const bad of ['a/b', '.hidden', '', 'x'.repeat(65)]) {
      writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: bad }));
      const { warnings, warn } = captureWarn();
      const load = readHostSettings(dir, { warn });
      expect(load.settings).toEqual({}); // 拒该键
      expect(warnings.some((w) => w.includes('theme 值域外'))).toBe(true);
    }
    // 写侧自定义名往返（/themes 选定持久化路）
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: 'dark' }));
    expect(writeHostSettings(dir, { theme: 'my-theme' })).toBe('written');
    expect(JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')).theme).toBe('my-theme');
  });

  it('keybindings 好形读入（批 10k R5——string→string 条目全量）', () => {
    const dir = tmpDir('settings-keys-good-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({ keybindings: { 'thinking.toggle': 'ctrl+g', 'editor.undo': 'ctrl+/' } }),
    );
    expect(readHostSettings(dir).settings).toEqual({
      keybindings: { 'thinking.toggle': 'ctrl+g', 'editor.undo': 'ctrl+/' },
    });
  });

  it('keybindings 形校验两档：非对象忽略整键、条目值非字符串丢条点名（好条照常）', () => {
    const dir = tmpDir('settings-keys-bad-');
    // 档一：整键非对象（数组）
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ keybindings: ['ctrl+t'] }));
    let { warnings, warn } = captureWarn();
    let load = readHostSettings(dir, { warn });
    expect(load.settings).toEqual({});
    expect(warnings.some((w) => w.includes('keybindings 须为对象'))).toBe(true);
    // 档二：条目值非字符串——丢该条点名、好条不受连坐
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({ keybindings: { 'thinking.toggle': 7, 'editor.undo': 'ctrl+/' } }),
    );
    ({ warnings, warn } = captureWarn());
    load = readHostSettings(dir, { warn });
    expect(load.settings).toEqual({ keybindings: { 'editor.undo': 'ctrl+/' } });
    expect(warnings.some((w) => w.includes('keybindings.thinking.toggle 值非字符串'))).toBe(true);
  });
});

describe('writeHostSettings（写侧——合并保留 + 原子 + 坏形拒）', () => {
  it('合并写只动两键：未知键原样保留（用户手编面不损毁）', () => {
    const dir = tmpDir('settings-merge-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ futureKnob: 42, sandboxMode: 'read-only' }, null, 2));
    const result = writeHostSettings(dir, { sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
    expect(result).toBe('written');
    const doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ futureKnob: 42, sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
  });
  it('缺席键不动现状（预设展开只写该预设携带的旋钮）', () => {
    const dir = tmpDir('settings-partial-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ approvalPolicy: 'never' }));
    writeHostSettings(dir, { sandboxMode: 'read-only' });
    const doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ approvalPolicy: 'never', sandboxMode: 'read-only' });
  });
  it('文件缺席直接造（首启落盘）', () => {
    const dir = tmpDir('settings-create-');
    const result = writeHostSettings(dir, { sandboxMode: 'workspace-write' });
    expect(result).toBe('written');
    const doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ sandboxMode: 'workspace-write' });
  });
  it('原子替换不留 tmp 残（撕裂窗口不暴露半文件）', () => {
    const dir = tmpDir('settings-atomic-');
    writeHostSettings(dir, { sandboxMode: 'danger' });
    const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
    // 尾随换行稳定（prettier 式 JSON 落盘面）
    expect(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8').endsWith('\n')).toBe(true);
  });
  it('文件级坏形期拒写（rejected——机器不在坏文件上覆写扩大破坏）', () => {
    const dir = tmpDir('settings-reject-');
    writeFileSync(join(dir, SETTINGS_BASENAME), '{broken');
    expect(writeHostSettings(dir, { sandboxMode: 'read-only' })).toBe('rejected');
    // 原文件字节不动
    expect(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')).toBe('{broken');
  });
  it('theme 写侧合并：写 theme 不动他键、他键写不动 theme（缺席键不动现状律）', () => {
    const dir = tmpDir('settings-theme-write-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: 'auto', approvalPolicy: 'ask' }));
    expect(writeHostSettings(dir, { sandboxMode: 'read-only' })).toBe('written');
    let doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ theme: 'auto', approvalPolicy: 'ask', sandboxMode: 'read-only' });
    expect(writeHostSettings(dir, { theme: 'light' })).toBe('written');
    doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ theme: 'light', approvalPolicy: 'ask', sandboxMode: 'read-only' });
  });
  it('keybindings 写侧合并：写 keybindings 不动他键、他键写不动 keybindings（批 10k）', () => {
    const dir = tmpDir('settings-keys-write-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: 'dark' }));
    expect(writeHostSettings(dir, { keybindings: { 'thinking.toggle': 'ctrl+g' } })).toBe('written');
    let doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ theme: 'dark', keybindings: { 'thinking.toggle': 'ctrl+g' } });
    expect(writeHostSettings(dir, { sandboxMode: 'read-only' })).toBe('written');
    doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({
      theme: 'dark',
      keybindings: { 'thinking.toggle': 'ctrl+g' },
      sandboxMode: 'read-only',
    });
  });
  it('非敏感件自证：文件名不在 settings 面（SENSITIVE_READ_DATA_PATHS 恰四件锁不动——此例锁对面；2026-09-14 五役 CL-1 集员扩容注笔随勘）', () => {
    // settings.json 非敏感（两旋钮无秘密）——可读性自证：写后文件存在且可读
    const dir = tmpDir('settings-plain-');
    writeHostSettings(dir, { approvalPolicy: 'ask' });
    expect(existsSync(join(dir, SETTINGS_BASENAME))).toBe(true);
  });
});

describe('customProviders 第五键（2026-09-28 模型渠道批 C-1——条目级校验丢条点名）', () => {
  /** 好形两渠道（两协议腿各一） */
  const GOOD = {
    'my-gw': { protocol: 'anthropic-messages', baseUrl: 'https://a.example.test', models: ['m1', 'm2'] },
    'oa-gw': {
      protocol: 'openai-completions',
      baseUrl: 'https://b.example.test/v1',
      models: ['g1'],
      name: '中转',
      headers: { 'X-Custom': 'v1' },
    },
  } as const;

  it('好形读入（两协议腿 + name/headers 可选位）', () => {
    const dir = tmpDir('settings-cp-good-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ customProviders: GOOD }));
    const load = readHostSettings(dir);
    expect(load.settings.customProviders).toEqual(GOOD);
    expect(load.healthy).toBe(true);
  });

  it('条目坏形 = 丢该条点名、好条目照常生效（keybindings 先例同形——04 §9 定形块⑥ 键面条款定形）', () => {
    const dir = tmpDir('settings-cp-badentry-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          'good-gw': GOOD['my-gw'],
          'bad-proto': { protocol: 'grpc', baseUrl: 'https://x.test', models: ['m'] },
          'bad-url': { protocol: 'openai-completions', baseUrl: '', models: ['m'] },
          'bad-models': { protocol: 'openai-completions', baseUrl: 'https://x.test', models: ['m', 42] },
          'bad-shape': 'not-an-object',
        },
      }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.healthy).toBe(true);
    expect(load.settings.customProviders).toEqual({ 'good-gw': GOOD['my-gw'] });
    // 四坏条逐一点名
    for (const id of ['bad-proto', 'bad-url', 'bad-models', 'bad-shape']) {
      expect(warnings.some((w) => w.includes(`customProviders.${id} 坏形`))).toBe(true);
    }
  });

  it('#30 baseUrl 零形校验：无协议/非 http(s) 形丢条点名（修前红：非空即过——首请求才抛 Invalid URL）', () => {
    const dir = tmpDir('settings-cp-urlshape-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          'ok-gw': GOOD['my-gw'],
          // 无协议形：读侧旧判据只查非空——注册通过、首请求 Invalid URL
          'no-scheme': { protocol: 'openai-completions', baseUrl: 'gw.test/v1', models: ['m'] },
          // 协议非 http(s)：URL 可解析但协议面越域
          'ftp-scheme': { protocol: 'openai-completions', baseUrl: 'ftp://x.test/v1', models: ['m'] },
        },
      }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toEqual({ 'ok-gw': GOOD['my-gw'] });
    for (const id of ['no-scheme', 'ftp-scheme']) {
      expect(warnings.some((w) => w.includes(`customProviders.${id} 坏形`) && w.includes('baseUrl'))).toBe(true);
    }
  });

  it('#32 models 元素级校验：空串/含斜杠丢条点名（修前红：元素形零校验照收——全形 spec 尾斜杠非法路径 fail-loud）', () => {
    const dir = tmpDir('settings-cp-models-elem-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          'ok-gw': GOOD['my-gw'],
          // 空串元素：注册后全形 spec 尾斜杠非法（'gw/'），ctrl+p 循环/首模型探针路径炸
          'empty-model': { protocol: 'openai-completions', baseUrl: 'https://x.test/v1', models: [''] },
          // 含斜杠元素：全形 spec 分割律错位（模型 id 裸形不含斜杠）
          'slash-model': { protocol: 'openai-completions', baseUrl: 'https://x.test/v1', models: ['a/b'] },
        },
      }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toEqual({ 'ok-gw': GOOD['my-gw'] });
    for (const id of ['empty-model', 'slash-model']) {
      expect(warnings.some((w) => w.includes(`customProviders.${id} 坏形`) && w.includes('models'))).toBe(true);
    }
  });

  it('#33 渠道 id 长度帽 64：超长 slug 键丢条点名（修前红：上界零校验照收——超长 id 直存 settings/凭证行）', () => {
    const dir = tmpDir('settings-cp-slug-cap-');
    // 65 字 = 首字母 + 64 个尾段字符（帽 64 恰越一档）；全形 slug 合字母/连字符
    const longId = `a${'b'.repeat(64)}`;
    const capId = `a${'b'.repeat(63)}`; // 恰 64 字 = 帽内放行
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({ customProviders: { [longId]: GOOD['my-gw'], [capId]: GOOD['my-gw'] } }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toEqual({ [capId]: GOOD['my-gw'] });
    expect(warnings.some((w) => w.includes(`customProviders.${longId}`) && w.includes('slug'))).toBe(true);
  });

  it('整键非对象 = 忽略整键点名', () => {
    const dir = tmpDir('settings-cp-badkey-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ customProviders: [1, 2] }));
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toBeUndefined();
    expect(warnings.some((w) => w.includes('customProviders 须为对象'))).toBe(true);
  });

  it('R-2 渠道 id slug 读侧校验：坏形键丢条点名（04 §9 ⑥ 批注⑤），好键照常——修前红：键形零校验照收（含斜杠 id 全形 spec 解析错位根因）', () => {
    const dir = tmpDir('settings-cp-slug-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          'ok-gw': GOOD['my-gw'],
          'Bad-Upper': GOOD['my-gw'], // 大写坏形
          '1st-num': GOOD['my-gw'], // 数字开头坏形
          'slash/gw': GOOD['my-gw'], // 含斜杠坏形（spec 解析错位根因——修前红主证）
          under_score: GOOD['my-gw'], // 下划线坏形
        },
      }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toEqual({ 'ok-gw': GOOD['my-gw'] });
    for (const id of ['Bad-Upper', '1st-num', 'slash/gw', 'under_score']) {
      expect(warnings.some((w) => w.includes(`customProviders.${id}`) && w.includes('slug'))).toBe(true);
    }
  });

  it('写侧合并：patch 携带落盘、缺席键不动现状、往返保真（向导落库路径）', () => {
    const dir = tmpDir('settings-cp-write-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ theme: 'dark' }));
    expect(writeHostSettings(dir, { customProviders: GOOD })).toBe('written');
    let doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ theme: 'dark', customProviders: GOOD });
    // 他键写不动 customProviders（缺席键不动现状律）
    expect(writeHostSettings(dir, { sandboxMode: 'read-only' })).toBe('written');
    doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ theme: 'dark', customProviders: GOOD, sandboxMode: 'read-only' });
    // 读回往返保真
    expect(readHostSettings(dir).settings.customProviders).toEqual(GOOD);
  });

  it('非敏感定性自证：customProviders 含 key 样值不触发任何敏感面（settings.json 不入敏感件集——04 §7 恰四件不动）', () => {
    const dir = tmpDir('settings-cp-plain-');
    writeHostSettings(dir, { customProviders: GOOD });
    expect(existsSync(join(dir, SETTINGS_BASENAME))).toBe(true);
  });

  it('pi-8 批：三键好形读入通过（openai 腿 compat+采样参两键全好形——读侧闭集执法不误伤）', () => {
    const dir = tmpDir('settings-pi8-good-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          'oa-full': {
            protocol: 'openai-completions',
            baseUrl: 'https://b.example.test/v1',
            models: ['g1'],
            compat: { supportsStore: true, thinkingFormat: 'zai', sessionAffinityFormat: 'openai' },
            samplingParams: { top_p: 0.9 },
            samplingParamsByThinkingLevel: { off: { top_k: 5 } },
          },
        },
      }),
    );
    const load = readHostSettings(dir);
    expect(load.settings.customProviders?.['oa-full']?.compat).toEqual({
      supportsStore: true,
      thinkingFormat: 'zai',
      sessionAffinityFormat: 'openai',
    });
    expect(load.settings.customProviders?.['oa-full']?.samplingParams).toEqual({ top_p: 0.9 });
    expect(load.settings.customProviders?.['oa-full']?.samplingParamsByThinkingLevel).toEqual({ off: { top_k: 5 } });
  });

  it('pi-8 批闭集执法：未知条目键 / 未白名单 compat 键 / 黑名单采样键 / 非 off 档位键全坏形丢条点名', () => {
    const dir = tmpDir('settings-pi8-closed-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          'ok-gw': GOOD['my-gw'],
          'extra-key': { ...GOOD['oa-gw'], whoops: 1 }, // 条目级未知键（修前：放行幸存=纯静默死键）
          'compat-stray': { ...GOOD['my-gw'], compat: { allowedFallbackModels: [] } }, // 白名单外 compat 键
          'sam-black': { ...GOOD['oa-gw'], samplingParams: { max_tokens: 999 } }, // 黑名单键（护栏旁路面）
          'level-stray': { ...GOOD['oa-gw'], samplingParamsByThinkingLevel: { low: { top_p: 0.9 } } }, // 非 off 档位键
        },
      }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toEqual({ 'ok-gw': GOOD['my-gw'] });
    expect(warnings.some((w) => w.includes('customProviders.extra-key 坏形'))).toBe(true);
    expect(warnings.some((w) => w.includes('未知键「whoops」'))).toBe(true);
    expect(warnings.some((w) => w.includes('键「allowedFallbackModels」不被支持'))).toBe(true);
    expect(warnings.some((w) => w.includes('键「max_tokens」不允许'))).toBe(true);
    expect(warnings.some((w) => w.includes('档「low」不支持'))).toBe(true);
  });

  it('pi-8 批：anthropic 腿采样参两键拒声明（上游忽略零效果——诚实律）+ ToolChanges 单开丢条', () => {
    const dir = tmpDir('settings-pi8-anthro-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          'sam-anthro': { ...GOOD['my-gw'], samplingParams: { top_p: 0.9 } }, // anthropic 腿声明采样参
          'tc-solo': { ...GOOD['my-gw'], compat: { supportsMidConvoToolChanges: true } }, // 依赖违例单开
        },
      }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toEqual({});
    expect(warnings.some((w) => w.includes('设置无效'))).toBe(true);
    expect(
      warnings.some((w) => w.includes('supportsMidConvoToolChanges 需与 supportsMidConvoSystemMessages 同时开启')),
    ).toBe(true);
  });

  it('pi-8 批破坏性收紧回归锁：既有档含未知键条目从「渠道可用」翻「整条丢点名」（有意收紧——boot warn 指路手编修复）', () => {
    const dir = tmpDir('settings-pi8-tighten-');
    writeFileSync(
      join(dir, SETTINGS_BASENAME),
      JSON.stringify({
        customProviders: {
          // 修前此条「渠道可用但额外键无效」（未知键放行）；本批起整条丢
          legacy: { protocol: 'openai-completions', baseUrl: 'https://x.test/v1', models: ['m'], legacyFlag: true },
        },
      }),
    );
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings.customProviders).toEqual({}); // 整条丢——渠道不可用（fail-loud 优先）
    expect(warnings.some((w) => w.includes('未知键「legacyFlag」'))).toBe(true);
  });
});

describe('readRawCustomProviders（#2 前半——写侧合并基单源：原始文件原样供料，04 §9 ⑥ 2026-09-29 笔）', () => {
  /** 好形条目（与上块 GOOD 同形——describe 作用域分立各自持样） */
  const goodEntry = { protocol: 'anthropic-messages', baseUrl: 'https://a.example.test', models: ['m1', 'm2'] };

  it('好形 + 坏形条目 + 坏 slug 键三键全在原样返回——对照 readHostSettings 投影只剩好形', () => {
    const dir = tmpDir('settings-rawcp-');
    const providers = {
      'good-gw': goodEntry,
      // 坏形条目：缺 protocol（读侧投影必丢）
      'no-proto': { baseUrl: 'https://x.test/v1', models: ['m'] },
      // 坏 slug 键：大写 + 下划线（读侧投影必丢）
      Bad_Key: goodEntry,
    };
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ customProviders: providers }));
    // 原始面：三键全在（零校验零丢条——写侧合并基要的是原文不是判断）
    expect(readRawCustomProviders(dir)).toEqual(providers);
    // 对照：读侧投影只剩好形条目（两个读位各司其职）
    expect(readHostSettings(dir).settings.customProviders).toEqual({ 'good-gw': goodEntry });
  });

  it('坏 JSON / 文件缺失 / 键缺席 = undefined；键非对象形也原样返回', () => {
    // 坏 JSON = undefined
    const dir = tmpDir('settings-rawcp-badjson-');
    writeFileSync(join(dir, SETTINGS_BASENAME), '{not json');
    expect(readRawCustomProviders(dir)).toBeUndefined();
    // 文件缺失 = undefined（零负担首启位同判）
    const dir2 = tmpDir('settings-rawcp-absent-');
    expect(readRawCustomProviders(dir2)).toBeUndefined();
    // 键缺席 = undefined（customProviders 未写）
    writeFileSync(join(dir2, SETTINGS_BASENAME), JSON.stringify({ sandboxMode: 'read-only' }));
    expect(readRawCustomProviders(dir2)).toBeUndefined();
    // 键非对象形（数组）也原样返回——判断归投影面，本读位零校验
    writeFileSync(join(dir2, SETTINGS_BASENAME), JSON.stringify({ customProviders: [1, 2] }));
    expect(readRawCustomProviders(dir2)).toEqual([1, 2]);
  });
});
