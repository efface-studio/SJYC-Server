import supertest from 'supertest';
import * as providers from '../src/auth/social-provider';
import { resetEnvCache } from '../src/config/env';
import { hashToken } from '../src/auth/tokens';
import { createTestApp, clearRateLimits, type TestContext } from './app';
import { createUser, PASSWORD, uniqueEmail } from './fixtures';

let t: TestContext;
const path = '/api/v1/auth/admin-social';
const pending = path + '/link';
const session = '/api/v1/auth/session';
const agent = () => supertest.agent(t.app.getHttpServer());
const callback = (url: string) =>
  '/api/v1/auth/social/kakao/callback?code=accepted&state=' + new URL(url).searchParams.get('state');
const mockProfile = (subject: string, email?: string) =>
  vi.spyOn(providers, 'providerProfile').mockResolvedValue({ subject, email, verifiedEmail: email });
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  vi.stubEnv('KAKAO_CLIENT_ID', 'test-client');
  resetEnvCache();
  await clearRateLimits(t);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

it('기존 관리자 이메일이 일치해도 연동 전에는 세션과 새 회원이 생기지 않으며, 연동 후 다음 로그인은 바로 완료된다', async () => {
  const admin = await createUser(t, { roles: ['admin'] });
  const member = await createUser(t);
  const before = await t.prisma.user.count();
  mockProfile('admin-' + admin.id, admin.email);
  const browser = agent();
  const start = async (next: string) =>
    browser
      .get(path + '/kakao/web-start')
      .query({ redirect: next })
      .expect(302);
  const login = await start('/admin/applications');
  const cb = callback(login.headers.location!);
  await t.http
    .get(cb)
    .expect(302)
    .expect('location', 'http://localhost:3000/admin/login?error=oauth_expired');
  const res = await browser.get(cb).expect(302);
  const url = new URL(res.headers.location!);
  expect(url.pathname).toBe('/admin/login/link');
  expect(url.searchParams.get('next')).toBe('/admin/applications');
  expect((await browser.get(pending).expect(200)).body.data).toEqual({ provider: 'kakao' });
  await t.http.get(pending).expect(400);
  await browser.get(session).expect(401);
  await browser.post(pending).send({ email: admin.email, password: 'incorrect-password' }).expect(400);
  await browser.post(pending).send({ email: member.email, password: PASSWORD }).expect(403);
  await browser.get(session).expect(401);
  expect(await t.prisma.session.count({ where: { userId: admin.id } })).toBe(0);
  expect(await t.prisma.socialIdentity.count({ where: { userId: admin.id } })).toBe(0);
  await browser.post(pending).send({ email: admin.email, password: PASSWORD }).expect(201);
  expect((await browser.get(session).expect(200)).body.data.user.id).toBe(admin.id);
  expect(await t.prisma.auditEvent.count({ where: { actorId: admin.id, action: 'admin.social.link' } })).toBe(
    1,
  );
  await browser.post(pending).send({ email: admin.email, password: PASSWORD }).expect(400);
  const fresh = agent();
  const next = await fresh.get(path + '/kakao/web-start?redirect=%2Fadmin%2Fapplications').expect(302);
  await fresh
    .get(callback(next.headers.location!))
    .expect(302)
    .expect('location', 'http://localhost:3000/admin/applications');
  expect((await fresh.get(session)).body.data.user.id).toBe(admin.id);
  expect(await t.prisma.user.count()).toBe(before);
});

it.each(['member', 'suspended', 'unverified'] as const)(
  '연결된 %s 계정은 관리자 세션을 받지 못하고 다른 운영자에게 연결을 이전할 수 없다',
  async (status) => {
    const user = await createUser(t, status === 'member' ? {} : { roles: ['admin'], status: 'suspended' });
    if (status === 'unverified')
      await t.prisma.user.update({
        where: { id: user.id },
        data: { status: 'active', emailVerified: false },
      });
    const other = await createUser(t, { roles: ['staff'] });
    const subject = uniqueEmail('provider');
    await t.prisma.socialIdentity.create({ data: { provider: 'kakao', subject, userId: user.id } });
    mockProfile(subject);
    const browser = agent();
    const start = await browser.get(path + '/kakao/web-start').expect(302);
    const res = await browser.get(callback(start.headers.location!)).expect(302);
    expect(new URL(res.headers.location!).pathname).toBe('/admin/login/link');
    await browser.post(pending).send({ email: other.email, password: PASSWORD }).expect(403);
    await browser.get(session).expect(401);
    expect(
      (
        await t.prisma.socialIdentity.findUniqueOrThrow({
          where: { provider_subject: { provider: 'kakao', subject } },
        })
      ).userId,
    ).toBe(user.id);
  },
);

it('지정된 동아리 담당자만 기존 담당 범위로 로그인하며 외부 복귀 주소를 받지 않는다', async () => {
  const user = await createUser(t);
  const club = await t.prisma.club.create({
    data: {
      name: '동아리',
      field: '예술',
      summary: '요약',
      description: '설명',
      meetingInfo: '토요일',
      managers: { create: { userId: user.id } },
    },
  });
  const subject = uniqueEmail('club');
  await t.prisma.socialIdentity.create({ data: { provider: 'kakao', subject, userId: user.id } });
  mockProfile(subject);
  const browser = agent();
  const start = await browser
    .get(path + '/kakao/web-start')
    .query({ redirect: 'https://elsewhere.example' })
    .expect(302);
  await browser
    .get(callback(start.headers.location!))
    .expect(302)
    .expect('location', 'http://localhost:3000/admin');
  const { user: actual } = (await browser.get(session)).body.data;
  expect(actual.managedClubIds).toEqual([club.id]);
  expect(actual.roles).toEqual(['member']);
});

it('관리자 앱에서만 복귀하는 소셜 인증은 기존 계정 연동 전까지 로그인을 보류하고 만료 후 새 인증을 요구한다', async () => {
  mockProfile(uniqueEmail('app'));
  const native = agent();
  async function authorize() {
    const { url, claim } = (await native.post(path + '/kakao/start').expect(201)).body.data;
    const callbackResponse = await t.http.get(callback(url)).expect(302);
    const redirect = new URL(callbackResponse.headers.location!);
    expect(redirect.protocol).toBe('sjyc-admin:');
    expect(redirect.host).toBe('oauth-return');
    return { receipt: redirect.searchParams.get('receipt'), claim };
  }
  const userResult = await authorize();
  await native.post('/api/v1/auth/social/complete').send(userResult).expect(400);
  const proof = await authorize();
  const response = await native
    .post(path + '/complete')
    .send(proof)
    .expect(201);
  expect(response.body.data).toEqual({ signedIn: false, needsLink: true });
  await native
    .post(path + '/complete')
    .send(proof)
    .expect(400);
  await native.get(session).expect(401);
  const cookies = response.headers['set-cookie'] as unknown as string[];
  const ticket = cookies
    .find((c) => c.startsWith('sjyc_admin_link='))!
    .split(';')[0]!
    .split('=')[1]!;
  const key = 'social:admin-link:' + hashToken(ticket);
  expect(await t.redis.ttl(key)).toBeGreaterThan(0);
  expect(await t.redis.ttl(key)).toBeLessThanOrEqual(300);
  await t.redis.expire(key, 0);
  await native.get(pending).expect(400);
  await native.get(session).expect(401);
});

it('관리자 앱에서 기존 직원 계정 연동을 마친 뒤 같은 소셜 계정으로 재로그인할 수 있다', async () => {
  const staff = await createUser(t, { roles: ['staff'] });
  mockProfile(uniqueEmail('native'));
  async function authenticate() {
    const client = agent();
    const { url, claim } = (await client.post(path + '/kakao/start')).body.data;
    const cb = await t.http.get(callback(url));
    const receipt = new URL(cb.headers.location!).searchParams.get('receipt');
    const result = await client
      .post(path + '/complete')
      .send({ receipt, claim })
      .expect(201);
    return { client, data: result.body.data };
  }
  const first = await authenticate();
  await first.client.post(pending).send({ email: staff.email, password: PASSWORD }).expect(201);
  const second = await authenticate();
  expect(second.data).toEqual({ signedIn: true, needsLink: false });
  expect((await second.client.get(session).expect(200)).body.data.user.id).toBe(staff.id);
});
