import { Injectable } from '@nestjs/common';
import type { Prisma, User as UserRow } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { pageArgs, toPage } from '../common/pagination';
import { RateLimitService } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import type { InquiryInput } from '../shared/domain/schemas';
import type {
  Faq,
  Inquiry,
  MediaItem,
  Notice,
  NoticeCategory,
  Page,
  PolicyDoc,
} from '../shared/domain/types';
import { toFaq, toInquiry, toMedia, toNotice, toPolicy } from './content.mapper';

export interface NoticeQuery {
  q?: string;
  category?: NoticeCategory;
  page: number;
  pageSize: number;
}

const NOT_FOUND = () => new AppException('NOT_FOUND');
/** 회원당 시간당 문의 수 — 도배 방지 */
const INQUIRY_LIMIT_PER_HOUR = 10;

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimitService,
  ) {}

  /** 게시된 공지 — 고정 공지 먼저, 그다음 최신 게시순 */
  async notices(q: NoticeQuery): Promise<Page<Notice>> {
    const text = q.q?.trim();
    const where: Prisma.NoticeWhereInput = {
      status: 'published',
      ...(q.category ? { category: q.category } : {}),
      ...(text
        ? {
            OR: [
              { title: { contains: text, mode: 'insensitive' } },
              { body: { contains: text, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notice.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.notice.count({ where }),
    ]);
    return toPage(rows.map(toNotice), total, q.page, q.pageSize);
  }

  async notice(id: string): Promise<Notice> {
    const n = await this.prisma.notice.findUnique({ where: { id } });
    if (!n || n.status !== 'published') throw NOT_FOUND();
    return toNotice(n);
  }

  async faqs(): Promise<Faq[]> {
    const rows = await this.prisma.faq.findMany({
      where: { published: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toFaq);
  }

  async policy(key: string): Promise<PolicyDoc> {
    const p = await this.prisma.policy.findUnique({ where: { key } });
    if (!p) throw NOT_FOUND();
    return toPolicy(p);
  }

  async media(): Promise<MediaItem[]> {
    const rows = await this.prisma.mediaItem.findMany({
      orderBy: [{ date: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    return rows.map(toMedia);
  }

  async createInquiry(user: UserRow, input: InquiryInput): Promise<Inquiry> {
    if (await this.limiter.exceeded(`inquiry:${user.id}`, INQUIRY_LIMIT_PER_HOUR, 3600)) {
      throw new AppException('RATE_LIMITED');
    }
    const q = await this.prisma.inquiry.create({
      data: {
        userId: user.id,
        authorName: user.name,
        category: input.category,
        title: input.title,
        body: input.body,
      },
    });
    return toInquiry(q);
  }

  async myInquiries(userId: string): Promise<Inquiry[]> {
    const rows = await this.prisma.inquiry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toInquiry);
  }

  /** 본인 문의만 — 다른 사람의 문의는 존재 여부도 알려주지 않는다 */
  async myInquiry(userId: string, id: string): Promise<Inquiry> {
    const q = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!q || q.userId !== userId) throw NOT_FOUND();
    return toInquiry(q);
  }
}
