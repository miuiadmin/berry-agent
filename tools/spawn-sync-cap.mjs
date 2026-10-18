/**
 * spawnSync 子进程帽（tools 闸测试族共享单源）。
 *
 * 背景（2026-10-18 CI run 39108786016 macos 死寂实证）：闸测试以 spawnSync
 * 真跑全仓扫描脚本——spawnSync 同步阻塞 worker 事件循环，testTimeout 定时器
 * 在阻塞期永不点火；子进程偶发不退（darwin CI 实证单次、重跑即绿——本地同树
 * 4.5s 自退）即测试永不回报、pool 完结信号不归、job 死寂直到 timeout-minutes
 * 砍单（15min 全量进度尽弃）。帽 = spawnSync 原生 timeout（原生层点火——JS
 * 线程同步阻塞不影响其计时）+ SIGKILL 强杀（SIGTERM 可被僵死子进程忽略）；
 * 60s = CI 慢机单子进程实测上限 ~23s（run 34852040696 实测）三倍余量——
 * 慢≠错照旧绿，真挂起帽点红（status null → 调用方 `?? -1` 断言红、可见可修）。
 *
 * 消费律：闸测试 spawnSync 位一律 `{ ...基础项, ...SPAWN_SYNC_CAP }` 展开
 * （展开位须后置——调用方局部覆写（如回归锁缩帽实证）仍可后置覆盖）。
 */
export const SPAWN_SYNC_CAP = Object.freeze({ timeout: 60_000, killSignal: 'SIGKILL' });
