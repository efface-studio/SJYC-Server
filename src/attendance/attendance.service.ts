import { RedisService } from '../redis/redis.service';
import {
  freshPosition,
  distanceMeters,
  CLUB_RADIUS_METERS,
  type AttendanceScan,
  type AttendancePosition,
} from '../shared/domain/check-in-location';
import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AttendanceRecord as RecordRow, AttendanceSession as SessionRow } from '@prisma/client';
import type { AuthUser } from '../auth/session.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { RateLimitService } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { memberStats } from '../shared/domain/attendance';
import { can } from '../shared/domain/permissions';
import type { AttendanceSessionInput } from '../shared/domain/schemas';
import type {
  AttendanceMark,
  AttendanceMemberStat,
  AttendanceSession,
  AttendanceTarget,
  AttendanceTargetSummary,
  MyAttendance,
} from '../shared/domain/types';

/** 출석 코드 유효 시간과 틀린 입력 제한 (웹 mock 과 같은 값) */
const CHECK_IN_MINUTES = 10;
const MAX_CHECK_IN_FAILURES = 5;
const CHECK_IN_LOCK_SECONDS = 10 * 60;

type SessionWithRecords = SessionRow & { records: RecordRow[] };
const withRecords = { records: true } as const;

const isOpen = (s: Pick<SessionRow, 'checkInCode' | 'checkInClosesAt'>, now = Date.now()) =>
  !!s.checkInCode && !!s.checkInClosesAt && s.checkInClosesAt.getTime() > now;

export function toSession(s: SessionWithRecords): AttendanceSession {
  const open = isOpen(s);
  return {
    id: s.id,
    targetType: s.targetType,
    targetId: s.targetId,
    targetName: s.targetName,
    date: s.date,
    title: s.title,
    // 마감 시간이 지난 코드는 내려주지 않는다
    checkInCode: open ? s.checkInCode : null,
    checkInClosesAt: open ? s.checkInClosesAt!.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    createdBy: s.createdBy,
    records: [...s.records]
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((r) => ({
        userId: r.userId,
        name: r.name,
        status: r.status,
        checkedAt: r.checkedAt?.toISOString() ?? null,
        method: r.method,
        note: r.note,
      })),
  };
}

const toMine = (s: SessionRow, r: RecordRow): MyAttendance => ({
  sessionId: s.id,
  targetType: s.targetType,
  targetId: s.targetId,
  targetName: s.targetName,
  date: s.date,
  title: s.title,
  status: r.status,
  checkedAt: r.checkedAt?.toISOString() ?? null,
});

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimitService,
    private readonly redis: RedisService,
  ) {}

  /** 센터 직원 이상은 모든 대상, 동아리 담당자는 자기 동아리만 */
  requireManager(user: AuthUser, target: AttendanceTarget): void {
    if (can(user, 'attendance.manage')) return;
    if (target.type === 'club' && user.managedClubIds.includes(target.id)) return;
    throw new AppException('FORBIDDEN', '이 출석부를 관리할 권한이 없습니다.');
  }

  /** 명단 — 동아리: 동아리원, 프로그램: 승인된 신청자 (활동 중인 회원만), 이름순 */
  async roster(target: AttendanceTarget): Promise<{ userId: string; name: string }[]> {
    const users =
      target.type === 'club'
        ? (
            await this.prisma.clubMembership.findMany({
              where: { clubId: target.id, user: { status: 'active' } },
              include: { user: { select: { id: true, name: true } } },
            })
          ).map((m) => m.user)
        : (
            await this.prisma.programApplication.findMany({
              where: { programId: target.id, status: 'approved', user: { status: 'active' } },
              include: { user: { select: { id: true, name: true } } },
            })
          ).map((a) => a.user);
    const unique = new Map(users.map((u) => [u.id, u.name]));
    return [...unique]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  private async targetName(target: AttendanceTarget): Promise<string> {
    const name =
      target.type === 'club'
        ? (await this.prisma.club.findUnique({ where: { id: target.id } }))?.name
        : (await this.prisma.program.findUnique({ where: { id: target.id } }))?.title;
    if (!name) throw new AppException('NOT_FOUND', '출석 대상을 찾을 수 없습니다.');
    return name;
  }

  async targets(user: AuthUser): Promise<AttendanceTargetSummary[]> {
    const all = can(user, 'attendance.manage');
    if (!all && user.managedClubIds.length === 0) {
      throw new AppException('FORBIDDEN', '출석부를 관리할 권한이 없습니다.');
    }
    const clubs = await this.prisma.club.findMany({
      where: { status: 'active', ...(all ? {} : { id: { in: user.managedClubIds } }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const programs = all
      ? await this.prisma.program.findMany({ where: { status: 'published' }, orderBy: { startsAt: 'desc' } })
      : [];
    const targets = [
      ...clubs.map((c) => ({ type: 'club' as const, id: c.id, name: c.name })),
      ...programs.map((p) => ({ type: 'program' as const, id: p.id, name: p.title })),
    ];
    // ponytail: 대상마다 명단·회차를 센다 — 대상이 수백 개를 넘으면 groupBy 로 한 번에 센다
    return Promise.all(
      targets.map(async (t) => ({
        ...t,
        rosterCount: (await this.roster(t)).length,
        sessionCount: await this.prisma.attendanceSession.count({
          where: { targetType: t.type, targetId: t.id },
        }),
      })),
    );
  }

  async sessions(user: AuthUser, target: AttendanceTarget): Promise<AttendanceSession[]> {
    this.requireManager(user, target);
    const rows = await this.prisma.attendanceSession.findMany({
      where: { targetType: target.type, targetId: target.id },
      include: withRecords,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return Promise.all(rows.map((s) => this.withQr(s)));
  }

  /** 회차를 찾고 그 대상의 관리 권한을 확인한다 */
  private async loadSession(user: AuthUser, id: string): Promise<SessionWithRecords> {
    const s = await this.prisma.attendanceSession.findUnique({ where: { id }, include: withRecords });
    if (!s) throw new AppException('NOT_FOUND');
    this.requireManager(user, { type: s.targetType, id: s.targetId });
    return s;
  }

  async get(user: AuthUser, id: string): Promise<AttendanceSession> {
    return this.withQr(await this.loadSession(user, id));
  }

  private async withQr(row: SessionWithRecords): Promise<AttendanceSession> {
    const session = toSession(row);
    if (session.targetType === 'club' && session.checkInClosesAt && session.checkInCode)
      session.qrTicket = await this.redis.get(
        'attendance:qr:' + row.id + ':' + session.checkInClosesAt + ':' + session.checkInCode,
      );
    return session;
  }

  async scan(userId: string, input: AttendanceScan) {
    if (input.kind === 'program') return this.checkIn(userId, input.code, { targetType: 'program' });
    if (!freshPosition(input.position))
      throw new AppException('VALIDATION', '정확한 현재 위치를 다시 확인해 주세요.');
    if (await this.limiter.exceeded('attendance:scan:' + userId, 30, 60))
      throw new AppException('RATE_LIMITED');
    const saved = await this.redis.get('attendance:ticket:' + input.ticket);
    if (!saved) throw new AppException('VALIDATION', 'QR이 만료되었습니다. 새 QR을 스캔해 주세요.');
    const { id, code, until, position } = JSON.parse(saved) as {
      id: string;
      code: string;
      until: string;
      position: AttendancePosition;
    };
    if (distanceMeters(position, input.position) > CLUB_RADIUS_METERS)
      throw new AppException('VALIDATION', 'QR 생성 위치 반경 100m 안에서 스캔해 주세요.');
    return this.checkIn(userId, code, { targetType: 'club', id, expires: new Date(until) });
  }
  async create(
    user: AuthUser,
    target: AttendanceTarget,
    input: AttendanceSessionInput,
  ): Promise<AttendanceSession> {
    this.requireManager(user, target);
    const targetName = await this.targetName(target);
    const roster = await this.roster(target);
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.attendanceSession.create({
        data: {
          targetType: target.type,
          targetId: target.id,
          targetName,
          date: input.date,
          title: input.title,
          createdBy: user.name,
          records: { create: roster.map((r) => ({ userId: r.userId, name: r.name })) },
        },
        include: withRecords,
      });
      await this.audit.record(
        user,
        {
          action: 'attendance.create',
          targetType: 'attendance',
          targetId: s.id,
          summary: `출석부 생성: ${targetName} ${s.date} ${s.title}`,
        },
        tx,
      );
      return toSession(s);
    });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const s = await this.loadSession(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceSession.delete({ where: { id } });
      await this.audit.record(
        user,
        {
          action: 'attendance.delete',
          targetType: 'attendance',
          targetId: id,
          summary: `출석부 삭제: ${s.targetName} ${s.date} ${s.title}`,
        },
        tx,
      );
    });
  }

  /** 여러 명을 한 번에 체크 — 명단에 없는 회원이 섞이면 아무것도 바꾸지 않는다 */
  async mark(user: AuthUser, id: string, marks: AttendanceMark[]): Promise<AttendanceSession> {
    const s = await this.loadSession(user, id);
    if (marks.some((m) => !s.records.some((r) => r.userId === m.userId))) {
      throw new AppException('VALIDATION', '출석부 명단에 없는 회원이 포함되어 있습니다.');
    }
    const now = new Date();
    await this.prisma.$transaction(
      marks.map((m) =>
        this.prisma.attendanceRecord.update({
          where: { sessionId_userId: { sessionId: id, userId: m.userId } },
          data: {
            status: m.status,
            checkedAt: m.status ? now : null,
            method: m.status ? 'manager' : null,
            ...(m.note !== undefined ? { note: m.note?.trim().slice(0, 100) || null } : {}),
          },
        }),
      ),
    );
    return this.get(user, id);
  }

  /** 열려 있는 다른 회차와 겹치지 않는 4자리 코드 */
  private async issueCode(): Promise<string> {
    const open = await this.prisma.attendanceSession.findMany({
      where: { checkInCode: { not: null }, checkInClosesAt: { gt: new Date() } },
      select: { checkInCode: true },
    });
    const taken = new Set(open.map((s) => s.checkInCode));
    // ponytail: 동시에 두 회차가 같은 코드를 받을 확률은 1/10000 수준 — 문제가 되면 열린 코드에 부분 고유 인덱스
    for (;;) {
      const code = String(randomInt(10_000)).padStart(4, '0');
      if (!taken.has(code)) return code;
    }
  }

  async setCheckIn(
    user: AuthUser,
    id: string,
    open: boolean,
    position?: AttendancePosition,
  ): Promise<AttendanceSession> {
    const s = await this.loadSession(user, id);
    const data = open
      ? {
          checkInCode: await this.issueCode(),
          checkInClosesAt: new Date(Date.now() + CHECK_IN_MINUTES * 60_000),
        }
      : { checkInCode: null, checkInClosesAt: null };
    if (open && s.targetType === 'club' && position && data.checkInClosesAt && data.checkInCode) {
      if (!freshPosition(position))
        throw new AppException('VALIDATION', '정확한 현재 위치를 다시 확인해 주세요.');
      const ticket = Array.from({ length: 2 }, () => String(randomInt(100_000_000)).padStart(8, '0')).join(
        '',
      );
      const until = data.checkInClosesAt.toISOString(),
        code = data.checkInCode;
      const result = await this.redis
        .multi()
        .set(
          'attendance:ticket:' + ticket,
          JSON.stringify({ id, code, until, position }),
          'EX',
          CHECK_IN_MINUTES * 60,
        )
        .set('attendance:qr:' + id + ':' + until + ':' + code, ticket, 'EX', CHECK_IN_MINUTES * 60)
        .exec();
      if (!result || result.some(([error]) => error))
        throw new AppException('NETWORK', 'QR을 생성하지 못했습니다.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceSession.update({ where: { id }, data });
      await this.audit.record(
        user,
        {
          action: open ? 'attendance.checkin.open' : 'attendance.checkin.close',
          targetType: 'attendance',
          targetId: id,
          summary: `출석 코드 ${open ? '열기' : '닫기'}: ${s.targetName} ${s.date} ${s.title}`,
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  async stats(user: AuthUser, target: AttendanceTarget): Promise<AttendanceMemberStat[]> {
    this.requireManager(user, target);
    return this.memberStatsOf(target);
  }

  /** 회원별 누적 — 공유 규칙(memberStats)으로 계산한다 */
  async memberStatsOf(target: AttendanceTarget): Promise<AttendanceMemberStat[]> {
    const rows = await this.prisma.attendanceSession.findMany({
      where: { targetType: target.type, targetId: target.id },
      include: withRecords,
    });
    return memberStats(rows.map(toSession));
  }

  async mine(userId: string): Promise<MyAttendance[]> {
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { userId },
      include: { session: true },
      orderBy: [{ session: { date: 'desc' } }, { session: { createdAt: 'desc' } }],
    });
    return rows.map((r) => toMine(r.session, r));
  }

  /** 본인 출석 코드 입력 — 틀리면 실패 횟수를 세고 5번이면 10분 잠근다 */
  async checkIn(
    userId: string,
    code: string,
    scope?: { targetType: 'club' | 'program'; id?: string; expires?: Date },
  ): Promise<MyAttendance> {
    const key = `checkin:fail:${userId}`;
    if ((await this.limiter.count(key)) >= MAX_CHECK_IN_FAILURES) {
      throw new AppException('RATE_LIMITED', '출석 코드를 여러 번 틀렸습니다. 잠시 후 다시 시도해 주세요.');
    }
    const record = await this.prisma.attendanceRecord.findFirst({
      where: {
        userId,
        session: {
          id: scope?.id,
          targetType: scope?.targetType,
          checkInCode: code,
          checkInClosesAt: { gt: new Date(), equals: scope?.expires },
        },
      },
      include: { session: true },
    });
    if (!record) {
      await this.limiter.exceeded(key, MAX_CHECK_IN_FAILURES, CHECK_IN_LOCK_SECONDS);
      throw new AppException('VALIDATION', '출석 코드가 맞지 않거나 출석 시간이 지났습니다.', {
        fieldErrors: { code: '출석 코드를 다시 확인해 주세요.' },
      });
    }
    await this.limiter.reset(key);
    // 담당자가 이미 체크했다면 그 결과를 존중한다
    const where = { sessionId: record.sessionId, userId };
    if (record.status === null) {
      const saved = await this.prisma.attendanceRecord.updateMany({
        where: {
          ...where,
          status: null,
          session: {
            checkInCode: code,
            checkInClosesAt: { gt: new Date(), equals: record.session.checkInClosesAt },
          },
        },
        data: { status: 'present', method: 'self', checkedAt: new Date() },
      });
      if (!saved.count) {
        const concurrent = await this.prisma.attendanceRecord.findUnique({
          where: { sessionId_userId: where },
        });
        if (!concurrent?.status) throw new AppException('VALIDATION', '출석 시간이 지났습니다.');
        return toMine(record.session, concurrent);
      }
    }
    const updated = await this.prisma.attendanceRecord.findUniqueOrThrow({
      where: { sessionId_userId: where },
    });
    return toMine(record.session, updated);
  }
}
