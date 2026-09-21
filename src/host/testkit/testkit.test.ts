/**
 * testkit 自举测试（03 §9.5 examples 双重身份第二重——生态启动批 eco-3c）。
 *
 * 矩阵断言器对真模板（examples/ 两形）跑全绿、对坏样本（default-export
 * 形两向/逃逸路径形/缺清单形）跑必红；变异验证 = 作者声明面喂假命令名
 * （摘断言器谓词活性的实操形——谓词死则该行假绿，07 §7.5 回归锁同律延伸）。
 * 好样本两例走真 npm pack（pack 完整性预检真链）；坏样本 packCheck 关
 * （所证面在装载拒，非 pack——去 spawn 省时且确定性）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { formatMatrixReceipt, proveLifecycleMatrix } from './index.js';
import type { LifecycleMatrixReport, MatrixRowResult } from './index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const codeExample = join(repoRoot, 'examples', 'minimal-code-plugin');
const skillExample = join(repoRoot, 'examples', 'pure-skill-pack');

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 坏样本铸造（tmp 真盘） */
function makeBadSample(build: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'testkit-bad-'));
  dirs.push(dir);
  build(dir);
  return dir;
}

/** 行名取器（fail 定位 + 行集完整性锁共用） */
function rowOf(report: LifecycleMatrixReport, name: string): MatrixRowResult {
  const row = report.rows.find((r) => r.row.startsWith(name));
  if (row === undefined) throw new Error(`矩阵缺行（${name}）——行集漂移`);
  return row;
}

describe('testkit 生命周期证明矩阵——examples 真模板全绿', () => {
  it('minimal-code-plugin（代码插件形）：八行全绿 + 真注册账断言（example-hello）', async () => {
    const report = await proveLifecycleMatrix({
      pluginDir: codeExample,
      expect: { commands: ['example-hello'] },
    });
    expect(report.ok).toBe(true);
    // 首版矩阵行集完整性锁（八行——行集漂移即红）
    expect(report.rows.map((r) => r.row)).toEqual([
      'install（装机 + pack 完整性）',
      'mount（真装载 activated + 注册账在场）',
      '事件面（plugin/mounted 恰一笔）',
      '幂等/负向（换代不双注 + mountRow 撞名拒）',
      'toggle（行翻转两断言）',
      '开门面（plugin/opens 幂等 diff）',
      'unmount（disposer 回卷 + 注册账缺席）',
      '残留检查（审计词 + 数据面双白名单）',
    ]);
    expect(report.pluginId).toBe('berry-agent-example-minimal-code');
  }, 120_000);

  it('pure-skill-pack（纯声明形）：八行全绿（技能目录账与清单声明同长）', async () => {
    const report = await proveLifecycleMatrix({ pluginDir: skillExample });
    expect(report.ok).toBe(true);
    expect(report.rows.every((r) => r.status === 'pass')).toBe(true);
    expect(report.pluginId).toBe('berry-agent-example-pure-skill');
  }, 120_000);
});

describe('testkit 矩阵——坏样本必红（03 §9.5 default-export 陷阱 + 逃逸 + 缺清单）', () => {
  it('代码插件误漏 default export → mount 行红（真 jiti 求值当场拒）', async () => {
    const dir = makeBadSample((d) => {
      writeFileSync(
        join(d, 'package.json'),
        JSON.stringify({ name: 'bad-nodefault', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      );
      writeFileSync(join(d, 'entry.js'), 'export const inject = [];\n');
    });
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const mount = rowOf(report, 'mount');
    expect(mount.status).toBe('fail');
    expect(mount.detail).toContain('default export');
  });

  it('纯声明包误带 default export（main 指向函数）→ install 行红（stray 探针）', async () => {
    const dir = makeBadSample((d) => {
      writeFileSync(
        join(d, 'package.json'),
        JSON.stringify({
          name: 'bad-stray-default',
          version: '1.0.0',
          main: 'index.js',
          berryAgent: { skills: ['skills'] },
        }),
      );
      writeFileSync(join(d, 'index.js'), 'export default async () => undefined;\n');
      mkdirSync(join(d, 'skills', 'demo-skill'), { recursive: true });
      writeFileSync(
        join(d, 'skills', 'demo-skill', 'SKILL.md'),
        '---\nname: demo-skill\ndescription: 坏样本技能\n---\n\n正文\n',
      );
    });
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const install = rowOf(report, 'install');
    expect(install.status).toBe('fail');
    expect(install.detail).toContain('default export');
  });

  it('声明载荷目录逃逸包根（skills: ["../outside"]）→ mount 行红', async () => {
    const dir = makeBadSample((d) => {
      writeFileSync(
        join(d, 'package.json'),
        JSON.stringify({
          name: 'bad-escape',
          version: '1.0.0',
          berryAgent: { entry: 'entry.js', skills: ['../outside'] },
        }),
      );
      writeFileSync(join(d, 'entry.js'), 'export default async () => undefined;\n');
    });
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const mount = rowOf(report, 'mount');
    expect(mount.status).toBe('fail');
    expect(mount.detail).toContain('逃逸');
  });

  it('缺 package.json（非插件目录）→ install 行红（构造即红收面）', async () => {
    const dir = makeBadSample(() => undefined); // 空目录
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const install = rowOf(report, 'install');
    expect(install.status).toBe('fail');
    expect(install.detail).toContain('package.json');
  });

  it('变异验证：作者声明面喂假命令名 → mount 行红（谓词活性——摘断言器必红）', async () => {
    const report = await proveLifecycleMatrix({
      pluginDir: codeExample,
      expect: { commands: ['never-registered'] },
      packCheck: false,
    });
    expect(report.ok).toBe(false);
    const mount = rowOf(report, 'mount');
    expect(mount.status).toBe('fail');
    expect(mount.detail).toContain('never-registered');
  });

  it('回执形：全绿回执含行名与 ✅；红回执含 ❌ 与 detail（可贴 README 面）', async () => {
    const red = await proveLifecycleMatrix({
      pluginDir: codeExample,
      expect: { commands: ['never-registered'] },
      packCheck: false,
    });
    const receipt = formatMatrixReceipt(red);
    expect(receipt).toContain('berry-agent-example-minimal-code');
    expect(receipt).toContain('❌');
    expect(receipt).toContain('never-registered');
    expect(receipt).toContain('unmount（disposer 回卷 + 注册账缺席）');
  });
});

/* ---------------- 宿主装配面对拍锁（研究档 E10——受局面跟进漂移信号） ---------------- */

/**
 * PluginBootOptions 接口体切片：marker 行起至列 0 的 '}' 收口行止。
 * 接口成员恒 ≥2 空格缩进（prettier 门禁锁形）——列 0 闭括号即接口终点；
 * marker 缺席即抛（抽取器失效 = 红，不静默空集假绿）。
 */
function sliceInterfaceBody(text: string, interfaceName: string): string {
  const start = text.indexOf(`export interface ${interfaceName} {`);
  if (start === -1) throw new Error(`对拍锁：源文缺 export interface ${interfaceName} {`);
  const lines = text.slice(start).split('\n');
  const end = lines.findIndex((line, i) => i > 0 && line === '}');
  if (end === -1) throw new Error(`对拍锁：interface ${interfaceName} 未在列 0 收口（形漂移）`);
  return lines.slice(1, end).join('\n');
}

/**
 * harness boot() 内 bootOptions 对象字面量切片：marker 行起至 6 空格 '};' 止。
 * 顶层键恒 8 空格缩进（同 prettier 锁形）；字面量内嵌套对象（若有）键更深缩进
 * 不误捕。
 */
function sliceBootOptionsLiteral(text: string): string {
  const start = text.indexOf('const bootOptions: PluginBootOptions = {');
  if (start === -1) throw new Error('对拍锁：harness.ts 缺 bootOptions 装配字面量（形漂移）');
  const lines = text.slice(start).split('\n');
  const end = lines.findIndex((line, i) => i > 0 && /^ {6}\};$/.test(line));
  if (end === -1) throw new Error('对拍锁：bootOptions 字面量未按形收口（形漂移）');
  return lines.slice(1, end).join('\n');
}

/**
 * testkit 假宿主显式缺席面台账（HOST−HARNESS 差集的白名单——键 → 缺席原因）。
 *
 * 双向执法：宿主新增受局面而 harness 未跟进 → 差集长出新键不在本表 = 红
 * （跟进或补原因注二选一）；harness 补跟进某面 → 差集缩、本表成陈腐项 = 红
 * （须除名本表行）。历史咬痕：commit 9af7863 channels-ui 受局面补齐前官方
 * ui.notify 用法过不了官方 testkit——本锁即把该类漂移从「静默假阴性」升为
 * 「点名红」。
 */
const HARNESS_ABSENT_WITH_REASON: Readonly<Record<string, string>> = {
  // —— 语义面（假宿主无对应真身——有该面需求的插件暂不在首版矩阵射程）——
  triggers: '触发器注册面（C-2 接线）——真身随 starter 装配，假宿主无触发器域',
  subagents: '子代理注册面（D-2 接线）——宿主装配域真身，假宿主无子代理服务',
  subagentToolDeps: '程序化子代理物化 toolDeps（G 批消费腿）——依赖 subagents 真身',
  uiBackends: '界面后端注册面（U3-4）——假宿主无通道后端可注册',
  sessionLineage: '会话血缘判定面（e2-4）——假宿主零会话，tree 档订阅无消费面',
  jobs: 'Job 收口面（04 §10）——假宿主无 Job 注册表',
  secrets: '插件凭证面（c-3 凭证代管）——假宿主无凭证 store 与 core:credentials 席',
  sessionsControl: '跨会话操控受理器（e4-3）——假宿主零会话',
  crossDoors: 'doors 段活体取值器（03 §4.6）——假宿主门检只吃行 opens',
  compaction: '压缩席位容器（U4-3）——假宿主无 conversation stack',
  sdkRoutes: '插件道路由受理器（U5-2）——假宿主无 core:sdk 件席',
  sessions: 'sessions 受理面（cs-D2）——假宿主无 driver/stack 活体',
  // —— 装配域位（宿主入口专属——testkit 构造路径不同形）——
  corePlugins: 'core: 官方引用注册表——假宿主不装载 core 件',
  hookDispatchGuard: '钩子派发段 guard（ca-3）——直测形不计数',
  loadHistory: '装载史世代面（h-3）——假宿主数据面不落世代快照',
  noPlugins: '安全模式入口位（--no-plugins）——testkit 恒装载，非开关面',
  pluginFile: '快速试件路径位（--plugin-file）——testkit 走 pluginDir 构造非 CLI 位',
  onPluginStart: '逐插件装载起步回调（启动动画供数——三反馈批 D 先行件2）——假宿主无动画呈现面',
  apiVersion: '装载门裁决坐标——测试注入面缺省 1.0 即本义（生产装配恒传真值）',
  fs: 'fs 注入位——harness 恒用真盘 realStoreFs（缺省即真盘）',
};

describe('testkit 宿主装配面对拍锁（E10——受局面跟进漂移信号）', () => {
  it('宿主装配面对拍锁：PluginBootOptions 新增受局面未被 testkit harness 跟进且不在缺席白名单 = 红', () => {
    // 纯源文正则对拍零运行时依赖：读两源文抽键集，比形状不比行为
    const bootSource = readFileSync(join(repoRoot, 'src', 'host', 'plugin-boot.ts'), 'utf8');
    const harnessSource = readFileSync(join(repoRoot, 'src', 'host', 'testkit', 'harness.ts'), 'utf8');

    // ① 宿主受局面全集：接口体内 2 空格缩进 readonly 键（嵌套子键 ≥4 空格不捕）
    const hostKeys = new Set(
      [...sliceInterfaceBody(bootSource, 'PluginBootOptions').matchAll(/^ {2}readonly (\w+)\??:/gm)].map((m) => m[1]!),
    );
    // ② testkit 注入集：bootOptions 字面量内 8 空格缩进键
    const harnessKeys = new Set(
      [...sliceBootOptionsLiteral(harnessSource).matchAll(/^ {8}(\w+)\s*[,:]/gm)].map((m) => m[1]!),
    );

    // 抽取器防腐锚（正则失效 → 空集恒过断言的假绿——锚缺席即红）
    for (const anchor of ['runtime', 'scope', 'dispatch', 'commands', 'llm', 'version']) {
      expect(hostKeys.has(anchor), `hostKeys 缺锚 ${anchor}（抽取器失效）`).toBe(true);
    }
    for (const anchor of ['runtime', 'version', 'audit', 'unloadRef']) {
      expect(harnessKeys.has(anchor), `harnessKeys 缺锚 ${anchor}（抽取器失效）`).toBe(true);
    }

    // ③ 陈腐键执法：harness 注入键不在宿主接口 = 红（宿主面除名后 testkit 未跟）
    const stale = [...harnessKeys].filter((k) => !hostKeys.has(k));
    expect(stale, `harness 注入了宿主面已除名的键：${stale.join('、')}`).toEqual([]);

    // ④ 差集双向对拍：HOST−HARNESS 恰等于缺席白名单键集（两侧漂移都点名）
    const absent = new Set([...hostKeys].filter((k) => !harnessKeys.has(k)));
    const whitelisted = new Set(Object.keys(HARNESS_ABSENT_WITH_REASON));
    const uncovered = [...absent].filter((k) => !whitelisted.has(k));
    const staleWhitelist = [...whitelisted].filter((k) => !absent.has(k));
    expect(
      uncovered,
      `宿主受局面未跟进且未挂缺席原因（跟进 harness 或补 HARNESS_ABSENT_WITH_REASON 原因注）：${uncovered.join('、')}`,
    ).toEqual([]);
    expect(
      staleWhitelist,
      `缺席白名单陈腐项（harness 已跟进或宿主已除名——须除名本表行）：${staleWhitelist.join('、')}`,
    ).toEqual([]);
  });
});

/* ---------------- examples 测试样张在场锁（研究档 E12） ---------------- */

describe('testkit examples 测试样张在场锁（E12——作者可拷贝的测试文件实物）', () => {
  it('examples 模板测试文件在场锁：lifecycle.test.ts 在场且为自持稳定形（入口直测 + effect 回卷律）', () => {
    // 纯存在 + 源文内容形锁（零运行时解析——不在宿主 vitest 里执行模板文件，
    // 规避嵌套包解析；模板实物被删/漂移即红，作者引导从「文档片段」升「实物样张」）
    const text = readFileSync(join(codeExample, 'test', 'lifecycle.test.ts'), 'utf8');
    // 形锁三锚（2026-09-16 勘正——原锁 import 'berry-agent/testkit' 与 proveLifecycleMatrix
    // 实验符号，违反查 5「examples 属稳定示例扫描面、实验符号唯一合法披露位 =
    // docs/plugin-development.md〔实验面〕节」；样张改自持形：零宿主 devDep 直测
    // entry.js 导出面，testkit 矩阵指路 docs 实验面节）：
    // ① 自持锚——直测模板入口（相对 import ../entry.js，不 import 宿主包）；
    // ② 注册面锚——模板命令名 example-hello 恰一注册；
    // ③ 回卷律锚——注册被 ctx.effect 包住（disposer 交作用域）。
    expect(text).toContain("from '../entry.js'");
    expect(text).toContain("'example-hello'");
    expect(text).toContain('ctx.effect');
    // 反向锁：实验符号不得回流稳定示例（查 5 执法面——回流即红）
    expect(text, '实验符号禁入 examples 稳定示例（查 5）').not.toContain('proveLifecycleMatrix');
    expect(text).not.toContain("from 'berry-agent/testkit'");
  });
});
