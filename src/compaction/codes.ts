/**
 * compaction 域错误码注册（02 §5.3 COMPACTION_ 族——2026-09-09 U4 规范
 * 先行批明列两码；03 §2.2 第十二面/§2.7 两动词行）。
 *
 * 两码同为槽位占用拒（单席位先到占的执法位）——装载窗 only 的窗外拒
 * 复用 PLUGIN_WINDOW_CLOSED（host 既有码，不在本册）。本文件由模块公开面
 * index.ts 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'COMPACTION_CONFIG_TAKEN',
    module: 'compaction',
    description:
      '数值配置槽席位已占拒（03 §2.7 ctx.compaction.setConfig——单席位先到占、后到拒；配置主权单源：两插件各设阈值 = 用户装配面错误，fail-loud 拒不静默 last-wins）',
  },
  {
    code: 'COMPACTION_SUMMARIZER_TAKEN',
    module: 'compaction',
    description:
      '摘要 provider 槽席位已占拒（03 §2.7 ctx.compaction.registerSummarizer——单席位先到占；溢出兜底恒宿主缺省算法系既有立法，槽不可及）',
  },
]);
