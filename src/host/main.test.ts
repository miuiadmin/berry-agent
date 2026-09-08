import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { isMainModule } from './main.js';

/**
 * 卫兵回归锁（2026-09-08 发布面收口批）：npm bin 符号链接与含链接环节的
 * 装机路径（/tmp → /private/tmp、/var → /private/var、nvm/volta shim 目录）
 * 下，字面 argv[1] 与入口模块 URL 错配 → 主序静默 no-op 退 0。
 *
 * 夹具纪律：moduleUrl 侧必须 realpath 归一（node 入口解析侧恒为真实路径——
 * 夹具若直接拿字面 tmpdir 路径造 URL，在 darwin 上 /var 本身即链接环节，
 * 测的会是夹具自己的错配而非卫兵行为）；全部链接建在自持夹具目录内。
 */
let fixtureDir: string | undefined;

function rig(name: string): {
  resolvedPath: string;
  resolvedUrl: string;
  fileLink: string;
  viaDirLink: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'berry-main-guard-'));
  fixtureDir = dir;
  const sub = join(dir, 'sub');
  mkdirSync(sub);
  const realPath = join(sub, name);
  writeFileSync(realPath, '#!/usr/bin/env node\n');
  // bin 符号链接形（npm 单 bin 装机即此形：prefix/bin/berry-agent → 包内 main.js）
  const fileLink = join(dir, `${name}.link`);
  symlinkSync(realPath, fileLink);
  // 目录链接环节形（路径中间环节是符号链接——/tmp、/var、shim 目录）
  const dirLink = join(dir, 'to-sub');
  symlinkSync(sub, dirLink);
  const resolvedPath = realpathSync(realPath);
  return {
    resolvedPath,
    resolvedUrl: pathToFileURL(resolvedPath).href,
    fileLink,
    viaDirLink: join(dirLink, name),
  };
}

afterEach(() => {
  if (fixtureDir !== undefined) rmSync(fixtureDir, { recursive: true, force: true });
  fixtureDir = undefined;
});

describe('isMainModule（bin 直跑卫兵）', () => {
  it('真实路径直跑 = 主模块', () => {
    const { resolvedPath, resolvedUrl } = rig('direct.mjs');
    expect(isMainModule(resolvedPath, resolvedUrl)).toBe(true);
  });

  it('符号链接形 argv[1]（npm bin 装机形）= 主模块〔回归锁——修复前必红：字面比对下链接路径与真实模块 URL 错配即静默 no-op 退 0〕', () => {
    const { fileLink, resolvedUrl } = rig('via-link.mjs');
    expect(isMainModule(fileLink, resolvedUrl)).toBe(true);
  });

  it('路径含符号链接目录环节（/tmp → /private/tmp 形）= 主模块', () => {
    const { viaDirLink, resolvedUrl } = rig('linky.mjs');
    expect(isMainModule(viaDirLink, resolvedUrl)).toBe(true);
  });

  it('非本模块（被 import 形）≠ 主模块', () => {
    const { resolvedPath } = rig('other.mjs');
    const otherUrl = pathToFileURL(`${resolvedPath}.elsewhere`).href;
    expect(isMainModule(resolvedPath, otherUrl)).toBe(false);
  });

  it('argv[1] 缺席（非进程入口）≠ 主模块', () => {
    expect(isMainModule(undefined, 'file:///x/y.js')).toBe(false);
  });
});
