import { resetEnvCache } from '../src/config/env';
import supertest from 'supertest';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createUser, loginAgent, PASSWORD, uniqueEmail } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

const signupBody = (email: string) => ({
  name: '김가입',
  email,
  password: 'abcd1234',
  passwordConfirm: 'abcd1234',
  phone: '010-0000-0000',
  birthYear: 2008,
  agreeTerms: 'on',
  agreePrivacy: 'on',
  agreeMarketing: false,
});

describe('회원가입·이메일 인증', () => {
  it('가입 → 인증 전 로그인 거부 → 메일 링크 확인 → 로그인', async () => {
    const email = uniqueEmail('signup');
    const res = await t.http.post('/api/v1/auth/signup').send(signupBody(email)).expect(201);
    expect(res.body).toEqual({ success: true, data: { requiresEmailVerification: true } });

    const blocked = await t.http.post('/api/v1/auth/login').send({ email, password: 'abcd1234' }).expect(403);
    expect(blocked.body.error.message).toContain('이메일 인증');

    const token = t.mail.lastToken(email)!;
    const confirm = await t.http.get(`/api/v1/auth/email-verification/confirm?token=${token}`).expect(302);
    expect(confirm.headers.location).toBe('http://localhost:3000/login?verified=1');
    // 1회용
    const again = await t.http.get(`/api/v1/auth/email-verification/confirm?token=${token}`).expect(302);
    expect(again.headers.location).toContain('error=verify_expired');

    const ok = await t.http.post('/api/v1/auth/login').send({ email, password: 'abcd1234' }).expect(200);
    expect(ok.body.data.user).toMatchObject({
      email,
      roles: ['member'],
      emailVerified: true,
      managedClubIds: [],
    });
    expect(ok.body.data.user.passwordHash).toBeUndefined();
    const consents = ok.body.data.user.consents as { key: string; agreed: boolean }[];
    expect(consents.find((c) => c.key === 'marketing')?.agreed).toBe(false);
  });

  it('중복 이메일은 CONFLICT(EMAIL_TAKEN) 와 필드 오류', async () => {
    const email = uniqueEmail('dup');
    await createUser(t, { email });
    const res = await t.http.post('/api/v1/auth/signup').send(signupBody(email.toUpperCase())).expect(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', reason: 'EMAIL_TAKEN' });
    expect(res.body.error.fieldErrors.email).toBeTruthy();
  });

  it('발송 실패 후 같은 자격 증명으로 이전 계정의 인증을 이어 간다', async () => {
    const email = uniqueEmail('retry');
    const request = { ...signupBody(email), phone: '010-0000-0000' };
    vi.spyOn(t.mail, 'send').mockRejectedValueOnce(new Error('SMTP unavailable'));
    const failed = await t.http.post('/api/v1/auth/signup').send(request).expect(503);
    expect(failed.body.error.message).toContain('계정은 등록');
    await t.http
      .post('/api/v1/auth/signup')
      .send({ ...request, password: 'different7', passwordConfirm: 'different7' })
      .expect(409);
    expect(t.mail.lastToken(email)).toBeUndefined();
    await t.http
      .post('/api/v1/auth/signup')
      .send({ ...request, name: '재시도', phone: '010-0000-1212' })
      .expect(201);
    expect(
      await t.prisma.user.findMany({
        where: { email },
        select: { emailVerified: true, name: true, phone: true },
      }),
    ).toEqual([{ emailVerified: false, name: request.name, phone: request.phone }]);
    const old = t.mail.lastToken(email)!;
    vi.spyOn(t.mail, 'send').mockRejectedValueOnce(new Error('SMTP unavailable'));
    await t.http.post('/api/v1/auth/email-verification/resend').send({ email }).expect(503);
    const verified = await t.http.get(`/api/v1/auth/email-verification/confirm?token=${old}`).expect(302);
    expect(verified.headers.location).toContain('verified=1');
  });

  it('휴대전화가 누락되거나 올바르지 않으면 회원을 저장하지 않는다', async () => {
    const email = uniqueEmail('phone');
    const bad = await t.http
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(email), phone: '123' })
      .expect(400);
    expect(bad.body.error.fieldErrors.phone).toBeTruthy();
    await t.http
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(email), phone: '' })
      .expect(400);
    await t.http
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(email), phone: undefined })
      .expect(400);
    expect(await t.prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('웹 폼과 같은 규칙으로 검증한다 (비밀번호 확인·필수 동의)', async () => {
    const res = await t.http
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(uniqueEmail()), passwordConfirm: 'zzzz9999', agreeTerms: false })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(expect.arrayContaining(['agreeTerms']));
  });
});

describe('로그인·세션', () => {
  it('세션 쿠키는 HttpOnly 이고 세션 조회·로그아웃이 된다', async () => {
    const user = await createUser(t);
    const agent = supertest.agent(t.app.getHttpServer());
    const login = await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/sjyc_session=[^;]+;.*HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const s = await agent.get('/api/v1/auth/session').expect(200);
    expect(s.body.data.user.id).toBe(user.id);
    expect(Date.parse(s.body.data.expiresAt)).toBeGreaterThan(Date.now());

    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/session').expect(401);
    expect(await t.prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('틀린 비밀번호와 없는 계정은 같은 오류, 정지 계정은 안내', async () => {
    const user = await createUser(t);
    const wrong = await t.http.post('/api/v1/auth/login').send({ email: user.email, password: 'nope1234' });
    const none = await t.http
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('x'), password: 'nope1234' });
    expect(wrong.status).toBe(400);
    expect(none.body.error).toEqual(wrong.body.error);

    const suspended = await createUser(t, { status: 'suspended' });
    const res = await t.http.post('/api/v1/auth/login').send({ email: suspended.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('이용이 제한');
  });

  it('같은 IP·이메일로 10번 넘게 틀리면 잠시 막는다', async () => {
    const user = await createUser(t);
    for (let i = 0; i < 10; i++) {
      await t.http.post('/api/v1/auth/login').send({ email: user.email, password: 'nope1234' }).expect(400);
    }
    const res = await t.http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('만료된 세션과 정지된 회원의 세션은 무효', async () => {
    const user = await createUser(t);
    const agent = await loginAgent(t, user.email);
    await t.prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    await agent.get('/api/v1/auth/session').expect(401);

    const other = await createUser(t);
    const agent2 = await loginAgent(t, other.email);
    await t.prisma.user.update({ where: { id: other.id }, data: { status: 'suspended' } });
    await agent2.get('/api/v1/auth/session').expect(401);
  });

  it('브라우저 요청은 XSRF 토큰이 있어야 로그인된다', async () => {
    const user = await createUser(t);
    const res = await t.http
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('비밀번호 재설정', () => {
  it('없는 이메일도 같은 응답, 링크로 바꾸면 모든 세션이 끊긴다', async () => {
    await t.http
      .post('/api/v1/auth/password-reset')
      .send({ email: uniqueEmail('ghost') })
      .expect(204);

    const user = await createUser(t);
    const agent = await loginAgent(t, user.email);
    await t.http.post('/api/v1/auth/password-reset').send({ email: user.email }).expect(204);
    const token = t.mail.lastToken(user.email)!;
    expect(t.mail.sent.at(-1)?.text).toContain('http://localhost:3000/password/reset?token=');

    const weak = await t.http.post('/api/v1/auth/password-reset/confirm').send({ token, password: 'short' });
    expect(weak.status).toBe(400);
    await t.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, password: 'newpass123' })
      .expect(204);
    await agent.get('/api/v1/auth/session').expect(401);
    await t.http.post('/api/v1/auth/login').send({ email: user.email, password: 'newpass123' }).expect(200);
    // 1회용
    const reuse = await t.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, password: 'another123' });
    expect(reuse.status).toBe(400);
  });
});

describe('소셜 로그인', () => {
  it('공급자 키가 없으면 웹 로그인 화면으로 안내한다', async () => {
    const res = await t.http.get('/api/v1/auth/oauth/kakao/start?redirect=%2Fmy').expect(302);
    expect(res.headers.location).toBe('http://localhost:3000/login?error=oauth_failed');
  });
});

it('로컬 가입 고정 코드는 가입을 시작한 기기에서만 한 번 사용할 수 있고 실메일을 보내지 않는다', async () => {
  vi.stubEnv('SIGNUP_PREVIEW_CODE', 'on');
  resetEnvCache();
  try {
    const browser = supertest.agent(t.app.getHttpServer());
    const email = uniqueEmail('preview');
    const form = signupBody(email);
    await browser
      .post('/api/v1/auth/signup')
      .send({ ...form, phone: '' })
      .expect(400);
    const start = await browser.post('/api/v1/auth/signup').send(form).expect(201);
    expect(start.body.data.verificationMode).toBe('preview');
    expect(t.mail.lastToken(email)).toBeUndefined();
    const route = '/api/v1/auth/email-verification/preview';
    await t.http.post(route).send({ code: '284600' }).expect(400);
    await browser.post(route).send({ code: '123456' }).expect(400);
    await browser.post(route).send({ code: '284600' }).expect(204);
    await browser.post(route).send({ code: '284600' }).expect(400);
    await browser.post('/api/v1/auth/login').send({ email, password: form.password }).expect(200);
  } finally {
    vi.unstubAllEnvs();
    resetEnvCache();
  }
});
