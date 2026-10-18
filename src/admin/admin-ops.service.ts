import { Injectable } from '@nestjs/common';
import { Prisma, type User as UserRow } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { pageArgs, toPage } from '../common/pagination';
import { toClub, toClubApplication, withMemberCount } from '../clubs/club.mapper';
import { toInquiry } from '../content/content.mapper';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { historyEntry, toApplication } from '../programs/program.mapper';
import { lockProgram } from '../programs/programs.service';
import type { ClubFormInput, SpaceFormInput } from '../shared/domain/schemas';
import type {
  BulkResult,
  Club,
  ClubApplication,
  ClubManager,
  Inquiry,
  Page,
  ProgramApplication,
  Space,
  SpaceReservation,
} from '../shared/domain/types';
import { toReservation, toSpace } from '../spaces/space.mapper';
import { type AdminListQuery, orderOf, statusIn } from './admin-query';

export type Decision = 'approved' | 'rejected';
const NOT_FOUND = () => new AppException('NOT_FOUND');
const word = (d: Decision, approved = '승인') => (d === 'approved' ? approved : '반려');

/** 반려는 사유가 있어야 한다 — 신청자에게 그대로 전달된다 */
export function requireReason(decision: Decision, reason: string | null | undefined): string | null {
  const r = reason?.trim() || null;
  if (decision === 'rejected' && !r) {
    throw new AppException('VALIDATION', '반려 사유를 입력해 주세요.', {
      fieldErrors: { reason: '반려 사유를 입력해 주세요.' },
    });
  }
  return r;
}

const contains = (text: string | undefined, fields: string[]) => {
  const q = text?.trim();
  return q ? { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' as const } })) } : {};
};

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------- 프로그램 신청 ---------- */

  async applications(q: AdminListQuery & { programId?: string }): Promise<Page<ProgramApplication>> {
    const status = statusIn(q.status, ['submitted', 'approved', 'rejected', 'cancelled'] as const);
    const text = q.q?.trim();
    const where: Prisma.ProgramApplicationWhereInput = {
      ...(status ? { status } : {}),
      ...(q.programId ? { programId: q.programId } : {}),
      ...(text
        ? {
            OR: [
              { applicantName: { contains: text, mode: 'insensitive' } },
              { receiptNo: { contains: text, mode: 'insensitive' } },
              { program: { title: { contains: text, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy =
      q.sort === 'title' ? { program: { title: 'asc' as const } } : orderOf(q.sort, 'createdAt', 'createdAt');
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.programApplication.findMany({
        where,
        orderBy,
        include: { program: true },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.programApplication.count({ where }),
    ]);
    return toPage(rows.map(toApplication), total, q.page, q.pageSize);
  }

  async application(id: string): Promise<ProgramApplication> {
    const a = await this.prisma.programApplication.findUnique({ where: { id }, include: { program: true } });
    if (!a) throw NOT_FOUND();
    return toApplication(a);
  }

  /** 일괄 승인·반려 — 건별 트랜잭션, 처리할 수 없는 건은 사유와 함께 failed 로 돌려준다 */
  async decideApplications(
    actor: UserRow,
    ids: string[],
    decision: Decision,
    reason: string | null,
  ): Promise<BulkResult> {
    const r = requireReason(decision, reason);
    const result: BulkResult = { succeeded: [], failed: [] };
    for (const id of [...new Set(ids)]) {
      const failure = await this.prisma.$transaction(async (tx) => {
        const found = await tx.programApplication.findUnique({ where: { id }, select: { programId: true } });
        if (!found) return '신청을 찾을 수 없습니다.';
        await lockProgram(tx, found.programId);
        const a = await tx.programApplication.findUniqueOrThrow({
          where: { id },
          include: { program: true },
        });
        if (a.status !== 'submitted') return '이미 처리되었거나 취소된 신청입니다.';
        await tx.programApplication.update({
          where: { id },
          data: {
            status: decision,
            history: [
              ...(a.history as unknown as object[]),
              historyEntry(decision, 'staff', r),
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        // 반려하면 자리가 다시 난다
        if (decision === 'rejected') {
          await tx.program.update({ where: { id: a.programId }, data: { appliedCount: { decrement: 1 } } });
        }
        await this.notifications.notify(
          {
            userId: a.userId,
            kind: 'application',
            title: `프로그램 신청이 ${word(decision)}되었습니다`,
            body: r ? `${a.program.title} · 사유: ${r}` : a.program.title,
            link: `/my/applications/${a.id}`,
          },
          tx,
        );
        await this.audit.record(
          actor,
          {
            action: `application.${decision}`,
            targetType: 'application',
            targetId: id,
            summary: `신청 ${word(decision)}: ${a.applicantName} · ${a.program.title}`,
          },
          tx,
        );
        return null;
      });
      if (failure) result.failed.push({ id, reason: failure });
      else result.succeeded.push(id);
    }
    return result;
  }

  /* ---------- 공간·예약 ---------- */

  async spaces(): Promise<Space[]> {
    const rows = await this.prisma.space.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows.map(toSpace);
  }

  async updateSpace(actor: UserRow, id: string, input: SpaceFormInput): Promise<Space> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.space.findUnique({ where: { id } }))) throw NOT_FOUND();
      const s = await tx.space.update({ where: { id }, data: input });
      await this.audit.record(
        actor,
        {
          action: 'space.update',
          targetType: 'space',
          targetId: id,
          summary: `공간 설정 변경: ${s.name} (예약 ${s.reservable ? '받음' : '중지'})`,
        },
        tx,
      );
      return toSpace(s);
    });
  }

  async reservations(
    q: AdminListQuery & { spaceId?: string; date?: string },
  ): Promise<Page<SpaceReservation>> {
    const status = statusIn(q.status, ['pending', 'approved', 'rejected', 'cancelled'] as const);
    const text = q.q?.trim();
    const where: Prisma.SpaceReservationWhereInput = {
      ...(status ? { status } : {}),
      ...(q.spaceId ? { spaceId: q.spaceId } : {}),
      ...(q.date ? { date: q.date } : {}),
      ...(text
        ? {
            OR: [
              { applicantName: { contains: text, mode: 'insensitive' } },
              { purpose: { contains: text, mode: 'insensitive' } },
              { space: { name: { contains: text, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy =
      q.sort === 'title' ? { space: { name: 'asc' as const } } : orderOf(q.sort, 'createdAt', 'createdAt');
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.spaceReservation.findMany({
        where,
        orderBy,
        include: { space: true },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.spaceReservation.count({ where }),
    ]);
    return toPage(rows.map(toReservation), total, q.page, q.pageSize);
  }

  async decideReservation(
    actor: UserRow,
    id: string,
    decision: Decision,
    reason: string | null,
  ): Promise<SpaceReservation> {
    const r = requireReason(decision, reason);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.spaceReservation.updateMany({
        where: { id, status: 'pending' },
        data: { status: decision, reason: r },
      });
      const res = await tx.spaceReservation.findUnique({ where: { id }, include: { space: true } });
      if (!res) throw NOT_FOUND();
      if (count === 0)
        throw new AppException('CONFLICT', '이미 처리된 예약입니다.', { reason: 'INVALID_STATE' });
      await this.notifications.notify(
        {
          userId: res.userId,
          kind: 'reservation',
          title: `공간 예약이 ${word(decision, '확정')}되었습니다`,
          body: `${res.space.name} · ${res.date} ${res.startTime}–${res.endTime}${r ? ` · 사유: ${r}` : ''}`,
          link: '/my#reservations',
        },
        tx,
      );
      await this.audit.record(
        actor,
        {
          action: `reservation.${decision}`,
          targetType: 'reservation',
          targetId: id,
          summary: `공간 예약 ${word(decision, '확정')}: ${res.applicantName} · ${res.space.name} ${res.date} ${res.startTime}`,
        },
        tx,
      );
      return toReservation(res);
    });
  }

  /* ---------- 문의 ---------- */

  async inquiries(q: AdminListQuery): Promise<Page<Inquiry>> {
    const status = statusIn(q.status, ['open', 'answered'] as const);
    const where: Prisma.InquiryWhereInput = {
      ...(status ? { status } : {}),
      ...contains(q.q, ['title', 'authorName']),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inquiry.findMany({
        where,
        orderBy: orderOf(q.sort, 'createdAt', 'title'),
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.inquiry.count({ where }),
    ]);
    return toPage(rows.map(toInquiry), total, q.page, q.pageSize);
  }

  async inquiry(id: string): Promise<Inquiry> {
    const x = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!x) throw NOT_FOUND();
    return toInquiry(x);
  }

  /** 답변 등록·수정 — 답변자는 처리한 직원 이름 */
  async answerInquiry(actor: UserRow, id: string, body: string): Promise<Inquiry> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.inquiry.findUnique({ where: { id } }))) throw NOT_FOUND();
      const x = await tx.inquiry.update({
        where: { id },
        data: { status: 'answered', answerBody: body, answeredAt: new Date(), answeredBy: actor.name },
      });
      await this.notifications.notify(
        {
          userId: x.userId,
          kind: 'inquiry',
          title: '1:1 문의에 답변이 등록되었습니다',
          body: x.title,
          link: `/qna/${x.id}`,
        },
        tx,
      );
      await this.audit.record(
        actor,
        { action: 'inquiry.answer', targetType: 'inquiry', targetId: id, summary: `문의 답변: ${x.title}` },
        tx,
      );
      return toInquiry(x);
    });
  }

  /* ---------- 동아리 ---------- */

  async clubs(): Promise<Club[]> {
    const rows = await this.prisma.club.findMany({
      include: withMemberCount,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toClub);
  }

  async club(id: string): Promise<Club> {
    const c = await this.prisma.club.findUnique({ where: { id }, include: withMemberCount });
    if (!c) throw NOT_FOUND();
    return toClub(c);
  }

  private clubData(input: ClubFormInput) {
    // 입력하지 않은 선택 항목(사진·활동·출처)은 그대로 둔다
    return Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Prisma.ClubUpdateInput;
  }

  async createClub(actor: UserRow, input: ClubFormInput): Promise<Club> {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.club.create({
        data: this.clubData(input) as Prisma.ClubCreateInput,
        include: withMemberCount,
      });
      await this.audit.record(
        actor,
        { action: 'club.create', targetType: 'club', targetId: c.id, summary: `동아리 등록: ${c.name}` },
        tx,
      );
      return toClub(c);
    });
  }

  async updateClub(actor: UserRow, id: string, input: ClubFormInput): Promise<Club> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.club.findUnique({ where: { id } }))) throw NOT_FOUND();
      const c = await tx.club.update({ where: { id }, data: this.clubData(input), include: withMemberCount });
      await this.audit.record(
        actor,
        { action: 'club.update', targetType: 'club', targetId: id, summary: `동아리 수정: ${c.name}` },
        tx,
      );
      return toClub(c);
    });
  }

  async clubApplications(q: AdminListQuery, clubId?: string): Promise<Page<ClubApplication>> {
    const status = statusIn(q.status, ['pending', 'approved', 'rejected', 'cancelled'] as const);
    const text = q.q?.trim();
    const where: Prisma.ClubApplicationWhereInput = {
      ...(status ? { status } : {}),
      ...(clubId ? { clubId } : {}),
      ...(text
        ? {
            OR: [
              { applicantName: { contains: text, mode: 'insensitive' } },
              { club: { name: { contains: text, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy =
      q.sort === 'title' ? { club: { name: 'asc' as const } } : orderOf(q.sort, 'createdAt', 'createdAt');
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.clubApplication.findMany({
        where,
        orderBy,
        include: { club: true },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.clubApplication.count({ where }),
    ]);
    return toPage(rows.map(toClubApplication), total, q.page, q.pageSize);
  }

  /** 가입 신청 처리 — 승인하면 회원으로 등록한다 (담당자 화면과 공유) */
  async decideClubApplication(
    actor: UserRow,
    id: string,
    decision: Decision,
    reason: string | null,
    clubId?: string,
  ): Promise<ClubApplication> {
    const r = requireReason(decision, reason);
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.clubApplication.findUnique({ where: { id }, include: { club: true } });
      // 담당자 화면에서는 자기 동아리의 신청만 — 다른 동아리 신청은 존재 여부도 알려주지 않는다
      if (!a || (clubId && a.clubId !== clubId)) throw NOT_FOUND();
      const { count } = await tx.clubApplication.updateMany({
        where: { id, status: 'pending' },
        data: { status: decision, reason: r },
      });
      if (count === 0)
        throw new AppException('CONFLICT', '이미 처리된 신청입니다.', { reason: 'INVALID_STATE' });
      if (decision === 'approved') await this.addMember(tx, a.clubId, a.userId);
      await this.notifications.notify(
        {
          userId: a.userId,
          kind: 'club_application',
          title: `동아리 가입 신청이 ${word(decision)}되었습니다`,
          body: r ? `${a.club.name} · 사유: ${r}` : a.club.name,
          link: decision === 'approved' ? `/clubs/${a.clubId}` : '/my',
        },
        tx,
      );
      await this.audit.record(
        actor,
        {
          action: `club_application.${decision}`,
          targetType: 'club_application',
          targetId: id,
          summary: `동아리 가입 ${word(decision)}: ${a.applicantName} · ${a.club.name}`,
        },
        tx,
      );
      return toClubApplication({ ...a, status: decision, reason: r });
    });
  }

  private async addMember(tx: Tx, clubId: string, userId: string) {
    await tx.clubMembership.upsert({
      where: { clubId_userId: { clubId, userId } },
      create: { clubId, userId },
      update: {},
    });
  }

  async managers(clubId: string): Promise<ClubManager[]> {
    await this.club(clubId);
    const rows = await this.prisma.clubManager.findMany({
      where: { clubId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { assignedAt: 'asc' },
    });
    return rows.map((m) => ({
      clubId: m.clubId,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      assignedAt: m.assignedAt.toISOString(),
    }));
  }

  /** 가입된 활동 회원의 이메일로만 지정한다 */
  async assignManager(actor: UserRow, clubId: string, email: string): Promise<ClubManager> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw NOT_FOUND();
    const u = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!u || u.status !== 'active') {
      const message = '가입된 활동 회원의 이메일이 아닙니다.';
      throw new AppException('VALIDATION', message, { fieldErrors: { email: message } });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const m = await tx.clubManager.create({ data: { clubId, userId: u.id } });
        await this.notifications.notify(
          {
            userId: u.id,
            kind: 'club_manager',
            title: '동아리 담당자로 지정되었습니다',
            body: `${club.name} — 관리자 화면의 동아리 운영에서 회원·가입·출석·소식을 관리할 수 있습니다.`,
            link: `/admin/my-clubs/${clubId}`,
          },
          tx,
        );
        await this.audit.record(
          actor,
          {
            action: 'club.manager.assign',
            targetType: 'club',
            targetId: clubId,
            summary: `동아리 담당자 지정: ${u.name} · ${club.name}`,
          },
          tx,
        );
        return { clubId, userId: u.id, name: u.name, email: u.email, assignedAt: m.assignedAt.toISOString() };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppException('CONFLICT', '이미 이 동아리의 담당자입니다.', { reason: 'DUPLICATE' });
      }
      throw e;
    }
  }

  async removeManager(actor: UserRow, clubId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.clubManager.findUnique({
        where: { clubId_userId: { clubId, userId } },
        include: { user: { select: { name: true } }, club: { select: { name: true } } },
      });
      if (!m) throw new AppException('NOT_FOUND', '담당자를 찾을 수 없습니다.');
      await tx.clubManager.delete({ where: { clubId_userId: { clubId, userId } } });
      await this.audit.record(
        actor,
        {
          action: 'club.manager.remove',
          targetType: 'club',
          targetId: clubId,
          summary: `동아리 담당자 해제: ${m.user.name} · ${m.club.name}`,
        },
        tx,
      );
    });
  }
}
