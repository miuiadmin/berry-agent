/**
 * /setup 模型凭证配置向导流程件（onboarding ob-3——07 §4.1 定形注 + 2026-09-22
 * 连通验证机制改裁注）：三步轻向导 = 选 provider → 录 API key → 落绑定行。
 *
 * - **纯流程件（零 TUI 依赖）**：一切交互经 WizardPrompter 接口注入（接口居
 *   channels 公开面）——流程分支假 prompter 直锁测试，TUI 副屏实装同接口；
 * - **落行单源**：saveBinding 注入位产线真身 = runCredentialsCommand 公开路由
 *   （runAdd 同一纯函数——行名 = providerId、--model-provider 绑定、审计 seam
 *   在装配位接线，本件不触存储）；
 * - **重入默认值 = 当前值**：provider 预选（清单内在册时）+ key 空录入沿用
 *   （按**所选** providerId 现取——preview 头4尾4形，值恒不入面；换 provider
 *   改选不沿用他家 key）；
 * - **粘贴容错**：剥 `export VAR=` 前缀与包裹引号（用户从 shell 配置整行
 *   粘贴的高频形）；
 * - **连通微探针（可选步——改裁注机制形）**：真供血路 StreamFn 1-token
 *   微探针经注入 probe 位（缺席 = 探针步跳过附注记）；**失败不阻断只建议**
 *   （横切律 8——验证失败向导仍完成，回执附「未验证」注记）；探针目标 =
 *   provider 首模型（probeModelOf 注入位解析），模型目录空 = 跳过附注记；
 * - **Esc 任意步中止**（保存前零改动——凭证表未动即诚实收场）。
 */
import type { WizardPrompter } from '../channels/index.js'; // 公开面三名纪律（index 直达）

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

/** 向导流程依赖（装配位注入——本件零边外面） */
export interface SetupWizardDeps {
  readonly prompter: WizardPrompter;
  /** 可选 provider 清单（内置目录装配序——host 注入；空清单 = 手录是唯一路） */
  readonly providers: readonly string[];
  /** 重入默认值：当前 provider（清单内在册时预选） */
  readonly currentProvider?: string;
  /** 重入默认值取值器：按所选 providerId 现取该 provider 绑定行 key 原值
   * （供血胜出行——预览呈 + 空录入沿用 + confirm「沿用当前值」判据三位随
   * providerId 走；缺席/所选 provider 无绑定行回 undefined——不沿用他家 key） */
  readonly currentApiKeyOf?: (providerId: string) => string | undefined;
  /** env 遮蔽判据（provider → env 键已设置）——遮蔽预警 confirm 判据 */
  readonly envShadowed: (providerId: string) => boolean;
  /** 落绑定行（runCredentialsCommand 单源路由——行名 = providerId） */
  readonly saveBinding: (providerId: string, apiKey: string) => SetupWizardSaveResult;
  /** 连通微探针（缺席 = 探针步跳过附注记——横切律 8 结构性缺席形） */
  readonly probe?: (providerId: string, apiKey: string) => Promise<SetupWizardProbeResult>;
  /** 探针目标模型解析（provider 首模型 spec；undefined = 无可探模型 → 跳过注记） */
  readonly probeModelOf?: (providerId: string) => string | undefined;
}

/** 手录自定义尾项哨兵 id（清单末位——选中转 text 手录步） */
const MANUAL_PROVIDER_ID = '__manual_provider__';

/** 中止收场行（Esc/拒确认——保存前零改动的诚实回执） */
const ABORT_LINES = ['向导已退出——凭证表未改动（可 /setup 重开或 /credentials add 手录）'] as const;

/**
 * 头4尾4预览（`sk-1…wxyz` 形）：短值（≤12 字符——等价被遮字符 ≥4）全遮
 * ——头尾拼接可见字符近全长即泄值（9 字符泄 8/9 只遮 1 字符即此档），短键
 * 全遮不泄（态可入面、值恒不入面）。
 */
export function maskKeyPreview(value: string): string {
  if (value.length <= 12) return '…';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

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
 * 向导主流程（装配位消费）：intro → ① provider 选择（清单 + 手录尾项）→
 * env 遮蔽预警（判据命中时）→ ② key 敏感录入（粘贴容错 + 空录入沿用）→
 * ③ 落行 confirm → saveBinding → 可选连通微探针 → outro 回执。
 */
export async function runSetupWizard(deps: SetupWizardDeps): Promise<void> {
  const p = deps.prompter;
  p.intro('模型凭证配置向导', [
    '三步：选 provider → 录 API key → 落绑定行（录入即生效——供血面全表 live 读零重启）',
    'esc 任意步退出（保存前零改动）',
  ]);

  // —— ① provider 选择（清单装配序 + 手录尾项）——
  const selected = await p.select({
    title: '选择模型 provider',
    items: [
      ...deps.providers.map((id) => ({ id, label: id })),
      { id: MANUAL_PROVIDER_ID, label: '✎ 手录自定义 provider id（不限于清单）' },
    ],
    note: '清单 = 内置 provider 目录；自定义网关/兼容端走手录',
    ...(deps.currentProvider !== undefined && deps.providers.includes(deps.currentProvider)
      ? { preselect: deps.currentProvider }
      : {}),
  });
  if (selected === undefined) return void (await abortOut(p));
  let providerId = selected;
  if (providerId === MANUAL_PROVIDER_ID) {
    // 手录步：非敏感 text；斜杠整模型形取首段（绑定名是 provider——runAdd 归一同律）
    const manual = await p.text({
      title: 'provider id',
      hint: '形如 anthropic 或 anthropic/model-id（斜杠形取首段）',
    });
    if (manual === undefined) return void (await abortOut(p));
    const trimmed = manual.trim();
    if (trimmed === '') {
      await p.outro('已退出', ['未录入 provider id——凭证表未改动']);
      return;
    }
    // 斜杠整模型形取首段（绑定名是 provider——runAdd 归一同律）；split 恒返
    // 非空数组，但首段可为空串（'/gpt-4'、'/' 形）——空串守卫须在取段后复检，
    // 与 runAdd「斜杠首段空 = 坏形」判据单源同律（否则迟炸进保存失败档）
    const firstSegment = trimmed.split('/')[0] ?? trimmed; // ?? 分支不可达（split 恒非空）——保形防御
    if (firstSegment === '') {
      await p.outro('已退出', [
        'provider id 坏形（斜杠首段不可空——形如 anthropic 或 anthropic/model-id）——凭证表未改动',
      ]);
      return;
    }
    providerId = firstSegment;
  }

  // —— env 遮蔽预警（host 域行 env 优先——绑定行将被遮蔽的先验告知）——
  if (deps.envShadowed(providerId)) {
    const goOn = await p.confirm({
      title: `${providerId} 的 env 键已设置——绑定行将被 env 遮蔽（env 优先于绑定行）。仍要录入绑定行？`,
      defaultYes: true,
    });
    if (goOn !== true) return void (await abortOut(p));
  }

  // —— 重入默认值现取（按**所选** providerId——换 provider 改选不沿用他家
  // key：预览、空录入沿用、confirm「沿用当前值」判据三位同源此值）——
  const currentApiKey = deps.currentApiKeyOf?.(providerId);

  // —— ② key 敏感录入（掩码 + 预览 + 粘贴容错）——
  const typed = await p.text({
    title: `${providerId} API key`,
    sensitive: true,
    hint: '整行粘贴可带 export VAR= 前缀（自动剥除）；预览在场时空录入 = 沿用当前值',
    ...(currentApiKey !== undefined ? { preview: maskKeyPreview(currentApiKey) } : {}),
  });
  if (typed === undefined) return void (await abortOut(p));
  const stripped = stripExportPrefix(typed).trim();
  let apiKey: string;
  if (stripped === '') {
    // 空录入分叉：预览在场（当前值在场）= 沿用；否则未配置收场
    if (currentApiKey === undefined) {
      await p.outro('未配置', ['未录入 API key——凭证表未改动（可 /setup 重开再试）']);
      return;
    }
    apiKey = currentApiKey;
  } else {
    apiKey = stripped;
  }

  // —— ③ 落行 confirm → saveBinding（单源路由注入位）——
  const keyNote = apiKey === currentApiKey ? '沿用当前值' : `新值 ${maskKeyPreview(apiKey)}`;
  const yes = await p.confirm({
    title: `写入绑定行（/credentials add ${providerId} … --model-provider ${providerId}，${keyNote}）——${providerId} 供血即改？`,
    defaultYes: true,
  });
  if (yes !== true) return void (await abortOut(p));
  // saveBinding 同步抛防御（runCredentialsCommand 只折 BaseError 余者 rethrow
  // ——better-sqlite3 原生 SqliteError 直达此形）：异常折 {ok:false} 走既有
  // 「保存失败」outro 分档——不向上抛（fire-and-forget 调用位零 unhandled）
  let saved: SetupWizardSaveResult;
  try {
    saved = deps.saveBinding(providerId, apiKey);
  } catch (err) {
    saved = { ok: false, text: `保存异常：${err instanceof Error ? err.message : String(err)}` };
  }
  if (!saved.ok) {
    await p.outro('保存失败', [saved.text, '凭证表未改动（可 /setup 重开再试）']);
    return;
  }

  // —— 可选步：连通微探针（失败不阻断只建议——横切律 8）——
  const probeModel = deps.probeModelOf?.(providerId);
  let verifyNote: string;
  if (deps.probe === undefined || probeModel === undefined) {
    // 结构性缺席：探针注入缺席 / 该 provider 无注册模型可探
    verifyNote = '连通性未验证（无注册模型可探——首条消息时自然检验）';
  } else {
    const wantVerify = await p.confirm({
      title: `现在验证连通？（${probeModel} 发 1-token 微探针）`,
      defaultYes: false,
    });
    if (wantVerify === true) {
      const result = await deps.probe(providerId, apiKey);
      verifyNote = result.ok
        ? `连通验证通过（${probeModel} 应答正常）`
        : `连通性未验证：${result.detail}（配置已保存——可 /setup 重开复探或发首条消息检验）`;
    } else {
      verifyNote = '连通性未验证（已跳过）';
    }
  }

  await p.outro('配置完成', [saved.text, verifyNote]);
}
