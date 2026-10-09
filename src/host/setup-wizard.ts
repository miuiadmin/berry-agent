/**
 * /setup 模型凭证配置向导流程件 v2（onboarding ob-3 + 2026-09-28 模型渠道批
 * C-3 重做——用户五点批评兑现：渠道/协议分立、通用协议自定义、话术直白、
 * **全明文**、自定义模型与官方同权）。
 *
 * - **纯流程件（零 TUI 依赖）**：一切交互经 WizardPrompter 接口注入（接口居
 *   channels 公开面）——流程分支假 prompter 直锁测试，TUI 副屏实装同接口；
 * - **分桶选单**：自定义渠道桶（customProviders 既有列表 + 「+ 新建」）在
 *   前、官方渠道桶（内置目录——id/name/baseUrl 对象源 + 已配置标记 + 「官方 ·」
 *   标注）在后分立（UX 对标批 2026-09-30——用户令自定义第一；参考集 8/8 官方
 *   在前无先例、官方标注先例 CodePilot/opencode）——v1 裸 id 平铺「选
 *   anthropic 不知官方还是自定义」的混淆源拔除；
 * - **自定义渠道腿**（六步表单）：渠道 id（slug 规约 + 保留字/撞名校验）→
 *   协议二选（wire format 与渠道正交——Anthropic 兼容/OpenAI 兼容）→
 *   Base URL → API key → 模型清单（端点拉取〔C-2 件供数〕/手填兜底）→
 *   可选 headers（鉴权材料禁入——警示语）→ confirm 全值回执；
 * - **写序定死**（凭证行先、settings 后——04 §9 ⑥ 2026-09-28 裁决）：settings
 *   语义上引用凭证供血；反向则 provider 在册恒 unconfigured 更迷惑。任一侧
 *   失败 outro 诚实呈「半应用」态与补齐路径；
 * - **活注册**（落库成功后、切模型问句前）：deps.registerCustomProvider 当场
 *   进 llmRuntime 目录——向导路立即生效（手编 settings 路下次启动生效——
 *   生效时点双路语义）；「切换到该渠道模型」问句接 switchModel；
 * - **录入回显全明文**（2026-09-28 全明文翻裁——用户拍板）：录入回显/当前值
 *   预览/confirm 回执一律完整值（v1 头4尾4掩码 maskKeyPreview 退役）；
 * - **重入默认值 = 当前值**（两腿同律）：官方腿 key 空录入沿用；自定义腿
 *   表单各步带当前值（协议预选/baseUrl·key·模型清单预览）；
 * - **删除按写序**（凭证行先删、settings 后删——与保存同序）；
 * - **env 遮蔽预警只在官方腿问**：自定义渠道 env 不供血（绑定行唯一供血源
 *   ——providerApiKeyEnvNames 对 customProviders id 不合成，07 §8.4 豁免裁决）；
 * - **粘贴容错**：剥 `export VAR=` 前缀与包裹引号（保留 v1）；
 * - **连通微探针（官方腿可选步）**：真供血路 1-token 微探针经注入 probe 位
 *   （缺席 = 跳过注记）；失败不阻断只建议（横切律 8）；
 * - **Esc 任意步中止**（保存前零改动——诚实收场）。
 * - **评审修复役 Lane A 批（2026-09-29）**：拒注不问切模型（#1——切模型门
 *   同门 registrationOk）/ headers 面三修（#4 无当前值不记清除 · #5 坏形重问
 *   + hint 点名 · #27 全角逗号/冒号容忍）/ 自定义桶 ✓ 同锚（#15）/ 删除腿
 *   别名行提醒（#16）/ 半应用指路可达（#24）/ 手填清单换行分隔（#28）/
 *   key 内嵌换行拒（#29）/ Base URL try-parse 真校验（#31）。
 */
import type { CustomProviderDef, CustomProviderProtocol } from '../llm/index.js'; // host → llm 既有边（工厂定义件类型真源）
import type { WizardPrompter } from '../channels/index.js'; // 公开面三名纪律（index 直达）
import type { ChannelModelsRequest, ChannelModelsResult } from './channel-models-fetch.js';
// 渠道 id slug 规约单源（R-2 D4 裁决：host 域共享常量——settings 读侧同判据双消费）
import { CUSTOM_CHANNEL_ID_RE } from './settings-store.js';

/** 落绑定行注入位回执（saveBinding 结算——ok 位折向导回执分档） */
export interface SetupWizardSaveResult {
  readonly ok: boolean;
  readonly text: string;
}

/** 连通微探针结算（ok 位折回执注记分档；detail = 人读结局） */
export interface SetupWizardProbeResult {
  readonly ok: boolean;
  readonly detail: string;
}

/** 官方渠道目录项（v2 对象源——装配位从 provider 目录供 name/baseUrl） */
export interface SetupWizardProviderInfo {
  readonly id: string;
  readonly name: string;
  /** 缺席 = 无固定 baseUrl（面板可省略次行） */
  readonly baseUrl?: string;
}

/** 向导流程依赖（装配位注入——本件零边外面） */
export interface SetupWizardDeps {
  readonly prompter: WizardPrompter;
  /** 官方渠道目录（内置——装配序） */
  readonly providers: readonly SetupWizardProviderInfo[];
  /** 既有自定义渠道（装配位读 settings customProviders 供——重入/删除面） */
  readonly customChannels: Readonly<Record<string, CustomProviderDef>>;
  /** 内置目录 id 集（保留字判据——新建自定义 id 撞内置拒注） */
  readonly builtinProviderIds: readonly string[];
  /** 重入默认值：当前 provider（分桶选单官方桶预选） */
  readonly currentProvider?: string;
  /** 重入默认值取值器：按所选 providerId 现取绑定行 key 原值（全明文预览呈） */
  readonly currentApiKeyOf?: (providerId: string) => string | undefined;
  /**
   * 渠道配置就绪判据（R-3——分桶 ✓ 标记同锚注入）：与 /status 呈现同一
   * modelCredentialStatus 判据（env 键非空 ∨ 绑定行命中——含遮蔽语义），
   * 缺席回退 currentApiKeyOf 判据（绑定性近似——旧测试假 deps 零负担）。
   */
  readonly credentialReadyOf?: (providerId: string) => boolean;
  /** env 遮蔽判据（官方腿预警用——自定义腿不问：env 不供血自定义渠道） */
  readonly envShadowed: (providerId: string) => boolean;
  /** 落绑定行（runCredentialsCommand 单源路由——行名 = providerId） */
  readonly saveBinding: (providerId: string, apiKey: string) => SetupWizardSaveResult;
  /** 删绑定行（删除腿——写序第一步；缺席容忍折档由装配位定义） */
  readonly removeBinding: (providerId: string) => SetupWizardSaveResult;
  /** 连通微探针（缺席 = 探针步跳过附注记——横切律 8 结构性缺席形） */
  readonly probe?: (providerId: string, apiKey: string) => Promise<SetupWizardProbeResult>;
  /** 探针目标模型解析（provider 首模型 spec；undefined = 无可探模型 → 跳过注记） */
  readonly probeModelOf?: (providerId: string) => string | undefined;
  /** 模型清单拉取（C-2 件——拉取步供数） */
  readonly fetchModels: (req: ChannelModelsRequest) => Promise<ChannelModelsResult>;
  /** 落自定义渠道（settings customProviders 键合并写——写序第二步） */
  readonly saveCustomChannel: (id: string, def: CustomProviderDef) => SetupWizardSaveResult;
  /** 删自定义渠道（settings customProviders 键删条——删除腿第二步） */
  readonly removeCustomChannel: (id: string) => SetupWizardSaveResult;
  /**
   * 活注册（落库成功后当场进 llmRuntime 目录——向导路立即生效）。R-1 评审
   * 修复役：保留字执法单源在 stack 注册口——回执形透传（拒注不抛，ok 位折
   * 注册注记分档）。
   */
  readonly registerCustomProvider: (id: string, def: CustomProviderDef) => SetupWizardRegisterResult;
  /**
   * 活除名 + 模型复位（R-1 删除腿三联动第三步——装配位组合：运行时除名；
   * 当前模型停在被删渠道时复位目录首条并回执点名，目录空不复位）。
   */
  readonly unregisterCustomProvider: (id: string) => SetupWizardUnregisterResult;
  /** 切模型（切模型问句消费——spec 全形 `${渠道id}/${模型id}`） */
  readonly switchModel: (spec: string) => void;
}

/** 活注册回执（R-1——stack 注册口拒注回执的消费形：ok 位折注册注记分档） */
export interface SetupWizardRegisterResult {
  readonly ok: boolean;
  /** 拒注原因（ok:false 时在场——注册注记点名） */
  readonly reason?: string;
}

/** 活除名回执（R-1——装配位组合「运行时除名 + 模型复位」的产物面） */
export interface SetupWizardUnregisterResult {
  /** 当前模型停在被删渠道时的复位 spec（undefined = 无需复位或目录空） */
  readonly modelReset?: string;
}

/** 分桶选单 id 前缀（命名空间——官方/自定义桶 id 撞名消解） */
const OFFICIAL_PREFIX = 'official:';
const CUSTOM_PREFIX = 'custom:';
/** 「+ 新建自定义渠道」尾项哨兵 id */
const NEW_CUSTOM_ID = '__new_custom__';
/** 既有自定义渠道子选单哨兵 */
const ENTRY_EDIT = '__entry_edit__';
const ENTRY_DELETE = '__entry_delete__';
/** 模型清单步二选哨兵 */
const MODELS_FETCH = '__models_fetch__';
const MODELS_MANUAL = '__models_manual__';

/** 协议人面标签（选单/回执呈现——枚举真源在 llm 域工厂） */
function protocolLabel(protocol: CustomProviderProtocol): string {
  return protocol === 'anthropic-messages' ? 'Anthropic 兼容' : 'OpenAI 兼容';
}

/** 中止收场行（Esc/拒确认——保存前零改动的诚实回执） */
const ABORT_LINES = ['向导已退出——未保存任何改动（可 /setup 重开）'] as const;

/**
 * 剥整行粘贴前缀（容错单源）：`export VAR=` 前缀 + 包裹引号（shell 配置
 * 整行复制的两高频形）。无前缀原样透传（流程侧剥——呈现面不判内容）。
 */
export function stripExportPrefix(raw: string): string {
  const unexported = raw.replace(/^export\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, '');
  return unexported.replace(/^["'](.*)["']$/, '$1');
}

/** 中止收场（outro 后终局——各取消位共尾） */
async function abortOut(p: WizardPrompter): Promise<void> {
  await p.outro('已退出', [...ABORT_LINES]);
}

/**
 * 忙等指示消费单源（R-3 体验批——busy 可选法缺席 no-op）：返回清除函数，
 * 调用侧 try/finally 恒调（D6 裁决——异常路径状态行不留残）。
 */
function showBusy(p: WizardPrompter, label: string): () => void {
  if (p.busy === undefined) return () => {}; // 旧实装/假 prompter 无此法——no-op
  return p.busy(label);
}

/** 注入位调用防御包（同步抛折 {ok:false}——fire-and-forget 零 unhandled） */
function safeCall(action: () => SetupWizardSaveResult): SetupWizardSaveResult {
  try {
    return action();
  } catch (err) {
    return { ok: false, text: `操作异常：${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * 向导主流程 v2（装配位消费）：intro → 分桶选单（官方/自定义/+ 新建）→
 * 官方腿（遮蔽预警 → key 明文录入 → confirm 全值 → 落行 → 可选探针）/
 * 既有自定义渠道（编辑重入 / 删除按写序）/ 新建腿（六步表单 → 写序落库 →
 * 活注册 → 切模型问句）→ outro 回执。
 */
export async function runSetupWizard(deps: SetupWizardDeps): Promise<void> {
  const p = deps.prompter;
  p.intro('模型配置向导', [
    '选渠道 → 录 API key → 立即生效（官方渠道与自定义网关同权）',
    'esc 任意步退出（保存前零改动）',
  ]);

  // —— ① 分桶选单（官方桶在前——内置目录装配序；自定义桶既有列表 + 新建尾项）——
  // ✓ 判据 R-3 同锚：credentialReadyOf 注入位与 /status 同一 modelCredentialStatus
  // 判据（env ∨ 绑定行——含遮蔽语义）；缺席回退 currentApiKeyOf 绑定性近似
  const configuredOf = (providerId: string): boolean =>
    deps.credentialReadyOf !== undefined
      ? deps.credentialReadyOf(providerId)
      : deps.currentApiKeyOf?.(providerId) !== undefined;
  const officialItems = deps.providers.map((info) => {
    const configured = configuredOf(info.id);
    const isCurrent = deps.currentProvider === info.id; // （当前）标记——重入光标位之外的可视锚
    return {
      id: `${OFFICIAL_PREFIX}${info.id}`,
      // 「官方 ·」标注（UX 对标批——官方渠道辨识位；自定义桶在前后排语境
      // 下官方桶各行点名官方，CodePilot 分组标题先例的行内形）
      label: `官方 · ${info.name}${configured ? ' ✓' : ''}${isCurrent ? '（当前）' : ''}`,
      desc: info.baseUrl !== undefined ? (configured ? `已配置 · ${info.baseUrl}` : info.baseUrl) : undefined,
    };
  });
  const customItems = Object.entries(deps.customChannels).map(([id, def]) => ({
    id: `${CUSTOM_PREFIX}${id}`,
    // #15：✓ 判据与官方桶同锚（configuredOf 复用——credentialReadyOf 注入或
    // 绑定行回退，修前自定义桶恒无标记与官方桶呈现不一致）
    label: `${def.name !== undefined ? `${def.name}（${id}）` : id}${configuredOf(id) ? ' ✓' : ''}${
      deps.currentProvider === id ? '（当前）' : ''
    }`,
    desc: `${protocolLabel(def.protocol)} · ${def.baseUrl} · 模型 ${def.models.length} 个`,
  }));
  // 重入预选（R-3 扩自定义桶）：当前 provider 在官方桶或自定义桶任一命中即预选
  const preselectId =
    deps.currentProvider !== undefined
      ? deps.providers.some((info) => info.id === deps.currentProvider)
        ? `${OFFICIAL_PREFIX}${deps.currentProvider}`
        : deps.customChannels[deps.currentProvider] !== undefined
          ? `${CUSTOM_PREFIX}${deps.currentProvider}`
          : undefined
      : undefined;
  const selected = await p.select({
    title: '选择模型渠道',
    // 桶序（UX 对标批 2026-09-30）：自定义桶（既有 + 新建尾项）第一、官方桶
    // 在后——用户令；官方桶各行带「官方 ·」标注补辨识
    items: [
      ...customItems,
      {
        id: NEW_CUSTOM_ID,
        label: '+ 新建自定义渠道',
        desc: 'Anthropic/OpenAI 兼容网关——Base URL + API key + 模型清单',
      },
      ...officialItems,
    ],
    note: '自定义渠道 = 中转站/兼容网关（保存在 settings.json）；官方渠道 = 内置',
    ...(preselectId !== undefined ? { preselect: preselectId } : {}),
  });
  if (selected === undefined) return void (await abortOut(p));

  if (selected === NEW_CUSTOM_ID) return void (await customFormLeg(deps, p));
  if (selected.startsWith(CUSTOM_PREFIX))
    return void (await customEntryLeg(deps, p, selected.slice(CUSTOM_PREFIX.length)));
  if (selected.startsWith(OFFICIAL_PREFIX)) {
    const info = deps.providers.find((candidate) => `${OFFICIAL_PREFIX}${candidate.id}` === selected);
    if (info === undefined) return void (await abortOut(p)); // 防御位（选单项即目录派生）
    return void (await officialLeg(deps, p, info));
  }
  return void (await abortOut(p)); // 防御位（未知前缀零静默）
}

/* ---------------- 官方腿（内置渠道——三步：预警 → key → 落行+探针） ---------------- */

/** 官方渠道配置腿：env 遮蔽预警 → key 全明文录入 → confirm 全值 → saveBinding → 可选探针 */
async function officialLeg(deps: SetupWizardDeps, p: WizardPrompter, info: SetupWizardProviderInfo): Promise<void> {
  const providerId = info.id;

  // env 遮蔽预警（host 域行 env 优先——绑定行将被遮蔽的先验告知）
  if (deps.envShadowed(providerId)) {
    const goOn = await p.confirm({
      title: `${providerId} 的 API key 环境变量已设置——环境变量优先，这里保存的 key 不会生效。仍要保存？`,
      defaultYes: true,
    });
    if (goOn !== true) return void (await abortOut(p));
  }

  // key 全明文录入（当前值完整回显；空录入 = 沿用）
  const currentApiKey = deps.currentApiKeyOf?.(providerId);
  const typed = await p.text({
    title: `${providerId} API key`,
    hint: '整行粘贴可带 export 前缀（自动剥除）；留空 = 沿用当前值',
    ...(currentApiKey !== undefined ? { preview: currentApiKey } : {}),
  });
  if (typed === undefined) return void (await abortOut(p));
  const stripped = stripExportPrefix(typed).trim();
  let apiKey: string;
  if (stripped === '') {
    if (currentApiKey === undefined) {
      await p.outro('未配置', ['未录入 API key——未保存任何改动（可 /setup 重开再试）']);
      return;
    }
    apiKey = currentApiKey;
  } else {
    apiKey = stripped;
  }

  // confirm 全值直呈（全明文翻裁——所见即所存）
  const yes = await p.confirm({
    title: `保存 ${providerId} 的 API key？`,
    lines: [
      `key：${apiKey}`,
      `渠道：${info.name}${info.baseUrl !== undefined ? `（${info.baseUrl}）` : ''}`,
      apiKey === currentApiKey ? '（与已保存的值相同——不改动）' : '（新值——保存后立即生效，无需重启）',
    ],
    defaultYes: true,
  });
  if (yes !== true) return void (await abortOut(p));
  const saved = safeCall(() => deps.saveBinding(providerId, apiKey));
  if (!saved.ok) {
    await p.outro('保存失败', [saved.text, '未保存任何改动（可 /setup 重开再试）']);
    return;
  }

  // 可选步：连通微探针（失败不阻断只建议——横切律 8）
  const probeModel = deps.probeModelOf?.(providerId);
  let verifyNote: string;
  if (deps.probe === undefined || probeModel === undefined) {
    verifyNote = '连通性未验证——暂无模型可试，发第一条消息即可验证';
  } else {
    const wantVerify = await p.confirm({
      title: `现在验证连通？（向 ${probeModel} 发一条最小测试请求）`,
      defaultYes: false,
    });
    if (wantVerify === true) {
      // R-3 busy：探针短等步即时反馈（finally 恒清——D6）
      const clearBusy = showBusy(p, `正在探测 ${providerId}…`);
      let result: SetupWizardProbeResult;
      try {
        result = await deps.probe(providerId, apiKey);
      } finally {
        clearBusy();
      }
      verifyNote = result.ok
        ? `连通验证通过（${probeModel} 返回正常）`
        : `连通性未验证：${result.detail}（配置已保存——可 /setup 重新检测，或发首条消息检验）`;
    } else {
      verifyNote = '连通性未验证（已跳过）';
    }
  }

  await p.outro('配置完成', [saved.text, verifyNote]);
}

/* ---------------- 既有自定义渠道腿（子选单：编辑重入 / 删除） ---------------- */

/** 既有自定义渠道入口：编辑 / 删除 / 返回选单 */
async function customEntryLeg(deps: SetupWizardDeps, p: WizardPrompter, id: string): Promise<void> {
  const def = deps.customChannels[id];
  if (def === undefined) return void (await abortOut(p)); // 防御位（清单派生项）
  const action = await p.select({
    title: `自定义渠道 ${def.name !== undefined ? `${def.name}（${id}）` : id}`,
    items: [
      { id: ENTRY_EDIT, label: '编辑配置', desc: '带当前值重走表单（改 key / 补模型清单等）' },
      { id: ENTRY_DELETE, label: '删除渠道', desc: '保存的 API key 与 settings 配置同删——不可恢复' },
    ],
  });
  if (action === undefined) return void (await abortOut(p));
  if (action === ENTRY_EDIT) return void (await customFormLeg(deps, p, { id, def }));
  if (action === ENTRY_DELETE) return void (await deleteCustomLeg(deps, p, id));
  return void (await abortOut(p));
}

/* ---------------- 自定义渠道表单腿（新建 / 编辑重入共用六步） ---------------- */

/** 表单产物（confirm 回执与落库的值集） */
interface CustomChannelDraft {
  readonly id: string;
  readonly def: CustomProviderDef;
  readonly apiKey: string;
  readonly isNew: boolean;
  /** 编辑腿清除 headers 的信号（原条数——confirm 回执诚实呈「已清除」） */
  readonly headersClearedFrom?: number;
}

/**
 * 自定义渠道表单：渠道 id（新建时）→ 协议 → Base URL → API key → 模型清单
 * （拉取/手填）→ 可选 headers → confirm 全值 → 写序落库 → 活注册 → 切模型问句。
 * existing 在场 = 编辑重入（表单各步带当前值；id 固定不可改）。
 */
async function customFormLeg(
  deps: SetupWizardDeps,
  p: WizardPrompter,
  existing?: { readonly id: string; readonly def: CustomProviderDef },
): Promise<void> {
  // —— 渠道 id（新建时录——编辑重入固定）——
  let id: string;
  if (existing !== undefined) {
    id = existing.id;
    // R-1 编辑腿表单前复验（清单陈化窗纵深——开向导后 settings 被外改的防御
    // 位）：撞内置目录 id 的条目防御性拒入表单（分桶判据已排除撞名条入桶，
    // 本位零成本兜缝；指路手编清除——撞名条向导全域不可见的清除径唯一）。
    if (deps.builtinProviderIds.includes(id)) {
      await p.outro('已退出', [`渠道 id ${id} 与内置渠道重名，这条配置不会生效——在 settings.json 里删掉它即可清除`]);
      return;
    }
  } else {
    // 渠道 id 步（R-3 体验批——坏形**重问当前步**不退出整向导：坏形/撞名/撞
    // 既有动态 hint 点名再问；esc（undefined）仍是唯一退出径）
    let idHint = '小写字母/数字/连字符，如 my-relay——之后用模型时写 my-relay/model-a';
    id = '';
    for (;;) {
      const idTyped = await p.text({ title: '渠道 id', hint: idHint });
      if (idTyped === undefined) return void (await abortOut(p)); // esc 退出
      const trimmedId = idTyped.trim();
      if (trimmedId === '') {
        idHint = '未录入——输入渠道 id（esc 退出）';
        continue;
      }
      if (!CUSTOM_CHANNEL_ID_RE.test(trimmedId)) {
        idHint = `「${trimmedId}」格式不对——须以小写字母开头，只含小写字母/数字/连字符；重输或 esc 退出`;
        continue;
      }
      if (deps.builtinProviderIds.includes(trimmedId)) {
        idHint = `「${trimmedId}」与内置渠道重名——换一个；重输或 esc 退出`;
        continue;
      }
      if (deps.customChannels[trimmedId] !== undefined) {
        idHint = `「${trimmedId}」已存在——选单里可编辑该渠道，或换个 id；重输或 esc 退出`;
        continue;
      }
      id = trimmedId;
      break;
    }
  }

  // —— 协议二选（wire format 与渠道正交——用户批评①兑现）——
  const currentProtocol = existing?.def.protocol;
  const proto = await p.select({
    title: '协议（网关兼容哪家 API——Anthropic 还是 OpenAI）',
    items: [
      { id: 'anthropic-messages', label: 'Anthropic 兼容', desc: 'Claude 系端点——x-api-key 头；Base URL 填根地址' },
      { id: 'openai-completions', label: 'OpenAI 兼容', desc: 'GPT 系端点——Bearer 头；Base URL 通常填到 /v1' },
    ],
    note: '不确定？多数中转站/网关是 OpenAI 兼容；Claude 系代理（如官方 API 反代）选 Anthropic 兼容',
    ...(currentProtocol !== undefined ? { preselect: currentProtocol } : {}),
  });
  if (proto !== 'anthropic-messages' && proto !== 'openai-completions') return void (await abortOut(p));
  const protocol = proto;

  // —— Base URL（R-3 坏形重问；空录入沿用当前值——preview 语义同律）——
  const currentBaseUrl = existing?.def.baseUrl;
  let urlHint =
    protocol === 'anthropic-messages'
      ? '根地址，如 https://gw.example.com（自动拼 /v1/models 拉清单）'
      : '填到 /v1，如 https://gw.example.com/v1（自动拼 /models 拉清单）';
  let baseUrl = '';
  for (;;) {
    const urlTyped = await p.text({
      title: 'Base URL',
      hint: urlHint,
      ...(currentBaseUrl !== undefined ? { preview: currentBaseUrl } : {}),
    });
    if (urlTyped === undefined) return void (await abortOut(p)); // esc 退出
    const urlTrimmed = urlTyped.trim();
    const candidate = urlTrimmed === '' && currentBaseUrl !== undefined ? currentBaseUrl : urlTrimmed;
    if (candidate === '') {
      urlHint = '未录入——填网关地址（esc 退出）';
      continue;
    }
    // #31：前缀正则 → try-parse 真校验（空宿主「https://」与查询串形
    // 「https://?q=1」的放行缝拔除：解析成功 + protocol 白名单 + hostname
    // 非空三条件）
    let urlOk = false;
    try {
      const parsedUrl = new URL(candidate);
      urlOk = (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && parsedUrl.hostname !== '';
    } catch {
      urlOk = false;
    }
    if (!urlOk) {
      urlHint = `「${candidate}」须是完整 http(s) 地址，如 https://gw.example.com/v1——重填或 esc 退出`;
      continue;
    }
    baseUrl = candidate;
    break;
  }

  // —— API key（全明文——空录入沿用当前值；R-3 无当前值空录入重问；#29 内嵌
  // 换行拒——坏形重问循环兜底：含换行的 key 落凭证行后运行时炸英文 TypeError）——
  const currentApiKey = deps.currentApiKeyOf?.(id);
  let apiKey = '';
  {
    const hasCurrent = currentApiKey !== undefined;
    let keyHint = hasCurrent
      ? '整行粘贴可带 export 前缀（自动剥除）；留空 = 沿用当前值'
      : '整行粘贴可带 export 前缀（自动剥除）';
    for (;;) {
      const keyTyped = await p.text({
        title: `${id} API key`,
        hint: keyHint,
        ...(hasCurrent ? { preview: currentApiKey } : {}),
      });
      if (keyTyped === undefined) return void (await abortOut(p)); // esc 退出
      const strippedKey = stripExportPrefix(keyTyped).trim();
      if (strippedKey === '') {
        if (hasCurrent) {
          apiKey = currentApiKey; // 空录入沿用当前值（有当前值不重问——原语义）
          break;
        }
        keyHint = '未录入——填网关的 API key（esc 退出）';
        continue;
      }
      if (/[\r\n]/.test(strippedKey)) {
        // #29：key 值域拒内嵌换行（trim 只剥首尾——内嵌换行仍在，点名重输）
        keyHint = 'key 不能含换行——去掉换行重输（esc 退出）';
        continue;
      }
      apiKey = strippedKey;
      break;
    }
  }

  // —— 模型清单（拉取/手填——拉取失败手填兜底不阻断；空清单可保存——合法
  // 中间态，confirm 回执与终局 outro 点明补齐路径）——
  const models = await modelsStep(deps, p, { baseUrl, protocol, apiKey }, existing?.def.models);
  if (models === undefined) return; // modelsStep 内已收场（取消/坏形各自 outro）

  // —— 可选 headers（非标网关兜底——鉴权材料禁入警示；R-3 措辞随在场 +
  // 空录入 = 清除、confirm 答否 = 不动）——
  const currentHeaders = existing?.def.headers;
  const headersPreview =
    currentHeaders !== undefined
      ? Object.entries(currentHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
      : undefined;
  const wantHeaders = await p.confirm({
    title: currentHeaders !== undefined ? '编辑/清除自定义请求头？' : '添加自定义请求头？',
    lines: [
      '一般不需要——上面填的 API key 已负责鉴权。',
      '这里只填网关要求的额外请求头（如 X-Upstream）——别填 API key；内容会明文存进 settings.json。',
      ...(currentHeaders !== undefined ? [`当前（${Object.keys(currentHeaders).length} 条）：${headersPreview}`] : []),
    ],
    defaultYes: false,
  });
  if (wantHeaders === undefined) return void (await abortOut(p));
  let headers: Record<string, string> | undefined = currentHeaders !== undefined ? { ...currentHeaders } : undefined;
  let headersClearedFrom: number | undefined;
  if (wantHeaders) {
    let headersHint =
      currentHeaders !== undefined
        ? '如 X-Upstream: beta, X-Region: eu——留空 = 清除全部请求头'
        : '如 X-Upstream: beta, X-Region: eu';
    for (;;) {
      const headersTyped = await p.text({
        title: '请求头（"头名: 值" 逗号分隔）',
        hint: headersHint,
        ...(headersPreview !== undefined ? { preview: headersPreview } : {}),
      });
      if (headersTyped === undefined) return void (await abortOut(p)); // esc 退出
      if (headersTyped.trim() === '') {
        headers = undefined; // 空录入 = 清除（R-3——confirm 回执可核）
        // #4：无当前值不记「清除」——「清除（原 0 条）」误导行拔除（无从清除）
        headersClearedFrom = currentHeaders !== undefined ? Object.keys(currentHeaders).length : undefined;
        break;
      }
      const parsed = parseHeaders(headersTyped);
      if (parsed === null) {
        // #5：坏形重问当前步 + hint 点名格式错因（修前坏形静默折「保持当前
        // 值」直进 confirm 无错因提示）
        headersHint = '格式：K: V, K2: V2——每条须含冒号且键值非空（重输或 esc 退出）';
        continue;
      }
      headers = parsed;
      break;
    }
  } // confirm 答否 = 不动（保留当前值或缺席——R-3 裁决）

  const draft: CustomChannelDraft = {
    id,
    def: {
      // 编辑重入透传展示名（R-3——修前真缺陷：draft 构造丢 existing.def.name，
      // 编辑保存后渠道展示名回落 id；手编 settings 的 name 在向导路同样幸存）
      ...(existing?.def.name !== undefined ? { name: existing.def.name } : {}),
      protocol,
      baseUrl,
      models,
      ...(headers !== undefined ? { headers } : {}),
      // pi-8 批向导编辑腿透传律（04 §9 ⑥ pi-8 批注）：v1 向导不开采集步
      // （compat 白名单/采样参自由形均手编 settings 面），但编辑保存必透传
      // 新三键——「向导编辑保存即静默清除手编键」是 R-3 name 丢键先例 bug
      // 族的复发面，透传是防丢键义务非 UX 扩展
      ...(existing?.def.compat !== undefined ? { compat: existing.def.compat } : {}),
      ...(existing?.def.samplingParams !== undefined ? { samplingParams: existing.def.samplingParams } : {}),
      ...(existing?.def.samplingParamsByThinkingLevel !== undefined
        ? { samplingParamsByThinkingLevel: existing.def.samplingParamsByThinkingLevel }
        : {}),
    },
    apiKey,
    isNew: existing === undefined,
    ...(headersClearedFrom !== undefined ? { headersClearedFrom } : {}),
  };
  return void (await confirmAndSaveCustom(deps, p, draft));
}

/**
 * headers 解析（"K: V, K2: V2" 形——语义分立三态）：
 * - 空串 → undefined（清除/不设语义——调用步按清除处理）；
 * - 非空坏形 → null 哨兵（#5——调用步重问当前步，不再静默折「保持当前值」）；
 * - 好形 → 头对象（#27：分隔与冒号探测均扩全角「，」「：」——中文输入法容忍；
 *   任一条目坏形整体拒 null 不半采）。
 */
function parseHeaders(raw: string): Record<string, string> | undefined | null {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined; // 空录入 = 不设 headers
  const out: Record<string, string> = {};
  for (const segment of trimmed.split(/[,，]/)) {
    // #27：冒号探测双形（半角 ':' / 全角 '：'——取实际命中位切片）
    const colonHalf = segment.indexOf(':');
    const colonFull = segment.indexOf('：');
    const colon = colonHalf === -1 ? colonFull : colonFull === -1 ? colonHalf : Math.min(colonHalf, colonFull);
    if (colon <= 0) return null; // 坏形（无冒号/空键）——哨兵拒（重问）
    const key = segment.slice(0, colon).trim();
    const value = segment.slice(colon + 1).trim();
    if (key === '' || value === '') return null;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 模型清单步：拉取/手填二选 → 拉取（C-2 件）成功转 multiselect 勾选、失败
 * 附原因落手填；手填逗号分隔。回 undefined = 上游已收场。
 */
async function modelsStep(
  deps: SetupWizardDeps,
  p: WizardPrompter,
  req: ChannelModelsRequest,
  existingModels?: readonly string[],
): Promise<readonly string[] | undefined> {
  const how = await p.select({
    title: '模型清单',
    items: [
      { id: MODELS_FETCH, label: '从网关拉取', desc: `从网关拉取模型列表（只发鉴权头，8s 超时；失败转手填）` },
      { id: MODELS_MANUAL, label: '手动填写', desc: '逗号分隔模型 id——拉取失败时手填' },
    ],
    ...(existingModels !== undefined && existingModels.length > 0
      ? { note: `当前清单：${existingModels.join(', ')}` }
      : {}),
  });
  if (how === undefined) {
    await abortOut(p);
    return undefined;
  }
  let fetchNote = '';
  if (how === MODELS_FETCH) {
    // R-3 busy：拉取短等步即时反馈（可选法缺席 no-op；finally 恒清——D6）
    const clearBusy = showBusy(p, '正在拉取模型清单…');
    let result: ChannelModelsResult;
    try {
      result = await deps.fetchModels(req);
    } finally {
      clearBusy();
    }
    if (result.kind === 'ok' && result.models.length > 0) {
      const chosen = await p.multiselect({
        title: `拉到 ${result.models.length} 个模型——勾选要用的`,
        items: result.models.map((model) => ({ id: model, label: model })),
        note: '空格勾选 · 全不选 + enter = 改手填',
        // R-3 preselect 接线：重入默认勾当前清单（在拉取结果内的条目）
        ...(existingModels !== undefined && existingModels.length > 0
          ? { preselect: existingModels.filter((model) => result.models.includes(model)) }
          : {}),
      });
      if (chosen === undefined) {
        await abortOut(p);
        return undefined;
      }
      if (chosen.length > 0) return chosen;
      fetchNote = ''; // 空选落手填
    } else if (result.kind === 'failed') {
      fetchNote = `拉取失败：${result.message}——改手填`;
    } else {
      fetchNote = '端点清单为空——改手填';
    }
  }
  const typed = await p.text({
    title: '模型 id（逗号分隔）',
    // 拉取失败落手填时提示语换成失败原因（两提示同位互斥——原因优先）
    hint: fetchNote !== '' ? fetchNote : '如 model-a, model-b——对话里即 my-channel/model-a 形可选',
    ...(existingModels !== undefined && existingModels.length > 0 ? { preview: existingModels.join(', ') } : {}),
  });
  if (typed === undefined) {
    await abortOut(p);
    return undefined;
  }
  const trimmed = typed.trim();
  // 空录入沿用现有清单（preview「在场空录入 = 沿用」语义同律——重入不动清单零负担）
  if (trimmed === '') return existingModels ?? [];
  // R-3：全角逗号容忍（/[,，]/ 中文输入法高频）+ Set 去重保序（重复条目静默收编）
  // #28：换行也是分隔符（粘贴一行一模型的多行清单——与逗号等价，修前结成
  // 含内嵌换行的垃圾 id）
  const seen = new Set<string>();
  const models: string[] = [];
  for (const segment of trimmed.split(/[,，\n\r]+/)) {
    const model = segment.trim();
    if (model === '' || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

/** confirm 全值回执 → 写序落库（凭证行先、settings 后）→ 活注册 → 切模型问句 → outro */
async function confirmAndSaveCustom(
  deps: SetupWizardDeps,
  p: WizardPrompter,
  draft: CustomChannelDraft,
): Promise<void> {
  const { id, def, apiKey, isNew, headersClearedFrom } = draft;
  const yes = await p.confirm({
    title: `${isNew ? '保存' : '更新'}自定义渠道 ${id}？`,
    lines: [
      ...(def.name !== undefined ? [`名称：${def.name}`] : []),
      `协议：${protocolLabel(def.protocol)}`,
      `Base URL：${def.baseUrl}`,
      `API key：${apiKey}`,
      `模型（${def.models.length} 个）：${def.models.length > 0 ? def.models.join(', ') : '（空——以后再运行 /setup 可以补填）'}`,
      ...(def.headers !== undefined
        ? [
            `请求头：${Object.entries(def.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')}`,
          ]
        : []),
      // 编辑腿清除 headers 的诚实回执行（R-3——清除可核）
      ...(headersClearedFrom !== undefined ? [`请求头：清除（原 ${headersClearedFrom} 条）`] : []),
      isNew ? '写入：API key + settings.json（渠道定义）——保存后立即生效' : '',
    ].filter((line) => line !== ''),
    defaultYes: true,
  });
  if (yes !== true) return void (await abortOut(p));

  // —— 写序定死：凭证行先（settings 语义上引用凭证供血）——
  const savedKey = safeCall(() => deps.saveBinding(id, apiKey));
  if (!savedKey.ok) {
    await p.outro('保存失败', [savedKey.text, 'API key 未保存——本次零改动（可 /setup 重开再试）']);
    return;
  }
  const savedChannel = safeCall(() => deps.saveCustomChannel(id, def));
  if (!savedChannel.ok) {
    await p.outro('保存失败（部分完成）', [
      savedChannel.text,
      // #24：指路可达（修前「重入该渠道（编辑配置）补齐」不可达——渠道未落
      // 库、重入清单无此条）；改为重新配置或修复 settings 后重试
      'API key 已保存，但渠道配置写入失败（未进渠道清单）——重启不会生效。可 /setup 重新配置，或修复 settings.json 后重试。',
    ]);
    return;
  }

  // —— 活注册（两写皆成——当场进 llmRuntime 目录，向导路立即生效）——
  // R-1：注册口回执形（执法单源在 stack——拒注不抛，回执折注记分档；抛错
  // 防御包保留：注入位测试形/换代窗异常不杀流程）。registrationOk 位供
  // R-3 可选探针门槛（拒注渠道无可探运行时目标）。
  let registerNote: string;
  let registrationOk = false;
  try {
    const registration = deps.registerCustomProvider(id, def);
    registrationOk = registration.ok;
    registerNote = registration.ok
      ? '已注册——立即生效（无需重启）'
      : `注册被拒：${registration.reason ?? '渠道 id 被占用'}——配置已保存，但重启后也会被拒；建议 /setup 换 id 重配`;
  } catch (err) {
    registerNote = `注册异常：${err instanceof Error ? err.message : String(err)}——配置已保存，重启后生效`;
  }

  // —— 切模型问句（#1：注册成功且模型清单非空才问——拒注渠道运行时目录无此
  // 条、切了也选不到，修前「注册被拒」+「已切换模型」自相矛盾回执）——
  let switchNote = '';
  if (registrationOk && def.models.length > 0) {
    const wantSwitch = await p.confirm({
      title: `立即切换到 ${id} 的模型？`,
      defaultYes: false,
    });
    if (wantSwitch === undefined) {
      // 收尾确认位取消 = 不切（渠道已保存——诚实完成收场，不按中止处理）
      switchNote = '未切换——ctrl+p 随时可换';
    } else if (wantSwitch) {
      const chosen = await p.select({
        title: `选 ${id} 的模型`,
        items: def.models.map((model) => ({ id: model, label: `${id}/${model}` })),
      });
      if (chosen !== undefined) {
        deps.switchModel(`${id}/${chosen}`);
        switchNote = `已切换模型：${id}/${chosen}`;
      }
    } else {
      // 答否指路（R-3——不当场切换也要知道怎么切）
      switchNote = '未切换——ctrl+p 随时可换';
    }
  }

  // —— 可选探针（R-3——保存后顺手验连通：与官方腿同一 probe 注入位）——
  let probeNote = '';
  if (registrationOk && deps.probe !== undefined && deps.probeModelOf?.(id) !== undefined) {
    const wantProbe = await p.confirm({
      title: `顺手探一下 ${id} 的连通性？`,
      lines: ['向该渠道首个模型发一条最小请求——验地址/密钥是否真的可用。'],
      defaultYes: true,
    });
    if (wantProbe === true) {
      const spec = deps.probeModelOf?.(id);
      if (spec !== undefined) {
        const clearBusy = showBusy(p, `正在探测 ${id}…`);
        let probeResult: SetupWizardProbeResult;
        try {
          probeResult = await deps.probe(id, apiKey);
        } finally {
          clearBusy();
        }
        probeNote = probeResult.ok ? '连通验证：通过 ✓' : `连通验证：未通——${probeResult.detail}`;
      }
    }
  }

  await p.outro(isNew ? '渠道已保存' : '渠道已更新', [
    savedChannel.text,
    registerNote,
    ...(switchNote !== '' ? [switchNote] : []),
    ...(probeNote !== '' ? [probeNote] : []),
    ...(def.models.length === 0 ? ['（模型清单为空——以后再运行 /setup 可补填）'] : []),
  ]);
}

/* ---------------- 删除腿（三联动：凭证行 → settings → 运行时除名） ---------------- */

/**
 * 删除自定义渠道：confirm → 三联动删（凭证行 → settings → 运行时除名——
 * R-1 评审修复役：与保存腿活注册对称的「当场失效」；unregister 组合模型
 * 复位〔当前模型停在被删渠道时复位目录首条〕）→ outro 查各步 ok 位诚实
 * 呈报（任一失败呈半应用态——修前恒「已删除」不诚实）。
 */
async function deleteCustomLeg(deps: SetupWizardDeps, p: WizardPrompter, id: string): Promise<void> {
  const def = deps.customChannels[id];
  const yes = await p.confirm({
    title: `删除自定义渠道 ${id}？`,
    lines: [
      `协议：${def !== undefined ? protocolLabel(def.protocol) : '（定义已缺——仍可清理）'}`,
      `Base URL：${def?.baseUrl ?? '（缺）'}`,
      '保存的 API key 与配置同删，并立即从当前运行中移除——不可恢复。',
    ],
    defaultYes: false, // 破坏性操作缺省否——防误触
  });
  if (yes !== true) return void (await abortOut(p));
  // 三联动同序（写序：凭证行先、settings 后 + 第三步运行时除名）
  const removedKey = safeCall(() => deps.removeBinding(id));
  const removedChannel = safeCall(() => deps.removeCustomChannel(id));
  let unregisterNote = '已从当前运行中移除——立即生效';
  let modelResetNote = '';
  try {
    const { modelReset } = deps.unregisterCustomProvider(id);
    if (modelReset !== undefined) {
      modelResetNote = `当前模型已复位：${modelReset}（原渠道已删——ctrl+p 可换）`;
    }
  } catch (err) {
    unregisterNote = `从当前运行中移除失败：${err instanceof Error ? err.message : String(err)}——重启后生效`;
  }
  // outro 查 ok 位诚实分档（修前恒「已删除」）
  if (removedKey.ok && removedChannel.ok && !unregisterNote.startsWith('从当前运行中移除失败')) {
    await p.outro('已删除', [
      removedKey.text,
      removedChannel.text,
      unregisterNote,
      ...(modelResetNote !== '' ? [modelResetNote] : []),
      // #16：别名行提醒（行名 ≠ 渠道 id 的凭证行不随本删除清理——诚实指路手
      // 清，防重建同名渠道旧 key 静默复活）
      '若曾用别名保存过该渠道的 key（如 berry credentials add 自定义别名），别名不随本删除清理——可 berry credentials rm <别名> 手动清理。',
    ]);
  } else {
    await p.outro('删除未完全成功（部分完成）', [
      removedKey.text,
      removedChannel.text,
      unregisterNote,
      '——可 /setup 重开重删，或重启后按 settings 剩余配置生效',
    ]);
  }
}
