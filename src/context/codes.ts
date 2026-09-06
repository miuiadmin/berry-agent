/**
 * context 模块错误码注册（02 §5.3 #2：各模块落码批经 registerErrorCodes 显式注册，
 * 禁字符串字面量散落）。
 *
 * 域码族注记：EVENT_* / SCOPE_* 系 04 §6 定名的域语义命名（事件面/作用域面），
 * 视同 CONTEXT_ 域族成员（02 §5.3 前缀族注记，2026-09-05 落码批）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'EVENT_NOT_REGISTERED',
    module: 'context',
    description: 'ctx.emit/on 未注册词 fail-loud（词汇注册表单源——禁散播未声明事件名）',
  },
  {
    code: 'EVENT_DUPLICATE',
    module: 'context',
    description: '事件词汇撞名拒静默覆盖（注册表单源执法）',
  },
  {
    code: 'SCOPE_STALE',
    module: 'context',
    description: '作用域已回卷后的迟到操作（迟到的服务注册/disposer 登记拒绝——异步竞速收口）',
  },
  {
    code: 'SCOPE_EFFECT_CAPACITY',
    module: 'context',
    description:
      'effect 总注册帽：本作用域自有登记达 10^4 拒新登记（03 §3.4 可用性防线——失控登记不拖垮回卷序；拒在 register 回调执行前）',
  },
  {
    code: 'CONTEXT_SERVICE_MISSING',
    module: 'context',
    description: 'get 缺席 fail-loud（拼错名立即炸，不静默 undefined 传播；可选消费走 tryGet）',
  },
  {
    code: 'CONTEXT_SERVICE_DUPLICATE',
    module: 'context',
    description: '同作用域 provide 撞名拒（两方抢一名即装配 bug；fork 子遮蔽父合法）',
  },
]);
