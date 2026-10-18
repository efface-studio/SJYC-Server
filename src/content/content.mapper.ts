import type {
  Faq as FaqRow,
  Inquiry as InquiryRow,
  MediaItem as MediaRow,
  Notice as NoticeRow,
  Policy as PolicyRow,
} from '@prisma/client';
import type {
  Attachment,
  Faq,
  Inquiry,
  MediaItem,
  Notice,
  PolicyDoc,
  PolicyKey,
} from '../shared/domain/types';

export const toNotice = (n: NoticeRow): Notice => ({
  id: n.id,
  title: n.title,
  category: n.category,
  body: n.body,
  status: n.status,
  pinned: n.pinned,
  publishedAt: n.publishedAt?.toISOString() ?? null,
  updatedAt: n.updatedAt.toISOString(),
  attachments: n.attachments as unknown as Attachment[],
});

export const toFaq = (f: FaqRow): Faq => ({
  id: f.id,
  category: f.category,
  question: f.question,
  answer: f.answer,
  order: f.order,
  published: f.published,
});

export const toPolicy = (p: PolicyRow): PolicyDoc => ({
  key: p.key as PolicyKey,
  title: p.title,
  body: p.body,
  confirmed: p.confirmed,
  effectiveAt: p.effectiveAt?.toISOString() ?? null,
  updatedAt: p.updatedAt.toISOString(),
});

export const toMedia = (m: MediaRow): MediaItem => ({
  kind: m.kind,
  title: m.title,
  url: m.url,
  thumbnailUrl: m.thumbnailUrl,
  sourceUrl: m.sourceUrl,
  date: m.date,
});

export const toInquiry = (q: InquiryRow): Inquiry => ({
  id: q.id,
  userId: q.userId,
  authorName: q.authorName,
  category: q.category,
  title: q.title,
  body: q.body,
  status: q.status,
  createdAt: q.createdAt.toISOString(),
  answer:
    q.answerBody && q.answeredAt
      ? { body: q.answerBody, answeredAt: q.answeredAt.toISOString(), answeredBy: q.answeredBy ?? '' }
      : null,
});
