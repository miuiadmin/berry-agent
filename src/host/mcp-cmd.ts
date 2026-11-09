/**
 * host/mcp-cmd — `berry mcp <sub>` MCP 客户端管理子命令族（03 §10.1 B5 条·
 * CLI/SDK 进化批 2026-11-09）。
 *
 * 同词双面：bare `berry mcp` = MCP server 包装形态（mcp-entry 承载，本件
 * 不涉）；带子命令 = core:mcp 行 config.servers 的客户端管理族——list /
 * add / remove 三动词（gemini mcp 子命令族参照）。
 *
 * 零装配直读写侧（credentials/doors 零装配族同形）：不开运行时、不占单
 * 活跃机、不 boot 插件面——行编辑走 **plugin-store 行编辑写者家族单源**
 * （readEnabledRowsForEdit + setRowConfig——行 config 整值替换既有面、
 * core:mcp 行缺席时 overlay 造行、doors 段保真往返、读-改-写整段互斥锁；
 * 零新写通道）。
 *
 * 词法执法两段（03 §10.1 B5 清偿形）：归一器段 = normalizeMcpConfig 逐
 * 字段（command 绝对路径/键词法/字段形——**不含保留键拒**）+ 保留键段 =
 * MCP_RESERVED_SERVER_NAME 词面单源判（add 位当场拒**不落坏行**——65 轮
 * 件G「fail-loud 在配置面」律的 CLI 侧兑现）。词法拒同归用法错退 2
 * （执法律③同族——command 形可解析层预判）；读盘后才可判的错（重名/
 * 名缺席/行读写失败）退 1。remove 非幂等有意（指路优先——与 unmountRow
 * 幂等跳过分立，N-3 注记）。
 *
 * 退出码：0 成功（含空清单——诚实空非失败）/ 1 执行失败 / 2 词法·用法错。
 */
import { stderr as processStderr, stdout as processStdout } from 'node:process';

import { isAbsolute } from 'node:path';

import { BaseError } from '../contracts/index.js';
import { resolveDataDir } from '../persist/index.js';
import { MCP_RESERVED_SERVER_NAME, normalizeMcpConfig, type McpConfig } from '../../plugins/mcp/index.js';
import { createPluginStoreFs, readEnabledRowsForEdit, setRowConfig, type PluginStoreFs } from './plugin-store.js';

/** 管理子命令 tagged union（cli.ts 解析层消费——同 CredentialsSub 形） */
export type McpManageSub =
  | { readonly sub: 'list' }
  | { readonly sub: 'add'; readonly name: string; readonly command: string; readonly args: readonly string[] }
  | { readonly sub: 'remove'; readonly name: string };

/** 入口选项（main 分派接线 + 测试注入面——fs 注入零真盘依赖） */
export interface McpManageEntryOptions {
  /** 数据目录（缺省 resolveDataDir() 三级梯子） */
  readonly dataDir?: string;
  /** 输出面（缺省 process.stdout——测试注入） */
  readonly writeOut?: (text: string) => void;
  /** 错误面（缺省 process.stderr——测试注入） */
  readonly writeErr?: (text: string) => void;
  /** fs 注入面（缺省 createPluginStoreFs() 真身） */
  readonly fs?: PluginStoreFs;
}

/** core:mcp 行 id（config.servers 的归属行） */
const CORE_MCP_ROW_ID = 'core:mcp';

/**
 * 读现行 config.servers（行缺席/键缺席 = 空配置——出厂缺省态非错误）。
 * 行 config 坏形（手编 enabled.yaml 漂移）照归一器响亮拒——add/remove 对
 * 坏行零动作（先修行再管理，fail-loud 不静默覆盖）。
 */
function readServers(
  dataDir: string,
  fs: PluginStoreFs,
): { ok: true; servers: McpConfig } | { ok: false; message: string } {
  const read = readEnabledRowsForEdit(dataDir, fs);
  if (!read.ok) return { ok: false, message: read.message };
  const row = read.rows.find((entry) => entry.id === CORE_MCP_ROW_ID);
  if (row === undefined || row.config === undefined) return { ok: true, servers: {} };
  const raw = (row.config as { servers?: unknown }).servers;
  try {
    return { ok: true, servers: normalizeMcpConfig(raw) };
  } catch (error) {
    if (error instanceof BaseError) {
      return { ok: false, message: `core:mcp 行 config.servers 损坏（${error.message}）——先修 enabled.yaml 再管理` };
    }
    throw error;
  }
}

/** mcp 客户端管理族主入口。返回进程退出码（0/1；词法·用法错退 2）。 */
export async function runMcpManageEntry(sub: McpManageSub, options: McpManageEntryOptions = {}): Promise<number> {
  const out = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const fs = options.fs ?? createPluginStoreFs();

  if (sub.sub === 'list') {
    const read = readServers(dataDir, fs);
    if (!read.ok) {
      err(read.message);
      return 1;
    }
    const names = Object.keys(read.servers);
    if (names.length === 0) {
      out('（无登记的 MCP 服务器——berry mcp add <name> <command> [args…] 登记）');
      return 0;
    }
    for (const name of names) {
      const server = read.servers[name]!;
      const argv = [server.command, ...(server.args ?? [])].join(' ');
      const tools =
        server.enabled_tools !== undefined
          ? `白名单 ${server.enabled_tools.length} 项`
          : server.disabled_tools !== undefined
            ? `黑名单 ${server.disabled_tools.length} 项`
            : '全量工具';
      out(`${name}  ${argv}  ${tools}`);
    }
    return 0;
  }

  if (sub.sub === 'add') {
    // —— 词法执法两段（B-5 清偿形）：保留键段先行（词面单源）+ 归一器段
    //（逐字段——command 绝对路径/键词法/字段形）；两段拒同归用法错退 2，
    // **不落坏行**（坏键进 enabled.yaml 只会在下次 boot 才炸——65 轮件G
    // 立法要防的配置面漂移形，CLI 位当场拦）
    if (sub.name === MCP_RESERVED_SERVER_NAME) {
      err(`服务器名 "${sub.name}" 是保留键（agent__<tool> 复合工具名正中宿主 agent_ 前缀保留闸）——换一个名字`);
      return 2;
    }
    if (!isAbsolute(sub.command)) {
      err(`command 须为绝对路径（收到：${sub.command}——v1 只收绝对路径，相对路径有 CWD 歧义）`);
      return 2;
    }
    let entry: ReturnType<typeof normalizeMcpConfig>[string];
    try {
      // 归一器单源执法：键词法/字段形全在此（保留键除外——受理位补段）；
      // args 防御缺省空（cli 解析层恒携数组——直调面容缺省）
      const args = [...(sub.args ?? [])];
      const normalized = normalizeMcpConfig({
        [sub.name]: { command: sub.command, ...(args.length > 0 ? { args } : {}) },
      });
      entry = normalized[sub.name]!;
    } catch (error) {
      if (error instanceof BaseError) {
        err(`${error.message}`);
        return 2;
      }
      throw error;
    }
    // —— 读写段（读盘后才可判的错退 1）：现行配置读-改-写整段互斥
    const read = readServers(dataDir, fs);
    if (!read.ok) {
      err(read.message);
      return 1;
    }
    if (read.servers[sub.name] !== undefined) {
      err(`服务器名 "${sub.name}" 已登记——先 berry mcp remove ${sub.name} 再改（不静默覆盖）`);
      return 1;
    }
    const config = { servers: { ...read.servers, [sub.name]: entry } };
    const edit = setRowConfig(dataDir, CORE_MCP_ROW_ID, config, fs);
    if (!edit.ok) {
      err(edit.message);
      return 1;
    }
    out(`已登记 MCP 服务器 "${sub.name}"（重启宿主或 /reload 生效）`);
    return 0;
  }

  // remove：缺席退 1 指路（非幂等有意——N-3：指路优先，与 unmount 幂等分立）
  const read = readServers(dataDir, fs);
  if (!read.ok) {
    err(read.message);
    return 1;
  }
  if (read.servers[sub.name] === undefined) {
    err(`服务器名 "${sub.name}" 未登记——berry mcp list 查看现有清单`);
    return 1;
  }
  const { [sub.name]: _removed, ...rest } = read.servers;
  void _removed;
  const edit = setRowConfig(dataDir, CORE_MCP_ROW_ID, { servers: rest }, fs);
  if (!edit.ok) {
    err(edit.message);
    return 1;
  }
  out(`已摘除 MCP 服务器 "${sub.name}"（重启宿主或 /reload 生效）`);
  return 0;
}
