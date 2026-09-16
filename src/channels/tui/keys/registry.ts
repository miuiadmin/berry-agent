/**
 * 声明式键位注册表（07 §4.1 R5 批 10i——两层基座）。
 *
 * 两层：引擎原始键面（InputEvent——路由层消费的物理事实）与应用**动作面**
 * （本册——动作 id 英文蛇形 + 缺省键位同册单源）。keyText(动作id) 从册上
 * 动态取当前键名（用户覆盖后文案随动——thinking 标签的键名提示等显示面
 * 单源消费）。
 *
 * 本批接线面：全局键（ctrl+c / ctrl+d——不可覆盖）+ thinking.toggle /
 * tools.toggle-expand 两动作 + **编辑器族 dispatch 迁册**（批 10j——editor.ts
 * 内部键表退役，册为唯一真源；yank / yank-pop 两动作随 R3 kill-ring 同批入册）。
 * keyText 与冲突检测的判据域随册走。缺省册自身的历史双绑（ctrl+d = 全局退出 /
 * 编辑器删字——分层消解的既定形：空框退出、非空删字）按「键 → 动作集」整集
 * 对拍缺省册放行（见 conflict 检测注）。
 *
 * 用户覆盖（settings.json `keybindings` 键——10k 装配接线）经
 * resolveKeybindings 四形校验 fail-loud 点名拒载：未知动作 / 不可覆盖动作 /
 * 畸形键串 / 冲突（覆盖后某键的动作集 ≠ 缺省册该键既有集且非单动作）。
 * 拒载 = 弃该键 + 清单呈报（不炸会话——其余覆盖照常生效）。
 */

/** 动作域（冲突检测与 /help 分组〔10k〕的判据位） */
export type ActionScope = 'global' | 'thinking' | 'tools' | 'editor';

/** 动作定义（册条目——id / 域 / 中文标签 / 缺省键位 / 可覆盖性） */
export interface ActionDef {
  readonly id: string;
  readonly scope: ActionScope;
  readonly label: string;
  readonly keys: readonly string[];
  readonly overridable: boolean;
}

/**
 * 缺省动作册（单源——缺省键位与动作同册）。键串文法：修饰键序 ctrl+alt+
 * shift+ + 键名（单字符或具名键，全小写）；具名键集 = NAMED_KEYS。
 * 编辑器族键位 = editor.ts dispatch 真源（批 10j 迁册——内部键表退役）。
 */
export const ACTION_CATALOG: readonly ActionDef[] = [
  // 全局键（路由层①——不可覆盖：中断与退出是会话生命线）
  { id: 'global.interrupt', scope: 'global', label: '中断当前 run', keys: ['ctrl+c'], overridable: false },
  { id: 'global.quit', scope: 'global', label: '退出（空框时）', keys: ['ctrl+d'], overridable: false },
  // 模型循环（挂账解挂批 2026-09-15——ctrl+p 轮换会话模型；层③.5 应用动作路）
  {
    id: 'global.model-cycle',
    scope: 'global',
    label: '切换模型（下一 run 生效）',
    keys: ['ctrl+p'],
    overridable: true,
  },
  // 思考块开关（批 10i——会话级折叠/展开）
  { id: 'thinking.toggle', scope: 'thinking', label: '思考块折叠/展开', keys: ['ctrl+t'], overridable: true },
  // 工具卡开关（批 10i——会话级展开/收起）
  { id: 'tools.toggle-expand', scope: 'tools', label: '工具卡展开/收起', keys: ['ctrl+o'], overridable: true },
  // 编辑器族（批 10j 迁册——dispatch 真源）
  { id: 'editor.submit', scope: 'editor', label: '提交输入', keys: ['enter'], overridable: true },
  // 候跑提交（挂账解挂批 2026-09-15——alt+enter 提交携候跑标记：busy 期显式
  // 排队候 run 终态种子新 run，不顶注不打断在飞 run；与 enter 键序分立）
  { id: 'editor.queue-followup', scope: 'editor', label: '提交并排队候跑', keys: ['alt+enter'], overridable: true },
  { id: 'editor.new-line', scope: 'editor', label: '换行', keys: ['shift+enter', 'ctrl+j'], overridable: true },
  { id: 'editor.undo', scope: 'editor', label: '撤销', keys: ['ctrl+-', 'ctrl+_'], overridable: true },
  { id: 'editor.move-left', scope: 'editor', label: '光标左移', keys: ['left', 'ctrl+b'], overridable: true },
  { id: 'editor.move-right', scope: 'editor', label: '光标右移', keys: ['right', 'ctrl+f'], overridable: true },
  {
    id: 'editor.move-word-left',
    scope: 'editor',
    label: '左移一词',
    keys: ['alt+left', 'ctrl+left', 'alt+b'],
    overridable: true,
  },
  {
    id: 'editor.move-word-right',
    scope: 'editor',
    label: '右移一词',
    keys: ['alt+right', 'ctrl+right', 'alt+f'],
    overridable: true,
  },
  { id: 'editor.line-start', scope: 'editor', label: '行首', keys: ['home', 'ctrl+a'], overridable: true },
  { id: 'editor.line-end', scope: 'editor', label: '行尾', keys: ['end', 'ctrl+e'], overridable: true },
  { id: 'editor.jump-forward', scope: 'editor', label: '跳至下一空行', keys: ['ctrl+]'], overridable: true },
  { id: 'editor.jump-backward', scope: 'editor', label: '跳至上一空行', keys: ['ctrl+alt+]'], overridable: true },
  { id: 'editor.page-up', scope: 'editor', label: '编辑器上翻页', keys: ['pageup'], overridable: true },
  { id: 'editor.page-down', scope: 'editor', label: '编辑器下翻页', keys: ['pagedown'], overridable: true },
  { id: 'editor.delete-backward', scope: 'editor', label: '向前删字符', keys: ['backspace'], overridable: true },
  { id: 'editor.delete-forward', scope: 'editor', label: '向后删字符', keys: ['delete', 'ctrl+d'], overridable: true },
  {
    id: 'editor.delete-word-backward',
    scope: 'editor',
    label: '向前删一词',
    keys: ['ctrl+w', 'alt+backspace'],
    overridable: true,
  },
  {
    id: 'editor.delete-word-forward',
    scope: 'editor',
    label: '向后删一词',
    keys: ['alt+d', 'alt+delete'],
    overridable: true,
  },
  { id: 'editor.delete-to-line-start', scope: 'editor', label: '删至行首', keys: ['ctrl+u'], overridable: true },
  { id: 'editor.delete-to-line-end', scope: 'editor', label: '删至行尾', keys: ['ctrl+k'], overridable: true },
  // kill-ring 消费键（R3 批 10j——kill 族键位即上方词删/行删既有条目，入环是行为升级非新键）
  { id: 'editor.yank', scope: 'editor', label: '粘贴最近 kill 段', keys: ['ctrl+y'], overridable: true },
  { id: 'editor.yank-pop', scope: 'editor', label: '环游标步进替换', keys: ['alt+y'], overridable: true },
  { id: 'editor.history-prev', scope: 'editor', label: '上一条历史', keys: ['up'], overridable: true },
  { id: 'editor.history-next', scope: 'editor', label: '下一条历史', keys: ['down'], overridable: true },
];

/** 具名键全集（键串文法的非单字符键位——键名与 InputDecoder 输出形同源小写） */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  'enter',
  'escape',
  'tab',
  'backspace',
  'delete',
  'insert',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'space',
]);

/** 键串文法校验：修饰键（固序可选项 ctrl+alt+shift+——序错即畸形）+ 单字符（非空白可打印）或具名键 */
function isValidBinding(binding: string): boolean {
  const match = /^(?:ctrl\+)?(?:alt\+)?(?:shift\+)?(\S.*)$/.exec(binding);
  if (match === null) return false;
  const key = match[1]!;
  if (key.includes('+')) return false; // 键位段内不纳 '+' 号本身之外的修饰残留（畸形形）
  return key.length === 1 ? /[^\s]/.test(key) : NAMED_KEYS.has(key);
}

/** 路由消费的键事实形（engine InputEvent 的窄面——键 + 修饰位族） */
export interface KeyInput {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

/**
 * 动作投影（R5 批 10k /help 键位册数据源）：册条目 + 解析后当前键集
 * （用户覆盖生效形——拒载已回退缺省，投影只呈生效态）。
 */
export interface ActionView {
  readonly id: string;
  readonly scope: ActionScope;
  readonly label: string;
  readonly keys: readonly string[];
}

/**
 * 键事件 → 规范键串（'ctrl+t' / 'alt+ctrl+]' / 'shift+enter' 形——修饰键序
 * 恒 ctrl+alt+shift+）。meta 修饰返回 null 不入门（macOS cmd 家族留终端与
 * 系统——不与终端快捷键争键）。
 */
export function keyEventToBinding(ev: KeyInput): string | null {
  if (ev.meta === true) return null;
  let prefix = '';
  if (ev.ctrl === true) prefix += 'ctrl+';
  if (ev.alt === true) prefix += 'alt+';
  if (ev.shift === true) prefix += 'shift+';
  return prefix + ev.key.toLowerCase();
}

/** 拒载形（四形——见件头注；detail 为点名文案） */
export interface KeybindingRejection {
  readonly kind: 'unknown-action' | 'not-overridable' | 'malformed-binding' | 'conflict';
  readonly actionId?: string;
  readonly binding?: string;
  readonly detail: string;
}

/** 解析产物：动作 → 当前键集（缺省或覆盖后）+ 拒载清单 */
export interface ResolvedKeybindings {
  readonly keysByAction: ReadonlyMap<string, readonly string[]>;
  readonly rejections: readonly KeybindingRejection[];
}

/** 缺省册索引（id → 定义——O(1) 查阅位） */
const CATALOG_BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTION_CATALOG.map((def) => [def.id, def]));

/**
 * 用户覆盖解析 + 校验（纯函数——装配面与测试直锁消费）。
 *
 * 冲突判据：把「缺省册 + 已受理覆盖」全量倒排成 键 → 动作集；某键的动作集
 * 超过一个时，与缺省册该键的动作集整集对拍——**恰等**才放行（缺省册既有
 * 的分层消耦双绑〔ctrl+d〕是既定形），否则该键上所有覆盖条目全数拒载
 * （回退缺省键位，点名冲突对）。
 */
export function resolveKeybindings(overrides?: Readonly<Record<string, string>>): ResolvedKeybindings {
  // 第一步：逐条预检（未知动作 / 不可覆盖 / 畸形键串——此三形只涉单条，直接拒）
  const staged = new Map<string, string>(); // 已预检受理的覆盖（动作 → 键串）
  const rejections: KeybindingRejection[] = [];
  if (overrides !== undefined) {
    for (const [actionId, binding] of Object.entries(overrides)) {
      const def = CATALOG_BY_ID.get(actionId);
      if (def === undefined) {
        rejections.push({ kind: 'unknown-action', actionId, detail: `未知动作 ${actionId}——不在动作册` });
        continue;
      }
      if (!def.overridable) {
        rejections.push({ kind: 'not-overridable', actionId, binding, detail: `${def.label}（${actionId}）不可覆盖` });
        continue;
      }
      if (!isValidBinding(binding)) {
        rejections.push({
          kind: 'malformed-binding',
          actionId,
          binding,
          detail: `键串 ${binding} 不合文法（ctrl+alt+shift+ 修饰序 + 单字符/具名键）`,
        });
        continue;
      }
      staged.set(actionId, binding); // 后写覆盖前写（同动作多条以末条为准——对象键序语义）
    }
  }

  // 第二步：冲突检测（键 → 动作集整集对拍缺省册）
  const keysByAction = new Map<string, readonly string[]>(ACTION_CATALOG.map((def) => [def.id, def.keys]));
  if (staged.size > 0) {
    for (const [actionId, binding] of staged) keysByAction.set(actionId, [binding]);
    // 倒排：键 → 动作集（受理后的全量形）
    const actionsByBinding = new Map<string, Set<string>>();
    for (const [actionId, keys] of keysByAction) {
      for (const key of keys) {
        const set = actionsByBinding.get(key) ?? new Set<string>();
        set.add(actionId);
        actionsByBinding.set(key, set);
      }
    }
    // 缺省册倒排（对拍基准——不随覆盖动）
    const defaultActionsByBinding = new Map<string, Set<string>>();
    for (const def of ACTION_CATALOG) {
      for (const key of def.keys) {
        const set = defaultActionsByBinding.get(key) ?? new Set<string>();
        set.add(def.id);
        defaultActionsByBinding.set(key, set);
      }
    }
    // 越集即冲突：该键上的覆盖条目全数拒载（回退缺省）
    const conflicted = new Set<string>(); // 已拒载动作（去重——一动作只报一次）
    for (const [binding, actions] of actionsByBinding) {
      if (actions.size < 2) continue; // 单动作键无冲突
      const preset = defaultActionsByBinding.get(binding);
      if (preset !== undefined && setsEqual(preset, actions)) continue; // 缺省册既有集——分层双绑既定形
      for (const actionId of actions) {
        if (!staged.has(actionId) || staged.get(actionId) !== binding || conflicted.has(actionId)) continue;
        conflicted.add(actionId);
        const peer = [...actions].filter((id) => id !== actionId).join(', ');
        rejections.push({
          kind: 'conflict',
          actionId,
          binding,
          detail: `键 ${binding} 冲突：${actionId} 与 ${peer} 同键（非缺省册既有集）`,
        });
      }
    }
    // 拒载回退：冲突动作回缺省键位
    for (const actionId of conflicted) {
      const def = CATALOG_BY_ID.get(actionId);
      if (def !== undefined) keysByAction.set(actionId, def.keys);
    }
  }
  return { keysByAction, rejections };
}

/** 集合相等（小集合全包含判定——册规模几十条，O(n²) 无虞） */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * 键位注册表消费面（TuiBackend 装配位持有一个实例——会话级只读）。
 * rejections 非空时装配面负责呈报（拒载键不生效但点名可见——fail-loud）。
 */
export class Keymap {
  private readonly keysByAction: ReadonlyMap<string, readonly string[]>;
  readonly rejections: readonly KeybindingRejection[];

  constructor(overrides?: Readonly<Record<string, string>>) {
    const resolved = resolveKeybindings(overrides);
    this.keysByAction = resolved.keysByAction;
    this.rejections = resolved.rejections;
  }

  /** 事件命中判定（动作当前键集含该事件的规范键串即命中） */
  actionMatches(ev: KeyInput, actionId: string): boolean {
    const binding = keyEventToBinding(ev);
    return binding !== null && (this.keysByAction.get(actionId)?.includes(binding) ?? false);
  }

  /** 动作当前首键名（显示面单源——覆盖后随动；未知动作返空串） */
  keyText(actionId: string): string {
    return this.keysByAction.get(actionId)?.[0] ?? '';
  }

  /**
   * 动作册投影（R5 批 10k——/help 键位册数据源）：id/域/中文标签/解析后
   * 键集（拒载回退后的生效形）。册序恒定（ACTION_CATALOG 声明序）。
   */
  get actions(): readonly ActionView[] {
    return ACTION_CATALOG.map((def) => ({
      id: def.id,
      scope: def.scope,
      label: def.label,
      keys: this.keysByAction.get(def.id) ?? def.keys,
    }));
  }
}
