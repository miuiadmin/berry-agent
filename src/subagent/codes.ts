/**
 * subagent 域错误码注册（04 §10——SUBAGENT_/JOB_ 前缀族；02 §5.3 批 15c
 * 明列五码，SUBAGENT_DEPTH_EXCEEDED/JOB_KIND_UNKNOWN 承 04 §10 定名）。
 *
 * 码语义分层：SUBAGENT_DEPTH_EXCEEDED 管委派深度帽（防自嵌套爆栈）；
 * SUBAGENT_PRECHECK_FAILED 管 spawn 前预检闸（fail-ask 不降级瞎跑）；
 * SUBAGENT_PROVIDER_UNKNOWN 管静态绑定路由；JOB_KIND_UNKNOWN 管 kind
 * 词汇登记（词汇注册表纪律）；JOB_LIMIT_REACHED 管 Job 并行帽（形随
 * issue 件落码批定值）；SUBAGENT_NAME_INVALID 管程序化注册槽 name 裸词
 * 词法（D 批——03 §2.7 行 262「本批新码」）。本文件由模块公开面 index.ts
 * 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'SUBAGENT_DEPTH_EXCEEDED',
    module: 'subagent',
    description: '委派深度超帽 3 拒——防自嵌套爆栈（04 §10 委派边界③）',
  },
  {
    code: 'SUBAGENT_PRECHECK_FAILED',
    module: 'subagent',
    description:
      'spawn 前能力/权限预检闸拒——委派 def 前置要求（requiresTools）工具缺席即拒起跑并回执缺口清单，fail-ask 不降级瞎跑（04 §10 静默退化防御②；与 tools 白名单正交——白名单缺了照样跑、前置要求缺了不起跑）',
  },
  {
    code: 'SUBAGENT_PROVIDER_UNKNOWN',
    module: 'subagent',
    description: '委派路由命中未注册 provider 拒——委派面静态绑定（通用 agent 工具缺省路由 in-process）',
  },
  {
    code: 'SUBAGENT_PROVIDER_EXISTS',
    module: 'subagent',
    description:
      'named provider 撞名拒——服务面注册（声明式子代理每文件一 named provider，扫描序 first-wins 由发现层表达、注册面撞名响亮拒）',
  },
  {
    code: 'JOB_KIND_UNKNOWN',
    module: 'subagent',
    description: 'registerKind 未登记种类拒——防随手字符串当 kind 用（词汇注册表纪律同 04 §6）',
  },
  {
    code: 'JOB_LIMIT_REACHED',
    module: 'subagent',
    description:
      'Job 并行帽拒——同刻在飞 Job 数达按 kind 分帽上限（缺省无帽；缺省值随 issue 件落码批定——04 §10 issue 立题批钉位）',
  },
  {
    code: 'SUBAGENT_NAME_INVALID',
    module: 'subagent',
    description:
      '程序化注册槽 name 词法违例拒——非裸词（06 §11.6 声明式 name 同形、词法承 §11.2「小写连字符与数字」——词法真源 06:386）；执法序同 AGENT_ROLE 注记：撞名闸前置格式闸（03 §2.7 行 262；2026-09-07 冷读闸 blocker 修复批拍板案 a 改形——原「非域名两段式」弃）',
  },
]);
