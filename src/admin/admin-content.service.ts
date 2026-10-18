import { Injectable } from '@nestjs/common';
import type { Prisma, User as UserRow } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { pageArgs, toPage } from '../common/pagination';
import { toFaq, toNotice, toPolicy } from '../content/content.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toProgram } from '../programs/program.mapper';
import type {
  FaqFormInput,
  NoticeFormInput,
  PolicyFormInput,
  ProgramFormInput,
} from '../shared/domain/schemas';
import type { Faq, Notice, Page, PolicyDoc, Program } from '../shared/domain/types';
import { type AdminListQuery, orderOf, statusIn } from './admin-query';

const NOT_FOUND = () => new AppException('NOT_FOUND');
const PUBLISH_STATUSES = ['draft', 'published', 'hidden'] as const;
/** 날짜만 받은 값을 서울 시각으로 — 시작은 09:00, 마감은 18:00 (mock 과 같은 규칙) */
const kst = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);

const programData = (input: ProgramFormInput) => ({
  title: input.title,
  categoryId: input.categoryId,
  summary: input.summary,
  description: input.description,
  target: input.target,
  place: input.place,
  startsAt: kst(input.startsAt, '09:00'),
  endsAt: kst(input.endsAt, '18:00'),
  recruitStartsAt: kst(input.recruitStartsAt, '09:00'),
  recruitEndsAt: kst(input.recruitEndsAt, '18:00'),
  cancelDeadline: kst(input.cancelDeadline, '18:00'),
  capacity: input.capacity,
  status: input.status,
});

@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---------- 공지 ---------- */

  async notices(q: AdminListQuery): Promise<Page<Notice>> {
    const status = statusIn(q.status, PUBLISH_STATUSES);
    const text = q.q?.trim();
    const where: Prisma.NoticeWhereInput = {
      ...(status ? { status } : {}),
      ...(text ? { title: { contains: text, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notice.findMany({
        where,
        orderBy: orderOf(q.sort, 'updatedAt', 'title'),
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.notice.count({ where }),
    ]);
    return toPage(rows.map(toNotice), total, q.page, q.pageSize);
  }

  async notice(id: string): Promise<Notice> {
    const n = await this.prisma.notice.findUnique({ where: { id } });
    if (!n) throw NOT_FOUND();
    return toNotice(n);
  }

  async createNotice(actor: UserRow, input: NoticeFormInput): Promise<Notice> {
    return this.prisma.$transaction(async (tx) => {
      const n = await tx.notice.create({
        data: { ...input, publishedAt: input.status === 'published' ? new Date() : null },
      });
      await this.audit.record(
        actor,
        { action: 'notice.create', targetType: 'notice', targetId: n.id, summary: `공지 등록: ${n.title}` },
        tx,
      );
      return toNotice(n);
    });
  }

  async updateNotice(actor: UserRow, id: string, input: NoticeFormInput): Promise<Notice> {
    return this.prisma.$transaction(async (tx) => {
      const prev = await tx.notice.findUnique({ where: { id } });
      if (!prev) throw NOT_FOUND();
      // 게시일은 처음 게시할 때 한 번만 정한다
      const publishedAt = input.status === 'published' ? (prev.publishedAt ?? new Date()) : prev.publishedAt;
      const n = await tx.notice.update({ where: { id }, data: { ...input, publishedAt } });
      await this.audit.record(
        actor,
        { action: 'notice.update', targetType: 'notice', targetId: id, summary: `공지 수정: ${n.title}` },
        tx,
      );
      return toNotice(n);
    });
  }

  async removeNotice(actor: UserRow, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.notice.findUnique({ where: { id } });
      if (!n) throw NOT_FOUND();
      await tx.notice.delete({ where: { id } });
      await this.audit.record(
        actor,
        { action: 'notice.delete', targetType: 'notice', targetId: id, summary: `공지 삭제: ${n.title}` },
        tx,
      );
    });
  }

  /* ---------- 프로그램 ---------- */

  async programs(q: AdminListQuery): Promise<Page<Program>> {
    const status = statusIn(q.status, PUBLISH_STATUSES);
    const text = q.q?.trim();
    const where: Prisma.ProgramWhereInput = {
      ...(status ? { status } : {}),
      ...(text ? { title: { contains: text, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.program.findMany({
        where,
        orderBy: orderOf(q.sort, 'updatedAt', 'title'),
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.program.count({ where }),
    ]);
    const now = new Date();
    return toPage(
      rows.map((p) => toProgram(p, now)),
      total,
      q.page,
      q.pageSize,
    );
  }

  async program(id: string): Promise<Program> {
    const p = await this.prisma.program.findUnique({ where: { id } });
    if (!p) throw NOT_FOUND();
    return toProgram(p);
  }

  private async requireCategory(id: string) {
    if (!(await this.prisma.programCategory.findUnique({ where: { id } }))) {
      throw new AppException('VALIDATION', '분류를 선택해 주세요.', {
        fieldErrors: { categoryId: '분류를 선택해 주세요.' },
      });
    }
  }

  async createProgram(actor: UserRow, input: ProgramFormInput): Promise<Program> {
    await this.requireCategory(input.categoryId);
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.program.create({ data: programData(input) });
      await this.audit.record(
        actor,
        {
          action: 'program.create',
          targetType: 'program',
          targetId: p.id,
          summary: `프로그램 등록: ${p.title}`,
        },
        tx,
      );
      return toProgram(p);
    });
  }

  async updateProgram(actor: UserRow, id: string, input: ProgramFormInput): Promise<Program> {
    await this.requireCategory(input.categoryId);
    return this.prisma.$transaction(async (tx) => {
      // 신청과 같은 행 잠금 — 수정 중 정원이 신청 인원 아래로 내려가지 않게
      await tx.$queryRaw`SELECT id FROM "Program" WHERE id = ${id} FOR UPDATE`;
      const prev = await tx.program.findUnique({ where: { id } });
      if (!prev) throw NOT_FOUND();
      if (input.capacity < prev.appliedCount) {
        throw new AppException('VALIDATION', '정원은 현재 신청 인원보다 적을 수 없습니다.', {
          fieldErrors: { capacity: `현재 신청 인원(${prev.appliedCount}명)보다 적을 수 없습니다.` },
        });
      }
      const p = await tx.program.update({ where: { id }, data: programData(input) });
      await this.audit.record(
        actor,
        {
          action: 'program.update',
          targetType: 'program',
          targetId: id,
          summary: `프로그램 수정: ${p.title}`,
        },
        tx,
      );
      return toProgram(p);
    });
  }

  async removeProgram(actor: UserRow, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.program.findUnique({
        where: { id },
        include: { _count: { select: { applications: true } } },
      });
      if (!p) throw NOT_FOUND();
      if (p._count.applications > 0) {
        throw new AppException(
          'CONFLICT',
          '신청 내역이 있는 프로그램은 삭제할 수 없습니다. 비공개로 전환해 주세요.',
          {
            reason: 'INVALID_STATE',
          },
        );
      }
      await tx.program.delete({ where: { id } });
      await this.audit.record(
        actor,
        {
          action: 'program.delete',
          targetType: 'program',
          targetId: id,
          summary: `프로그램 삭제: ${p.title}`,
        },
        tx,
      );
    });
  }

  /* ---------- FAQ ---------- */

  async faqs(): Promise<Faq[]> {
    const rows = await this.prisma.faq.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toFaq);
  }

  async createFaq(actor: UserRow, input: FaqFormInput): Promise<Faq> {
    return this.prisma.$transaction(async (tx) => {
      const f = await tx.faq.create({ data: input });
      await this.audit.record(
        actor,
        { action: 'faq.create', targetType: 'faq', targetId: f.id, summary: `FAQ 등록: ${f.question}` },
        tx,
      );
      return toFaq(f);
    });
  }

  async updateFaq(actor: UserRow, id: string, input: FaqFormInput): Promise<Faq> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.faq.findUnique({ where: { id } }))) throw NOT_FOUND();
      const f = await tx.faq.update({ where: { id }, data: input });
      await this.audit.record(
        actor,
        { action: 'faq.update', targetType: 'faq', targetId: id, summary: `FAQ 수정: ${f.question}` },
        tx,
      );
      return toFaq(f);
    });
  }

  async removeFaq(actor: UserRow, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const f = await tx.faq.findUnique({ where: { id } });
      if (!f) throw NOT_FOUND();
      await tx.faq.delete({ where: { id } });
      await this.audit.record(
        actor,
        { action: 'faq.delete', targetType: 'faq', targetId: id, summary: `FAQ 삭제: ${f.question}` },
        tx,
      );
    });
  }

  /* ---------- 정책 문서 ---------- */

  async policies(): Promise<PolicyDoc[]> {
    const rows = await this.prisma.policy.findMany({ orderBy: { key: 'asc' } });
    return rows.map(toPolicy);
  }

  /** 개정 — 시행일을 정하고 확정본으로 표시한다 */
  async updatePolicy(actor: UserRow, key: string, input: PolicyFormInput): Promise<PolicyDoc> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.policy.findUnique({ where: { key } }))) throw NOT_FOUND();
      const p = await tx.policy.update({
        where: { key },
        data: { body: input.body, effectiveAt: kst(input.effectiveAt, '00:00'), confirmed: true },
      });
      await this.audit.record(
        actor,
        {
          action: 'policy.update',
          targetType: 'policy',
          targetId: key,
          summary: `정책 문서 개정: ${p.title}`,
        },
        tx,
      );
      return toPolicy(p);
    });
  }
}
