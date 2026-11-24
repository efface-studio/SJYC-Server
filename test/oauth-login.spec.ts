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
  vi.spyOn(providers, 'providerSubject').mockResolvedValue('web-kakao-user');
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
  vi.stubEnv('APPLE_CLIENT_ID', service);
  vi.stubEnv('APPLE_TEAM_ID', 'TESTTEAM');
  vi.stubEnv('APPLE_KEY_ID', 'TESTKEY');
  vi.stubEnv('APPLE_PRIVATE_KEY', await exportPKCS8(pair.privateKey));
  resetEnvCache();
  const url = new URL(providers.authorize('apple', 'state', 'verifier'));
  expect(url.searchParams.get('redirect_uri')).toBe('https://example.test/api/v1/auth/social/apple/callback');
  expect(url.searchParams.get('response_mode')).toBe('query');
  const applePublic = await importJWK(await exportJWK(pair.publicKey), 'ES256');
  const call = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ error: 'invalid_grant' }, { status: 400 }),
  );
  vi.stubGlobal('fetch', call);
  await expect(providers.providerSubject('apple', 'test-code', 'state', 'verifier')).rejects.toThrow();
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
