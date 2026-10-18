/**
 * 개발·시연용 시드 — 웹 mock 과 같은 샘플·참고 데이터를 DB 에 넣는다 (`pnpm db:seed [--reset]`).
 * 원본: 웹 저장소 src/api/mock/seed.ts (pnpm sync:shared 로 src/shared/mock 에 복사).
 * - 이미 데이터가 있으면 거부한다. --reset 이면 모든 테이블을 비우고 다시 넣는다.
 * - NODE_ENV=production 에서는 SEED_DEMO=1 일 때만 (시연 서버 전용 — 실제 센터 운영 DB 에 쓰지 않는다).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { createSeed, DEMO_PASSWORD } from '../src/shared/mock/seed';

const prisma = new PrismaClient();
const json = (v: unknown) => v as Prisma.InputJsonValue;
const date = (v: string | null | undefined) => (v ? new Date(v) : null);

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // 테이블 이름은 pg_tables 에서 온 값이라 사용자 입력이 섞이지 않는다
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list) await prisma.$executeRaw`${Prisma.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)}`;
}

async function main() {
  const reset = process.argv.includes('--reset');
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== '1') {
    throw new Error('운영 환경에서는 SEED_DEMO=1 일 때만 시연용 시드를 넣습니다.');
  }
  if (reset) await truncateAll();
  else if ((await prisma.user.count()) > 0) {
    throw new Error('이미 데이터가 있습니다. 비우고 다시 넣으려면 --reset 을 붙이세요.');
  }

  const db = createSeed();
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: db.users.map((u) => ({
        id: u.id,
        email: u.email.toLowerCase(),
        name: u.name,
        phone: u.phone,
        birthYear: u.birthYear,
        roles: u.roles,
        status: u.status,
        emailVerified: u.emailVerified,
        providers: u.providers,
        consents: json(u.consents),
        createdAt: new Date(u.createdAt),
        passwordHash,
      })),
    });
    await tx.programCategory.createMany({
      data: db.categories.map((c, i) => ({ id: c.id, name: c.name, group: c.group, sortOrder: i })),
    });
    // ponytail: appliedCount 는 mock 값(다른 신청자를 가정한 숫자)을 그대로 쓴다 — 시연용 데이터라 실제 신청 수와 다를 수 있다
    await tx.program.createMany({
      data: db.programs.map((p) => ({
        id: p.id,
        title: p.title,
        categoryId: p.categoryId,
        summary: p.summary,
        description: p.description,
        target: p.target,
        place: p.place,
        startsAt: new Date(p.startsAt),
        endsAt: new Date(p.endsAt),
        recruitStartsAt: new Date(p.recruitStartsAt),
        recruitEndsAt: new Date(p.recruitEndsAt),
        capacity: p.capacity,
        appliedCount: p.appliedCount,
        status: p.status,
        cancelDeadline: new Date(p.cancelDeadline),
      })),
    });
    await tx.programApplication.createMany({
      data: db.applications.map((a) => ({
        id: a.id,
        receiptNo: a.receiptNo ?? `DEV-${a.id}`,
        programId: a.programId,
        userId: a.userId,
        applicantName: a.applicantName,
        phone: a.phone,
        note: a.note,
        status: a.status,
        history: json(a.history),
        createdAt: new Date(a.createdAt),
      })),
    });
    await tx.notice.createMany({
      data: db.notices.map((n) => ({
        id: n.id,
        title: n.title,
        category: n.category,
        body: n.body,
        status: n.status,
        pinned: n.pinned,
        publishedAt: date(n.publishedAt),
        attachments: json(n.attachments),
      })),
    });
    await tx.club.createMany({
      data: db.clubs.map((c, i) => ({
        id: c.id,
        name: c.name,
        field: c.field,
        summary: c.summary,
        description: c.description,
        meetingInfo: c.meetingInfo,
        target: c.target,
        recruiting: c.recruiting,
        status: c.status,
        photos: json(c.photos),
        activities: json(c.activities),
        sourceUrls: c.sourceUrls,
        sortOrder: i,
      })),
    });
    await tx.clubMembership.createMany({
      data: db.memberships.map((m) => ({ ...m, joinedAt: new Date(m.joinedAt) })),
    });
    await tx.clubManager.createMany({
      data: db.clubManagers.map((m) => ({ ...m, assignedAt: new Date(m.assignedAt) })),
    });
    await tx.clubPost.createMany({
      data: db.clubPosts.map((p) => ({
        id: p.id,
        clubId: p.clubId,
        kind: p.kind,
        title: p.title,
        body: p.body,
        at: new Date(p.at),
      })),
    });
    await tx.clubApplication.createMany({
      data: db.clubApplications.map((a) => ({
        id: a.id,
        clubId: a.clubId,
        userId: a.userId,
        applicantName: a.applicantName,
        motivation: a.motivation,
        status: a.status,
        reason: a.reason,
        createdAt: new Date(a.createdAt),
      })),
    });
    await tx.space.createMany({
      data: db.spaces.map((s, i) => ({ ...s, sortOrder: i })),
    });
    await tx.spaceReservation.createMany({
      data: db.reservations.map((r) => ({
        id: r.id,
        spaceId: r.spaceId,
        userId: r.userId,
        applicantName: r.applicantName,
        phone: r.phone.replace(/-/g, ''),
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        headcount: r.headcount,
        purpose: r.purpose,
        status: r.status,
        reason: r.reason,
        createdAt: new Date(r.createdAt),
      })),
    });
    await tx.inquiry.createMany({
      data: db.inquiries.map((q) => ({
        id: q.id,
        userId: q.userId,
        authorName: q.authorName,
        category: q.category,
        title: q.title,
        body: q.body,
        status: q.status,
        createdAt: new Date(q.createdAt),
        answerBody: q.answer?.body ?? null,
        answeredAt: date(q.answer?.answeredAt),
        answeredBy: q.answer?.answeredBy ?? null,
      })),
    });
    await tx.faq.createMany({ data: db.faqs });
    await tx.policy.createMany({
      data: db.policies.map((p) => ({
        key: p.key,
        title: p.title,
        body: p.body,
        confirmed: p.confirmed,
        effectiveAt: date(p.effectiveAt),
      })),
    });
    await tx.mediaItem.createMany({ data: db.media });
    await tx.notification.createMany({
      data: db.notifications.map((n) => ({
        id: n.id,
        userId: n.userId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.link,
        createdAt: new Date(n.createdAt),
        readAt: date(n.readAt),
      })),
    });
    await tx.auditEvent.createMany({
      data: db.audit.map((e) => ({ ...e, at: new Date(e.at) })),
    });
    for (const s of db.attendance) {
      await tx.attendanceSession.create({
        data: {
          id: s.id,
          targetType: s.targetType,
          targetId: s.targetId,
          targetName: s.targetName,
          date: s.date,
          title: s.title,
          createdBy: s.createdBy,
          createdAt: new Date(s.createdAt),
          records: {
            create: s.records.map((r) => ({
              userId: r.userId,
              name: r.name,
              status: r.status,
              checkedAt: date(r.checkedAt),
              method: r.method,
              note: r.note,
            })),
          },
        },
      });
    }
  });

  console.log(
    `시드 완료: 회원 ${db.users.length}, 프로그램 ${db.programs.length}, 동아리 ${db.clubs.length}, 공지 ${db.notices.length}, 공간 ${db.spaces.length}`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
