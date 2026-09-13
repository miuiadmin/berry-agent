/**
 * host/plugins-config 表单腿测试（ix-3b/c——03 §1.2 表单条款 + 07 §4.3
 * 提问队列消费）。
 *
 * 纪律：mock 只停在问询面（scripted ask——通道行为面归 channels 域）与
 * 凭证盒（内存 Map）；行编辑真链（真 yaml 往返经 memFs 注入）。断言面：
 * 逐字段问答分流（四型→input/select〔boolean 亦 select 两值——s-9〕）/ secret 入盒不落 yaml +
 * credentials/changed 归因 / 未声明键透传 / 取消整次放弃（含 boolean 问询取消
 * s-9 修前红）/ required 两拒 /
 * 缺省烘焙回避 / 回执呈现纪律（secret 恒 '***'）。
 */
import { describe, expect, it } from 'vitest';

import type { CredentialChangedPayload } from '../credentials/index.js';
import type { UiInputOptions, UiSelectChoice } from '../contracts/index.js';

import type { ConfigField } from './config-schema.js';
import { readEnabledRowsForEdit } from './plugin-store.js';
import type { PluginStoreFs } from './plugin-store.js';
import { runPluginConfigForm } from './plugins-config.js';
import type { PluginConfigFormDeps } from './plugins-config.js';

/** 内存 fs（plugin-store.test 同形——真 yaml 往返零真盘） */
function memFs(initial: Record<string, string> = {}): PluginStoreFs {
  const files = new Map(Object.entries(initial));
  const isUnder = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
  return {
    read: (path) => files.get(path) ?? null,
    write: (path, text) => void files.set(path, text),
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, text);
    },
    mkdir: () => undefined,
    rm: (path) => {
      for (const key of [...files.keys()]) if (isUnder(key, path)) files.delete(key);
    },
    readdir: (path) => {
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(`${path}/`)) names.add(key.slice(path.length + 1).split('/')[0]!);
      }
      return names.size === 0 ? null : [...names];
    },
    size: (path) => {
      let total = 0;
      let hit = false;
      for (const [key, text] of files) {
        if (isUnder(key, path)) {
          total += Buffer.byteLength(text, 'utf8');
          hit = true;
        }
      }
      return hit ? total : null;
    },
  };
}

/** 问询脚本（Error 元素 = 该次问询拒绝——取消路径注入） */
interface AskScript {
  readonly inputs?: readonly (string | Error)[];
  readonly selects?: readonly string[];
}

/** 四型字段 fixture（声明面全集） */
const FIELDS: readonly ConfigField[] = [
  { key: 'endpoint', type: 'text', required: true, label: '端点' },
  { key: 'token', type: 'secret', required: false },
  {
    key: 'mode',
    type: 'select',
    default: 'fast',
    options: [
      { value: 'fast', label: '快' },
      { value: 'slow', label: '慢' },
    ],
  },
  { key: 'verbose', type: 'boolean', default: false },
];

/** 表单 rig：scripted ask + 内存凭证盒（写面全录）+ 计数 reload */
function rig(
  overrides: {
    readonly id?: string;
    readonly script?: AskScript;
    readonly fields?: readonly ConfigField[];
    readonly hostDefaults?: unknown;
    readonly enabledYaml?: string;
    readonly presetCredentials?: Record<string, string>;
    /** 第 2 次 setCredential 抛此错（落盘期半途异常注入——分档回执锁） */
    readonly failSecondCredentialWith?: Error;
  } = {},
) {
  const pluginId = overrides.id ?? 'demo';
  const dir = '/dd-plugins-config';
  const fs = memFs(overrides.enabledYaml === undefined ? {} : { [`${dir}/enabled.yaml`]: overrides.enabledYaml });
  const creds = new Map<string, { apiKey: string; meta?: unknown }>([
    ...Object.entries(overrides.presetCredentials ?? {}).map(([k, v]) => [k, { apiKey: v }] as const),
  ]);
  const writes: Array<[string, string, { apiKey: string; meta?: unknown }]> = [];
  const changes: CredentialChangedPayload[] = [];
  let reloads = 0;
  const script = overrides.script ?? {};
  const failSecondCredentialWith = overrides.failSecondCredentialWith;
  const calls = {
    inputs: [] as Array<[string, UiInputOptions | undefined]>,
    selects: [] as Array<[string, readonly UiSelectChoice[]]>,
  };
  let inIdx = 0;
  let selIdx = 0;
  const deps: PluginConfigFormDeps = {
    dataDir: dir,
    fs,
    configFaceOf: (id) =>
      id === pluginId ? { fields: overrides.fields ?? FIELDS, hostDefaults: overrides.hostDefaults } : undefined,
    ask: {
      input: async (message, opts) => {
        calls.inputs.push([message, opts]);
        const next = script.inputs?.[inIdx++] ?? '';
        if (next instanceof Error) throw next;
        return next;
      },
      select: async (message, choices) => {
        calls.selects.push([message, choices]);
        return script.selects?.[selIdx++] ?? choices[0]!.value;
      },
    },
    getCredential: (ns, name) => creds.get(`${ns}/${name}`),
    setCredential: (ns, name, entry) => {
      // 第 2 次入盒抛错（failSecondCredentialWith 在场时）——落盘半途注入
      if (failSecondCredentialWith !== undefined && writes.length === 1) throw failSecondCredentialWith;
      writes.push([ns, name, entry]);
      creds.set(`${ns}/${name}`, entry);
    },
    onCredentialChanged: (payload) => void changes.push(payload),
    requestReload: () => (reloads += 1),
  };
  return {
    deps,
    creds,
    writes,
    changes,
    calls,
    reloads: () => reloads,
    rows: () => {
      const read = readEnabledRowsForEdit(dir, fs);
      if (!read.ok) throw new Error(`坏行：${read.message}`);
      return read.rows;
    },
  };
}

describe('声明面缺席与前置拒', () => {
  it('无 configSchema → 诚实回执「无声明配置面」+ 零问询零写盘', async () => {
    const rig_ = rig();
    const out = await runPluginConfigForm('nope', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('无声明配置面');
    expect(rig_.calls.inputs).toEqual([]);
    expect(rig_.reloads()).toBe(0);
  });

  it('enabled.yaml 损坏 → fail-loud 拒（不写防覆盖）', async () => {
    const rig_ = rig({ enabledYaml: 'plugins: [~~broken' });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('损坏');
  });

  it('required text 空答无值 → 拒 + 零写盘零链', async () => {
    const rig_ = rig({ script: { inputs: [''] } });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('必填字段');
    expect(rig_.rows()).toEqual([]); // 文件缺席 = 行集空
    expect(rig_.writes).toEqual([]);
    expect(rig_.reloads()).toBe(0);
  });

  it('required secret 空答且凭证盒无现值 → 拒（诚实面：真实装载将拒载）', async () => {
    const rig_ = rig({
      fields: [
        { key: 'endpoint', type: 'text', required: true },
        { key: 'token', type: 'secret', required: true },
      ],
      script: { inputs: ['https://x', ''] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('必填 secret');
    expect(rig_.writes).toEqual([]);
    expect(rig_.reloads()).toBe(0);
  });
});

describe('四型字段全景（问询分流 + 落盘双落点）', () => {
  it('text/secret→input、boolean→select 两值（s-9）、select→select；secret 入盒不落 yaml', async () => {
    const rig_ = rig({
      enabledYaml: 'plugins:\n  - id: demo\n',
      // 问询序 = 字段序：mode 先、verbose 后——selects 两脚本轮到两问
      script: { inputs: ['https://x', 'sekret'], selects: ['slow', 'true'] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(true);
    // 问询分流四型（label 缺省 = key；required text 用 placeholder 缺席形）
    expect(rig_.calls.inputs).toHaveLength(2);
    expect(rig_.calls.inputs[0]![0]).toContain('端点'); // label 在场胜 key
    // boolean 问询 = select 两值（s-9——confirm 面取消不可辨，弃用）
    expect(rig_.calls.selects).toHaveLength(2);
    expect(rig_.calls.selects[1]![0]).toContain('verbose');
    expect(rig_.calls.selects[1]![1]).toEqual([
      { value: 'true', label: '开' },
      { value: 'false', label: '关' },
    ]);
    expect(rig_.calls.selects[0]![1]).toEqual((FIELDS[2] as { options: readonly UiSelectChoice[] }).options);
    // 行落盘：非 secret 三值（mode/verbose 偏离缺省故落行）——token 不落 yaml
    expect(rig_.rows()).toEqual([{ id: 'demo', config: { endpoint: 'https://x', mode: 'slow', verbose: true } }]);
    // 凭证盒：plugin:demo/config:token + meta source manual + 归因恰一笔
    expect(rig_.writes).toEqual([['plugin:demo', 'config:token', { apiKey: 'sekret', meta: { source: 'manual' } }]]);
    expect(rig_.changes).toEqual([{ namespace: 'plugin:demo', name: 'config:token', action: 'add', origin: 'human' }]);
    expect(rig_.reloads()).toBe(1);
    // 回执呈现纪律：明文与遮蔽
    expect(out.text).toContain('***（凭证盒，已更新）');
    expect(out.text).not.toContain('sekret');
    expect(out.text).toContain('endpoint = https://x');
    expect(out.text).toContain('已自动链 /reload');
  });

  it('text 空答保留现值（placeholder 承载）+ secret 空答保留现值（不重写盒）', async () => {
    const rig_ = rig({
      enabledYaml: 'plugins:\n  - id: demo\n    config:\n      endpoint: https://old\n',
      presetCredentials: { 'plugin:demo/config:token': 'existing-sekret' },
      script: { inputs: ['', ''], selects: ['fast', 'false'] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(true);
    // 现值 placeholder：text 承载现行值、secret 承载「留空保留现值」
    expect(rig_.calls.inputs[0]![1]).toEqual({ placeholder: 'https://old' });
    expect(rig_.calls.inputs[1]![1]).toEqual({ placeholder: '留空保留现值' });
    // 保留语义：endpoint 沿旧值；token 未重写（writes 空）；mode/verbose 随缺省不落
    expect(rig_.rows()).toEqual([{ id: 'demo', config: { endpoint: 'https://old' } }]);
    expect(rig_.writes).toEqual([]);
    expect(rig_.changes).toEqual([]);
    expect(rig_.reloads()).toBe(1); // 行重写（幂等归一）仍链——行在场照写律
    expect(out.text).toContain('***（凭证盒，保留现值）');
    expect(out.text).not.toContain('existing-sekret');
  });
});

describe('未声明键透传与缺省烘焙回避', () => {
  it('行内未声明键整值替换后原样透传（回执点名）', async () => {
    const rig_ = rig({
      enabledYaml:
        'plugins:\n  - id: demo\n    config:\n      endpoint: https://old\n      extra:\n        deep: true\n',
      script: { inputs: ['https://new', ''], selects: ['fast', 'false'] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(true);
    expect(rig_.rows()).toEqual([{ id: 'demo', config: { extra: { deep: true }, endpoint: 'https://new' } }]);
    expect(out.text).toContain('未声明键透传 1 个：extra');
  });

  it('行缺席全随缺省 → 不造 overlay 空行不链（缺省源不变即不落行）', async () => {
    const rig_ = rig({
      id: 'core:demo',
      fields: FIELDS.filter((f) => f.key !== 'endpoint'), // 去 required text——全随缺省场景
      script: { selects: ['fast', 'false'] },
    });
    const out = await runPluginConfigForm('core:demo', rig_.deps);
    expect(out.ok).toBe(true);
    expect(out.text).toContain('无变更');
    expect(rig_.rows()).toEqual([]); // 零 overlay 行
    expect(rig_.reloads()).toBe(0);
    expect(out.text).toContain('mode = fast'); // 回执仍呈现生效值
  });
});

describe('防御位（行缺席用户 id——真实面 configFaceOf 结构性不可达）', () => {
  it('全字段答毕后 setRowConfig 拒——回执指路先 mount（诚实拒非静默吞）', async () => {
    const rig_ = rig({ script: { inputs: ['https://x', ''], selects: ['fast', 'false'] } });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('先走 /plugins mount');
  });
});

describe('取消语义（整次放弃）', () => {
  it('任一问询拒绝 → 诚实回执 + 零写盘零凭证写零链（行写盘在全部问询后）', async () => {
    const rig_ = rig({
      enabledYaml: 'plugins:\n  - id: demo\n    config:\n      endpoint: https://old\n',
      script: { inputs: ['https://x', new Error('通道取消')] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('整次放弃');
    expect(out.text).toContain('通道取消');
    // 旧值原样未动（第二个问询拒——一切写盘未达）
    expect(rig_.rows()).toEqual([{ id: 'demo', config: { endpoint: 'https://old' } }]);
    expect(rig_.writes).toEqual([]);
    expect(rig_.reloads()).toBe(0);
  });

  it("select 问询取消（'' 保守值）→ 整次放弃——'' 不在值域，落行即写坏插件（修前红）", async () => {
    const rig_ = rig({
      enabledYaml: 'plugins:\n  - id: demo\n    config:\n      endpoint: https://old\n',
      // rig select 脚本缺省回落 choices[0] 只吃 nullish——显式传 '' 即保守值直达
      script: { inputs: ['https://x', ''], selects: [''] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('已取消');
    // 整次放弃三零：行原样（endpoint 旧值未动、mode 未落 ''）+ 零凭证 + 零链
    expect(rig_.rows()).toEqual([{ id: 'demo', config: { endpoint: 'https://old' } }]);
    expect(rig_.writes).toEqual([]);
    expect(rig_.reloads()).toBe(0);
  });

  it("boolean 问询取消（'' 保守值——s-9 修前红）→ 整次放弃零写盘——旧码取消折「关」落盘违取消条款", async () => {
    // s-9（03 §1.2 2026-09-13 定形注）：confirm 通道 Esc 折 false 与显式「否」
    // 不可辨——旧码 boolean 用 confirm 时取消被折成「关」落行。修后 boolean
    // 走 select 两值，'' 取消信使同律整次放弃；回执点名 boolean 问询取消
    const rig_ = rig({
      enabledYaml: 'plugins:\n  - id: demo\n    config:\n      endpoint: https://old\n',
      script: { inputs: ['https://x', ''], selects: ['fast', ''] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('boolean 问询取消'); // 修前红锚——旧码无此问询形
    expect(out.text).toContain('整次放弃');
    // 三零：endpoint 旧值未动、verbose 未折「关」落行、零凭证零链
    expect(rig_.rows()).toEqual([{ id: 'demo', config: { endpoint: 'https://old' } }]);
    expect(rig_.writes).toEqual([]);
    expect(rig_.reloads()).toBe(0);
  });
});

describe('落盘期异常分档回执（已写事实不谎称零写盘）', () => {
  it('secret 入盒半途抛错 → 回执点名已写进度（行已写 + 1 secret 已入盒不回滚）', async () => {
    const rig_ = rig({
      fields: [
        { key: 'a', type: 'text' },
        { key: 's1', type: 'secret' },
        { key: 's2', type: 'secret' },
      ],
      enabledYaml: 'plugins:\n  - id: demo\n',
      script: { inputs: ['x', 'sek1', 'sek2'] },
      failSecondCredentialWith: new Error('sqlite boom'),
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(false);
    // 诚实分档：不再谎称「零写盘」，点名已写事实与指路面
    expect(out.text).not.toContain('零写盘');
    expect(out.text).toContain('已写入');
    expect(out.text).toContain('sqlite boom');
    expect(out.text).toContain('/plugins config');
    // 事实面：行已写盘 + 恰 1 个 secret 已入盒（不回滚）
    expect(rig_.rows()).toEqual([{ id: 'demo', config: { a: 'x' } }]);
    expect(rig_.writes).toHaveLength(1);
    expect(rig_.writes[0]![1]).toBe('config:s1');
  });
});

describe('生效现值三级（行 config ?? 宿主默认 ?? 字段 default——装载合成序同源）', () => {
  it('行 config 缺该键 + 宿主默认缺席 + 字段 default 在场 → placeholder 承载字段 default（修前红）', async () => {
    const rig_ = rig({
      fields: [{ key: 'url', type: 'text', default: 'https://field-default' }],
      enabledYaml: 'plugins:\n  - id: demo\n',
      script: { inputs: ['https://field-default'] },
    });
    const out = await runPluginConfigForm('demo', rig_.deps);
    expect(out.ok).toBe(true);
    // placeholder = 生效现值（三级合成）——修前仅两级，字段 default 层漏呈
    expect(rig_.calls.inputs[0]![1]).toEqual({ placeholder: 'https://field-default' });
    // 答值 = 缺省源 → 缺省烘焙回避不落行（行在场照写律——config 空对象）
    expect(rig_.rows()).toEqual([{ id: 'demo', config: {} }]);
  });
});
