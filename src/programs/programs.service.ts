import type { ApplicationEditInput } from '../shared/domain/types';
import { Injectable } from '@nestjs/common';
import { Prisma, type Program as ProgramRow, type User as UserRow } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { computeRecruitStatus } from '../shared/domain/program';
import type { ProgramApplyInput } from '../shared/domain/schemas';
import type {
  Page,
  Program,
  ProgramApplication,
  ProgramCategory,
  RecruitStatus,
} from '../shared/domain/types';
import { historyEntry, toApplication, toProgram } from './program.mapper';

export interface ProgramQuery {
  q?: string;
  categoryId?: string;
  recruitStatus?: RecruitStatus;
  page: number;
  pageSize: number;
}

const ORDER: Record<RecruitStatus, number> = { open: 0, upcoming: 1, full: 2, closed: 3 };
const NOT_FOUND = () => new AppException('NOT_FOUND');

/** 같은 트랜잭션 안에서 프로그램 행을 잠근다 — 동시 신청·취소가 정원을 넘기지 못하게 */
export async function lockProgram(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Program" WHERE id = ${id} FOR UPDATE`;
  return tx.program.findUnique({ where: { id } });
}

/** 접수 번호 — DB 시퀀스로 서버가 발급한다 */
export async function nextReceiptNo(tx: Tx): Promise<string> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('program_application_receipt_seq') AS n`;
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(
    new Date(),
  );
  return `SJYC-${year}-${String(row!.n).padStart(6, '0')}`;
}

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async categories(): Promise<ProgramCategory[]> {
    const rows = await this.prisma.programCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ id, name, group }) => ({ id, name, group }));
  }

  /** 같은 시각과 DB 스냅샷으로 모집 상태, 전체 건수, 페이지를 계산한다. */
  async list(q: ProgramQuery): Promise<Page<Program>> {
    const now = new Date();
    // Prisma의 DateTime 열은 UTC timestamp다. 경계 시각에서는 모집 중으로 판정한다.
    const instant = Prisma.sql`(${now}::timestamptz AT TIME ZONE 'UTC')`;
    const rank = Prisma.sql`CASE
      WHEN "recruitStartsAt" > ${instant} THEN 1
      WHEN "recruitEndsAt" < ${instant} THEN 3
      WHEN "appliedCount" >= capacity THEN 2
      ELSE 0 END`;
    const filters = [Prisma.sql`status = 'published'`];
    if (q.categoryId) filters.push(Prisma.sql`"categoryId" = ${q.categoryId}`);
    const text = q.q?.trim();
    if (text) {
      const pattern = `%${text}%`;
      filters.push(
        Prisma.sql`(title ILIKE ${pattern} OR summary ILIKE ${pattern} OR target ILIKE ${pattern})`,
      );
    }
    if (q.recruitStatus) filters.push(Prisma.sql`${rank} = ${ORDER[q.recruitStatus]}`);
    const where = Prisma.join(filters, ' AND ');
    const offset = (BigInt(q.page) - 1n) * BigInt(q.pageSize);
    const [rows, [count]] = await this.prisma.$transaction(
      [
        this.prisma.$queryRaw<ProgramRow[]>`
        SELECT * FROM "Program" WHERE ${where}
        ORDER BY ${rank}, "recruitEndsAt", id
        LIMIT ${q.pageSize} OFFSET ${offset}`,
        this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM "Program" WHERE ${where}`,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: rows.map((row) => toProgram(row, now)),
      total: Number(count!.total),
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(id: string): Promise<Program> {
    const p = await this.prisma.program.findUnique({ where: { id } });
    if (!p || p.status !== 'published') throw NOT_FOUND();
    return toProgram(p);
  }

  async apply(user: UserRow, id: string, input: ProgramApplyInput): Promise<ProgramApplication> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const p = await lockProgram(tx, id);
        if (!p) throw NOT_FOUND();
        const status = computeRecruitStatus(toProgram(p), new Date());
        if (p.status !== 'published' || status === 'upcoming' || status === 'closed') {
          throw new AppException('CONFLICT', '모집 기간이 아닙니다.', { reason: 'RECRUIT_CLOSED' });
        }
        const active = await tx.programApplication.findFirst({
          where: { programId: id, userId: user.id, status: { in: ['submitted', 'approved'] } },
        });
        if (active) throw duplicate();
        if (status === 'full') {
          throw new AppException('CONFLICT', '정원이 마감되었습니다.', { reason: 'CAPACITY_FULL' });
        }
        const a = await tx.programApplication.create({
          data: {
            receiptNo: await nextReceiptNo(tx),
            programId: id,
            userId: user.id,
            applicantName: user.name,
            phone: input.phone,
            note: input.note,
            history: [historyEntry('submitted', 'applicant')] as unknown as Prisma.InputJsonValue,
          },
          include: { program: true },
        });
        await tx.program.update({ where: { id }, data: { appliedCount: { increment: 1 } } });
        return toApplication(a);
      });
    } catch (e) {
      // 부분 고유 인덱스(활동 중 신청 1건) 위반 — 동시에 두 번 누른 경우
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw duplicate();
      throw e;
    }
  }

  async editApplication(userId: string, id: string, input: ApplicationEditInput) {
    return this.prisma.$transaction(async (tx) => {
      // 같은 신청의 수정 순서를 직렬화한다. 소유자가 아닌 경우 행을 잠그지 않는다.
      await tx.$queryRaw`SELECT id FROM "ProgramApplication" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const row = await tx.programApplication.findFirst({
        where: { id, userId },
        include: { program: true },
      });
      if (!row) throw NOT_FOUND();
      const current = toApplication(row);
      if (current.note === input.value) return current;
      const edits = current.contentEdits ?? [];
      if (edits.length !== input.revision) {
        throw new AppException('CONFLICT', '신청 내용이 변경되었습니다. 다시 확인해 주세요.');
      }
      const updated = await tx.programApplication.update({
        where: { id },
        data: {
          note: input.value,
          contentEdits: [
            ...edits,
            { previous: current.note, next: input.value, at: new Date().toISOString() },
          ],
        },
        include: { program: true },
      });
      return toApplication(updated);
    });
  }

  async mine(userId: string): Promise<ProgramApplication[]> {
    const rows = await this.prisma.programApplication.findMany({
      where: { userId },
      include: { program: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toApplication);
  }

  /** 본인 신청만 — 다른 사람의 신청은 존재 여부도 알려주지 않는다 */
  async mineOne(userId: string, id: string): Promise<ProgramApplication> {
    const a = await this.prisma.programApplication.findUnique({ where: { id }, include: { program: true } });
    if (!a || a.userId !== userId) throw NOT_FOUND();
    return toApplication(a);
  }

  async cancel(userId: string, id: string): Promise<ProgramApplication> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.programApplication.findUnique({
        where: { id },
        select: { userId: true, programId: true },
      });
      if (!found || found.userId !== userId) throw NOT_FOUND();
      await lockProgram(tx, found.programId);
      const a = await tx.programApplication.findUniqueOrThrow({ where: { id }, include: { program: true } });
      if (!toApplication(a).cancellable) {
        throw new AppException('CONFLICT', '취소 가능 기간이 지났거나 이미 처리된 신청입니다.', {
          reason: 'CANCEL_DEADLINE_PASSED',
        });
      }
      const updated = await tx.programApplication.update({
        where: { id },
        data: {
          status: 'cancelled',
          history: [
            ...(a.history as unknown as object[]),
            historyEntry('cancelled', 'applicant'),
          ] as unknown as Prisma.InputJsonValue,
        },
        include: { program: true },
      });
      await tx.program.update({ where: { id: a.programId }, data: { appliedCount: { decrement: 1 } } });
      return toApplication(updated);
    });
  }
}

const duplicate = () =>
  new AppException('CONFLICT', '이미 신청한 프로그램입니다. 마이페이지에서 신청 상태를 확인해 주세요.', {
    reason: 'DUPLICATE',
  });
