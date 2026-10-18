import { Injectable } from '@nestjs/common';
import type { ClubRole } from '@prisma/client';
import { type Decision, AdminOpsService } from '../admin/admin-ops.service';
import { AttendanceService } from '../attendance/attendance.service';
import type { AuthUser } from '../auth/session.service';
import { AuditService } from '../audit/audit.service';
import { toClub, toClubApplication, toClubPost, withMemberCount } from '../clubs/club.mapper';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { can, canManageClub } from '../shared/domain/permissions';
import type { ClubIntroInput, ClubPostInput } from '../shared/domain/schemas';
import type { Club, ClubApplication, ClubPost, ClubRosterEntry } from '../shared/domain/types';

const ROLE_LABEL: Record<ClubRole, string> = { leader: '대표', member: '동아리원' };

/** 동아리 담당자 운영 — 센터 직원 이상(club.manage)은 모든 동아리, 담당자는 지정된 동아리만 */
@Injectable()
export class ManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ops: AdminOpsService,
    private readonly attendance: AttendanceService,
  ) {}

  private async requireClub(user: AuthUser, clubId: string) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppException('NOT_FOUND');
    if (!canManageClub(user, clubId))
      throw new AppException('FORBIDDEN', '이 동아리를 운영할 권한이 없습니다.');
    return club;
  }

  async clubs(user: AuthUser): Promise<Club[]> {
    const all = can(user, 'club.manage');
    if (!all && user.managedClubIds.length === 0)
      throw new AppException('FORBIDDEN', '운영하는 동아리가 없습니다.');
    const rows = await this.prisma.club.findMany({
      where: all ? {} : { id: { in: user.managedClubIds } },
      include: withMemberCount,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toClub);
  }

  /** 연락처가 포함된 명단 — 운영 목적 외 사용 금지. 대표 먼저, 이름순 */
  async roster(user: AuthUser, clubId: string): Promise<ClubRosterEntry[]> {
    await this.requireClub(user, clubId);
    const [members, stats] = await Promise.all([
      this.prisma.clubMembership.findMany({
        where: { clubId },
        include: { user: { select: { name: true, email: true, phone: true } } },
      }),
      this.attendance.memberStatsOf({ type: 'club', id: clubId }),
    ]);
    return members
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        attendanceRate: stats.find((s) => s.userId === m.userId)?.rate ?? null,
      }))
      .sort((a, b) =>
        a.role === b.role ? a.name.localeCompare(b.name, 'ko') : a.role === 'leader' ? -1 : 1,
      );
  }

  async setMemberRole(
    user: AuthUser,
    clubId: string,
    userId: string,
    role: ClubRole,
  ): Promise<ClubRosterEntry> {
    await this.requireClub(user, clubId);
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.clubMembership.findUnique({ where: { clubId_userId: { clubId, userId } } });
      if (!found) throw new AppException('NOT_FOUND', '동아리 회원을 찾을 수 없습니다.');
      const m = await tx.clubMembership.update({
        where: { clubId_userId: { clubId, userId } },
        data: { role },
        include: { user: { select: { name: true, email: true, phone: true } } },
      });
      await this.audit.record(
        user,
        {
          action: 'club.member.role',
          targetType: 'club',
          targetId: clubId,
          summary: `동아리 역할 변경: ${m.user.name} → ${ROLE_LABEL[role]}`,
        },
        tx,
      );
      return {
        userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        attendanceRate: null,
      };
    });
  }

  async removeMember(user: AuthUser, clubId: string, userId: string): Promise<void> {
    const club = await this.requireClub(user, clubId);
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.clubMembership.findUnique({
        where: { clubId_userId: { clubId, userId } },
        include: { user: { select: { name: true } } },
      });
      if (!m) throw new AppException('NOT_FOUND', '동아리 회원을 찾을 수 없습니다.');
      await tx.clubMembership.delete({ where: { clubId_userId: { clubId, userId } } });
      await this.audit.record(
        user,
        {
          action: 'club.member.remove',
          targetType: 'club',
          targetId: clubId,
          summary: `동아리 회원 제외: ${m.user.name} · ${club.name}`,
        },
        tx,
      );
    });
  }

  /** 가입 신청 — 대기 먼저, 최신순 */
  async applications(user: AuthUser, clubId: string): Promise<ClubApplication[]> {
    await this.requireClub(user, clubId);
    const rows = await this.prisma.clubApplication.findMany({
      where: { clubId },
      include: { club: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .map(toClubApplication)
      .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  }

  async decideApplication(
    user: AuthUser,
    clubId: string,
    id: string,
    decision: Decision,
    reason: string | null,
  ): Promise<ClubApplication> {
    await this.requireClub(user, clubId);
    return this.ops.decideClubApplication(user, id, decision, reason, clubId);
  }

  /** 소개·모임 일정·모집 여부 — 사진·활동 기록·출처는 센터 직원이 관리한다 */
  async updateIntro(user: AuthUser, clubId: string, input: ClubIntroInput): Promise<Club> {
    await this.requireClub(user, clubId);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.club.update({
        where: { id: clubId },
        data: {
          summary: input.summary,
          description: input.description,
          meetingInfo: input.meetingInfo,
          recruiting: input.recruiting,
        },
        include: withMemberCount,
      });
      await this.audit.record(
        user,
        {
          action: 'club.intro.update',
          targetType: 'club',
          targetId: clubId,
          summary: `동아리 소개 수정: ${c.name}`,
        },
        tx,
      );
      return toClub(c);
    });
  }

  async createPost(user: AuthUser, clubId: string, input: ClubPostInput): Promise<ClubPost> {
    await this.requireClub(user, clubId);
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.clubPost.create({ data: { clubId, ...input } });
      await this.audit.record(
        user,
        {
          action: 'club.post.create',
          targetType: 'club',
          targetId: clubId,
          summary: `동아리 소식 작성: ${p.title}`,
        },
        tx,
      );
      return toClubPost(p);
    });
  }

  async removePost(user: AuthUser, clubId: string, postId: string): Promise<void> {
    await this.requireClub(user, clubId);
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.clubPost.findUnique({ where: { id: postId } });
      if (!p || p.clubId !== clubId) throw new AppException('NOT_FOUND', '소식을 찾을 수 없습니다.');
      await tx.clubPost.delete({ where: { id: postId } });
      await this.audit.record(
        user,
        {
          action: 'club.post.delete',
          targetType: 'club',
          targetId: clubId,
          summary: `동아리 소식 삭제: ${p.title}`,
        },
        tx,
      );
    });
  }
}
