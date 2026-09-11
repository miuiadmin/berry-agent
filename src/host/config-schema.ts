/**
 * host/config-schema — 插件配置字段声明面（03 §1.2 configSchema 条款；
 * 2026-09-11 交互动词族批 ix-3）。
 *
 * 字段描述数组（letta channel.json `config_schema` 形）——JSON 可序列化、
 * 字段型闭集可控，宿主侧编译为校验器；typebox JSON Schema 原生形不采
 * （插件清单是 package.json 纯 JSON，typebox Type 对象不可序列化进清单，
 * 且 secret 凭证域联动在原生 JSON Schema 无语义位——RP4 改裁）。
 *
 * 双消费源（03 §1.2）：①装载期字段级校验（本件 synthesizePluginConfig
 * ——PLUGIN_CONFIG_INVALID 执法源，行 config 与宿主默认 config 双源过校验）；
 * ②TUI `/plugins config <id>` 表单腿（fields 驱动逐字段问答，ix-3c 接线）。
 *
 * 合成序（03 §1.2 通用字段位 default 句）：行 config 整值覆盖宿主默认 →
 * 声明字段过字段级校验 → 余键字段 default 兜底 → secret 键凭证直取注回 →
 * 未声明键原样透传。呈现纪律：一切人面呈现位 secret 值遮蔽 `'***'`
 * （maskConfigSecrets——明文只进 apply config 实参与凭证盒读写）。
 */
import { BaseError } from '../contracts/index.js';

/** select 型选项（形同 07 §4.3 select 签名内联形 UiSelectChoice——名在 contracts） */
export interface ConfigSelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * 配置字段描述（四型判别联合——字段型 v1 四值闭集，闭集外值 = PLUGIN_SHAPE_INVALID）。
 * 通用字段位：key（必携，词法 `^[a-z][a-z0-9-]*$` 与插件 id 同形）/ type（必携）/
 * label / description / required / default（text/boolean/select 三型可选——secret 无 default）。
 */
export type ConfigField =
  | {
      readonly key: string;
      readonly type: 'text';
      readonly label?: string;
      readonly description?: string;
      readonly required?: boolean;
      readonly default?: string;
    }
  | {
      readonly key: string;
      readonly type: 'secret';
      readonly label?: string;
      readonly description?: string;
      readonly required?: boolean;
    }
  | {
      readonly key: string;
      readonly type: 'select';
      readonly label?: string;
      readonly description?: string;
      readonly required?: boolean;
      readonly default?: string;
      readonly options: readonly ConfigSelectOption[];
    }
  | {
      readonly key: string;
      readonly type: 'boolean';
      readonly label?: string;
      readonly description?: string;
      readonly required?: boolean;
      readonly default?: boolean;
    };

/** 配置键词法：小写字母/数字/连字符，首字符字母（与插件 id 同形——YAML 键友好、点/斜杠/冒号禁入防路径歧义） */
const CONFIG_KEY_RE = /^[a-z][a-z0-9-]*$/;

/** 字段型闭集（v1 四值） */
const FIELD_TYPES = new Set(['text', 'secret', 'select', 'boolean']);

/** 字段对象已知键闭集（未知键拒绝式——拼写错误当场红） */
const FIELD_KEYS = new Set(['key', 'type', 'label', 'description', 'required', 'default', 'options']);

/**
 * 清单 configSchema 深校验（纯函数——PLUGIN_SHAPE_INVALID 面）。
 *
 * 执法项：数组形 / 逐字段对象形 / key 必携且过词法 / type 四值闭集 /
 * select 必携非空 options（value/label 字符串）/ default 型匹配
 * （text·select 须字符串、boolean 须布尔、secret 携 default 拒）/
 * key 重复拒。失败 message 自带指路（manifest 侧 shapeFail 包装消费）。
 */
export function parseConfigSchemaFields(
  raw: unknown,
  opts: { pluginId: string },
): { ok: true; fields: readonly ConfigField[] } | { ok: false; message: string } {
  const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail(`berryAgent.configSchema 须为非空字段描述数组（插件 ${opts.pluginId}）`);
  }
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return fail(`configSchema 字段描述须为对象（插件 ${opts.pluginId}）`);
    }
    const field = item as Record<string, unknown>;
    for (const key of Object.keys(field)) {
      if (!FIELD_KEYS.has(key)) {
        return fail(
          `configSchema 字段未知键 "${key}"（插件 ${opts.pluginId}）——闭集：key/type/label/description/required/default/options`,
        );
      }
    }
    const key = field['key'];
    if (typeof key !== 'string' || !CONFIG_KEY_RE.test(key)) {
      return fail(
        `configSchema 字段 key "${String(key)}" 违词法 ^[a-z][a-z0-9-]*$（插件 ${opts.pluginId}——与插件 id 同形，点/斜杠/冒号禁入）`,
      );
    }
    if (seen.has(key)) {
      return fail(`configSchema 字段 key "${key}" 重复出现（插件 ${opts.pluginId}）`);
    }
    seen.add(key);
    const type = field['type'];
    if (typeof type !== 'string' || !FIELD_TYPES.has(type)) {
      return fail(
        `configSchema 字段 "${key}" 型 "${String(type)}" 不在闭集 text/secret/select/boolean（插件 ${opts.pluginId}）`,
      );
    }
    if (field['label'] !== undefined && typeof field['label'] !== 'string') {
      return fail(`configSchema 字段 "${key}" label 须字符串（插件 ${opts.pluginId}）`);
    }
    if (field['description'] !== undefined && typeof field['description'] !== 'string') {
      return fail(`configSchema 字段 "${key}" description 须字符串（插件 ${opts.pluginId}）`);
    }
    if (field['required'] !== undefined && typeof field['required'] !== 'boolean') {
      return fail(`configSchema 字段 "${key}" required 须布尔（插件 ${opts.pluginId}）`);
    }
    if (type === 'secret') {
      if (field['default'] !== undefined) {
        return fail(
          `configSchema secret 型字段 "${key}" 不得携 default（插件 ${opts.pluginId}——敏感值缺省走凭证盒，不落清单明文）`,
        );
      }
      continue; // secret 无 options/default 两判位
    }
    if (type === 'select') {
      const options = field['options'];
      const badOption = (o: unknown): boolean => {
        if (typeof o !== 'object' || o === null) return true;
        const opt = o as Record<string, unknown>;
        return typeof opt['value'] !== 'string' || opt['value'].length === 0 || typeof opt['label'] !== 'string';
      };
      if (!Array.isArray(options) || options.length === 0 || options.some(badOption)) {
        return fail(
          `configSchema select 型字段 "${key}" 必携非空 options: { value, label }[]（插件 ${opts.pluginId}）`,
        );
      }
    }
    if (field['default'] !== undefined) {
      const expected = type === 'boolean' ? 'boolean' : 'string';
      if (typeof field['default'] !== expected) {
        return fail(`configSchema 字段 "${key}" default 须 ${expected} 型（插件 ${opts.pluginId}）`);
      }
    }
  }
  return { ok: true, fields: raw as readonly ConfigField[] };
}

/** 合成器输入（装载位——loader loadRow 组装） */
export interface SynthesizeConfigInput {
  readonly pluginId: string;
  /** 字段声明面（缺席 = 行为零变化——无字段级校验、无合成，原值直传） */
  readonly fields?: readonly ConfigField[];
  /** 启用行 config（整值覆盖源一） */
  readonly rowConfig?: unknown;
  /** 宿主侧默认 config（清单 config 键 / core 引用形 config 位） */
  readonly defaultConfig?: unknown;
  /** 凭证读面（宿主装载序直取 plugin:<id> 域——缺席 = secret 恒缺席） */
  readonly getSecret?: (key: string) => string | undefined;
  /** required-secret 诊断豁免（:memory: 同构诊断形 true——缺席拒降级 warn 提示行，装载照走） */
  readonly allowMissingRequiredSecret?: boolean;
  /** 降级 warn 落点（豁免提示行；缺席 = 不记） */
  readonly warn?: (message: string) => void;
}

/**
 * 装载位配置合成（03 §1.2 合成序——PLUGIN_CONFIG_INVALID 执法源）。
 *
 * configSchema 缺席时行为零变化：返回 rowConfig ?? defaultConfig 原值
 * （不校验不合成——config 键与 configSchema 键分立后各单源）。在场时：
 * ① base = 行 config ?? 宿主默认（整值替换非合并）；② secret 型键在
 * base 出现即拒（明文拒双源同律——行 config 与清单 config 均拒，
 * message 分流指路：行侧指路 /plugins config 表单、清单侧指路作者
 * 从 package.json 删该键）；③ 声明字段过字段级校验（text 须字符串 /
 * boolean 须布尔 / select 须 options 值域内；required 合成后值缺席拒）；
 * ④ 余键字段 default 兜底；⑤ secret 键凭证直取注回（缺席即不注——
 * required 的 secret 缺席走诊断豁免位）；⑥ 未声明键原样透传。
 */
export function synthesizePluginConfig(input: SynthesizeConfigInput): unknown {
  if (input.fields === undefined || input.fields.length === 0) {
    // 行为零变化档：整值回落原样透传（磁盘轨旧 typebox 消费路径已拆——无 schema 即无校验）
    return input.rowConfig !== undefined ? input.rowConfig : input.defaultConfig;
  }
  const base = input.rowConfig !== undefined ? input.rowConfig : input.defaultConfig;
  const configInvalid = (message: string): never => {
    throw new BaseError('PLUGIN_CONFIG_INVALID', `${message}（插件 ${input.pluginId}）`);
  };
  if (base !== undefined && (typeof base !== 'object' || Array.isArray(base))) {
    configInvalid('config 须为对象（整值替换非合并）');
  }
  const baseRecord = (base ?? {}) as Record<string, unknown>;

  // ② secret 明文拒（双源同律——message 分流指路）
  for (const field of input.fields) {
    if (field.type !== 'secret') continue;
    if (!(field.key in baseRecord)) continue;
    if (input.rowConfig !== undefined && field.key in (input.rowConfig as object)) {
      configInvalid(
        `行 config 携 secret 型键 "${field.key}" 明文值拒——secret 值不落 enabled.yaml（走 /plugins config 表单写凭证盒，加密存储语义不容 yaml 明文旁路）`,
      );
    }
    configInvalid(
      `清单 config 键（宿主默认值位）携 secret 型键 "${field.key}" 明文值拒——从 package.json 删该键、走表单/凭证盒（package.json 随 npm 分发明文更烈）`,
    );
  }

  // ③④⑤ 逐声明字段：在场过校验 → 缺席 default 兜底 → secret 凭证直取 → required 终判
  const merged: Record<string, unknown> = { ...baseRecord }; // ⑥ 未声明键随展开原样透传
  for (const field of input.fields) {
    const present = field.key in merged;
    if (field.type === 'secret') {
      // secret 只走凭证直取（base 里的明文已在上一步拒掉——此处值必缺席）
      const secret = input.getSecret?.(field.key);
      if (secret !== undefined) {
        merged[field.key] = secret;
      } else if (field.required === true) {
        if (input.allowMissingRequiredSecret === true) {
          // 诊断豁免（07 §5 dump-config）：:memory: 形凭证盒结构性恒空——降级 warn 提示行装载照走
          input.warn?.(
            `插件 ${input.pluginId} required secret 字段 "${field.key}" 未合成——凭证盒 :memory: 空诊断形豁免（真实装载将拒载 PLUGIN_CONFIG_INVALID）`,
          );
        } else {
          configInvalid(`required secret 字段 "${field.key}" 凭证盒缺席——经 /plugins config 表单或 credentials 域写入`);
        }
      }
      continue;
    }
    if (present) {
      const value = merged[field.key];
      if (field.type === 'text' && typeof value !== 'string') {
        configInvalid(`config 字段 "${field.key}"（text 型）须字符串`);
      }
      if (field.type === 'boolean' && typeof value !== 'boolean') {
        configInvalid(`config 字段 "${field.key}"（boolean 型）须布尔`);
      }
      if (field.type === 'select' && (typeof value !== 'string' || !field.options.some((o) => o.value === value))) {
        configInvalid(`config 字段 "${field.key}"（select 型）值不在 options 值域内`);
      }
      continue;
    }
    if (field.default !== undefined) {
      merged[field.key] = field.default; // ④ 字段级缺省兜底
    } else if (field.required === true) {
      configInvalid(`required 字段 "${field.key}" 合成后缺席——/reload 时刻可修`);
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * 呈现纪律（03 §1.2——合成结果的一切人面/诊断呈现位）：secret 型键值
 * 遮蔽占位符 `'***'`。纯函数不改性参——返回遮蔽副本（明文只进 apply
 * config 实参与凭证盒读写；打印面即外泄面）。
 */
export function maskConfigSecrets(fields: readonly ConfigField[] | undefined, config: unknown): unknown {
  if (fields === undefined || typeof config !== 'object' || config === null) return config;
  const record = config as Record<string, unknown>;
  let masked: Record<string, unknown> | undefined;
  for (const field of fields) {
    if (field.type !== 'secret' || !(field.key in record)) continue;
    masked ??= { ...record };
    masked[field.key] = '***';
  }
  return masked ?? config;
}
