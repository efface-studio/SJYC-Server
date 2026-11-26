import supertest from 'supertest';
import { createTestApp, clearRateLimits, type TestContext } from './app';
import { signedIn, PASSWORD, createUser } from './fixtures';
import { phoneUpdate, policyKey } from '../src/auth/login-contact';
import type { LoginAudience } from '../src/shared/domain/login-contact';
import * as providers from '../src/auth/social-provider';
import { resetEnvCache } from '../src/config/env';

let t: TestContext;
const path = '/api/v1/admin/login-contact',
  login = '/api/v1/auth/login';
const agent = () => supertest.agent(t.app.getHttpServer());
const keys = ['user', 'admin'].map((a) => policyKey(a as LoginAudience));
beforeAll(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.prisma.siteSettings.deleteMany({ where: { id: { in: keys } } });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});
afterAll(() => t.app.close());
it('사이트 관리 권한, 앱별 독립 버전, 변경 이력과 동시 저장 충돌을 검사한다', async () => {
  const { agent: editor, user } = await signedIn(t, ['admin']),
    staff = await signedIn(t, ['staff']);
  const input = { audience: 'user', version: 0, allowUnverifiedEmail: false, allowUnverifiedPhone: true };
  await t.http.get(path).expect(401);
  await staff.agent.get(path).expect(403);
  await staff.agent.put(path).send(input).expect(403);
  expect((await editor.get(path)).body.data).toEqual({
    user: { version: 0, rule: null },
    admin: { version: 0, rule: null },
  });
  const result = await Promise.all([0, 1].map(() => editor.put(path).send(input)));
  expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await editor.get(path)).body.data.admin).toEqual({ version: 0, rule: null });
  expect(
    await t.prisma.auditEvent.count({ where: { action: 'auth.contact-policy.update', actorId: user.id } }),
  ).toBe(1);
});
it.each(['user', 'admin'] as const)(
  '%s 앱 정책의 모든 조합은 실제 인증 상태를 각각 확인한다',
  async (audience) => {
    const { agent: editor } = await signedIn(t, ['developer']),
      account = await createUser(t, { roles: ['staff'] });
    let version = 0;
    for (const allowUnverifiedEmail of [false, true])
      for (const allowUnverifiedPhone of [false, true]) {
        await editor
          .put(path)
          .send({ audience, version: version++, allowUnverifiedEmail, allowUnverifiedPhone })
          .expect(200);
        for (const emailVerified of [false, true])
          for (const phoneVerified of [false, true]) {
            await clearRateLimits(t);
            await t.prisma.user.update({
              where: { id: account.id },
              data: { emailVerified, signupPhoneVerifiedAt: phoneVerified ? new Date() : null },
            });
            const allowed =
              (allowUnverifiedEmail || emailVerified) && (allowUnverifiedPhone || phoneVerified);
            const browser = agent();
            await browser
              .post(login)
              .send({ email: account.email, password: PASSWORD, audience })
              .expect(allowed ? 200 : 403);
            if (allowed) await browser.get('/api/v1/auth/session?audience=' + audience).expect(200);
            else await browser.get('/api/v1/auth/session').expect(401);
          }
      }
  },
);
it('사용자 정책을 통과한 세션에도 관리자 앱의 인증·권한 조건이 적용되고 기존 관리자 세션은 유지된다', async () => {
  const { agent: editor } = await signedIn(t, ['admin']),
    member = await createUser(t),
    staff = await createUser(t, { roles: ['staff'] });
  const input = { version: 0, allowUnverifiedEmail: true, allowUnverifiedPhone: true };
  await editor
    .put(path)
    .send({ ...input, audience: 'user' })
    .expect(200);
  await editor
    .put(path)
    .send({ ...input, audience: 'admin' })
    .expect(200);
  await t.prisma.user.update({ where: { id: staff.id }, data: { emailVerified: false } });
  const userApp = agent(),
    adminApp = agent(),
    password = PASSWORD,
    email = staff.email;
  await userApp.post(login).send({ password, email, audience: 'user' }).expect(200);
  await adminApp.post(login).send({ password, email, audience: 'admin' }).expect(200);
  await editor
    .put(path)
    .send({ ...input, audience: 'admin', version: 1, allowUnverifiedPhone: false })
    .expect(200);
  await adminApp.get('/api/v1/auth/session?audience=admin').expect(200);
  await userApp.get('/api/v1/auth/session?audience=admin').expect(403);
  await userApp.get('/api/v1/admin/dashboard').expect(403);
  await t.http.post(login).send({ password, email, audience: 'admin' }).expect(403);
  await t.http.post(login).send({ password, email: member.email, audience: 'admin' }).expect(403);
  expect(
    await t.prisma.user.findUnique({
      where: { id: staff.id },
      select: { emailVerified: true, signupPhoneVerifiedAt: true },
    }),
  ).toEqual({ emailVerified: false, signupPhoneVerifiedAt: null });
  await t.prisma.user.update({ where: { id: staff.id }, data: { status: 'suspended' } });
  await t.http.post(login).send({ password, email, audience: 'user' }).expect(403);
});
it('카카오로 로그인해도 해당 앱의 휴대전화 인증 정책을 적용한다', async () => {
  vi.stubEnv('KAKAO_CLIENT_ID', 'test-client');
  resetEnvCache();
  const { agent: editor } = await signedIn(t, ['admin']),
    staff = await createUser(t, { roles: ['staff'] });
  const subject = 'contact-' + staff.id;
  await t.prisma.socialIdentity.create({ data: { provider: 'kakao', subject, userId: staff.id } });
  vi.spyOn(providers, 'providerProfile').mockResolvedValue({ subject });
  for (const [scope, audience] of [
    ['social', 'user'],
    ['admin-social', 'admin'],
  ] as const) {
    for (const [version, allowed] of [false, true].entries()) {
      await editor
        .put(path)
        .send({ audience, version, allowUnverifiedEmail: true, allowUnverifiedPhone: allowed })
        .expect(200);
      const browser = agent(),
        base = '/api/v1/auth/' + scope;
      const { url, claim } = (await browser.post(base + '/kakao/start').expect(201)).body.data;
      const cb = await t.http
        .get('/api/v1/auth/social/kakao/callback')
        .query({ state: new URL(url).searchParams.get('state'), code: 'accepted' })
        .expect(302);
      const receipt = new URL(cb.headers.location!).searchParams.get('receipt');
      await browser
        .post(base + '/complete')
        .send({ receipt, claim })
        .expect(allowed ? 201 : 403);
      await browser.get('/api/v1/auth/session?audience=' + audience).expect(allowed ? 200 : 401);
    }
  }
});
it('전화번호 표시 형식만 바뀌면 인증을 유지하고 실제 번호가 바뀌면 다시 인증한다', () => {
  expect(phoneUpdate('010-1111-1212', '01011111212')).toEqual({ phone: '01011111212' });
  expect(phoneUpdate('010-1111-1212', '010-2222-3434')).toMatchObject({ signupPhoneVerifiedAt: null });
});
