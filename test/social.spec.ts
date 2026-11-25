import { createTestApp, type TestContext } from './app';
import { signedIn } from './fixtures';
import { SocialService } from '../src/auth/social.service';
import * as providers from '../src/auth/social-provider';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.app.close());
afterEach(() => vi.restoreAllMocks());

it('두 증명값과 요청을 시작한 계정이 일치할 때만 연결하고, 연결한 계정으로 로그인한다', async () => {
  const social = t.app.get(SocialService);
  const { user, agent } = await signedIn(t);
  const other = await signedIn(t);
  vi.spyOn(providers, 'authorize').mockImplementation((_p, state) => 'https://example.test/?state=' + state);
  vi.spyOn(providers, 'providerSubject').mockResolvedValue('verified-subject');
  const proof = async (id: string | null) => {
    const { url, claim } = await social.start('kakao', id);
    const state = new URL(url).searchParams.get('state')!;
    return { receipt: await social.callback('kakao', state, 'provider-code'), claim };
  };
  const path = '/api/v1/auth/social/complete';
  await other.agent
    .post(path)
    .send(await proof(user.id))
    .expect(400);
  const valid = await proof(user.id);
  await agent
    .post(path)
    .send({ ...valid, claim: 'x'.repeat(43) })
    .expect(400);
  await agent.post(path).send(valid).expect(201);
  await agent.post(path).send(valid).expect(400);
  expect((await agent.get('/api/v1/me/social')).body.data.linked).toEqual(['kakao']);
  await other.agent
    .post(path)
    .send(await proof(other.user.id))
    .expect(409);
  const login = await t.http
    .post(path)
    .send(await proof(null))
    .expect(201);
  expect(login.headers['set-cookie']).toBeDefined();
  await t.prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });
  await agent.delete('/api/v1/me/social/kakao').expect(409);
  await t.prisma.socialIdentity.create({
    data: { userId: user.id, provider: 'google', subject: 'another-verified-subject' },
  });
  await agent.delete('/api/v1/me/social/kakao').expect(200);
  expect((await agent.get('/api/v1/me/social')).body.data.linked).toEqual(['google']);
});

it('연결 불가 상태, 만료된 콜백, 자기 기기와 다른 회원 세션 보호', async () => {
  const { agent } = await signedIn(t);
  const other = await signedIn(t);
  await t.http.get('/api/v1/me/social').expect(401);
  await agent.post('/api/v1/auth/social/google/start').expect(503);
  const callback = await t.http.get('/api/v1/auth/social/kakao/callback?state=missing').expect(302);
  expect(callback.headers.location).toBe('sjyc://oauth-return?error=cancelled');
  const path = '/api/v1/me/login-devices';
  const own = (await agent.get(path)).body.data[0];
  expect(own.current).toBe(true);
  expect(own.tokenHash).toBeUndefined();
  await other.agent.delete(path + '/' + own.id).expect(200);
  await agent.delete(path + '/' + own.id).expect(200);
  await agent.get('/api/v1/auth/session').expect(200);
});
