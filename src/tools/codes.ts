/**
 * tools 域错误码注册（04 §7 三段管道 + 注册面 + fs 工具族——TOOL_/FS_ 前缀族首批）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1）；码名清
 * 单与语义真源 = 02 篇 §5.3 TOOL_/FS_ 族明列段（2026-09-06 tools 纵切批）。
 * 本文件由模块公开面 index.ts 引入（注册纪律：写入点文件必须实际 import 本
 * 文件注册才发生——与 llm/session/persist 的 codes.ts 同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  // ---- TOOL_ 族（管道与注册面）----
  {
    code: 'TOOL_INVALID_ARGS',
    module: 'tools',
    description: 'schema 段参数校验拒（04 §7 段 1）——模型拿到的可纠正错误回执',
  },
  {
    code: 'TOOL_BLOCKED',
    module: 'tools',
    description: '守门段 block 短路（04 §7 段 2）——拒绝原因随码入结果，模型可见可自纠',
  },
  {
    code: 'TOOL_GATE_FAILED',
    module: 'tools',
    description: '守门监听器自身抛错——fail-closed 视同 block（先落 gate/decision 再拒）',
  },
  {
    code: 'TOOL_TIMEOUT',
    module: 'tools',
    description: '执行段单工具预算超时（def.timeoutMs 或缺省 60s）——竞速先到即拒',
  },
  {
    code: 'TOOL_NAME_CONFLICT',
    module: 'tools',
    description: '注册撞名拒绝式（03 §2.7——碰撞域内双向对称：宿主内建/官方件/兄弟插件）',
  },
  {
    code: 'TOOL_DESCRIPTION_REJECTED',
    module: 'tools',
    description: '描述注入模式扫描命中拒注册（03 §2.8——任何来源同一防线，官方件同受管）',
  },
  {
    code: 'TOOL_REGISTRY_CAPACITY',
    module: 'tools',
    description: '注册表两层合计达 10^3 总量帽（03 §3.4 双帽之一）——超限拒新注册',
  },
  {
    code: 'TOOL_CHANGE_RATE_LIMITED',
    module: 'tools',
    description: 'register/unregister 令牌桶空拒（03 §3.4 双帽之二——容量 240、回填 600/分钟）',
  },
  {
    code: 'TOOL_SCHEMA_INVALID',
    module: 'tools',
    description: 'parameters 根节点非 object——注册即拒（provider 声明契约只认根 object）',
  },
  // ---- FS_ 族（fs 工具族）----
  {
    code: 'FS_NOT_OBSERVED',
    module: 'tools',
    description: '未观察径直写拒（04 §7 CAS 观察态）——先读后写是结构纪律',
  },
  {
    code: 'FS_VERSION_CONFLICT',
    module: 'tools',
    description: '观察指纹不符/读后他方并发创建/读后删除——丢失更新守卫，重新 read 再写',
  },
  {
    code: 'FS_OUTSIDE_WRITABLE_ROOTS',
    module: 'tools',
    description: '写目标 canonical 化后不在任何可写根内（04 §7 fence）',
  },
  {
    code: 'FS_WRITE_TARGET_DRIFTED',
    module: 'tools',
    description: '写串行链段内写目标漂移（符号链被换/目录被移）——重验不过拒落盘',
  },
  {
    code: 'FS_NOT_FOUND',
    module: 'tools',
    description: 'read/ls 目标不存在（read 仍登记 absent 观察——「这里没有文件」也是观察）',
  },
  {
    code: 'FS_DECODE_NON_UTF8',
    module: 'tools',
    description: '文本读 UTF-8 严格解码 lossy 拒（04 §7 编码纪律——防 mojibake 静默进上下文）',
  },
  {
    code: 'FS_PATCH_FAILED',
    module: 'tools',
    description: 'apply_patch 补丁格式解析失败或 update 定位失败（context 行锚不在场即拒）',
  },
  {
    code: 'FS_READ_PROTECTED',
    module: 'tools',
    description: '读目标命中敏感件保护面硬拒（04 §7 读侧 carve-out）——密钥与免问面恒不可读，fail-closed 无审批出路',
  },
  // ---- FS_ 族 worktree 三码（04 §7 worktree 条——批 16 worktree 工具族）----
  {
    code: 'FS_WORKTREE_EXISTS',
    module: 'tools',
    description: 'worktree/同名分支已存在拒建（名字即分支名——双域撞名同码）',
  },
  {
    code: 'FS_WORKTREE_DIRTY',
    module: 'tools',
    description: 'worktree 有未提交变更拒拆（防误清宁拒勿删——force 形显式覆盖）',
  },
]);
