import type { Role } from '@prisma/client';
import argon2 from 'argon2';
import supertest from 'supertest';
import type { TestContext } from './app';

let n = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${++n}@test.local`;
export const PASSWORD = 'abcd1234';

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
