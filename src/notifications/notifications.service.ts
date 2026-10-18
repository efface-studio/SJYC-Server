import { Global, Injectable, Module } from '@nestjs/common';
import type { Notification as NotificationRow, NotificationKind } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { Notification } from '../shared/domain/types';

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
}

export const toNotification = (n: NotificationRow): Notification => ({
  id: n.id,
  userId: n.userId,
  kind: n.kind,
  title: n.title,
  body: n.body,
  link: n.link,
  createdAt: n.createdAt.toISOString(),
  readAt: n.readAt?.toISOString() ?? null,
});

/** 처리 결과를 본인에게 알린다 — 처리와 같은 트랜잭션에서 만든다 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotifyInput, tx: Tx = this.prisma): Promise<void> {
    await tx.notification.create({ data: input });
  }

  async list(userId: string): Promise<Notification[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toNotification);
  }

  /** ids 를 생략하면 전체 읽음. 다른 회원의 알림은 조건에서 빠진다 */
  async markRead(userId: string, ids?: string[]): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
  }
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
