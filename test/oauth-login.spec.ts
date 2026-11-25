import { exportJWK, exportPKCS8, generateKeyPair, importJWK, jwtVerify, SignJWT } from 'jose';
import supertest from 'supertest';
import { createTestApp, type TestContext } from './app';
import { signedIn } from './fixtures';
import { resetEnvCache } from '../src/config/env';
import * as providers from '../src/auth/social-provider';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.app.close());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvCache();
});

it('웹에서 시작한 카카오 인증은 같은 브라우저에 세션을 발급하고 원래 화면으로 복귀한다', async () => {
  vi.stubEnv('KAKAO_CLIENT_ID', 'test-client');
  resetEnvCache();
  vi.spyOn(providers, 'providerProfile').mockResolvedValue({ subject: 'web-kakao-user' });
  const { agent } = await signedIn(t);
  const link = await agent.post('/api/v1/me/social/kakao/web-start').expect(201);
  const callback = '/api/v1/auth/social/kakao/callback';
  const result = (url: string) => callback + '?code=valid&state=' + new URL(url).searchParams.get('state');
  await agent
    .get(result(link.body.data.url))
    .expect(302)
    .expect('location', 'http://localhost:3000/my/profile');
  const browser = supertest.agent(t.app.getHttpServer());
  const login = await browser.get('/api/v1/auth/oauth/kakao/start?redirect=%2Fprograms').expect(302);
  if (!login.headers.location) throw new Error('공급자 리다이렉트가 없습니다.');
  expect(new URL(login.headers.location).hostname).toBe('kauth.kakao.com');
  const returning = result(login.headers.location);
  await t.http
    .get(returning)
    .expect(302)
    .expect('location', 'http://localhost:3000/login?error=oauth_expired');
  await browser.get(returning).expect(302).expect('location', 'http://localhost:3000/programs');
  await browser.get('/api/v1/auth/session').expect(200);
});

it('Apple iOS 서명, 발급자, 앱 및 일회성 nonce를 확인하여 연결한 계정으로 로그인한다', async () => {
  const bundle = 'studio.efface.sjyc';
  vi.stubEnv('APPLE_IOS_LOGIN_ENABLED', 'on');
  vi.stubEnv('APPLE_IOS_BUNDLE_ID', bundle);
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test');
  resetEnvCache();
  expect((await t.http.get('/api/v1/auth/social/providers?platform=ios')).body.data).toContain('apple');
  expect((await t.http.get('/api/v1/auth/social/providers')).body.data).not.toContain('google');
  await t.http.post('/api/v1/auth/social/google/start').expect(503);
  const pair = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-signing-key', alg: 'RS256' };
  vi.stubGlobal('fetch', async (input: string) => {
    expect(String(input)).toBe('https://appleid.apple.com/auth/keys');
    return Response.json({ keys: [jwk] });
  });
  const { agent } = await signedIn(t);
  const path = '/api/v1/auth/social/apple/native/complete';
  const tokenFor = (nonce: string, audience: string = bundle) =>
    new SignJWT({ nonce })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer('https://appleid.apple.com')
      .setSubject('test-apple-user')
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey);
  const challenge = (await agent.post('/api/v1/me/social/apple/native/start').expect(201)).body.data;
  await agent
    .post(path)
    .send({ state: challenge.state, identityToken: await tokenFor(challenge.nonce) })
    .expect(201);
  expect((await agent.get('/api/v1/me/social')).body.data.linked).toContain('apple');
  const fresh = async () =>
    (await t.http.post('/api/v1/auth/social/apple/native/start').expect(201)).body.data;
  const login = await fresh();
  const input = { state: login.state, identityToken: await tokenFor(login.nonce) };
  const session = await t.http.post(path).send(input).expect(201);
  expect(session.headers['set-cookie']).toBeDefined();
  await t.http.post(path).send(input).expect(400);
  const wrong = await fresh();
  await t.http
    .post(path)
    .send({ state: wrong.state, identityToken: await tokenFor(wrong.nonce, 'another.app') })
    .expect(400);
  const old = await fresh();
  await t.http.post(path).send({ state: old.state, identityToken: input.identityToken }).expect(400);
});

it('Apple 웹 토큰 교환에 Services ID와 개발자 키로 서명한 client_secret을 보낸다', async () => {
  const service = 'dev.test.sjyc.web';
  const pair = await generateKeyPair('ES256', { extractable: true });
  vi.stubEnv('API_PUBLIC_URL', 'https://example.test/api/v1');
  vi.stubEnv('APPLE_WEB_LOGIN_ENABLED', 'on');
  vi.stubEnv('APPLE_CLIENT_ID', service);
  vi.stubEnv('APPLE_TEAM_ID', 'TESTTEAM');
  vi.stubEnv('APPLE_KEY_ID', 'TESTKEY');
  vi.stubEnv('APPLE_PRIVATE_KEY', await exportPKCS8(pair.privateKey));
  resetEnvCache();
  const url = new URL(providers.authorize('apple', 'state', 'verifier'));
  expect(url.searchParams.get('redirect_uri')).toBe('https://example.test/api/v1/auth/social/apple/callback');
  expect(url.searchParams.get('response_mode')).toBe('form_post');
  const applePublic = await importJWK(await exportJWK(pair.publicKey), 'ES256');
  const call = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ error: 'invalid_grant' }, { status: 400 }),
  );
  vi.stubGlobal('fetch', call);
  await expect(providers.providerProfile('apple', 'test-code', 'state', 'verifier')).rejects.toThrow();
  expect(call).toHaveBeenCalledOnce();
  const exchange = call.mock.calls[0];
  if (!exchange) throw new Error('Apple 토큰 교환 요청이 없습니다.');
  const [exchangeUrl, init] = exchange;
  expect(exchangeUrl).toBe('https://appleid.apple.com/auth/token');
  const token = (init.body as URLSearchParams).get('client_secret');
  if (!token) throw new Error('Apple client secret이 없습니다.');
  const jwt = await jwtVerify(token, applePublic, {
    algorithms: ['ES256'],
    issuer: 'TESTTEAM',
    audience: 'https://appleid.apple.com',
  });
  expect(jwt.protectedHeader.kid).toBe('TESTKEY');
  expect(jwt.payload.sub).toBe(service);
});

it('Apple 자격 정보가 일부 있어도 출시 확인 전에는 iOS 및 웹으로 시작할 수 없다', async () => {
  vi.stubEnv('APPLE_IOS_BUNDLE_ID', 'studio.efface.sjyc');
  resetEnvCache();
  expect(providers.availableProviders(true)).not.toContain('apple');
  expect(providers.availableProviders()).not.toContain('apple');
  const result = await t.http.post('/api/v1/auth/social/apple/native/start');
  expect(result.body.error.code).toBe('NOT_CONFIGURED');
});

it('새 소셜 계정은 정보를 확인한 뒤에만 세션을 받으며 입력값 수정과 휴대전화 필수를 적용한다', async () => {
  vi.stubEnv('KAKAO_CLIENT_ID', 'test-client');
  resetEnvCache();
  const email = 'profile-' + Date.now() + '@example.org';
  vi.spyOn(providers, 'providerProfile').mockResolvedValue({
    subject: 'new-' + Date.now(),
    email,
    verifiedEmail: email,
    name: '가져온이름',
  });
  const browser = supertest.agent(t.app.getHttpServer());
  const start = await browser.get('/api/v1/auth/oauth/kakao/start').expect(302);
  const state = new URL(start.headers.location!).searchParams.get('state');
  const redirect = await browser
    .get('/api/v1/auth/social/kakao/callback?code=valid&state=' + state)
    .expect(302);
  expect(redirect.headers.location).toContain('/oauth/profile');
  const path = '/api/v1/auth/social/onboarding';
  const draft = await browser.get(path).expect(200);
  expect(draft.body.data).toMatchObject({
    email,
    name: '가져온이름',
    phone: '',
    birthDate: '',
    needsConsent: true,
  });
  expect(draft.body.data.subject).toBeUndefined();
  await browser.get('/api/v1/auth/session').expect(401);
  await t.http.get(path).expect(400);
  const form = {
    email,
    name: '수정한이름',
    birthDate: '2000-02-29',
    phone: '010-0000-1212',
    agreeTerms: true,
    agreePrivacy: true,
    agreeMarketing: false,
  };
  await browser
    .post(path)
    .send({ ...form, phone: '' })
    .expect(400);
  await browser
    .post(path)
    .send({ ...form, agreeTerms: false })
    .expect(400);
  await browser.post(path).send(form).expect(201);
  await browser.get('/api/v1/auth/session').expect(401);
  await browser
    .post('/api/v1/auth/phone-verification/confirm')
    .send({ code: t.sms.sent.at(-1)!.code })
    .expect(200);
  const session = await browser.get('/api/v1/auth/session').expect(200);
  expect(session.body.data.user).toMatchObject({ email, name: form.name, phone: form.phone });
  await browser.get(path).expect(400);
});

it('Apple 최초 동의 POST를 일회성 GET으로 이어 원래 브라우저에서만 가입 프로필을 연다', async () => {
  vi.stubEnv('APPLE_WEB_LOGIN_ENABLED', 'on');
  vi.stubEnv('APPLE_CLIENT_ID', 'review-service');
  vi.stubEnv('APPLE_CLIENT_SECRET', 'test-signing-secret');
  vi.stubEnv('API_PUBLIC_URL', 'https://example.test/api/v1');
  resetEnvCache();
  vi.spyOn(providers, 'providerProfile').mockImplementation(async (_p, _c, _s, _v, name) => ({
    subject: 'web-apple-new',
    name,
  }));
  const browser = supertest.agent(t.app.getHttpServer());
  const start = await browser.get('/api/v1/auth/oauth/apple/start').expect(302);
  const state = new URL(start.headers.location!).searchParams.get('state');
  const cb = '/api/v1/auth/social/apple/callback';
  const data = {
    state,
    code: 'sample',
    user: JSON.stringify({ name: { lastName: '김', firstName: '센터' } }),
  };
  await t.http.post(cb).set('Origin', 'https://another.example').type('form').send(data).expect(403);
  const relay = await t.http
    .post(cb)
    .set('Origin', 'https://appleid.apple.com')
    .type('form')
    .send(data)
    .expect(303);
  const url = new URL(relay.headers.location!);
  expect(url.pathname).toBe(cb);
  expect([...url.searchParams.keys()]).toEqual(['response']);
  // Supertest uses HTTP. Explicitly transport only the secure state cookie set by the start endpoint.
  const cookie = (start.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('sjyc_oauth_apple='))!
    .split(';')[0]!;
  const done = await browser
    .get(cb + url.search)
    .set('Cookie', cookie)
    .expect(302);
  expect(done.headers.location).toContain('/oauth/profile');
  expect((await browser.get(cb + url.search)).headers.location).toContain('oauth_expired');
});

it('소셜 가입도 선택한 번호로 인증하며 수정한 이메일을 인증됨으로 기록하지 않는다', async () => {
  vi.stubEnv('NAVER_CLIENT_ID', 'test-naver');
  vi.stubEnv('NAVER_CLIENT_SECRET', 'test-secret');
  resetEnvCache();
  vi.spyOn(providers, 'providerProfile').mockResolvedValue({
    subject: 'new-' + Date.now(),
    email: 'old@example.org',
  });
  const browser = supertest.agent(t.app.getHttpServer());
  const start = await browser.get('/api/v1/auth/oauth/naver/start').expect(302);
  await browser
    .get(
      '/api/v1/auth/social/naver/callback?code=valid&state=' +
        new URL(start.headers.location!).searchParams.get('state'),
    )
    .expect(302);
  const email = 'edited-' + Date.now() + '@example.org',
    phone = '010-1111-1212';
  await browser
    .post('/api/v1/auth/social/onboarding')
    .send({
      email,
      name: '변경한이름',
      birthDate: '2002-04-12',
      phone,
      agreeTerms: true,
      agreePrivacy: true,
      agreeMarketing: false,
    })
    .expect(201);
  expect(t.sms.sent.at(-1)?.phone).toBe(phone);
  await browser.get('/api/v1/auth/session').expect(401);
  await browser
    .post('/api/v1/auth/phone-verification/confirm')
    .send({ code: t.sms.sent.at(-1)!.code })
    .expect(200);
  expect((await browser.get('/api/v1/auth/session')).body.data.user).toMatchObject({
    email,
    phone,
    emailVerified: false,
  });
});
