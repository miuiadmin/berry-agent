/**
 * skills 域错误码注册（06 篇 §11 技能机制 + §12.1 skill_manage——SKILLS_ 前缀族）。
 *
 * 前缀族在 contracts/errors.ts ERROR_CODE_PREFIXES 已注册（02 §5.3 #1）；八码全为
 * 落码批定名（规范具名面只有机制语义无码名——06 §11.2 校验族 / §12.1 create 亮拒·
 * patch 三拒 / provider 链装配期撞名）。本文件由模块公开面 index.ts 引入
 * （注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'SKILLS_NAME_INVALID',
    module: 'skills',
    description:
      '技能名词法/长度违例（≤64、^[a-z0-9-]+$、首尾与连续连字符禁——skill_manage create 载荷校验面；装载面同规则仅警告不拒）',
  },
  {
    code: 'SKILLS_NAME_EXISTS',
    module: 'skills',
    description:
      'skill_manage create 同名亮拒不覆写——判据 = 注册表在册名 ∪ 盘上文件在场（坏 frontmatter 文件对 get() 隐身，只查在册名会静默毁文件，06 §12.1）',
  },
  {
    code: 'SKILLS_CONTENT_INVALID',
    module: 'skills',
    description: 'skill_manage create 载荷校验拒——description 非空且 ≤1024 / 正文非空（06 §12.1）',
  },
  {
    code: 'SKILLS_NOT_FOUND',
    module: 'skills',
    description: 'skill_manage patch 目标技能不在注册表（先刷新后改；盘上有坏文件不入册者同报——修坏文件走人面）',
  },
  {
    code: 'SKILLS_LAYER_READONLY',
    module: 'skills',
    description: 'skill_manage patch 仅 project 层可改——user/package 层拒并指路人面（06 §12.1 patch 域条款）',
  },
  {
    code: 'SKILLS_PATCH_MATCH_INVALID',
    module: 'skills',
    description: 'skill_manage patch find 串零匹配或多匹配均拒（不猜改点——与节级寻址歧义报错不猜同律，06 §11.3/§12.1）',
  },
  {
    code: 'SKILLS_WRITE_ROOT_DENIED',
    module: 'skills',
    description:
      'skill_manage create/patch 写点前置可写根断言拒——物理写（含 mkdir）前走装配注入的可写根推导，read-only 档空根即拒（06 §12.1；绕过 fence 的直写即缺陷）',
  },
  {
    code: 'SKILLS_PROVIDER_CONFLICT',
    module: 'skills',
    description:
      '技能 provider 撞名拒——同 id 两方注册属装配期错误 fail-loud（03 skills_change 载荷 = provider id 清单，id 即身份）',
  },
]);
