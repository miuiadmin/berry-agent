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
      return { ok: true, text: `渠道配置已持久化（customProviders.${id}）` } satisfies SetupWizardSaveResult;
    },
    removeCustomChannel: (id) => {
      log.removedChannels.push(id);
      return { ok: true, text: `渠道配置已移除（customProviders.${id}）` } satisfies SetupWizardSaveResult;
    },
    registerCustomProvider: (id, def) => {
      log.registered.push({ id, def });
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
    expect(items).toEqual(['official:anthropic', 'official:openai', 'custom:my-gw', '__new_custom__']);
    // 官方桶 desc 位：已配置键带 ✓ + baseUrl；未配置键裸 baseUrl
    const first = recorded.selects[0]!.items[0]!;
    expect(first.label).toContain('✓');
    expect(first.desc).toContain('https://api.anthropic.com');
    expect(recorded.selects[0]!.items[1]!.label).not.toContain('✓');
    // 自定义桶 desc：协议 · baseUrl · 模型数
    expect(recorded.selects[0]!.items[2]!.desc).toContain('OpenAI 兼容');
    expect(recorded.selects[0]!.items[2]!.desc).toContain('模型 1 个');
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
    // 「沿用当前值」判据随 providerId 走（confirm 附呈行——非 title）
    expect(recorded.confirms[0]?.lines?.join('\n')).toContain('沿用当前值');
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
    expect(rejected.recorded.confirms[0]?.title).toContain('遮蔽');
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
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('当场生效');
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

  it('渠道 id 三坏形：非 slug / 撞内置保留字 / 撞既有自定义——各自诚实收场零写', async () => {
    for (const [badId, expectWord] of [
      ['My_Relay', '坏形'],
      ['anthropic', '撞名'],
      ['existing-gw', '已存在'],
    ] as const) {
      const { prompter, recorded } = makePrompter({
        select: ['__new_custom__'],
        text: [badId],
      });
      const { deps, log } = makeDeps(prompter, {
        customChannels: { 'existing-gw': { protocol: 'openai-completions', baseUrl: 'https://x.test', models: [] } },
      });
      await runSetupWizard(deps);
      expect(log.savedBindings).toEqual([]);
      expect(log.savedChannels).toEqual([]);
      expect(recorded.outros.at(-1)?.lines.join('\n')).toContain(expectWord);
    }
  });

  it('Base URL 坏形（非 http(s) 开头）→ 诚实收场零写', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['__new_custom__', 'openai-completions'],
      text: ['my-relay', 'ftp://gw.test'],
    });
    const { deps, log } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(log.savedChannels).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('http');
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
    expect(outro.title).toContain('半应用');
    expect(outro.lines.join('\n')).toContain('编辑配置');
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
