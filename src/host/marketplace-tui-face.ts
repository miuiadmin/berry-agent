/**
 * host/marketplace-tui-face —— /marketplace 选装副屏的 host 侧编舞面
 * （03 §9.6 mp-5 TUI 选装面）：纯逻辑件（零 UI 触感）——行集装配（快照档
 * 零网络）+ 四动作长编舞（busy 单槽 + fire-and-forget + settle 回执）。
 *
 * - **消费服务面零绕过**：装机/卸载/换装/刷新八动词不在此重实现——install/
 *   uninstall/upgrade/update 全经注入的 runEntry（生产装配 = marketplace-cmd
 *   的 runMarketplaceEntry——CLI 服务函数族单源；回执经 writeOut/writeErr
 *   注入捕获，报文构造位消毒不变）；
 * - **开屏零网络**：open() 走 discoverMarketplaces **不传 fetch**——缓存即
 * 真相（fetch 注入位缺席 = 恒零网络纯读），面板行集是快照档；
 * - **r = 恒回源**：refresh 动词 = update（手动档整源刷新真身自带强制重取
 *   ——鲜缓存亦回源，非 discover 的 TTL 惰性腿），settle 后零网络重读缓存
 *   换行集；本面永不自带 fetch（网络真身归 CLI 服务面内部缺省）；
 * - **busy 单槽**：busyLabel 非 null 期间任何动作再发 = notify warn 拒
 *   （面板锁键是第一道，本面是第二道 fail-loud——enter 路面板已收屏，锁
 *   只能靠本面）；槽跨双相 uninstall 全程（inspect→用户裁决→execute 连续
 *   持有，裁决窗不放进第二个动作）；
 * - **双相 uninstall**：inspect（confirm:false，回执即核查清单）→ 用户裁决
 *   （channels select 三选 cancel/keep/purge——装配位接）→ execute
 *   （confirm:true + dataAction）；
 * - **开跑 / 结束各一行 notify（编舞①）**：起跑位一行（enter 路副屏已收
 *   ——npm/git 腿 30s+ 等待期主屏反馈位；与面板 busy 底行互补不重复——
 *   notify 是瞬时行、busy 底行在副屏）+ settle 位一行归因；双相 uninstall
 *   全程恰一行（inspect 起跑位发，execute 相不重复）；
 * - **settle 三件事**：results 结算块回填（保行结构逐行消毒——CLI 构造位已
 *   消毒，此处 sanitizeBlock 单源纵深再过）+ notify 归因（动词 + 退出码 +
 *   回执去向指路）+ 装机面变更自动链 requestReload（install/uninstall/
 *   upgrade 成功——refresh 不触发）+ 自动链提示行（编舞④——「已自动链
 *   /reload」完成行之后的第二行，与 /plugins 写动词尾句单源同文）。
 *
 * 模型（rows/tail/results/busyLabel）host 拥有跨开屏持久：busy/results
 * 跨开屏存活（enter 收屏后动作在飞，重开 /marketplace 可见 busy 行与结算
 * 回执）；rows/tail 每次开屏现取。
 */
import type { MarketEntryRow, MarketPanelActions, MarketPanelModel } from '../channels/index.js';
import type { MarketplaceCommand } from './cli.js';
import { discoverMarketplaces, sanitizeBlock, sanitizeLine } from './plugin-market/index.js';
import type { MarketFs } from './plugin-market/index.js';

/**
 * /reload 自动链提示句（编舞④）：与 /plugins 写动词成功尾句
 * （plugins-command / plugins-config 两面）单源同文——三面各自诚实律的同文
 * 腿；文案改动须三面同步（跨件抽公共常量归主会话统一处置——本件域内自持
 * 同文，测试以完整句等值锚防漂移）。
 */
const RELOAD_AUTO_CHAIN_NOTIFY = '已自动链 /reload（会话运行中自动排队，run 收场后执行）';

/** notify 级位（channels service notify 同词汇——结构兼容面） */
export type FaceNotifyLevel = 'info' | 'warn' | 'error';

/** 双相 uninstall 第二相用户裁决值（--data 语义三分——§5.5 词汇） */
export type UninstallChoice = 'cancel' | 'keep' | 'purge';

/** 回执捕获注入面（runMarketplaceEntry 的 writeOut/writeErr 注入位窄面） */
export interface EntryCapture {
  writeOut(text: string): void;
  writeErr(text: string): void;
}

/**
 * 面板编舞面依赖（全注入——测试假件可全谱编舞；无 fetch 注入位是设计律：
 * 网络真身归 CLI 服务面内部缺省，本面只分派动词）。
 */
export interface MarketplacePanelFaceDeps {
  /** 数据目录（null = 诚实拒——诊断形/无目录态不开屏） */
  readonly dataDir: string | null;
  /** 市场读侧 fs（discoverMarketplaces 消费——createMarketFs() 装配） */
  readonly fs: MarketFs;
  /** 时钟（TTL 判据材料——discover 侧不传 fetch 恒零网络，此刻仅账面） */
  readonly now: () => Date;
  /**
   * CLI 服务面单源（生产 = runMarketplaceEntry 直装）：sub = 动词，capture =
   * 回执捕获注入。返回退出码（0/1；用法错 2 不会到这——sub 由本面构造无解析层）。
   */
  readonly runEntry: (sub: MarketplaceCommand, capture: EntryCapture) => Promise<number>;
  /** 瞬时通知面（backend.notify / channels notify 装配） */
  readonly notify: (message: string, opts?: { level?: FaceNotifyLevel }) => void;
  /** 双相第二相裁决面（inspect 回执全文入、三分抉择出——channels select 装配） */
  readonly confirmUninstall: (inspectText: string) => Promise<UninstallChoice>;
  /** 插件装载面重载（reloader.request() 装配——装机面变更 settle 自动链） */
  readonly requestReload: () => void;
  /** 副屏程序化重画（backend.requestAltRepaint 装配——模型变更可见路） */
  readonly repaint: () => void;
  /** 装机账本 market 注记键集（`entry@market` 形——已装徽标判据单源） */
  readonly ledgerMarketKeys: () => ReadonlySet<string>;
  /** 开副屏面（backend.openMarketplace 装配——false = 副屏占用如实返） */
  readonly openPanel: (model: MarketPanelModel, actions: MarketPanelActions) => boolean;
}

/** 面板可变模型内持形（接口面 readonly——host 侧字段替换式变更） */
interface MutablePanelModel {
  rows: readonly MarketEntryRow[];
  tail: readonly string[];
  results: readonly string[];
  busyLabel: string | null;
}

/**
 * /marketplace 选装面编舞件：一模型（跨开屏）+ 四动作（busy 单槽长编舞）。
 * 装配位 = tui-entry localCommand marketplace（第七件）。
 */
export class MarketplaceTuiFace {
  private readonly model: MutablePanelModel = { rows: [], tail: [], results: [], busyLabel: null };
  private readonly actions: MarketPanelActions;
  private readonly deps: MarketplacePanelFaceDeps;

  constructor(deps: MarketplacePanelFaceDeps) {
    this.deps = deps;
    // 动作面自持（面板注入同一实例——busy 单槽第二道闸在本面方法内执法）
    this.actions = {
      install: (id) => this.install(id),
      uninstall: (id) => this.uninstall(id),
      upgrade: (id) => this.upgrade(id),
      refresh: () => this.refresh(),
    };
  }

  /**
   * 开屏（/marketplace 本地命令受理位）：行集快照现取（零网络——fetch 缺席
   * 纯读缓存）→ 开副屏；副屏占用如实 warn（不排队不顶替——件族同律）。
   * dataDir null = 诚实拒（诊断形无目录，无市场可谈）。busy 在飞期重开照常
   * （busy 行 + 锁键在屏——面板每帧现读模型，跨开屏 busy 槽可见）。
   */
  async open(): Promise<void> {
    if (this.deps.dataDir === null) {
      this.deps.notify('数据目录不在场——市场选装面不可用（诊断形无目录）', { level: 'warn' });
      return;
    }
    await this.rebuildRows();
    if (!this.deps.openPanel(this.model, this.actions)) {
      this.deps.notify('市场选装面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
    }
  }

  /** enter 选装（未装条目）：装机编舞（两步制——装机 ≠ 启用，回执尾行自带 mount 指路） */
  private install(id: string): void {
    if (this.busyGate(`install ${id}`)) return;
    void this.runLong(
      `装机在飞中（marketplace install ${id}）`,
      { sub: 'install', id },
      {
        verb: `marketplace install ${id}`,
        reload: true,
      },
    );
  }

  /** enter 卸载（已装条目）：双相编舞（inspect → 用户裁决 → execute——槽全程持有） */
  private uninstall(id: string): void {
    if (this.busyGate(`uninstall ${id}`)) return;
    void (async () => {
      // 第一相 inspect（confirm:false）——回执即核查清单（将动清单 + --data 指路）
      this.model.busyLabel = `卸载核查中（marketplace uninstall ${id}）`;
      this.model.results = [];
      this.deps.repaint(); // enter 路副屏已收 = no-op；重开屏（u/r 不闭屏）形即时见
      // 编舞①开跑行：双相全程恰一行（inspect 起跑位发——裁决窗也算在飞期；execute 相不重复）
      this.startNotify(`marketplace uninstall ${id}`);
      const inspect = await this.captureRun({ sub: 'uninstall', id, confirm: false });
      if (inspect.crashed || inspect.code !== 0) {
        this.model.busyLabel = null;
        this.model.results = inspect.receipt;
        this.deps.notify(`marketplace uninstall ${id} 核查失败——回执已呈`, { level: 'warn' });
        this.deps.repaint();
        return;
      }
      // 第二相：用户裁决（inspect 回执全文入——裁决材料即所见回执；槽持续持有）
      const inspectText = inspect.receipt.join('\n');
      const choice = await this.deps.confirmUninstall(inspectText);
      if (choice === 'cancel') {
        this.model.busyLabel = null;
        this.model.results = [...inspect.receipt, '已取消——未执行卸载（装机物与数据未动）'];
        this.deps.notify(`已取消卸载 ${id}——未执行任何变更`, { level: 'info' });
        this.deps.repaint();
        return;
      }
      // 第三相 execute（confirm:true + dataAction 三分裁决入）——槽连续持有不断档
      this.model.busyLabel = `卸载在飞中（marketplace uninstall ${id}）`;
      this.model.results = [];
      this.deps.repaint();
      const execute = await this.captureRun({ sub: 'uninstall', id, confirm: true, dataAction: choice });
      this.model.busyLabel = null;
      this.model.results = execute.receipt;
      this.settleNotify(`marketplace uninstall ${id}`, execute.code, execute.crashed, true);
      this.deps.repaint();
    })();
  }

  /** u 换装（已装条目）：单件点名 = force 换血重装（mp-4 语义——面板驻留不收屏） */
  private upgrade(id: string): void {
    if (this.busyGate(`upgrade ${id}`)) return;
    void this.runLong(
      `换装在飞中（marketplace upgrade ${id}）`,
      { sub: 'upgrade', id },
      {
        verb: `marketplace upgrade ${id}`,
        reload: true,
      },
    );
  }

  /**
   * r 刷新（面板驻留不收屏）：update 动词恒回源强制重取（手动档整源刷新
   * 真身——鲜缓存亦回源，**非** discover 的 TTL 惰性腿；本面无 fetch 注入
   * 位，网络真身归 runEntry 内部缺省），settle 后零网络重读缓存换行集。
   */
  private refresh(): void {
    if (this.busyGate('update')) return;
    if (this.deps.dataDir === null) {
      this.deps.notify('数据目录不在场——无市场缓存可刷新', { level: 'warn' });
      return;
    }
    void this.runLong(
      '市场刷新在飞中（marketplace update——恒回源强制重取）',
      { sub: 'update' },
      {
        verb: 'marketplace update',
        onSettle: async () => {
          await this.rebuildRows(); // 零网络重读（新缓存已落——行集/尾行区换血）
        },
      },
    );
  }

  /**
   * busy 单槽闸（第二道 fail-loud——面板锁键是第一道）：在飞期任何动作再发
   * 拒 + notify（不排队不静默丢——诚实拒律）。
   */
  private busyGate(verb: string): boolean {
    if (this.model.busyLabel === null) return false;
    this.deps.notify(`marketplace ${verb} 未发——长动作在飞（${this.model.busyLabel}），收场后再试`, {
      level: 'warn',
    });
    return true;
  }

  /**
   * 长动作编舞单源：busy 置位（清 results——上一笔回执让位于新动作）→ 开跑
   * notify（编舞①）→ 执行（fire-and-forget）→ settle（onSettle 钩〔refresh
   * 换行集〕→ busy 清 → results 回填 → notify 归因 + 自动链提示 → repaint）。
   */
  private async runLong(
    label: string,
    sub: MarketplaceCommand,
    meta: { readonly verb: string; readonly reload?: boolean; readonly onSettle?: () => Promise<void> | void },
  ): Promise<void> {
    this.model.busyLabel = label;
    this.model.results = [];
    this.deps.repaint(); // u/r 路面板在场即时见 busy 行；enter 路副屏已收 = no-op
    this.startNotify(meta.verb);
    const outcome = await this.captureRun(sub);
    if (meta.onSettle !== undefined) await meta.onSettle();
    this.model.busyLabel = null;
    this.model.results = outcome.receipt;
    this.settleNotify(meta.verb, outcome.code, outcome.crashed, meta.reload === true);
    this.deps.repaint();
  }

  /**
   * 编舞①开跑行（单源文案——runLong 三动作与 uninstall 双相共用）：结束前
   * 的 30s+ 等待期主屏反馈位。enter 路副屏已收、面板 busy 底行不可见，本行
   * 是该窗内唯一反馈（notify 瞬时行——回执文本归因 marketplace）。
   */
  private startNotify(verb: string): void {
    this.deps.notify(`${verb} 开跑——结束另行通知（回执届时见 /marketplace 面板）`, { level: 'info' });
  }

  /**
   * CLI 服务面执行 + 回执捕获（单源捕获形）：writeOut/writeErr 注入收集，
   * err 头条在前（失败形主报文先见）、out 随后；保行结构逐行消毒
   * （sanitizeBlock 单源——CLI 构造位已消毒，此处纵深一道）。
   */
  private async captureRun(
    sub: MarketplaceCommand,
  ): Promise<{ readonly code: number; readonly crashed: boolean; readonly receipt: readonly string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    let code = -1;
    let crashed = false;
    try {
      code = await this.deps.runEntry(sub, {
        writeOut: (text) => out.push(text),
        writeErr: (text) => err.push(text),
      });
    } catch (error) {
      // fire-and-forget 编舞必须自吞异常（否则 unhandled rejection）——异常也是
      // 结局的一档：如实入回执 + notify error，不静默
      crashed = true;
      err.push(`内部异常：${error instanceof Error ? error.message : String(error)}`);
    }
    const receipt = sanitizeBlock([...err, ...out].join('\n')).split('\n');
    return { code, crashed, receipt };
  }

  /**
   * settle 通知归因（动词 + 结局档 + 回执去向指路）+ 装机面变更 reload 自动链
   * （链真身 requestReload + 提示行——编舞④：完成行之后第二行，与 /plugins
   * 写动词成功尾句单源同文；失败 / 异常 / 非装载面动词零链零提示）。
   */
  private settleNotify(verb: string, code: number, crashed: boolean, reload: boolean): void {
    if (crashed) {
      this.deps.notify(`${verb} 内部异常——回执已呈 /marketplace 面板`, { level: 'error' });
      return;
    }
    if (code === 0) {
      if (reload) {
        this.deps.requestReload(); // 装机面变更——装载面重载自动链（03 §5.2 同律）
        this.deps.notify(`${verb} 完成——回执见 /marketplace 面板`, { level: 'info' });
        this.deps.notify(RELOAD_AUTO_CHAIN_NOTIFY, { level: 'info' }); // 编舞④提示行——完成行后的第二行
      } else {
        this.deps.notify(`${verb} 完成——回执见 /marketplace 面板`, { level: 'info' });
      }
      return;
    }
    this.deps.notify(`${verb} 失败（退出码 ${code}）——回执已呈 /marketplace 面板`, { level: 'warn' });
  }

  /**
   * 行集/尾行区装配（零网络快照档）：discover **不传 fetch**（缓存即真相——
   * fetch 注入位缺席恒零网络）；已装徽标 = 账本 market 注记键集对拍
   * （`entry@market` 与条目 id 同形）；自由文本（name/version/market/
   * description/skipped 原因）逐字段 sanitizeLine——注入面消毒锁（CLI 呈现
   * 位同函数单源）。空态两分文案在此拼（数据语义归 host——面板不判）：
   * 零源出厂 vs 源在册零条目。
   */
  private async rebuildRows(): Promise<void> {
    const dataDir = this.deps.dataDir;
    if (dataDir === null) {
      this.model.rows = [];
      this.model.tail = [];
      return;
    }
    const result = await discoverMarketplaces({ dataDir, fs: this.deps.fs, now: this.deps.now });
    const installedKeys = this.deps.ledgerMarketKeys();
    const rows: MarketEntryRow[] = [];
    const tail: string[] = [];
    if (result.sources.length === 0) {
      // 空态其一：零源出厂——指路 CLI add（源管理留 CLI 是定形边界）
      tail.push('无市场源——CLI berry marketplace add <源> 添加（源管理留 CLI）');
    } else {
      for (const source of result.sources) {
        if (source.status === 'skipped') {
          const who = source.marketplace.length > 0 ? sanitizeLine(source.marketplace) : '(未具名)';
          tail.push(`${who} 跳过：${sanitizeLine(source.skippedReason ?? '')}`);
          continue;
        }
        for (const entry of source.entries) {
          rows.push({
            id: entry.id, // 寻址形原样（动作寻址单源——不消毒不改形）
            name: sanitizeLine(entry.name),
            version: sanitizeLine(entry.version),
            market: sanitizeLine(source.marketplace),
            ...(entry.description !== undefined ? { description: sanitizeLine(entry.description) } : {}),
            installed: installedKeys.has(entry.id),
          });
        }
      }
      if (rows.length === 0) {
        // 空态其二：源在册但零可用条目（全部 skipped 或真空目录）
        tail.push('源在册但零条目——r 刷新重取（源清单见 CLI berry marketplace list）');
      }
    }
    this.model.rows = rows;
    this.model.tail = tail;
  }
}
