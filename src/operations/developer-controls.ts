import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/app-exception';
import { PERMISSIONS, can, type Permission } from '../shared/domain/permissions';
import type { Role } from '@prisma/client';

export const activities = {
  programs: '프로그램 신청',
  spaces: '공간 예약',
  clubs: '동아리 가입 신청',
} as const;
export type Activity = keyof typeof activities;
export const settingsKey = 'dev:operations';
export const controls = z.object({
  maintenance: z.boolean(),
  message: z.string().trim().min(1).max(160),
  targets: z.array(z.enum(['programs', 'spaces', 'clubs'])).min(1),
  disabled: z.array(z.enum(['programs', 'spaces', 'clubs'])),
});
export const defaults: z.infer<typeof controls> = {
  maintenance: false,
  message: '센터 서비스 점검 중입니다. 잠시 후 다시 신청해 주세요.',
  targets: ['programs', 'spaces', 'clubs'],
  disabled: [],
};
export const staffPermissions = PERMISSIONS.filter((p) => can({ roles: ['staff'], status: 'active' }, p));
export const roleProfile = z.object({
  label: z.string().trim().min(1).max(45),
  description: z.string().trim().max(240),
  permissions: z.array(z.enum(PERMISSIONS)).refine((ps) => ps.every((p) => staffPermissions.includes(p))),
});
export const binding = z.object({ roleId: z.string().min(1) });

export const roleLimits = z.object({ disabled: z.array(z.enum(PERMISSIONS)) });
export const coreRoleKey = (role: Role) => 'dev:base-role:' + role;
export const editablePermissions = (role: Role) =>
  PERMISSIONS.filter(
    (p) =>
      can({ roles: [role], status: 'active' }, p) &&
      p !== 'admin.access' &&
      !(role === 'developer' && ['developer.view', 'developer.access', 'site.manage'].includes(p)),
  );

export async function effectiveScope(
  db: Pick<PrismaService, 'siteSettings'>,
  id: string,
  roles: Role[],
): Promise<Permission[] | undefined> {
  if (!roles.some((r) => r !== 'member')) return;
  const custom = roles.includes('staff') && !roles.includes('developer') && !roles.includes('admin');
  const records = await db.siteSettings.findMany({
    where: { id: { in: [...roles.map(coreRoleKey), ...(custom ? ['dev:user:' + id] : [])] } },
  });
  if (!records.length) return;
  const disabled = new Map(
    records
      .filter((r) => r.id.startsWith('dev:base-role:'))
      .map((r) => [r.id, roleLimits.parse(r.values).disabled]),
  );
  const allowed = PERMISSIONS.filter((p) =>
    roles.some(
      (role) => can({ roles: [role], status: 'active' }, p) && !disabled.get(coreRoleKey(role))?.includes(p),
    ),
  );
  const assigned = records.find((r) => r.id === 'dev:user:' + id);
  if (!assigned) return allowed;
  const def = await db.siteSettings.findUnique({ where: { id: binding.parse(assigned.values).roleId } });
  const scoped = def ? roleProfile.parse(def.values).permissions : [];
  return allowed.filter((p) => scoped.includes(p));
}
export async function checkActivity(db: PrismaService, activity: Activity) {
  const row = await db.siteSettings.findUnique({ where: { id: settingsKey } });
  if (!row) return;
  const config = controls.parse(row.values);
  if (config.maintenance && config.targets.includes(activity))
    throw new AppException('NOT_CONFIGURED', config.message);
  if (config.disabled.includes(activity))
    throw new AppException('CONFLICT', activities[activity] + ' 접수가 중단되었습니다.');
}
