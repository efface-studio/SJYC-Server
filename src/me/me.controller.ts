import { Body, Controller, Delete, Get, HttpCode, Module, Patch, Post, Res } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { SessionService } from '../auth/session.service';
import { AuthModule } from '../auth/auth.controller';
import { CurrentUser } from '../common/auth';
import { apiInput, ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { type ProfileInput, profileSchema } from '../shared/domain/schemas';
import type { ConsentRecord, Notification, User } from '../shared/domain/types';
import { toUser } from '../users/user.mapper';

const readSchema = z.object({ ids: z.array(z.string().max(64)).max(200).optional() });

/** 마이페이지 — 로그인한 본인만 (전역 가드) */
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationsService,
  ) {}

  @Patch('profile')
  async updateProfile(
    @CurrentUser() me: UserRow,
    @Body(new ZodPipe(apiInput(profileSchema))) input: ProfileInput,
  ): Promise<User> {
    const now = new Date().toISOString();
    const marketing: ConsentRecord = {
      key: 'marketing',
      required: false,
      agreed: input.agreeMarketing,
      agreedAt: input.agreeMarketing ? now : null,
    };
    const prev = me.consents as unknown as ConsentRecord[];
    // 마케팅 동의 기록이 없으면(소셜 가입 등) 새로 남기고, 값이 바뀔 때만 시각을 갱신한다
    const consents = prev.some((c) => c.key === 'marketing')
      ? prev.map((c) => (c.key === 'marketing' && c.agreed !== input.agreeMarketing ? marketing : c))
      : [...prev, marketing];
    const u = await this.prisma.user.update({
      where: { id: me.id },
      data: {
        name: input.name,
        phone: input.phone || null,
        consents: consents as unknown as Prisma.InputJsonValue,
      },
    });
    return toUser(u);
  }

  /** 탈퇴 — 상태를 바꾸고 모든 기기에서 로그아웃한다 (보관 의무가 있는 기록은 정책 기간 동안 유지) */
  @Delete()
  @HttpCode(204)
  async withdraw(@CurrentUser() me: UserRow, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.prisma.user.update({ where: { id: me.id }, data: { status: 'withdrawn' } });
    await this.sessions.revokeAll(me.id);
    this.sessions.clearCookie(res);
  }

  @Get('notifications')
  notificationsList(@CurrentUser() me: UserRow): Promise<Notification[]> {
    return this.notifications.list(me.id);
  }

  @Post('notifications/read')
  @HttpCode(204)
  async markRead(
    @CurrentUser() me: UserRow,
    @Body(new ZodPipe(readSchema)) body: z.infer<typeof readSchema>,
  ): Promise<void> {
    await this.notifications.markRead(me.id, body.ids);
  }
}

@Module({ imports: [AuthModule], controllers: [MeController] })
export class MeModule {}
