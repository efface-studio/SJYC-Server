import { Injectable } from '@nestjs/common';
import { createHash, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppException } from '../common/app-exception';
import { AuditService } from '../audit/audit.service';
import { can, PERMISSIONS } from '../shared/domain/permissions';
import { effectiveScope } from '../operations/developer-controls';
import { env } from '../config/env';
import { ReleaseControls, inRollout, signedPart, type ReleaseRow } from './controls';

const role = z.enum(['member', 'staff', 'admin', 'developer']);
export const splash = z.object({ percent: z.boolean(), bar: z.boolean(), notes: z.boolean() });
export const settingsPatch = z
  .object({
    automatic: z.boolean().optional(),
    splash: splash.optional(),
    version: z.number().int().nonnegative(),
  })
  .strict();
const defaults = {
  automatic: true,
  splash: { percent: true, bar: true, notes: true },
  pinned: {} as Record<string, boolean>,
};
const configSchema = z.object({ automatic: z.boolean(), splash, pinned: z.record(z.string(), z.boolean()) });
const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('everyone') }),
  z.object({ kind: z.literal('users'), emails: z.array(z.email().max(254)).min(1).max(100) }),
  z.object({ kind: z.literal('role'), role }),
  z.object({ kind: z.literal('permission'), permission: z.enum(PERMISSIONS) }),
]);
export const waveInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('publish'),
    scope,
    percent: z.number().int().min(1).max(100),
    at: z.iso.datetime().optional(),
    version: z.number().int().nonnegative(),
  }),
  z.object({ action: z.enum(['cancel', 'undo']), waveId: z.uuid(), version: z.number().int().nonnegative() }),
]);
type Input = z.infer<typeof waveInput>;
const rollback = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  kind: z.enum(['UPDATE', 'ROLLBACK']),
  packet: z.object({ body: z.string(), signature: z.string() }),
});
const waveSchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  label: z.string(),
  percent: z.number(),
  users: z.array(z.string()),
  everyone: z.boolean(),
  cancelled: z.boolean(),
  rollback: rollback.nullable(),
});
type Wave = z.infer<typeof waveSchema>;
const wavesSchema = z.array(waveSchema);
type Config = z.infer<typeof configSchema>;
type Releases = { config: Config; version: number; plans: Map<string, { waves: Wave[]; version: number }> };
const key = 'ota:distribution:settings';
const planKey = (id: string) => 'ota:distribution:wave:' + id;
const manual = (c: Config, r: ReleaseRow) => r.source !== undefined && !(c.pinned[r.id] ?? c.automatic);
const covers = (wave: Wave, user?: string) => wave.everyone || (!!user && wave.users.includes(user));
type Actor = { id: string; name: string };
const conflict = (msg: string) => new AppException('CONFLICT', msg);

export function universal(row: ReleaseRow, data: Releases, now = new Date().toISOString()) {
  if (row.status !== 'ACTIVE' || row.kind !== 'UPDATE') return false;
  if (!manual(data.config, row)) return row.rolloutPercent === 100;
  const assigned = (data.plans.get(row.id)?.waves ?? []).filter((w) => !w.cancelled);
  return assigned.some((w) => w.everyone) && assigned.every((w) => w.at <= now && !w.rollback);
}

export function destination(
  rows: ReleaseRow[],
  data: Releases,
  user?: string,
  device?: string,
  now = new Date().toISOString(),
) {
  for (const row of rows) {
    if (row.status !== 'ACTIVE') continue;
    if (!manual(data.config, row)) {
      if (inRollout(row.id, row.rolloutPercent, device)) return row;
      continue;
    }
    const waves = data.plans.get(row.id)?.waves ?? [];
    if (!user && waves.some((w) => !w.cancelled && !w.everyone && (w.rollback || w.at > now))) continue;
    const assignment = waves.find((w) => !w.cancelled && covers(w, user));
    if (assignment && assignment.at > now) continue;
    if (assignment) return assignment.rollback ? { ...row, ...assignment.rollback, source: undefined } : row;
  }
}

@Injectable()
export class Distribution {
  constructor(
    private db: PrismaService,
    private controls: ReleaseControls,
    private audit: AuditService,
  ) {}
  async read(rows: ReleaseRow[], db: Tx | PrismaService = this.db): Promise<Releases> {
    const values = await db.siteSettings.findMany({
      where: { id: { in: [key, ...rows.map((r) => planKey(r.id))] } },
    });
    const settings = values.find((v) => v.id === key);
    const plans: Releases['plans'] = new Map();
    for (const v of values)
      if (v.id !== key)
        plans.set(v.id.slice(planKey('').length), { waves: wavesSchema.parse(v.values), version: v.version });
    return {
      config: settings ? configSchema.parse(settings.values) : defaults,
      version: settings?.version ?? 0,
      plans,
    };
  }
  async preferences() {
    const { config, version } = await this.read([]);
    return { automatic: config.automatic, splash: config.splash, version };
  }
  private async lock(tx: Tx) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(650067)`;
  }
  async configure(actor: Actor, input: z.infer<typeof settingsPatch>) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const { config, version } = await this.read([], tx);
      if (version !== input.version) throw conflict('설정이 변경되었습니다. 새로고침해 주세요.');
      const pinned = { ...config.pinned };
      if (input.automatic !== undefined && input.automatic !== config.automatic) {
        for (const row of await this.controls.rows()) if (row.source) pinned[row.id] ??= config.automatic;
      }
      const values = {
        automatic: input.automatic ?? config.automatic,
        splash: input.splash ?? config.splash,
        pinned,
      };
      await tx.siteSettings.upsert({
        where: { id: key },
        create: { id: key, version: 1, values },
        update: { version: { increment: 1 }, values },
      });
      await this.audit.record(
        actor,
        {
          action: 'ota.settings',
          targetType: 'site_settings',
          targetId: key,
          summary: 'OTA 발행 및 스플래시 설정 변경',
        },
        tx,
      );
      return { automatic: values.automatic, splash: values.splash, version: version + 1 };
    });
  }
  describe(row: ReleaseRow, data: Releases) {
    const plan = data.plans.get(row.id);
    return {
      manual: manual(data.config, row),
      planVersion: plan?.version ?? 0,
      waves: (plan?.waves ?? []).map((w) => ({
        id: w.id,
        at: w.at,
        label: w.label,
        count: w.users.length,
        everyone: w.everyone,
        percent: w.percent,
        state: w.cancelled
          ? 'cancelled'
          : w.rollback
            ? 'rolledBack'
            : Date.parse(w.at) > Date.now()
              ? 'scheduled'
              : 'active',
      })),
    };
  }
  async change(actor: Actor, id: string, input: Input) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const rows = await this.controls.rows();
      const row = rows.find((r) => r.id === id);
      if (!row) throw new AppException('NOT_FOUND');
      const data = await this.read(rows, tx),
        plan = data.plans.get(id) ?? { waves: [], version: 0 };
      if (!row.live || !manual(data.config, row) || plan.version !== input.version)
        throw conflict('배포 대상 또는 기록이 변경되었습니다. 다시 확인해 주세요.');
      const now = new Date().toISOString();
      if (input.action === 'publish') {
        if (input.at && input.at <= now)
          throw new AppException('VALIDATION', '예약 시각은 현재 시각 이후여야 합니다.');
        const prior = plan.waves.filter((w) => !w.cancelled);
        if (prior.some((w) => w.everyone)) throw conflict('이미 잔여 대상 전체가 배정되었습니다.');
        const assigned = new Set(prior.flatMap((w) => w.users));
        const selected = input.scope;
        const emails =
          selected.kind === 'users' ? [...new Set(selected.emails.map((e) => e.toLowerCase()))] : undefined;
        const population = await tx.user.findMany({
          where: {
            status: 'active',
            ...(emails ? { email: { in: emails } } : {}),
            ...(selected.kind === 'role' ? { roles: { has: selected.role } } : {}),
            ...(row.flavor === 'admin'
              ? {
                  OR: [
                    { roles: { hasSome: ['developer', 'admin', 'staff'] } },
                    { managedClubs: { some: {} } },
                  ],
                }
              : {}),
          },
          select: { id: true, roles: true, status: true },
        });
        if (emails && population.length !== emails.length)
          throw new AppException('VALIDATION', '대상 앱을 이용할 수 있는 활성 회원 이메일을 확인해 주세요.');
        const eligible: string[] = [];
        for (const u of population) {
          if (assigned.has(u.id)) continue;
          if (
            selected.kind === 'permission' &&
            !can({ ...u, permissionScope: await effectiveScope(tx, u.id, u.roles) }, selected.permission)
          )
            continue;
          eligible.push(u.id);
        }
        const everyone = selected.kind === 'everyone' && input.percent === 100;
        if (!everyone && !eligible.length) throw conflict('조건에 맞는 미배정 회원이 없습니다.');
        const rank = (u: string) =>
          createHash('sha256')
            .update(id + ':' + u)
            .digest('hex');
        const ranked = eligible
          .map((u) => ({ u, rank: rank(u) }))
          .sort((a, b) => a.rank.localeCompare(b.rank));
        const users = ranked.slice(0, Math.ceil((ranked.length * input.percent) / 100)).map((r) => r.u);
        plan.waves.push({
          id: randomUUID(),
          at: input.at ?? now,
          users,
          everyone,
          cancelled: false,
          rollback: null,
          percent: input.percent,
          label:
            selected.kind === 'everyone'
              ? prior.length
                ? '잔여 전체'
                : '전체'
              : selected.kind === 'users'
                ? '지정 회원'
                : selected.kind === 'role'
                  ? selected.role
                  : selected.permission,
        });
      } else {
        const w = plan.waves.find((w) => w.id === input.waveId);
        if (!w || w.cancelled || w.rollback) throw conflict('변경 가능한 배포 차수가 아닙니다.');
        if (input.action === 'cancel') {
          if (w.at <= now) throw conflict('이미 시작한 배포입니다.');
          w.cancelled = true;
        } else {
          if (w.at > now) throw conflict('아직 시작하지 않은 배포입니다.');
          const previous = rows.find(
            (p) => p.group === row.group && p.createdAt < row.createdAt && universal(p, data, now),
          );
          w.rollback = await this.rollback(row, previous);
        }
      }
      await tx.siteSettings.upsert({
        where: { id: planKey(id) },
        create: { id: planKey(id), version: 1, values: plan.waves },
        update: { values: plan.waves, version: { increment: 1 } },
      });
      await this.audit.record(
        actor,
        {
          action: 'ota.wave.' + input.action,
          targetType: 'site_settings',
          targetId: id,
          summary: 'OTA ' + row.flavor + ' ' + row.platform + ' 배포 차수 변경',
        },
        tx,
      );
      return { ok: true };
    });
  }
  private async rollback(current: ReleaseRow, previous?: ReleaseRow): Promise<NonNullable<Wave['rollback']>> {
    const path = env().OTA_ROLLBACK_KEY_FILE;
    if (!path) throw new AppException('NOT_CONFIGURED', '되돌리기 서명 키를 확인해 주세요.');
    const key = await readFile(path),
      source = await signedPart(previous ?? current);
    if (
      !verify(
        'sha256',
        Buffer.from(source.body),
        createPublicKey(key),
        Buffer.from(source.signature, 'base64'),
      )
    )
      throw new AppException('NOT_CONFIGURED', '배포 서명을 확인해 주세요.');
    const id = randomUUID(),
      createdAt = new Date(Math.max(Date.now(), Date.parse(current.createdAt) + 1)).toISOString();
    const body = previous
      ? JSON.stringify({ ...JSON.parse(source.body), id, createdAt })
      : JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime: createdAt } });
    return {
      id,
      createdAt,
      kind: previous ? 'UPDATE' : 'ROLLBACK',
      packet: { body, signature: sign('sha256', Buffer.from(body), key).toString('base64') },
    };
  }
}
