import type { PublishStatus, Role } from '@prisma/client';
import argon2 from 'argon2';
import supertest from 'supertest';
import type { TestContext } from './app';

let n = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${++n}@test.local`;
export const PASSWORD = 'abcd1234';
const DAY = 86_400_000;
const days = (d: number) => new Date(Date.now() + d * DAY);

/** 인증 완료된 회원을 바로 만든다 (가입 흐름은 auth.spec 에서 따로 확인) */
export async function createUser(
  t: TestContext,
  opts: { roles?: Role[]; email?: string; name?: string; status?: 'active' | 'suspended' } = {},
) {
  return t.prisma.user.create({
    data: {
      email: opts.email ?? uniqueEmail(),
      name: opts.name ?? '테스트',
      roles: opts.roles ?? ['member'],
      status: opts.status ?? 'active',
      emailVerified: true,
      passwordHash: await argon2.hash(PASSWORD),
    },
  });
}

/** 로그인한 에이전트 (쿠키 유지). Origin 없는 요청 — 네이티브 앱과 같은 경로 */
export async function loginAgent(t: TestContext, email: string, password = PASSWORD) {
  const agent = supertest.agent(t.app.getHttpServer());
  await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return agent;
}

export async function signedIn(t: TestContext, roles: Role[] = ['member']) {
  const user = await createUser(t, { roles });
  return { user, agent: await loginAgent(t, user.email) };
}

export async function ensureCategory(t: TestContext, id = 'c-test') {
  return t.prisma.programCategory.upsert({
    where: { id },
    create: { id, name: '테스트 분류', group: '청소년활동' },
    update: {},
  });
}

/** 기본값: 지금 모집 중, 정원 10, 취소 기한 7일 뒤 */
export async function createProgram(
  t: TestContext,
  opts: {
    title?: string;
    capacity?: number;
    status?: PublishStatus;
    recruitStartsInDays?: number;
    recruitEndsInDays?: number;
    cancelDeadlineInDays?: number;
  } = {},
) {
  const category = await ensureCategory(t);
  return t.prisma.program.create({
    data: {
      title: opts.title ?? `프로그램 ${Date.now()}${++n}`,
      categoryId: category.id,
      summary: '요약',
      description: '설명',
      target: '청소년',
      place: '센터',
      startsAt: days(10),
      endsAt: days(11),
      recruitStartsAt: days(opts.recruitStartsInDays ?? -1),
      recruitEndsAt: days(opts.recruitEndsInDays ?? 5),
      capacity: opts.capacity ?? 10,
      status: opts.status ?? 'published',
      cancelDeadline: days(opts.cancelDeadlineInDays ?? 7),
    },
  });
}

export async function createSpace(t: TestContext, opts: { capacity?: number; reservable?: boolean } = {}) {
  return t.prisma.space.create({
    data: {
      name: `공간 ${Date.now()}${++n}`,
      floor: '3층',
      capacity: opts.capacity ?? 10,
      description: '설명',
      reservable: opts.reservable ?? true,
    },
  });
}
