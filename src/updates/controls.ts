import { Injectable } from '@nestjs/common';
import { createHash, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { AuditService } from '../audit/audit.service';
import { env } from '../config/env';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { batches, channelSchema, flavorSchema, platformSchema } from './releases';

const packet = z.object({ body: z.string(), signature: z.string() });
const restored = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  message: z.string(),
  kind: z.enum(['UPDATE', 'ROLLBACK']),
  assetCount: z.number(),
  packet,
});
const stateSchema = z.object({
  percent: z.record(z.string(), z.number().int().min(1).max(100)),
  retired: z.array(z.uuid()),
  restored: z.array(restored),
});
type State = z.infer<typeof stateSchema>;
function emptyState(): State {
  return { percent: {}, retired: [], restored: [] };
}
export type ReleaseRow = {
  id: string;
  group: string;
  flavor: z.infer<typeof flavorSchema>;
  platform: z.infer<typeof platformSchema>;
  channel: z.infer<typeof channelSchema>;
  runtime: string;
  createdAt: string;
  message: string;
  live: boolean;
  status: 'ACTIVE' | 'ROLLED_BACK';
  kind: 'UPDATE' | 'ROLLBACK';
  rolloutPercent: number;
  assetCount: number;
  source?: string;
  packet?: z.infer<typeof packet>;
};
// 화소와 같은 기기별 버킷. 전량 배포에서는 기기 식별자가 없는 설치도 대상이다.
export function inRollout(id: string, percent: number, clientId?: string) {
  if (percent >= 100) return true;
  return (
    !!clientId &&
    createHash('sha256')
      .update(id + ':' + clientId)
      .digest()
      .readUInt32BE(0) %
      100 <
      percent
  );
}
export async function signedPart(row: ReleaseRow) {
  if (row.packet) return row.packet;
  if (!row.source) throw new AppException('SERVER');
  const [body, signature] = await Promise.all([
    readFile(row.source + '.json', 'utf8'),
    readFile(row.source + '.sig', 'utf8'),
  ]);
  if (!/^[A-Za-z0-9+/]+=*$/.test(signature)) throw new AppException('SERVER');
  return { body, signature };
}
export const controlInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('rollout'),
    percent: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]),
  }),
  z.object({ action: z.literal('rollback'), target: z.enum(['previous', 'embedded']) }),
]);
export type ControlInput = z.infer<typeof controlInput>;
@Injectable()
export class ReleaseControls {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async originals() {
    const releases = await batches();
    return releases.flatMap((batch) =>
      (['user', 'admin'] as const).flatMap((flavor) =>
        (['ios', 'android'] as const).map((platform) => {
          const { id, runtime, assetCount } = batch[flavor][platform];
          const group = ['ota', flavor, platform, batch.channel, runtime].join(':');
          return {
            id,
            group,
            flavor,
            platform,
            channel: batch.channel,
            runtime,
            createdAt: batch.createdAt,
            message: batch.message,
            source: join(batch.directory, flavor + '-' + platform),
            kind: 'UPDATE',
            status: 'ACTIVE',
            rolloutPercent: 100,
            assetCount: assetCount ?? 0,
            live: false,
          } satisfies ReleaseRow;
        }),
      ),
    );
  }
  private combine(originals: ReleaseRow[], state: State) {
    const anchor = originals[0];
    if (!anchor) return [];
    const results: ReleaseRow[] = [
      ...originals,
      ...state.restored.map((r) => ({ ...anchor, ...r, source: undefined })),
    ];
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    let assigned = false;
    for (const row of results) {
      row.status = state.retired.includes(row.id) ? 'ROLLED_BACK' : 'ACTIVE';
      row.live = !assigned && row.status === 'ACTIVE';
      assigned ||= row.live;
      row.rolloutPercent = state.percent[row.id] ?? 100;
    }
    return results;
  }
  async rows(group?: string) {
    const groups = new Map<string, ReleaseRow[]>();
    for (const row of await this.originals()) {
      if (group && row.group !== group) continue;
      const subset = groups.get(row.group) ?? [];
      subset.push(row);
      groups.set(row.group, subset);
    }
    const states = await this.db.siteSettings.findMany({ where: { id: { in: [...groups.keys()] } } });
    const byKey = new Map(states.map((r) => [r.id, stateSchema.parse(r.values)]));
    return [...groups]
      .flatMap(([key, rows]) => this.combine(rows, byKey.get(key) ?? emptyState()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async change(actor: { id: string; name: string }, id: string, input: ControlInput) {
    const initial = (await this.rows()).find((r) => r.id === id);
    if (!initial) throw new AppException('NOT_FOUND');
    const originals = (await this.originals()).filter((r) => r.group === initial.group);
    await this.db.$transaction(async (tx: Tx) => {
      const saved = await tx.siteSettings.findUnique({ where: { id: initial.group } });
      const state = saved ? stateSchema.parse(saved.values) : emptyState();
      const rows = this.combine(originals, state);
      const active = rows.find((r) => r.live);
      if (active?.id !== id || active.kind !== 'UPDATE')
        throw new AppException('CONFLICT', '배포 기록이 바뀌었습니다. 새로고침해 주세요.');
      if (input.action === 'rollout') state.percent[id] = input.percent;
      else {
        const previous =
          input.target === 'previous'
            ? rows.find((r) => r.id !== id && r.status === 'ACTIVE' && r.kind === 'UPDATE')
            : undefined;
        const path = env().OTA_ROLLBACK_KEY_FILE;
        if (!path) throw new AppException('NOT_CONFIGURED', '되돌리기 서명 키가 설정되지 않았습니다.');
        const key = await readFile(path);
        const current = await signedPart(active);
        if (
          !verify(
            'sha256',
            Buffer.from(current.body),
            createPublicKey(key),
            Buffer.from(current.signature, 'base64'),
          )
        )
          throw new AppException('NOT_CONFIGURED', '배포 인증서와 되돌리기 서명 키가 일치하지 않습니다.');
        const createdAt = new Date(Math.max(Date.now(), Date.parse(active.createdAt) + 1)).toISOString(),
          nextId = randomUUID();
        const body = previous
          ? JSON.stringify({ ...JSON.parse((await signedPart(previous)).body), id: nextId, createdAt })
          : JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime: createdAt } });
        state.restored.push({
          id: nextId,
          createdAt,
          kind: previous ? 'UPDATE' : 'ROLLBACK',
          message: previous ? '되돌림: ' + previous.message : '내장 버전으로 되돌림',
          assetCount: previous?.assetCount ?? 0,
          packet: { body, signature: sign('sha256', Buffer.from(body), key).toString('base64') },
        });
        state.retired.push(id);
      }
      const written = saved
        ? await tx.siteSettings.updateMany({
            where: { id: initial.group, version: saved.version },
            data: { version: { increment: 1 }, values: state },
          })
        : await tx.siteSettings.createMany({
            data: [{ id: initial.group, version: 1, values: state }],
            skipDuplicates: true,
          });
      if (written.count !== 1)
        throw new AppException('CONFLICT', '다른 관리자가 변경했습니다. 새로고침해 주세요.');
      await this.audit.record(
        actor,
        {
          action: 'ota.' + input.action,
          targetType: 'site_settings',
          targetId: id,
          summary:
            initial.flavor +
            ' ' +
            initial.platform +
            ' 앱 업데이트 ' +
            (input.action === 'rollout' ? input.percent + '% 배포' : '되돌리기'),
        },
        tx,
      );
    });
    return { ok: true };
  }
}
