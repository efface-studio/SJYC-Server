import { Injectable } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { randomToken, hashToken } from '../auth/tokens';
import { AppException } from '../common/app-exception';
import { env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { historyEntry } from '../programs/program.mapper';
import { lockProgram, nextReceiptNo } from '../programs/programs.service';
import { canManageUser } from '../shared/domain/permissions';
import { profileSchema } from '../shared/domain/schemas';

export const memberAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('profile'), ...profileSchema.pick({ name: true, phone: true }).shape }),
  z.object({ action: z.literal('reset-password') }),
  z.object({ action: z.literal('sign-out') }),
  z.object({ action: z.literal('withdraw') }),
  z.object({ action: z.literal('join-club'), clubId: z.string().min(1).max(160) }),
  z.object({ action: z.literal('enroll'), programId: z.string().min(1).max(160) }),
]);
type Command = z.infer<typeof memberAction>;
const labels: Record<Command['action'], string> = {
  profile: '이름·연락처 수정',
  'reset-password': '비밀번호 재설정 링크 발급',
  'sign-out': '모든 기기 로그아웃',
  withdraw: '계정 삭제',
  'join-club': '동아리 추가',
  enroll: '프로그램 참가 등록',
};

@Injectable()
export class MemberActions {
  constructor(
    private db: PrismaService,
    private audit: AuditService,
    private notices: NotificationsService,
  ) {}

  private check(actor: User, target: User | null) {
    if (!target) throw new AppException('NOT_FOUND');
    if (!canManageUser(actor, target))
      throw new AppException('FORBIDDEN', '이 계정에 대한 변경 권한이 없습니다.');
    if (target.status === 'withdrawn') throw new AppException('CONFLICT', '이미 탈퇴한 회원입니다.');
    return target;
  }

  async options(actor: User, id: string) {
    this.check(actor, await this.db.user.findUnique({ where: { id } }));
    const now = new Date();
    const [clubs, programs] = await Promise.all([
      this.db.club.findMany({
        where: { status: 'active', memberships: { none: { userId: id } } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.db.program.findMany({
        where: {
          status: 'published',
          OR: [
            {
              recruitStartsAt: { lte: now },
              recruitEndsAt: { gte: now },
              appliedCount: { lt: this.db.program.fields.capacity },
            },
            { applications: { some: { userId: id, status: 'submitted' } } },
          ],
          applications: { none: { userId: id, status: 'approved' } },
        },
        orderBy: { title: 'asc' },
        select: { id: true, title: true },
      }),
    ]);
    return { clubs: clubs.map(({ id, name }) => ({ id, title: name })), programs };
  }

  async execute(actor: User, id: string, input: Command) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const target = this.check(actor, await tx.user.findUnique({ where: { id } }));
      if (actor.id === id && !['join-club', 'enroll', 'sign-out'].includes(input.action)) {
        throw new AppException('FORBIDDEN', '이 작업은 본인 계정에 수행할 수 없습니다.');
      }
      let resetUrl: string | undefined;
      let detail = '';
      switch (input.action) {
        case 'profile':
          await tx.user.update({ where: { id }, data: { name: input.name, phone: input.phone } });
          break;
        case 'reset-password': {
          if (target.status !== 'active')
            throw new AppException('CONFLICT', '활성 회원만 비밀번호를 재설정할 수 있습니다.');
          const token = randomToken();
          await tx.authToken.deleteMany({ where: { userId: id, purpose: 'reset_password', usedAt: null } });
          await tx.authToken.create({
            data: {
              userId: id,
              purpose: 'reset_password',
              tokenHash: hashToken(token),
              expiresAt: new Date(Date.now() + 30 * 60_000),
            },
          });
          const url = new URL('/password/reset', env().WEB_PUBLIC_URL);
          url.searchParams.set('token', token);
          resetUrl = url.href;
          break;
        }
        case 'sign-out':
          await tx.session.deleteMany({ where: { userId: id } });
          break;
        case 'withdraw':
          await tx.session.deleteMany({ where: { userId: id } });
          await tx.authToken.deleteMany({ where: { userId: id } });
          await tx.userProfilePhoto.deleteMany({ where: { userId: id } });
          await tx.user.update({ where: { id }, data: { status: 'withdrawn' } });
          break;
        case 'join-club': {
          if (target.status !== 'active')
            throw new AppException('CONFLICT', '활성 회원만 등록할 수 있습니다.');
          const c = await tx.club.findFirst({ where: { id: input.clubId, status: 'active' } });
          if (!c) throw new AppException('NOT_FOUND', '활동 중인 동아리를 찾을 수 없습니다.');
          const row = await tx.clubMembership.createMany({
            data: [{ clubId: c.id, userId: id }],
            skipDuplicates: true,
          });
          if (!row.count) throw new AppException('CONFLICT', '이미 소속된 동아리입니다.');
          await tx.clubApplication.updateMany({
            where: { clubId: c.id, userId: id, status: 'pending' },
            data: { status: 'approved', reason: null },
          });
          await this.notices.notify(
            {
              userId: id,
              kind: 'club_application',
              title: '동아리에 등록되었습니다',
              body: c.name,
              link: '/clubs/' + c.id,
            },
            tx,
          );
          detail = c.name;
          break;
        }
        case 'enroll':
          if (target.status !== 'active')
            throw new AppException('CONFLICT', '활성 회원만 등록할 수 있습니다.');
          detail = await this.enroll(tx, target, input.programId);
          break;
      }
      await this.audit.record(
        actor,
        {
          action: 'user.' + input.action,
          targetType: 'user',
          targetId: id,
          summary: labels[input.action] + (detail ? ' · ' + detail : ''),
        },
        tx,
      );
      return resetUrl ? { resetUrl } : {};
    });
  }

  private async enroll(tx: Tx, target: User, programId: string) {
    const program = await lockProgram(tx, programId);
    if (!program || program.status !== 'published')
      throw new AppException('NOT_FOUND', '게시 중인 프로그램을 찾을 수 없습니다.');
    const active = await tx.programApplication.findFirst({
      where: { programId, userId: target.id, status: { in: ['submitted', 'approved'] } },
    });
    if (active?.status === 'approved') throw new AppException('CONFLICT', '이미 참가한 프로그램입니다.');
    const approved = historyEntry('approved', 'staff');
    let applicationId: string;
    if (active) {
      const history = Array.isArray(active.history) ? active.history : [];
      await tx.programApplication.update({
        where: { id: active.id },
        data: { status: 'approved', history: [...history, approved] as Prisma.InputJsonArray },
      });
      applicationId = active.id;
    } else {
      const now = new Date();
      if (program.recruitStartsAt > now || program.recruitEndsAt < now)
        throw new AppException('CONFLICT', '모집 기간이 아닙니다.');
      if (program.appliedCount >= program.capacity)
        throw new AppException('CONFLICT', '정원이 마감되었습니다.');
      if (!target.phone) throw new AppException('VALIDATION', '회원 연락처를 먼저 입력해 주세요.');
      const a = await tx.programApplication.create({
        data: {
          programId,
          userId: target.id,
          applicantName: target.name,
          phone: target.phone,
          note: '',
          receiptNo: await nextReceiptNo(tx),
          status: 'approved',
          history: [{ ...approved }],
        },
      });
      await tx.program.update({ where: { id: programId }, data: { appliedCount: { increment: 1 } } });
      applicationId = a.id;
    }
    await this.notices.notify(
      {
        userId: target.id,
        kind: 'application',
        title: '프로그램 참가가 확정되었습니다',
        body: program.title,
        link: '/my/applications/' + applicationId,
      },
      tx,
    );
    return program.title;
  }
}
