import { Global, Injectable, Module } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { AuditEvent } from '../shared/domain/types';

export type AuditInput = Pick<AuditEvent, 'action' | 'targetType' | 'targetId' | 'summary'>;

export const toAuditEvent = (e: {
  id: string;
  at: Date;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): AuditEvent => ({
  id: e.id,
  at: e.at.toISOString(),
  actorName: e.actorName,
  action: e.action,
  targetType: e.targetType as AuditEvent['targetType'],
  targetId: e.targetId,
  summary: e.summary,
});

/** 관리자 작업 기록 — 변경과 같은 트랜잭션(tx)으로 남기면 변경이 롤백될 때 기록도 함께 사라진다 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(actor: Pick<UserRow, 'id' | 'name'>, e: AuditInput, tx?: Tx): Promise<void> {
    await (tx ?? this.prisma).auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, ...e } });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
