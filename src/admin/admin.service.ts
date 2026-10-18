import { Injectable } from '@nestjs/common';
import type { Prisma, Role, User as UserRow, UserStatus } from '@prisma/client';
import { AuditService, toAuditEvent } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AppException } from '../common/app-exception';
import { pageArgs, toPage } from '../common/pagination';
import { toNotice } from '../content/content.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toApplication, toProgram } from '../programs/program.mapper';
import { assignableRoles, canManageUser, ROLE_LABEL } from '../shared/domain/permissions';
import type { AuditEvent, DashboardSummary, Page, User } from '../shared/domain/types';
import { toUser } from '../users/user.mapper';
import { type AdminListQuery, orderOf, statusIn } from './admin-query';

const DAY = 86_400_000;
const USER_STATUSES = ['active', 'suspended', 'withdrawn'] as const;
const withManaged = { managedClubs: { select: { clubId: true } } } as const;

export interface MemberPatch {
  roles?: Role[];
  status?: UserStatus;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async dashboard(periodDays: number): Promise<DashboardSummary> {
    const since = new Date(Date.now() - periodDays * DAY);
    const now = new Date();
    const [
      published,
      submitted,
      inPeriod,
      clubPending,
      reservPending,
      inqOpen,
      noticesPublished,
      apps,
      notices,
    ] = await this.prisma.$transaction([
      this.prisma.program.findMany({ where: { status: 'published' } }),
      this.prisma.programApplication.count({ where: { status: 'submitted' } }),
      this.prisma.programApplication.count({ where: { createdAt: { gte: since } } }),
      this.prisma.clubApplication.count({ where: { status: 'pending' } }),
      this.prisma.spaceReservation.count({ where: { status: 'pending' } }),
      this.prisma.inquiry.count({ where: { status: 'open' } }),
      this.prisma.notice.count({ where: { status: 'published' } }),
      this.prisma.programApplication.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { program: true },
      }),
      this.prisma.notice.findMany({ orderBy: { updatedAt: 'desc' }, take: 5 }),
    ]);
    return {
      generatedAt: now.toISOString(),
      programsOpen: published.filter((p) => toProgram(p, now).recruitStatus === 'open').length,
      applicationsSubmitted: submitted,
      applicationsInPeriod: inPeriod,
      clubApplicationsPending: clubPending,
      reservationsPending: reservPending,
      inquiriesOpen: inqOpen,
      noticesPublished,
      recentApplications: apps.map(toApplication),
      recentNotices: notices.map(toNotice),
    };
  }

  async members(q: AdminListQuery): Promise<Page<User>> {
    const text = q.q?.trim();
    const status = statusIn(q.status, USER_STATUSES);
    const where: Prisma.UserWhereInput = {
      ...(status ? { status } : {}),
      ...(text
        ? {
            OR: [
              { name: { contains: text, mode: 'insensitive' } },
              { email: { contains: text, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: orderOf(q.sort, 'createdAt', 'name'),
        include: withManaged,
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.user.count({ where }),
    ]);
    const items = rows.map((u) =>
      toUser(
        u,
        u.managedClubs.map((m) => m.clubId),
      ),
    );
    return toPage(items, total, q.page, q.pageSize);
  }

  async member(id: string): Promise<User> {
    const u = await this.prisma.user.findUnique({ where: { id }, include: withManaged });
    if (!u) throw new AppException('NOT_FOUND');
    return toUser(
      u,
      u.managedClubs.map((m) => m.clubId),
    );
  }

  async updateMember(actor: UserRow, id: string, patch: MemberPatch): Promise<User> {
    if (actor.id === id) {
      throw new AppException('CONFLICT', '자기 자신의 권한·상태는 변경할 수 없습니다.', {
        reason: 'INVALID_STATE',
      });
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppException('NOT_FOUND');
    if (!canManageUser(actor, target)) {
      throw new AppException('FORBIDDEN', '개발자 계정은 개발자만 변경할 수 있습니다.');
    }
    if (patch.roles) {
      const allowed = assignableRoles(actor);
      if (patch.roles.some((r) => !allowed.includes(r))) {
        throw new AppException('FORBIDDEN', '부여할 수 없는 역할입니다.');
      }
    }
    const changes = [
      patch.roles && `역할 ${patch.roles.map((r) => ROLE_LABEL[r]).join(',')}`,
      patch.status && `상태 ${patch.status}`,
    ].filter(Boolean);
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          ...(patch.roles ? { roles: [...new Set(patch.roles)] } : {}),
          ...(patch.status ? { status: patch.status } : {}),
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'user.update',
          targetType: 'user',
          targetId: id,
          summary: `회원 변경: ${u.name} (${changes.join(', ')})`,
        },
        tx,
      );
    });
    // 정지·탈퇴는 즉시 로그아웃 — 남은 세션으로 계속 쓰지 못하게
    if (patch.status && patch.status !== 'active') await this.sessions.revokeAll(id);
    return this.member(id);
  }

  async auditEvents(q: AdminListQuery): Promise<Page<AuditEvent>> {
    const text = q.q?.trim();
    const where: Prisma.AuditEventWhereInput = text
      ? {
          OR: [
            { summary: { contains: text, mode: 'insensitive' } },
            { actorName: { contains: text, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({ where, orderBy: { at: 'desc' }, ...pageArgs(q.page, q.pageSize) }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return toPage(rows.map(toAuditEvent), total, q.page, q.pageSize);
  }
}
