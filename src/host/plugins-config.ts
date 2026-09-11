/**
 * host/plugins-config — `/plugins config <id>` 表单腿编排（ix-3b/c——03 §1.2
 * 表单条款 + 07 §4.3 提问队列消费）。
 *
 * fields 驱动逐字段问答：text/secret 用 input（secret 空答 = 保留现值）、
 * boolean 用 confirm、select 用 select；问询经 ask seam（sessionId 由装配
 * 面绑定——表单需会话锚，无发起会话的面装配缺席）。写盘分两落点：
 *  - 非_secret 字段 + 未声明键透传 → enabled.yaml 行 config 整值替换
 *    （setRowConfig——保留 disabled/opens/doors 原样）；
 *  - secret 字段 → 凭证盒 plugin:<id>/config:<key>（meta source 'manual'，
 *    credentials/changed seam 归因——值恒不入生命周期面）。
 *
 * 取消语义（03 §1.2「取消 = 整次放弃」）：任一 ask 拒绝（通道取消/abort）
 * → 捕获为诚实回执，零写盘零凭证写。缺省烘焙回避：值等于缺省源（行缺席
 * 时宿主默认/字段 default）的字段不落行——行是覆盖仓，表单全默认直存会把
 * 清单缺省烙进用户行，作者后续改 default 不再传播。
 *
 * 成功尾序：行写盘 → secret 入盒 → requestReload（与 mount 同律 03 §5.2
 * 自动链）→ 回执（maskConfigSecrets 呈现纪律——secret 值恒遮蔽）。
 */
import { pluginNamespace } from '../credentials/index.js';
import type { CredentialChangedPayload } from '../credentials/index.js';
import type { UiAskOptions, UiInputOptions, UiSelectChoice } from '../contracts/index.js';

import type { ConfigField } from './config-schema.js';
import { readEnabledRowsForEdit, setRowConfig } from './plugin-store.js';
import type { PluginStoreFs } from './plugin-store.js';
import type { PluginsCommandOutcome } from './plugins-command.js';

/** 问询四原语的会话绑定形（装配面闭包绑定 sessionId——本件零会话感知） */
export interface PluginConfigAskFace {
  readonly confirm: (message: string, opts?: UiAskOptions) => Promise<boolean>;
  readonly select: (message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions) => Promise<string>;
  readonly input: (message: string, opts?: UiInputOptions) => Promise<string>;
}

/** 表单腿 deps（装配面注入——纯逻辑件零 fs/db/通道直连） */
export interface PluginConfigFormDeps {
  readonly dataDir: string;
  readonly fs: PluginStoreFs;
  /** 配置声明面取值器（plugin-boot configFaceOf——换代取值器） */
  readonly configFaceOf: (
    pluginId: string,
  ) => { readonly fields: readonly ConfigField[]; readonly hostDefaults?: unknown } | undefined;
  /** 问询面（sessionId 已绑定） */
  readonly ask: PluginConfigAskFace;
  /** 凭证存在性读面（secret 现值判在与 required 终判——只读不呈现值） */
  readonly getCredential: (namespace: string, provider: string) => { readonly apiKey: string } | undefined;
  /** 凭证写面（secret 答值入盒） */
  readonly setCredential: (
    namespace: string,
    provider: string,
    entry: { readonly apiKey: string; readonly meta?: unknown },
  ) => void;
  /** credentials/changed 审计 seam（c-5 同形——值恒不入载荷） */
  readonly onCredentialChanged?: (payload: CredentialChangedPayload) => void;
  /** 成功尾自动链 /reload（fire-and-forget） */
  readonly requestReload: () => void;
}

/** boolean 呈现词（人读形） */
const onOff = (v: boolean): string => (v ? '开' : '关');

/**
 * 表单腿主入口（id → 结算形）。异常问询（取消/abort/通道断）整次放弃——
 * 捕获为诚实回执，不向上抛（TUI 装配面只消费 text）。
 */
export async function runPluginConfigForm(
  pluginId: string,
  deps: PluginConfigFormDeps,
): Promise<PluginsCommandOutcome> {
  const face = deps.configFaceOf(pluginId);
  if (face === undefined) {
    return { ok: false, text: `插件 ${pluginId} 无声明配置面（configSchema 缺席）——无可编辑字段。` };
  }
  // 现行行读（未声明键透传源 + 行内现值）；损坏 = fail-loud 诚实拒（不写防覆盖）
  const read = readEnabledRowsForEdit(deps.dataDir, deps.fs);
  if (!read.ok) return { ok: false, text: read.message };
  const row = read.rows.find((r) => r.id === pluginId);
  const rowConfig: Record<string, unknown> =
    typeof row?.config === 'object' && row.config !== null && !Array.isArray(row.config) ? { ...row.config } : {};
  const defaults: Record<string, unknown> =
    typeof face.hostDefaults === 'object' && face.hostDefaults !== null && !Array.isArray(face.hostDefaults)
      ? { ...(face.hostDefaults as Record<string, unknown>) }
      : {};

  try {
    // —— 逐字段问答（03 §1.2 表单条款——text/secret→input、boolean→confirm、select→select）——
    const next: Record<string, unknown> = {}; // 落行值（非 secret）
    const secrets: { key: string; value: string }[] = []; // 入盒值
    const receipt: string[] = []; // 回执逐字段行（呈现纪律：secret 恒遮蔽）
    for (const field of face.fields) {
      const label = field.label ?? field.key;
      const hint = field.description === undefined ? '' : `\n  ${field.description}`;
      // 生效现值 = 行 config ?? 宿主默认 ?? 字段 default（装载合成序同源）
      const currentRaw = field.key in rowConfig ? rowConfig[field.key] : defaults[field.key];
      const fromRow = field.key in rowConfig;
      // 字段 default 的型外安全读（secret 型无 default 位——判别联合外共取须窄化）
      const fieldDefault = 'default' in field ? field.default : undefined;
      const defaultSource = fromRow ? rowConfig[field.key] : (defaults[field.key] ?? fieldDefault);

      if (field.type === 'text') {
        const placeholder = typeof currentRaw === 'string' ? currentRaw : undefined;
        const answer = await deps.ask.input(
          `${label}：${hint}`,
          placeholder === undefined ? undefined : { placeholder },
        );
        // 空答 = 保留现值（清除值不可达——v1 诚实面：清值走手编 enabled.yaml）
        const value = answer !== '' ? answer : typeof currentRaw === 'string' ? currentRaw : field.default;
        if (value === undefined) {
          if (field.required === true) {
            return { ok: false, text: `必填字段 ${field.key}（text）无值——整次放弃（零写盘）。` };
          }
          receipt.push(`  ${field.key} =（缺席）`);
          continue;
        }
        if (fromRow || value !== defaultSource) next[field.key] = value; // 缺省烘焙回避
        receipt.push(`  ${field.key} = ${value}`);
        continue;
      }
      if (field.type === 'secret') {
        const ns = pluginNamespace(pluginId);
        const name = `config:${field.key}`;
        const exists = deps.getCredential(ns, name) !== undefined;
        const answer = await deps.ask.input(`${label}（敏感——入凭证盒不落 yaml）：${hint}`, {
          placeholder: exists ? '留空保留现值' : '未设置——输入新值',
        });
        if (answer !== '') {
          secrets.push({ key: field.key, value: answer });
          receipt.push(`  ${field.key} = ***（凭证盒，已更新）`);
        } else if (exists) {
          receipt.push(`  ${field.key} = ***（凭证盒，保留现值）`);
        } else if (field.required === true) {
          return { ok: false, text: `必填 secret 字段 ${field.key} 未提供且凭证盒无现值——整次放弃（零写盘）。` };
        } else {
          receipt.push(`  ${field.key} =（未设置）`);
        }
        continue;
      }
      if (field.type === 'boolean') {
        const current = typeof currentRaw === 'boolean' ? currentRaw : (field.default ?? false);
        const value = await deps.ask.confirm(`${label}？（当前 ${onOff(current)}——确认 = 开 / 取消答复 = 关）${hint}`);
        if (fromRow || value !== defaultSource) next[field.key] = value;
        receipt.push(`  ${field.key} = ${onOff(value)}`);
        continue;
      }
      // select：choices 即声明 options（值域单源——出值域答复结构性不可达）
      const choices: readonly UiSelectChoice[] = field.options;
      const current = typeof currentRaw === 'string' ? currentRaw : field.default;
      const value = await deps.ask.select(
        `${label}${current === undefined ? '' : `（当前 ${current}）`}:${hint}`,
        choices,
      );
      if (fromRow || value !== defaultSource) next[field.key] = value;
      receipt.push(`  ${field.key} = ${value}`);
    }

    // —— 落盘序：行 config 整值替换（未声明键透传）→ secret 入盒 → reload ——
    const undeclared = Object.keys(rowConfig).filter((k) => !face.fields.some((f) => f.key === k));
    const newRowConfig: Record<string, unknown> = {};
    for (const key of undeclared) newRowConfig[key] = rowConfig[key]; // 未声明键原样透传
    for (const [key, value] of Object.entries(next)) newRowConfig[key] = value;
    // 行缺席且新 config 为空 = 零覆盖需求（全随缺省）——不造 overlay 空行；
    // 行在场则照写（幂等归一，未声明键清面场景亦达）
    const rowWriteNeeded = row !== undefined || Object.keys(newRowConfig).length > 0;
    if (rowWriteNeeded) {
      const write = setRowConfig(deps.dataDir, pluginId, newRowConfig, deps.fs);
      if (!write.ok) return { ok: false, text: write.message };
    }
    const ns = pluginNamespace(pluginId);
    for (const { key, value } of secrets) {
      deps.setCredential(ns, `config:${key}`, { apiKey: value, meta: { source: 'manual' } });
      deps.onCredentialChanged?.({ namespace: ns, name: `config:${key}`, action: 'add', origin: 'human' });
    }
    const changed = rowWriteNeeded || secrets.length > 0;
    if (changed) deps.requestReload();

    // 呈现纪律内嵌于回执逐字段行（secret 恒 '***'——secret 值结构性不落行，
    // maskConfigSecrets 的装载呈现位在 dump-config/list 面，此面无需再过一道）
    const undeclaredLine =
      undeclared.length === 0 ? '' : `\n未声明键透传 ${undeclared.length} 个：${undeclared.join('、')}`;
    const head = changed
      ? `已更新 ${pluginId} 配置（行 config 整值替换 + secret 入凭证盒）——已自动链 /reload（会话运行中自动排队，run 收场后执行）`
      : `无变更——全随缺省（值等于缺省源不落行，行是覆盖仓不烙缺省）`;
    return {
      ok: true,
      text: `${head}\n${receipt.join('\n')}${undeclaredLine}`,
    };
  } catch (err) {
    // 取消/通道断 = 整次放弃（零写盘——行写盘在全部问询之后，此捕获点必然先于一切写）
    return {
      ok: false,
      text: `已取消——${pluginId} config 编辑整次放弃（零写盘零凭证写）：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
