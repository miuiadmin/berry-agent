/**
 * /setup 配置向导流程件测试（onboarding ob-3——07 §4.1 定形 + 改裁注）：
 * 假 prompter 直锁全流程分支（contract-first——本测试先于实现落红）。
 *
 * 锁面：三步主流程（清单选 provider / 敏感录入 / confirm 落绑定行）、
 * 手录自定义尾项、剥 export 前缀、重入默认值（空录入沿用）、env 遮蔽预警、
 * 探针三结局（通过/失败不阻断/跳过注记）、Esc 任意步中止零保存、保存失败档。
 * 禁断言 AI 生成文本——本面全为静态文案，锁结构不锁逐字（关键锚词断言除外）。
 */
import { describe, expect, it } from 'vitest';
import type {
  WizardConfirmRequest,
  WizardPrompter,
  WizardSelectRequest,
  WizardTextRequest,
} from '../channels/index.js';
import { maskKeyPreview, runSetupWizard, type SetupWizardDeps, type SetupWizardSaveResult } from './setup-wizard.js';

/** 假 prompter：脚本化应答队列 + 全调用记录（流程分支直锁） */
interface ScriptedAnswers {
  readonly select?: (string | undefined)[];
  readonly text?: (string | undefined)[];
  readonly confirm?: (boolean | undefined)[];
}

interface Recorded {
  readonly selects: WizardSelectRequest[];
  readonly texts: WizardTextRequest[];
  readonly confirms: WizardConfirmRequest[];
  readonly intros: { title: string; lines: readonly string[] }[];
  readonly outros: { title: string; lines: readonly string[] }[];
}

function makePrompter(script: ScriptedAnswers): { prompter: WizardPrompter; recorded: Recorded } {
  const selects = [...(script.select ?? [])];
  const texts = [...(script.text ?? [])];
  const confirms = [...(script.confirm ?? [])];
  const recorded: Recorded = {
    selects: [],
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

/** 标准依赖装配（saveBinding 记录调用——单源路由断言面） */
function makeDeps(
  prompter: WizardPrompter,
  overrides: Partial<SetupWizardDeps> = {},
): { deps: SetupWizardDeps; saved: { providerId: string; apiKey: string }[]; probeCalls: string[][] } {
  const saved: { providerId: string; apiKey: string }[] = [];
  const probeCalls: string[][] = [];
  const deps: SetupWizardDeps = {
    prompter,
    providers: ['anthropic', 'openai'],
    envShadowed: () => false,
    saveBinding: (providerId, apiKey) => {
      saved.push({ providerId, apiKey });
      return { ok: true, text: `已录入凭证 host/${providerId}` } satisfies SetupWizardSaveResult;
    },
    probeModelOf: () => 'anthropic/claude-sonnet-5',
    probe: (providerId, apiKey) => {
      probeCalls.push([providerId, apiKey]);
      return Promise.resolve({ ok: true, detail: '应答正常' });
    },
    ...overrides,
  };
  return { deps, saved, probeCalls };
}

describe('maskKeyPreview（头4尾4预览）', () => {
  it('长值呈头4尾4形', () => {
    expect(maskKeyPreview('sk-ant-1234wxyz9')).toBe('sk-a…xyz9');
  });
  it('短值（≤8 字符）全遮不泄', () => {
    expect(maskKeyPreview('short')).toBe('…');
    expect(maskKeyPreview('12345678')).toBe('…');
  });
});

describe('stripExportPrefix（整行粘贴容错）', () => {
  it('剥 export VAR= 前缀', async () => {
    const { stripExportPrefix } = await import('./setup-wizard.js');
    expect(stripExportPrefix('export ANTHROPIC_API_KEY=sk-abc')).toBe('sk-abc');
    expect(stripExportPrefix('export MY_KEY = "sk-quoted"')).toBe('sk-quoted');
  });
  it('无前缀原样透传（含包裹引号剥离）', async () => {
    const { stripExportPrefix } = await import('./setup-wizard.js');
    expect(stripExportPrefix('sk-plain')).toBe('sk-plain');
    expect(stripExportPrefix("'sk-single'")).toBe('sk-single');
  });
});

describe('runSetupWizard 主流程', () => {
  it('三步全走：清单选 provider → 录 key → 落绑定行 + 探针跳过注记（probe 缺席）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['openai'],
      text: ['sk-openai-new'],
      confirm: [true],
    });
    const { deps, saved } = makeDeps(prompter, { probe: undefined });
    await runSetupWizard(deps);
    // 选择面：清单 + 手录尾项
    expect(recorded.selects[0]?.items.map((item) => item.id)).toEqual([
      'anthropic',
      'openai',
      expect.stringMatching(/manual/) as unknown as string,
    ]);
    // 敏感录入面：掩码位 + 提示在场
    expect(recorded.texts[0]?.sensitive).toBe(true);
    // 落绑定行：行名 = providerId（单源路由断言）
    expect(saved).toEqual([{ providerId: 'openai', apiKey: 'sk-openai-new' }]);
    // 回执：保存文本 + 跳过注记（probe 缺席 = 无注册模型可探形）
    const outro = recorded.outros.at(-1)!;
    expect(outro.lines.join('\n')).toContain('已录入凭证 host/openai');
    expect(outro.lines.join('\n')).toContain('未验证');
  });

  it('手录自定义尾项：text 输入斜杠整模型形取首段', async () => {
    const { prompter } = makePrompter({
      select: ['__manual_provider__'],
      text: ['my-gateway/my-model', 'sk-custom'],
      confirm: [true],
    });
    const { deps, saved } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(saved).toEqual([{ providerId: 'my-gateway', apiKey: 'sk-custom' }]);
  });

  it('剥 export VAR= 前缀后落行（粘贴容错）', async () => {
    const { prompter } = makePrompter({
      select: ['anthropic'],
      text: ['export ANTHROPIC_API_KEY=sk-ant-tail'],
      confirm: [true],
    });
    const { deps, saved } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(saved).toEqual([{ providerId: 'anthropic', apiKey: 'sk-ant-tail' }]);
  });

  it('重入默认值：currentApiKey 在场 → 预览呈 + 空录入沿用原值', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['anthropic'],
      text: [''],
      confirm: [true],
    });
    const { deps, saved } = makeDeps(prompter, { currentApiKey: 'sk-old-value-9999' });
    await runSetupWizard(deps);
    // 预览呈头4尾4形（值不入面）
    expect(recorded.texts[0]?.preview).toBe(maskKeyPreview('sk-old-value-9999'));
    // 空录入 = 沿用当前值
    expect(saved).toEqual([{ providerId: 'anthropic', apiKey: 'sk-old-value-9999' }]);
  });

  it('currentProvider 在册 → select 预选（重入光标位）', async () => {
    const { prompter, recorded } = makePrompter({ select: ['openai'], text: ['sk-x'], confirm: [true] });
    const { deps } = makeDeps(prompter, { currentProvider: 'openai' });
    await runSetupWizard(deps);
    expect(recorded.selects[0]?.preselect).toBe('openai');
  });

  it('env 遮蔽预警：confirm 拒 → 中止零保存', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['anthropic'],
      confirm: [false],
    });
    const { deps, saved } = makeDeps(prompter, { envShadowed: () => true });
    await runSetupWizard(deps);
    // 遮蔽预警先于录入
    expect(recorded.confirms[0]?.title).toContain('遮蔽');
    expect(saved).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('未改动');
  });

  it('env 遮蔽预警：confirm 允 → 照常录入落行（confirm 队列两笔：遮蔽允 + 落行允）', async () => {
    const { prompter } = makePrompter({ select: ['anthropic'], confirm: [true, true], text: ['sk-shadowed'] });
    const { deps, saved } = makeDeps(prompter, { envShadowed: () => true });
    await runSetupWizard(deps);
    expect(saved).toEqual([{ providerId: 'anthropic', apiKey: 'sk-shadowed' }]);
  });

  it('Esc 取消选择步 → outro 已退出 + 零保存', async () => {
    const { prompter, recorded } = makePrompter({ select: [undefined] });
    const { deps, saved } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(saved).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('未改动');
  });

  it('Esc 取消录入步 → 零保存（选择步已答不回滚——凭证表未动即诚实）', async () => {
    const { prompter } = makePrompter({ select: ['anthropic'], text: [undefined] });
    const { deps, saved } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(saved).toEqual([]);
  });

  it('空录入且无当前值 → 未配置收场零保存', async () => {
    const { prompter, recorded } = makePrompter({ select: ['anthropic'], text: ['  '] });
    const { deps, saved } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(saved).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('未录入');
  });

  it('保存 confirm 拒 → 零保存收场', async () => {
    const { prompter } = makePrompter({ select: ['anthropic'], text: ['sk-v'], confirm: [false] });
    const { deps, saved } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(saved).toEqual([]);
  });

  it('保存失败档（saveBinding ok:false）→ 回执失败不进探针', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['anthropic'],
      text: ['sk-v'],
      confirm: [true],
    });
    const { probeCalls } = { probeCalls: [] as string[][] };
    const deps: SetupWizardDeps = {
      prompter,
      providers: ['anthropic'],
      envShadowed: () => false,
      saveBinding: () => ({ ok: false, text: 'PERSIST_SECRET_UNREADABLE：密钥腐坏' }),
      probe: () => {
        probeCalls.push(['unexpected']);
        return Promise.resolve({ ok: true, detail: '' });
      },
    };
    await runSetupWizard(deps);
    expect(recorded.outros.at(-1)?.title).toContain('失败');
    expect(probeCalls).toEqual([]);
  });
});

describe('runSetupWizard 连通微探针（可选步三结局——失败不阻断）', () => {
  it('verify 允 + 探针过 → 回执含验证通过', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['anthropic'],
      text: ['sk-ok'],
      confirm: [true, true],
    });
    const { deps, probeCalls } = makeDeps(prompter);
    await runSetupWizard(deps);
    // 探针收新录 key + 探针目标模型入 confirm 题
    expect(probeCalls).toEqual([['anthropic', 'sk-ok']]);
    expect(recorded.confirms[1]?.title).toContain('anthropic/claude-sonnet-5');
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('验证通过');
  });

  it('verify 允 + 探针败 → 配置已保存 + 未验证注记（不阻断）', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['anthropic'],
      text: ['sk-bad'],
      confirm: [true, true],
    });
    const { deps, saved } = makeDeps(prompter, {
      probe: () => Promise.resolve({ ok: false, detail: '[401] invalid x-api-key' }),
    });
    await runSetupWizard(deps);
    expect(saved).toEqual([{ providerId: 'anthropic', apiKey: 'sk-bad' }]);
    const receipt = recorded.outros.at(-1)!.lines.join('\n');
    expect(receipt).toContain('401');
    expect(receipt).toContain('已保存');
  });

  it('verify 拒（稍后）→ 已跳过注记 + 探针零调用', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['anthropic'],
      text: ['sk-v'],
      confirm: [true, false],
    });
    const { deps, probeCalls } = makeDeps(prompter);
    await runSetupWizard(deps);
    expect(probeCalls).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('已跳过');
  });

  it('provider 无注册模型（probeModelOf undefined）→ 跳过注记不问 verify', async () => {
    const { prompter, recorded } = makePrompter({
      select: ['empty-provider'],
      text: ['sk-v'],
      confirm: [true],
    });
    const { deps, probeCalls } = makeDeps(prompter, { probeModelOf: () => undefined });
    await runSetupWizard(deps);
    // 只一笔 confirm（落行）——探针步结构性缺席
    expect(recorded.confirms).toHaveLength(1);
    expect(probeCalls).toEqual([]);
    expect(recorded.outros.at(-1)?.lines.join('\n')).toContain('未验证');
  });
});
