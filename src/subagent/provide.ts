/**
 * ctx.jobs 服务面组装（02 §4.1 席 15 词汇位——04 §10 本篇钉归属）。
 *
 * host 装配根调用一次：注册表 provide 到装载运行时 scope（ctx.jobs），
 * 插件/消费件经 scope.get 消费。04 §12 分工线：ctx.jobs 管运行中 job 的
 * 登记与终态结算；GoalJobsFace 管 jobs 表挂钟行——两词汇分立不混读。
 */
import type { Scope } from '../context/index.js';
import type { JobRegistry } from './registry.js';

/** 服务词汇名（ctx.jobs——02 §4.1 #15 行 2026-09-07 批 15c 改名收口） */
export const JOBS_SERVICE_NAME = 'jobs';

/** provide 注册表到 scope（host 装配根调用——先于一切消费件起跑） */
export function provideJobsService(scope: Scope, registry: JobRegistry): JobRegistry {
  scope.provide(JOBS_SERVICE_NAME, registry);
  return registry;
}
