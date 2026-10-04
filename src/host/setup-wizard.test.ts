/**
 * /setup 配置向导流程件测试 v2（onboarding ob-3 + 2026-09-28 模型渠道批
 * C-3 重做）：假 prompter 直锁全流程分支（contract-first）。
 *
 * 锁面：分桶选单结构（official:/custom:/+ 新建三段）/ 官方腿（明文录入 +
 * confirm 全值行 + 探针三结局）/ 自定义腿新建全流程（slug 校验三坏形 /
 * 协议二选 / 拉取 multiselect / 手填兜底 / headers 可选 / **写序 = 凭证行先
 * settings 后** / 活注册 / 切模型）/ 编辑重入（默认值带当前值）/ 删除按写序
 * / 半应用诚实收场 / Esc 任意步中止零保存。
 * 明文锁：录入 preview 与 confirm 回执均完整值（v1 掩码断言全翻——掩码函数
 * 已退役）。禁断言 AI 生成文本——本面全为静态文案，锁结构不锁逐字。
 */
import { describe, expect, it } from 'vitest';
import type {
  WizardConfirmRequest,
  WizardMultiselectRequest,
  WizardPrompter,
  WizardSelectRequest,
  WizardTextRequest,
} from '../channels/index.js';
import type { CustomProviderDef } from '../llm/index.js';
import { runSetupWizard, stripExportPrefix, type SetupWizardDeps, type SetupWizardSaveResult } from './setup-wizard.js';
import type { ChannelModelsResult } from './channel-models-fetch.js';

/** 假 prompter：脚本化应答队列 + 全调用记录（流程分支直锁） */
interface ScriptedAnswers {
  readonly select?: (string | undefined)[];
  readonly multiselect?: (readonly string[] | undefined)[];
  readonly text?: (string | undefined)[];
  readonly confirm?: (boolean | undefined)[];
}

interface Recorded {
  readonly selects: WizardSelectRequest[];
  readonly multiselects: WizardMultiselectRequest[];
  readonly texts: WizardTextRequest[];
  readonly confirms: WizardConfirmRequest[];
  readonly intros: { title: string; lines: readonly string[] }[];
  readonly outros: { title: string; lines: readonly string[] }[];
}

function makePrompter(script: ScriptedAnswers): { prompter: WizardPrompter; recorded: Recorded } {
  const selects = [...(script.select ?? [])];
  const multiselects = [...(script.multiselect ?? [])];
  const texts = [...(script.text ?? [])];
  const confirms = [...(script.confirm ?? [])];
  const recorded: Recorded = {
    selects: [],
    multiselects: [],
    texts: [],
    confirms: [],
    intros: [],
    outros: [],
  };
  return {
    prompter: {
      intro: (title, lines) => {
        recorded.intros.push({ title, lines });
      },
      select: (req) => {
        recorded.selects.push(req);
        return Promise.resolve(selects.shift());
      },
      multiselect: (req) => {
        recorded.multiselects.push(req);
        return Promise.resolve(multiselects.shift());
      },
      text: (req) => {
        recorded.texts.push(req);
        return Promise.resolve(texts.shift());
      },
      confirm: (req) => {
        recorded.confirms.push(req);
        return Promise.resolve(confirms.shift());
      },
      outro: (title, lines) => {
        recorded.outros.push({ title, lines });
        return Promise.resolve();
      },
    },
    recorded,
  };
}

/** 调用序记录（写序/活注册/切模型断言面——数组序即调用序） */
interface CallLog {
  readonly savedBindings: { providerId: string; apiKey: string }[];
  readonly removedBindings: string[];
  readonly savedChannels: { id: string; def: CustomProviderDef }[];
  readonly removedChannels: string[];
  readonly registered: { id: string; def: CustomProviderDef }[];
  /** R-1 删除腿三联动第三步——运行时除名记录 */
  readonly unregistered: string[];
  readonly switched: string[];
  readonly fetched: { baseUrl: string; protocol: string; apiKey: string }[];
  readonly probeCalls: string[][];
}

/** 标准依赖装配（官方桶两渠道 + 全注入位记录） */
function makeDeps(
  prompter: WizardPrompter,
  overrides: Partial<SetupWizardDeps> = {},
): { deps: SetupWizardDeps; log: CallLog } {
  const log: CallLog = {
    savedBindings: [],
    removedBindings: [],
    savedChannels: [],
    removedChannels: [],
    registered: [],
    unregistered: [],
    switched: [],
    fetched: [],
    probeCalls: [],
  };
  const deps: SetupWizardDeps = {
    prompter,
    providers: [
      { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
      { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
    ],
    customChannels: {},
    builtinProviderIds: ['anthropic', 'openai'],
    envShadowed: () => false,
    saveBinding: (providerId, apiKey) => {
      log.savedBindings.push({ providerId, apiKey });
      return { ok: true, text: `已录入凭证 host/${providerId}` } satisfies SetupWizardSaveResult;
    },
    removeBinding: (providerId) => {
      log.removedBindings.push(providerId);
      return { ok: true, text: `已撤销凭证 host/${providerId}` } satisfies SetupWizardSaveResult;
    },
    probeModelOf: () => 'anthropic/claude-sonnet-5',
    probe: (providerId, apiKey) => {
      log.probeCalls.push([providerId, apiKey]);
      return Promise.resolve({ ok: true, detail: '应答正常' });
    },
    fetchModels: (req) => {
      log.fetched.push({ baseUrl: req.baseUrl, protocol: req.protocol, apiKey: req.apiKey });
      return Promise.resolve({ kind: 'ok', models: ['gw-a', 'gw-b'] } satisfies ChannelModelsResult);
    },
    saveCustomChannel: (id, def) => {
      log.savedChannels.push({ id, def });
      return { ok: true, text: `渠道配置已保存（customProviders.${id}）` } satisfies SetupWizardSaveResult;
    },
    removeCustomChannel: (id) => {
      log.removedChannels.push(id);
      return { ok: true, text: `渠道配置已移除（customProviders.${id}）` } satisfies SetupWizardSaveResult;
    },
    registerCustomProvider: (id, def) => {
      log.registered.push({ id, def });
      return { ok: true };
    },
    // R-1 删除腿三联动第三步（装配位组合「运行时除名 + 模型复位」——本桩纯记录）
    unregisterCustomProvider: (id) => {
      log.unregistered.push(id);
      return {};
    },
    switchModel: (spec) => {
      log.switched.push(spec);
    },
    ...overrides,
  };
  return { deps, log };
}

describe('stripExportPrefix（整行粘贴容错）', () => {
  it('剥 export VAR= 前缀', () => {
    expect(stripExportPrefix('export ANTHROPIC_API_KEY=sk-abc')).toBe('sk-abc');
    expect(stripExportPrefix('export MY_KEY = "sk-quoted"')).toBe('sk-quoted');
  });
  it('无前缀原样透传（含包裹引号剥离）', () => {
    expect(stripExportPrefix('sk-plain')).toBe('sk-plain');
    expect(stripExportPrefix("'sk-single'")).toBe('sk-single');
  });
});

describe('runSetupWizard 分桶选单', () => {
  it('桶结构：官方桶（official: 前缀 + 已配置 ✓）+ 自定义桶（custom: 前缀）+ 新建尾项', async () => {
    const { prompter, recorded } = makePrompter({ select: [undefined] });
    const { deps } = makeDeps(prompter, {
      customChannels: { 'my-gw': { protocol: 'openai-completions', baseUrl: 'https://gw.test/v1', models: ['m1'] } },
      currentApiKeyOf: (providerId) => (providerId === 'anthropic' ? 'sk-ant-live' : undefined),
    });
    await runSetupWizard(deps);
    const items = recorded.selects[0]?.items.map((item) => item.id) ?? [];
    // UX 对标批：自定义桶（+ 新建尾项）提前第一、官方桶退居其后（用户令
    // 2026-09-30——修前红锚：修前顺序 official 在前）
    expect(items).toEqual(['custom:my-gw', '__new_custom__', 'official:anthropic', 'official:openai']);
    // 自定义桶 desc：协议 · baseUrl · 模型数
    expect(recorded.selects[0]!.items[0]!.desc).toContain('OpenAI 兼容');
    expect(recorded.selects[0]!.items[0]!.desc).toContain('模型 1 个');
    // 官方桶：label 冠「官方 ·」标注 + desc 位 baseUrl；已配置键带 ✓、未配置裸
    expect(recorded.selects[0]!.items[2]!.label).toContain('官方 · ');
    expect(recorded.selects[0]!.items[2]!.label).toContain('✓');
    expect(recorded.selects[0]!.items[2]!.desc).toContain('https://api.anthropic.com');
    expect(recorded.selects[0]!.items[3]!.label).toContain('官方 · ');
    expect(recorded.selects[0]!.items[3]!.label).not.toContain('✓');
  });

  it('currentProvider 官方桶在册 → 预选 official: 前缀形', async () => {
    const { prompter, recorded } = makePrompter({ select: [undefined] });
    const { deps } = makeDeps(prompter, { currentProvider: 'openai' });
    await runSetupWizard(deps);
    expect(recorded.selects[0]?.preselect).toBe('official:openai');
  });
});

describe('runSetupWizard 官方腿（明文 + 落行 + 探针）', () => {
  it('全走：桶选 → key 明文录入 → confirm 全值行 → 落绑定行 + 探针跳过注记（probe 缺席）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['official:openai'],
      text: ['sk-openai-new'],
      confirm: [true],
    });
    const { deps, log } = makeDeps(prompter, { probe: undefined });
    await runSetupWizard(deps);
    // 录入请求零掩码位（v1 sensitive 字段已删——全明文相）；confirm 回执完整值行
    expect(recorded.texts[0]?.preview).toBeUndefined();
    const confirmLines = recorded.confirms[0]?.lines?.join('\n') ?? '';
    expect(confirmLines).toContain('key：sk-openai-new');
    expect(recorded.confirms[0]?.lines?.join('\n')).toContain('sk-openai-new');
    expect(log.savedBindings).toEqual([{ providerId: 'openai', apiKey: 'sk-openai-new' }]);
    const outro = recorded.outros.at(-1)!;
    expect(outro.lines.join('\n')).toContain('已录入凭证 host/openai');
    expect(outro.lines.join('\n')).toContain('未验证');
  });

  it('重入默认值：当前值完整呈预览（全明文——非掩码形）+ 空录入沿用原值', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['official:anthropic'],
      text: [''],
      confirm: [true],
    });
    const { deps, log } = makeDeps(prompter, {
      currentApiKeyOf: (providerId) => (providerId === 'anthropic' ? 'sk-old-value-9999' : undefined),
    });
    await runSetupWizard(deps);
    // 全明文锁：预览即全值（v1 头4尾4掩码断言翻档）
    expect(recorded.texts[0]?.preview).toBe('sk-old-value-9999');
    expect(log.savedBindings).toEqual([{ providerId: 'anthropic', apiKey: 'sk-old-value-9999' }]);
    // 「与已保存的值相同——不改动」判据随 providerId 走（confirm 附呈行——非 title）
    expect(recorded.confirms[0]?.lines?.join('\n')).toContain('不改动');
  });

  it('换渠道改选后空录入：不沿用他家 key、走「未配置」收场零保存', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['official:anthropic'],
      text: [''],
    });
    const { deps, log } = makeDeps(prompter, {
      currentApiKeyOf: (providerId) => (providerId === 'openai' ? 'sk-openai-old-value' : undefined),
    });
    await runSetupWizard(deps);
    expect(recorded.texts[0]?.preview).toBeUndefined();
    expect(log.savedBindings).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('未录入');
  });

  it('env 遮蔽预警：confirm 拒 → 中止零保存；允 → 照常落行', async () => {
    const rejected = makePrompter({ select: ['official:anthropic'], confirm: [false] });
    const depsR = makeDeps(rejected.prompter, { envShadowed: () => true });
    await runSetupWizard(depsR.deps);
    expect(rejected.recorded.confirms[0]?.title).toContain('不会生效');
    expect(depsR.log.savedBindings).toEqual([]);

    const allowed = makePrompter({ select: ['official:anthropic'], confirm: [true, true], text: ['sk-shadowed'] });
    const depsA = makeDeps(allowed.prompter, { envShadowed: () => true });
    await runSetupWizard(depsA.deps);
    expect(depsA.log.savedBindings).toEqual([{ providerId: 'anthropic', apiKey: 'sk-shadowed' }]);
  });

  it('Esc 取消选择步 / 录入步 / confirm 拒 / 空录入无当前值 → 各中止零保存', async () => {
    const cases: ScriptedAnswers[] = [
      { select: [undefined] },
      { select: ['official:anthropic'], text: [undefined] },
      { select: ['official:anthropic'], text: ['sk-v'], confirm: [false] },
      { select: ['official:anthropic'], text: ['  '] },
    ];
    for (const script of cases) {
      const { prompter } = makePrompter(script);
      const { deps, log } = makeDeps(prompter);
      await runSetupWizard(deps);
      expect(log.savedBindings).toEqual([]);
    }
  });

  it('saveBinding ok:false / 同步抛 → 保存失败档不进探针', async () => {
    const fail = makePrompter({ select: ['official:anthropic'], text: ['sk-v'], confirm: [true] });
    const depsF = makeDeps(fail.prompter, {
      saveBinding: () => ({ ok: false, text: 'PERSIST_SECRET_UNREADABLE：密钥腐坏' }),
    });
    await runSetupWizard(depsF.deps);
    expect(fail.recorded.outros.at(-1)?.title).toContain('失败');
    expect(depsF.log.probeCalls).toEqual([]);

    const thrown = makePrompter({ select: ['official:anthropic'], text: ['sk-v'], confirm: [true] });
    const depsT = makeDeps(thrown.prompter, {
      saveBinding: () => {
        throw new Error('SqliteError: database is locked');
      },
    });
    await runSetupWizard(depsT.deps); // 修前红形：同步抛不上杀流程
    expect(thrown.recorded.outros.at(-1)?.lines.join('\n')).toContain('database is locked');
  });

  it('探针三结局：允+过（回执验证通过）/ 允+败（保存不阻断）/ 拒（跳过零调用）', async () => {
    const okCase = makePrompter({ select: ['official:anthropic'], text: ['sk-ok'], confirm: [true, true] });
    const depsOk = makeDeps(okCase.prompter);
    await runSetupWizard(depsOk.deps);
    expect(depsOk.log.probeCalls).toEqual([['anthropic', 'sk-ok']]);
    expect(okCase.recorded.outros.at(-1)?.lines.join('\n')).toContain('验证通过');

    const badCase = makePrompter({ select: ['official:anthropic'], text: ['sk-bad'], confirm: [true, true] });
    const depsBad = makeDeps(badCase.prompter, {
      probe: () => Promise.resolve({ ok: false, detail: '[401] invalid' }),
    });
    await runSetupWizard(depsBad.deps);
    expect(badCase.recorded.outros.at(-1)?.lines.join('\n')).toContain('401');

    const skipCase = makePrompter({ select: ['official:anthropic'], text: ['sk-v'], confirm: [true, false] });
    const depsSkip = makeDeps(skipCase.prompter);
    await runSetupWizard(depsSkip.deps);
    expect(depsSkip.log.probeCalls).toEqual([]);
    expect(skipCase.recorded.outros.at(-1)?.lines.join('\n')).toContain('已跳过');
  });
});

describe('runSetupWizard 自定义渠道新建腿', () => {
  /** 新建腿脚本速构（拉取路默认全选 gw-a） */
  const NEW_SCRIPT = {
    select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a'],
    text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
    multiselect: [['gw-a'] as readonly string[]],
    confirm: [false /** headers 拒 */, true /** 保存允 */, false /** 切模型拒 */],
  };

  it('全流程：六步表单 → 写序落库（凭证行先、settings 后）→ 活注册 → 切模型拒', async () => {
    const { prompter, recorded } = makePrompter(NEW_SCRIPT);
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    // 拉取请求（拉取步供数）
    expect(log.fetched).toEqual([
      { baseUrl: 'https://gw.test/v1', protocol: 'openai-completions', apiKey: 'sk-gw-key' },
    ]);
    // multiselect 收拉取清单
    expect(recorded.multiselects[0]?.items.map((item) => item.id)).toEqual(['gw-a', 'gw-b']);
    // confirm 全值回执（全明文）
    const saveConfirm = recorded.confirms.find((c) => c.title.includes('保存自定义渠道'))!;
    expect(saveConfirm.lines?.join('\n')).toContain('sk-gw-key');
    expect(saveConfirm.lines?.join('\n')).toContain('https://gw.test/v1');
    expect(saveConfirm.lines?.join('\n')).toContain('gw-a');
    // 写序铁律：凭证行先、settings 后（数组序即调用序）
    expect(log.savedBindings.map((b) => b.providerId)).toEqual(['my-relay']);
    expect(log.savedChannels.map((c) => c.id)).toEqual(['my-relay']);
    expect(log.savedChannels[0]?.def).toEqual({
      protocol: 'openai-completions',
      baseUrl: 'https://gw.test/v1',
      models: ['gw-a'],
    });
    // 活注册（两写皆成后）+ 切模型拒零调用
    expect(log.registered.map((r) => r.id)).toEqual(['my-relay']);
    expect(log.switched).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('立即生效');
  });

  it('切模型允：select 模型 → switchModel 全形', async () => {
    const { prompter } = makePrompter({
      ...NEW_SCRIPT,
      confirm: [false, true, true /** 切模型允 */],
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-b'],
      multiselect: [['gw-b'] as readonly string[]],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.switched).toEqual(['my-relay/gw-b']);
  });

  it('拉取失败 → 手填兜底（失败原因入手填提示）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'anthropic-messages', '__models_fetch__'],
      text: ['my-relay', 'https://gw.test', 'sk-k', 'hand-a, hand-b ,'],
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter, {
      fetchModels: () => Promise.resolve({ kind: 'failed', message: '端点应答 401' } satisfies ChannelModelsResult),
    });
    await runSetupWizard(deps);
    // 手填解析：逗号分隔 trim + 空段过滤
    expect(log.savedChannels[0]?.def.models).toEqual(['hand-a', 'hand-b']);
    expect(recorded.multiselects).toEqual([]); // 拉取失败不进 multiselect
  });

  it('手填直路（不经拉取）', async () => {
    const { prompter } = makePrompter({
      select: ['__new_custom__', 'anthropic-messages', '__models_manual__'],
      text: ['my-relay', 'https://gw.test', 'sk-k', 'm1,m2'],
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.fetched).toEqual([]);
    expect(log.savedChannels[0]?.def.protocol).toBe('anthropic-messages');
  });

  it('headers 允 + 解析（"K: V, K2: V2" 形）', async () => {
    const { prompter } = makePrompter({
      ...NEW_SCRIPT,
      confirm: [true, true, false],
      text: [...(NEW_SCRIPT.text ?? []), 'X-Upstream: beta, X-Region: eu'],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.savedChannels[0]?.def.headers).toEqual({ 'X-Upstream': 'beta', 'X-Region': 'eu' });
  });

  it('渠道 id 三坏形 → 重问当前步（R-3 翻裁——坏形不退出整向导；动态 hint 点名错因，二次好形通过）', async () => {
    for (const [badId, expectWord, secondId] of [
      ['My_Relay', '格式不对', 'my-relay'],
      ['anthropic', '重名', 'my-relay'],
      ['existing-gw', '已存在', 'my-relay'],
    ] as const) {
      const { prompter, recorded } = makePrompter({
        // 全流程：选新建 → id 坏形一次 → 好形 → 后续 NEW_SCRIPT 尾段（协议
        // select 首答已耗——text 偏移补）
        select: ['__new_custom__', 'openai-completions'],
        text: [badId, secondId, 'https://gw.test/v1', 'sk-live', 'g1', ''],
        confirm: [false, true, true, false, false],
      });
      const { deps, log } = makeDeps(prompter, {
        customChannels: { 'existing-gw': { protocol: 'openai-completions', baseUrl: 'https://x.test', models: [] } },
      });
      await runSetupWizard(deps);
      // 坏形重问证据：text 调用 ≥2 次同 title「渠道 id」+ 第二次 hint 含错因词
      const idTexts = recorded.texts.filter((t) => t.title === '渠道 id');
      expect(idTexts.length).toBe(2);
      expect(idTexts[1]?.hint ?? '').toContain(expectWord);
      // 好形通过 → 流程继续到保存（零写由 confirm 拒保全——中断在 headers 问）
      expect(log.savedBindings).toEqual([]); // confirm 全拒零写
    }
  });

  it('Base URL 坏形（非 http(s) 开头）→ 重问当前步（R-3 翻裁——hint 点名须 http(s)，二次好形通过）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions'],
      text: ['my-relay', 'ftp://gw.test', 'https://gw.test/v1', 'sk-live', 'g1', ''],
      confirm: [false, true, true, false, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    const urlTexts = recorded.texts.filter((t) => t.title === 'Base URL');
    expect(urlTexts.length).toBe(2); // 坏形重问不退出
    expect(urlTexts[1]?.hint ?? '').toContain('http');
    expect(log.savedBindings).toEqual([]); // confirm 全拒零写
  });

  it('半应用：凭证行成、settings 败 → 诚实呈补齐路径且不活注册', async () => {
    const { prompter, recorded } = makePrompter(NEW_SCRIPT);
    const { deps, log } = makeDeps(prompter, {
      saveCustomChannel: () => ({ ok: false, text: 'settings.json 写入被拒' }),
    });
    await runSetupWizard(deps);
    expect(log.savedBindings).toHaveLength(1); // 凭证行已写（写序第一步）
    expect(log.registered).toEqual([]); // 不活注册
    const outro = recorded.outros.at(-1)!;
    expect(outro.title).toContain('部分完成');
    // #24 翻档：指路改可达形——渠道未落库、重入清单无此条，「编辑配置」指路退役
    expect(outro.lines.join('\n')).toContain('重新配置');
  });

  it('保存 confirm 拒 → 中止零写（headers 问已在拒前——confirm 序：headers 拒?/保存允?）', async () => {
    const { prompter } = makePrompter({ ...NEW_SCRIPT, confirm: [false, false] });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.savedBindings).toEqual([]);
    expect(log.savedChannels).toEqual([]);
    expect(log.registered).toEqual([]);
  });

  it('活注册抛（并发换代窗防御）→ 配置已持久注记（重启生效）不杀流程', async () => {
    const { prompter, recorded } = makePrompter(NEW_SCRIPT);
    const { deps } = makeDeps(prompter, {
      registerCustomProvider: () => {
        throw new Error('runtime 已换代');
      },
    });
    await runSetupWizard(deps);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('重启后生效');
  });
});

describe('runSetupWizard 既有自定义渠道（编辑重入 / 删除）', () => {
  const EXISTING: CustomProviderDef = {
    protocol: 'openai-completions',
    baseUrl: 'https://gw.test/v1',
    models: ['old-a', 'old-b'],
  };

  it('编辑重入：表单带当前值（协议预选/baseUrl·key 预览/清单预览）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_edit__', 'openai-completions', '__models_manual__'],
      text: ['', '', 'new-a'], // baseUrl 空=沿用 / key 空=沿用 / 手填换新清单
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter, {
      customChannels: { 'my-gw': EXISTING },
      currentApiKeyOf: (providerId) => (providerId === 'my-gw' ? 'sk-gw-current' : undefined),
    });
    await runSetupWizard(deps);
    // 重入默认值锁：协议预选 / baseUrl 预览全值 / key 预览全值 / 手填预览现清单
    const protoSelect = recorded.selects.find((r) => r.title.includes('协议'))!;
    expect(protoSelect.preselect).toBe('openai-completions');
    expect(recorded.texts[0]?.preview).toBe('https://gw.test/v1');
    expect(recorded.texts[1]?.preview).toBe('sk-gw-current');
    expect(recorded.texts[2]?.preview).toBe('old-a, old-b'); // 手填步预览现清单
    // 沿用当前值（baseUrl/key 空录入）+ 清单换新 + 更新 confirm 题
    expect(log.savedChannels[0]?.def).toEqual({
      protocol: 'openai-completions',
      baseUrl: 'https://gw.test/v1',
      models: ['new-a'],
    });
    expect(recorded.confirms.find((c) => c.title.includes('更新自定义渠道'))).toBeDefined();
    expect(log.registered).toHaveLength(1); // 编辑路同活注册（重注册 upsert）
  });

  it('手填空录入沿用现有清单（preview「在场空录入 = 沿用」语义同律）', async () => {
    const { prompter } = makePrompter({
      select: ['custom:my-gw', '__entry_edit__', 'openai-completions', '__models_manual__'],
      text: ['', '', ''], // 全空 = 全沿用
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter, {
      customChannels: { 'my-gw': EXISTING },
      currentApiKeyOf: (providerId) => (providerId === 'my-gw' ? 'sk-gw-current' : undefined),
    });
    await runSetupWizard(deps);
    expect(log.savedChannels[0]?.def.models).toEqual(['old-a', 'old-b']);
  });

  it('删除：confirm 缺省否 + 拒 → 零删；允 → 写序（凭证行先、settings 后）', async () => {
    // 拒路
    const rejected = makePrompter({ select: ['custom:my-gw', '__entry_delete__'], confirm: [false] });
    const depsR = makeDeps(rejected.prompter, { customChannels: { 'my-gw': EXISTING } });
    await runSetupWizard(depsR.deps);
    expect(depsR.log.removedBindings).toEqual([]);
    expect(rejected.recorded.confirms[0]?.defaultYes).toBe(false); // 破坏性缺省否

    // 允路
    const allowed = makePrompter({ select: ['custom:my-gw', '__entry_delete__'], confirm: [true] });
    const depsA = makeDeps(allowed.prompter, { customChannels: { 'my-gw': EXISTING } });
    await runSetupWizard(depsA.deps);
    expect(depsA.log.removedBindings).toEqual(['my-gw']);
    expect(depsA.log.removedChannels).toEqual(['my-gw']);
  });
});

describe('删除腿三联动与回执诚实化（R-1 评审修复役——修前红族）', () => {
  const EXISTING: CustomProviderDef = {
    protocol: 'openai-completions',
    baseUrl: 'https://gw.test/v1',
    models: ['old-a', 'old-b'],
  };

  it('三联动：凭证行 → settings → 运行时除名同序 + outro 点名「当场生效」（修前红：删除只两写、运行时仍注册）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_delete__'],
      confirm: [true],
    });
    const { deps, log } = makeDeps(prompter, { customChannels: { 'my-gw': EXISTING } });
    await runSetupWizard(deps);
    // 三步同序：凭证行 → settings → 运行时除名（数组序即调用序）
    expect(log.removedBindings).toEqual(['my-gw']);
    expect(log.removedChannels).toEqual(['my-gw']);
    expect(log.unregistered).toEqual(['my-gw']);
    // outro 诚实呈报：当场生效（与保存腿活注册对称的「当场失效」）
    const outro = recorded.outros.at(-1)!;
    expect(outro.lines.join('\n')).toContain('立即生效');
  });

  it('模型复位回执：当前模型停在被删渠道 → unregister 回执 modelReset 透传 outro 点名（修前红：无复位呈报）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_delete__'],
      confirm: [true],
    });
    const { deps } = makeDeps(prompter, {
      customChannels: { 'my-gw': EXISTING },
      unregisterCustomProvider: (id) => {
        // 装配位组合形：当前模型停在被删渠道 → 复位运行时目录首条并回执点名
        return { modelReset: id === 'my-gw' ? 'anthropic/claude-sonnet-5' : undefined };
      },
    });
    await runSetupWizard(deps);
    const outro = recorded.outros.at(-1)!;
    expect(outro.lines.join('\n')).toContain('anthropic/claude-sonnet-5');
    expect(outro.lines.join('\n')).toContain('复位');
  });

  it('半应用诚实呈报：凭证行缺席（ok:false 透传）→ outro 呈未完全成功（修前红：恒「已删除」不查 ok 位）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_delete__'],
      confirm: [true],
    });
    const { deps, log } = makeDeps(prompter, {
      customChannels: { 'my-gw': EXISTING },
      // 装配位折档缺席形（如 CREDENTIALS_NOT_FOUND 未折）——流程侧如实呈半应用
      removeBinding: () => ({
        ok: false,
        text: 'CREDENTIALS_NOT_FOUND：凭证 my-gw 不在 global 域——运行 /credentials list 查看全部凭证。',
      }),
    });
    await runSetupWizard(deps);
    expect(log.removedChannels).toEqual(['my-gw']); // settings 照删（第二步不被首败拦）
    const outro = recorded.outros.at(-1)!;
    expect(outro.title).not.toBe('已删除'); // 不再恒成功
    expect(outro.lines.join('\n')).toContain('CREDENTIALS_NOT_FOUND'); // 失败原因在场
  });

  it('半应用诚实呈报：settings 写败 → outro 呈未完全成功 + 补齐路径（修前红：恒「已删除」）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_delete__'],
      confirm: [true],
    });
    const { deps } = makeDeps(prompter, {
      customChannels: { 'my-gw': EXISTING },
      removeCustomChannel: () => ({ ok: false, text: 'settings.json 写入被拒' }),
    });
    await runSetupWizard(deps);
    const outro = recorded.outros.at(-1)!;
    expect(outro.title).not.toBe('已删除');
    expect(outro.lines.join('\n')).toContain('写入被拒');
  });

  it('编辑重入撞内置保留字（清单陈化窗防御）→ 表单前复验诚实收场 + 指路手编（修前红：existing 直取零校验）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:anthropic', '__entry_edit__'],
    });
    const { deps, log } = makeDeps(prompter, {
      // 分桶判据已排除撞名条入自定义桶——本测锁「清单陈化窗」纵深（开向导后
      // settings 被外改的防御位）：撞内置 id 的 existing 条进表单前复验拒入
      customChannels: { anthropic: EXISTING },
    });
    await runSetupWizard(deps);
    expect(log.savedBindings).toEqual([]); // 零写
    const outro = recorded.outros.at(-1)!;
    expect(outro.lines.join('\n')).toContain('内置渠道重名');
    expect(outro.lines.join('\n')).toContain('settings.json'); // 指路手编清除
  });

  it('活注册拒注回执（R-1 执法单源消费位）→ 注册注记「注册被拒」+ 换 id 指路（修前红：void 回执无消费恒「已注册」）', async () => {
    // 新建腿全走脚本（headers 拒 / 保存允 / 切模型拒——与新建 describe 的
    // NEW_SCRIPT 同形，本 describe 局部复制）。#1 后拒注不问切模型——第三答
    // 不再被消费（冗余位保留无害）
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter, {
      registerCustomProvider: (id) => ({ ok: false, reason: `渠道 id「${id}」已被内置渠道或其他渠道占用` }),
    });
    await runSetupWizard(deps);
    expect(log.savedChannels).toHaveLength(1); // 两写已成（配置已持久）
    const outro = recorded.outros.at(-1)!;
    expect(outro.lines.join('\n')).toContain('注册被拒');
    expect(outro.lines.join('\n')).toContain('已被'); // 拒注原因在场
  });
});

/* ---------------- R-3 体验批（busy/重问/同锚 ✓/探针/指路/标记/容忍/清除/name 透传） ---------------- */

describe('R-3 体验批（busy 可选法 + 坏形重问 + ✓ 判据同锚 + 可选探针 + 指路 + （当前）标记 + 全角容忍 + headers 清除 + name 透传）', () => {
  /** 带 busy 记录的假件（busy 调用/清除账面——showBusy 消费断言位） */
  function makeBusyPrompter(script: ScriptedAnswers): {
    prompter: WizardPrompter;
    busyLog: { label: string; cleared: boolean }[];
    recorded: ReturnType<typeof makePrompter>['recorded'];
  } {
    const base = makePrompter(script);
    const busyLog: { label: string; cleared: boolean }[] = [];
    const prompter: WizardPrompter = {
      ...base.prompter,
      busy(label: string): () => void {
        const entry = { label, cleared: false };
        busyLog.push(entry);
        return () => {
          entry.cleared = true;
        };
      },
    };
    return { prompter, busyLog, recorded: base.recorded };
  }

  it('busy 消费：拉取步呈现忙行 + finally 恒清（异常路径也清——D6 裁决）', async () => {
    // 异常形：fetchModels 抛——busy 清除必须仍发生（finally 面）
    const { prompter, busyLog } = makeBusyPrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      confirm: [],
    });
    const { deps } = makeDeps(prompter, {
      fetchModels: () => Promise.reject(new Error('网络腿炸')),
    });
    // 流程件不捕 fetchModels 异常（safeCall 只包写腿）——向上抛出前 finally 已清
    await expect(runSetupWizard(deps)).rejects.toThrow('网络腿炸');
    expect(busyLog.length).toBe(1); // 拉取步恰一次忙行
    expect(busyLog[0]?.label).toContain('拉取');
    expect(busyLog[0]?.cleared).toBe(true); // 异常路径 finally 恒清（D6）
  });

  it('busy 可选法缺席 = no-op（假 prompter 无 busy 不炸——07 §4.1 ob-3 定形注 R-3 裁决）', async () => {
    // makePrompter 假件不带 busy——NEW_SCRIPT 全流程直跑（拉取步 showBusy 无炸）
    const { prompter } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key', 'g1'],
      confirm: [false, true, false, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.savedChannels).toHaveLength(1); // 全流程走通零炸
  });

  it('✓ 判据同锚：credentialReadyOf 注入回 true 而 currentApiKeyOf undefined → 官方桶仍标 ✓（env 供血渠道诚实呈已配置）', async () => {
    const { prompter, recorded } = makePrompter({ select: [undefined] }); // 首问取消即出
    const { deps } = makeDeps(prompter, {
      currentApiKeyOf: () => undefined, // 绑定性判据下不 configured
      credentialReadyOf: (providerId) => providerId === 'anthropic', // env 供血同锚判据
    });
    await runSetupWizard(deps);
    const bucketSelect = recorded.selects[0]!;
    const anthropicItem = bucketSelect.items.find((item) => item.id === 'official:anthropic');
    expect(anthropicItem?.label).toContain('✓'); // 同锚判据生效（修前：currentApiKeyOf undefined 不标）
    const otherItem = bucketSelect.items.find((item) => item.id === 'official:openai');
    expect(otherItem?.label).not.toContain('✓');
  });

  it('（当前）标记 + 自定义桶预选：currentProvider 命中自定义渠道 → label 标（当前）+ preselect 落自定义桶项', async () => {
    const { prompter, recorded } = makePrompter({ select: [undefined] });
    const { deps } = makeDeps(prompter, {
      customChannels: { 'my-gw': { protocol: 'openai-completions', baseUrl: 'https://x.test/v1', models: ['m1'] } },
      currentProvider: 'my-gw',
    });
    await runSetupWizard(deps);
    const bucketSelect = recorded.selects[0]!;
    expect(bucketSelect.preselect).toBe('custom:my-gw'); // 修前：仅官方桶命中才预选（custom 桶永落首项）
    expect(bucketSelect.items.find((item) => item.id === 'custom:my-gw')?.label).toContain('（当前）');
  });

  it('手填全角逗号容忍 + Set 去重保序（R-3——中文输入法高频形）', async () => {
    const { prompter } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key', 'a，b, a, c，b'],
      confirm: [false, true, false, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.savedChannels[0]?.def.models).toEqual(['a', 'b', 'c']); // 全角分 + 去重保序
  });

  it('headers：编辑腿空录入 = 清除（confirm 回执「已清除」行）+ confirm 答否 = 不动（保留原值）', async () => {
    const EXISTING_HEADERS: CustomProviderDef = {
      protocol: 'openai-completions',
      baseUrl: 'https://gw.test/v1',
      models: ['m1'],
      headers: { 'X-Upstream': 'beta', 'X-Region': 'eu' },
    };
    // 清除路：headers 问允 + 空录入
    const cleared = makePrompter({
      select: ['custom:my-gw', '__entry_edit__', 'openai-completions', '__models_manual__'],
      text: ['', '', '', ''],
      confirm: [true, true, false, false],
    });
    const depsC = makeDeps(cleared.prompter, {
      customChannels: { 'my-gw': EXISTING_HEADERS },
      currentApiKeyOf: () => 'sk-current',
    });
    await runSetupWizard(depsC.deps);
    expect(depsC.log.savedChannels[0]?.def.headers).toBeUndefined(); // 清除落库
    expect(
      cleared.recorded.confirms.find((c) => c.title.includes('更新自定义渠道'))?.lines?.join('\n') ?? '',
    ).toContain('清除（原 2 条）'); // 回执诚实呈
    // 不动路：headers 问答否 → 原值保留
    const kept = makePrompter({
      select: ['custom:my-gw', '__entry_edit__', 'openai-completions', '__models_manual__'],
      text: ['', '', '', ''],
      confirm: [false, true, false, false],
    });
    const depsK = makeDeps(kept.prompter, {
      customChannels: { 'my-gw': EXISTING_HEADERS },
      currentApiKeyOf: () => 'sk-current',
    });
    await runSetupWizard(depsK.deps);
    expect(depsK.log.savedChannels[0]?.def.headers).toEqual({ 'X-Upstream': 'beta', 'X-Region': 'eu' });
  });

  it('name 编辑重入透传（修前红：draft 构造丢 existing.def.name——保存后展示名回落 id）', async () => {
    const EXISTING_NAMED: CustomProviderDef = {
      name: '我的中转站',
      protocol: 'openai-completions',
      baseUrl: 'https://gw.test/v1',
      models: ['m1'],
    };
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_edit__', 'openai-completions', '__models_manual__'],
      text: ['', '', '', ''],
      confirm: [false, true, false, false],
    });
    const { deps, log } = makeDeps(prompter, {
      customChannels: { 'my-gw': EXISTING_NAMED },
      currentApiKeyOf: () => 'sk-current',
    });
    await runSetupWizard(deps);
    expect(log.savedChannels[0]?.def.name).toBe('我的中转站'); // 修前红：name 丢失
    // confirm 回执「名称」行在场（全值回执诚实面）
    expect(recorded.confirms.find((c) => c.title.includes('更新自定义渠道'))?.lines?.join('\n') ?? '').toContain(
      '我的中转站',
    );
  });

  it('保存后可选探针：问句允 → probe 调用 + 回执行（拒绝注册渠道不问——无可探目标）', async () => {
    // 允路：探针问句在切模型问句后（confirm 序：headers 拒/保存允/切模型拒/探针允）
    const probed = makeBusyPrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a', 'gw-a'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false, true, false, true],
    });
    const depsP = makeDeps(probed.prompter, {
      // 默认 probe 桩即 {ok:true, detail:'应答正常'} 且记 probeCalls——
      // 勿覆写成不记 log 的裸桩（本锁首版即栽在此：probeCalls 恒空）
      probeModelOf: (providerId) => `${providerId}/gw-a`,
    });
    await runSetupWizard(depsP.deps);
    expect(depsP.log.probeCalls).toContainEqual(['my-relay', 'sk-gw-key']); // R-3 自定义腿探针调用
    expect(probed.recorded.outros.at(-1)?.lines.join('\n')).toContain('连通验证：通过'); // 回执行（U4 话术：探针→验证，随真态翻档）
  });

  it('切模型答否指路 ctrl+p（R-3——不当场切也要知道怎么切）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false, true, false, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.switched).toEqual([]); // 答否未切
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('ctrl+p'); // 指路行在场（修前：静默）
  });
});

/* ---------------- 评审修复役 Lane A 批（#1/#4/#5/#9/#15/#16/#24/#27/#28/#29/#31 + 纯锁 #7/#8/#10） ---------------- */

describe('评审修复役 Lane A：门与 ✓ 同锚（#1/#15）', () => {
  it('#1 拒注不问切模型：registrationOk=false 且 models 非空 → 无「立即切换」题且 switchModel 零调用（修前红：切模型门只看 models 非空——「注册被拒」+「已切换模型」自相矛盾回执）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false /** headers 拒 */, true /** 保存允 */, true /** 切模型位（修后不消费） */],
    });
    const { deps, log } = makeDeps(prompter, {
      registerCustomProvider: (id) => ({ ok: false, reason: `渠道 id「${id}」已被占用` }),
    });
    await runSetupWizard(deps);
    expect(recorded.confirms.some((c) => c.title.includes('立即切换'))).toBe(false);
    expect(log.switched).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).not.toContain('已切换'); // 拒注回执不再并存切换行
  });

  it('#15 自定义桶 ✓ 同锚：credentialReadyOf 真 → custom: 条目 label 含 ✓、假 → 无（修前红：自定义桶恒无标记——与官方桶判据呈现不一致）', async () => {
    const { prompter, recorded } = makePrompter({ select: [undefined] });
    const { deps } = makeDeps(prompter, {
      customChannels: {
        'my-gw': { protocol: 'openai-completions', baseUrl: 'https://x.test/v1', models: ['m1'] },
        'other-gw': { protocol: 'anthropic-messages', baseUrl: 'https://y.test', models: [] },
      },
      credentialReadyOf: (providerId) => providerId === 'my-gw',
    });
    await runSetupWizard(deps);
    const items = recorded.selects[0]!.items;
    expect(items.find((item) => item.id === 'custom:my-gw')?.label).toContain('✓');
    expect(items.find((item) => item.id === 'custom:other-gw')?.label).not.toContain('✓');
  });
});

describe('评审修复役 Lane A：headers 面（#4/#5/#9/#27）', () => {
  it('#4/#9 缺席分支：新建无 headers + 空录入 → 问句「添加」语义且保存回执无「清除」行（修前红：「清除（原 0 条）」误导行在场——无从清除）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-k', 'g1', ''],
      confirm: [true /** headers 问允（空录入） */, true /** 保存允 */, false /** 切模型拒 */],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    const headersConfirm = recorded.confirms.find((c) => c.title.includes('请求头'))!;
    expect(headersConfirm.title).toContain('添加'); // 缺席分支「添加」语义
    expect(headersConfirm.lines?.join('\n') ?? '').not.toContain('当前（'); // 无当前 N 条行
    const saveConfirm = recorded.confirms.find((c) => c.title.includes('保存自定义渠道'))!;
    expect(saveConfirm.lines?.join('\n') ?? '').not.toContain('清除'); // #4 修前红位
    expect(log.savedChannels[0]?.def.headers).toBeUndefined();
  });

  it('#9 在场分支：问句「编辑/清除」语义 + 当前 N 条直呈（纯锁）', async () => {
    const EXISTING_HEADERS: CustomProviderDef = {
      protocol: 'openai-completions',
      baseUrl: 'https://gw.test/v1',
      models: ['m1'],
      headers: { 'X-Upstream': 'beta', 'X-Region': 'eu' },
    };
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_edit__', 'openai-completions', '__models_manual__'],
      text: ['', '', '', ''],
      confirm: [false, true, false, false],
    });
    const { deps } = makeDeps(prompter, {
      customChannels: { 'my-gw': EXISTING_HEADERS },
      currentApiKeyOf: () => 'sk-current',
    });
    await runSetupWizard(deps);
    const headersConfirm = recorded.confirms.find((c) => c.title.includes('请求头'))!;
    expect(headersConfirm.title).toContain('编辑/清除'); // 在场分支「编辑/清除」语义
    const lines = headersConfirm.lines?.join('\n') ?? '';
    expect(lines).toContain('当前（2 条）'); // 当前 N 条直呈
    expect(lines).toContain('X-Upstream: beta, X-Region: eu');
  });

  it('#5 坏形重问：无冒号录入 → headers 题两次 + 第二次 hint 点名格式（修前红：坏形静默折「保持当前值」直进 confirm 无错因）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-k', 'g1', 'X-Upstream beta', 'X-Upstream: beta'],
      confirm: [true, true, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    const headersTexts = recorded.texts.filter((t) => t.title.includes('请求头'));
    expect(headersTexts).toHaveLength(2); // 坏形重问当前步（修前：1 次）
    expect(headersTexts[1]?.hint ?? '').toContain('格式'); // 错因点名
    expect(log.savedChannels[0]?.def.headers).toEqual({ 'X-Upstream': 'beta' }); // 二次好形采
  });

  it('#27 全角逗号/全角冒号容忍：恰两条键值不污染（修前红：split 只半角——整串成一条、值被污染/坏形折 undefined 静默）', async () => {
    // 全角逗号：修前 {'X-A': '1，X-B: 2'} 一条值污染
    const comma = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-k', 'g1', 'X-A: 1，X-B: 2'],
      confirm: [true, true, false],
    });
    const depsComma = makeDeps(comma.prompter);
    await runSetupWizard(depsComma.deps);
    expect(depsComma.log.savedChannels[0]?.def.headers).toEqual({ 'X-A': '1', 'X-B': '2' });

    // 全角冒号：修前半角探测不中 → 坏形折 undefined 静默
    const colon = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-k', 'g1', 'X-A：1, X-B: 2'],
      confirm: [true, true, false],
    });
    const depsColon = makeDeps(colon.prompter);
    await runSetupWizard(depsColon.deps);
    expect(depsColon.log.savedChannels[0]?.def.headers).toEqual({ 'X-A': '1', 'X-B': '2' });
  });
});

describe('评审修复役 Lane A：表单录入加固（#28/#29/#31）', () => {
  it('#28 手填清单换行分隔：a\\nb，c → [a,b,c]（修前红：换行入 id 成含内嵌换行的垃圾条——粘贴一行一模型清单不可用）', async () => {
    const { prompter } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-k', 'a\nb，c'],
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.savedChannels[0]?.def.models).toEqual(['a', 'b', 'c']);
  });

  it('#29 key 含内嵌换行拒：重问 + hint 点名「换行」（修前红：换行 key 直落凭证行——运行时请求头拼装炸英文 TypeError）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-a\nsk-b', 'sk-ok', 'g1'],
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    const keyTexts = recorded.texts.filter((t) => t.title.includes('API key'));
    expect(keyTexts).toHaveLength(2); // 换行拒重问当前步（修前：1 次）
    expect(keyTexts[1]?.hint ?? '').toContain('换行'); // 错因点名
    expect(log.savedBindings[0]?.apiKey).toBe('sk-ok'); // 二次好形采
  });

  it('#31 Base URL 真校验：空宿主（https://）与查询串形（https://?q=1）重问、完整地址过（修前红：^https?:// 前缀正则放行两形）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_manual__'],
      text: ['my-relay', 'https://', 'https://?q=1', 'https://gw.test/v1', 'sk-live', 'g1'],
      confirm: [false, true, false],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    const urlTexts = recorded.texts.filter((t) => t.title === 'Base URL');
    expect(urlTexts).toHaveLength(3); // 两坏形重问 + 一好形
    expect(urlTexts[1]?.hint ?? '').toContain('完整'); // 错因点名
    expect(log.savedChannels[0]?.def.baseUrl).toBe('https://gw.test/v1');
  });
});

describe('评审修复役 Lane A：回执诚实面（#16/#24）', () => {
  it('#16 删除腿别名行提醒：成功 outro 含「别名」与 credentials rm 指路（修前红：别名绑行成孤儿静默——重建同名渠道旧 key 复活）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_delete__'],
      confirm: [true],
    });
    const { deps } = makeDeps(prompter, {
      customChannels: { 'my-gw': { protocol: 'openai-completions', baseUrl: 'https://gw.test/v1', models: ['m1'] } },
    });
    await runSetupWizard(deps);
    const outro = recorded.outros.at(-1)!;
    expect(outro.title).toBe('已删除');
    expect(outro.lines.join('\n')).toContain('别名');
    expect(outro.lines.join('\n')).toContain('credentials rm');
  });

  it('#24 半应用指路可达：settings 写败 → 「未落库」+「/setup 重新配置」（修前红：指路「重入该渠道（编辑配置）」不可达——渠道未落库重入清单无此条）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false, true],
    });
    const { deps, log } = makeDeps(prompter, {
      saveCustomChannel: () => ({ ok: false, text: 'settings.json 写入被拒' }),
    });
    await runSetupWizard(deps);
    expect(log.savedBindings).toHaveLength(1); // 凭证行已成（写序第一步）
    const outro = recorded.outros.at(-1)!;
    expect(outro.title).toContain('部分完成');
    expect(outro.lines.join('\n')).toContain('未进渠道清单');
    expect(outro.lines.join('\n')).toContain('重新配置');
    expect(outro.lines.join('\n')).not.toContain('编辑配置'); // 不可达指路退役
  });
});

describe('评审修复役 Lane A：补锁面（#7/#8/#10——既有行为零锁位纯锁）', () => {
  it('#7 multiselect preselect = 既有清单 ∩ 拉取结果（gw-x 不在拉取结果被滤出 preselect）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['custom:my-gw', '__entry_edit__', 'openai-completions', '__models_fetch__'],
      text: ['', ''], // baseUrl/key 空录入全沿用
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false, true, false],
    });
    const { deps } = makeDeps(prompter, {
      customChannels: {
        'my-gw': { protocol: 'openai-completions', baseUrl: 'https://gw.test/v1', models: ['gw-a', 'gw-x'] },
      },
      currentApiKeyOf: () => 'sk-current',
    });
    await runSetupWizard(deps);
    expect(recorded.multiselects[0]?.preselect).toEqual(['gw-a']); // 交集滤（gw-x 出局）
  });

  it('#8 ①currentProvider 命中官方桶 → label（当前）②不在任何桶（如已删渠道 id）→ preselect 缺席', async () => {
    const current = makePrompter({ select: [undefined] });
    const depsC = makeDeps(current.prompter, { currentProvider: 'anthropic' });
    await runSetupWizard(depsC.deps);
    expect(current.recorded.selects[0]!.items.find((item) => item.id === 'official:anthropic')?.label).toContain(
      '（当前）',
    );

    const ghost = makePrompter({ select: [undefined] });
    const depsG = makeDeps(ghost.prompter, { currentProvider: 'ghost-gone' });
    await runSetupWizard(depsG.deps);
    expect(ghost.recorded.selects[0]?.preselect).toBeUndefined(); // 三元链 undefined 分支
  });

  it('#10 探针门槛 false 分支：①拒注（registrationOk=false）不问 ②probe 注入缺席不问', async () => {
    const rejected = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false, true, false],
    });
    const depsR = makeDeps(rejected.prompter, {
      registerCustomProvider: (id) => ({ ok: false, reason: `渠道 id「${id}」已被占用` }),
    });
    await runSetupWizard(depsR.deps);
    expect(rejected.recorded.confirms.some((c) => c.title.includes('顺手探'))).toBe(false); // 拒注不问
    expect(depsR.log.probeCalls).toEqual([]);

    const noProbe = makePrompter({
      select: ['__new_custom__', 'openai-completions', '__models_fetch__', 'gw-a'],
      text: ['my-relay', 'https://gw.test/v1', 'sk-gw-key'],
      multiselect: [['gw-a'] as readonly string[]],
      confirm: [false, true, false],
    });
    const depsN = makeDeps(noProbe.prompter, { probe: undefined });
    await runSetupWizard(depsN.deps);
    expect(noProbe.recorded.confirms.some((c) => c.title.includes('顺手探'))).toBe(false); // probe 缺席不问
  });
});
