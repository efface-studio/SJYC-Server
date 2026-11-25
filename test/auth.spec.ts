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

describe('회원가입·휴대전화 인증', () => {
  it('문자 확인 전에는 계정과 세션이 없고 완료 후 이메일을 로그인 ID로 쓸 수 있다', async () => {
    const browser = supertest.agent(t.app.getHttpServer()),
      form = signupBody(uniqueEmail('sms')),
      path = '/api/v1/auth/phone-verification';
    const result = await browser.post('/api/v1/auth/signup').send(form).expect(201);
    expect(result.body.data).toMatchObject({
      phone: form.phone,
      verificationMode: 'sms',
      requiresPhoneVerification: true,
    });
    expect(t.mail.lastToken(form.email)).toBeUndefined();
    expect(await t.prisma.user.findUnique({ where: { email: form.email } })).toBeNull();
    await browser.get('/api/v1/auth/session').expect(401);
    const code = t.sms.sent.at(-1)!.code;
    await t.http
      .post(path + '/confirm')
      .send({ code })
      .expect(400);
    await browser
      .post(path + '/confirm')
      .send({ code })
      .expect(200);
    await browser
      .post(path + '/confirm')
      .send({ code })
      .expect(400);
    const logged = await browser
      .post('/api/v1/auth/login')
      .send({ email: form.email, password: form.password })
      .expect(200);
    expect(logged.body.data.user).toMatchObject({
      email: form.email,
      emailVerified: false,
      phone: form.phone,
      roles: ['member'],
    });
    expect(logged.body.data.user.passwordHash).toBeUndefined();
    expect(await t.prisma.user.findUniqueOrThrow({ where: { email: form.email } })).toHaveProperty(
      'signupPhoneVerifiedAt',
      expect.any(Date),
    );
  });

  it('중복 이메일은 CONFLICT(EMAIL_TAKEN) 와 필드 오류', async () => {
    const email = uniqueEmail('dup');
    await createUser(t, { email });
    const res = await t.http.post('/api/v1/auth/signup').send(signupBody(email.toUpperCase())).expect(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', reason: 'EMAIL_TAKEN' });
    expect(res.body.error.fieldErrors.email).toBeTruthy();
  });

  it('문자 발송 실패는 가입을 만들지 않으며 재발송 실패 후 이전 코드가 살아 있다', async () => {
    const form = signupBody(uniqueEmail('send')),
      agent = supertest.agent(t.app.getHttpServer()),
      path = '/api/v1/auth/phone-verification';
    const { AppException } = await import('../src/common/app-exception');
    vi.spyOn(t.sms, 'send').mockRejectedValueOnce(new AppException('NETWORK'));
    await agent.post('/api/v1/auth/signup').send(form).expect(503);
    expect(await t.prisma.user.findUnique({ where: { email: form.email } })).toBeNull();
    await agent.post('/api/v1/auth/signup').send(form).expect(201);
    const code = t.sms.sent.at(-1)!.code;
    await agent
      .post(path + '/resend')
      .send({})
      .expect(429);
    vi.spyOn(t.sms, 'send').mockRejectedValueOnce(new AppException('NETWORK'));
    await agent
      .post(path + '/resend')
      .send({ phone: '010-1234-1001' })
      .expect(503);
    expect((await agent.get(path)).body.data.phone).toBe(form.phone);
    await agent
      .post(path + '/confirm')
      .send({ code })
      .expect(200);
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
    const route = '/api/v1/auth/phone-verification/confirm';
    await t.http.post(route).send({ code: '284600' }).expect(400);
    await browser.post(route).send({ code: '123456' }).expect(400);
    await browser.post(route).send({ code: '284600' }).expect(200);
    await browser.post(route).send({ code: '284600' }).expect(400);
    await browser.post('/api/v1/auth/login').send({ email, password: form.password }).expect(200);
  } finally {
    vi.unstubAllEnvs();
    resetEnvCache();
  }
});

it('재발송은 코드를 교체하고 번호 변경은 이전 기기 증명까지 무효화한다', async () => {
  const form = signupBody(uniqueEmail('change')),
    agent = supertest.agent(t.app.getHttpServer()),
    path = '/api/v1/auth/phone-verification';
  const first = await agent.post('/api/v1/auth/signup').send(form).expect(201);
  const oldCookie = (first.headers['set-cookie'] as unknown as string[])
    .find((s) => s.startsWith('sjyc_signup_phone='))!
    .split(';')[0]!;
  const old = t.sms.sent.at(-1)!.code;
  const hash = (await import('../src/auth/tokens')).hashToken(oldCookie.split('=')[1]!);
  await t.prisma.signupPhoneChallenge.update({
    where: { ticketHash: hash },
    data: { sentAt: new Date(Date.now() - 31000) },
  });
  await agent
    .post(path + '/resend')
    .send({})
    .expect(200);
  await t.http.get(path).set('Cookie', oldCookie).expect(400);
  const sameNumberCode = t.sms.sent.at(-1)!.code;
  const phone = '010-1111-1010';
  await agent
    .post(path + '/resend')
    .send({ phone })
    .expect(200);
  const next = t.sms.sent.at(-1)!;
  expect(next.phone).toBe(phone);
  if (old !== next.code)
    await agent
      .post(path + '/confirm')
      .send({ code: old })
      .expect(400);
  if (sameNumberCode !== next.code)
    await agent
      .post(path + '/confirm')
      .send({ code: sameNumberCode })
      .expect(400);
  await agent
    .post(path + '/confirm')
    .send({ code: next.code })
    .expect(200);
  expect((await t.prisma.user.findUniqueOrThrow({ where: { email: form.email } })).phone).toBe(phone);
});
it('만료되거나 5회 틀린 코드로 가입할 수 없다', async () => {
  const path = '/api/v1/auth/phone-verification',
    agent = supertest.agent(t.app.getHttpServer());
  const start = await agent
    .post('/api/v1/auth/signup')
    .send(signupBody(uniqueEmail('expire')))
    .expect(201);
  const valid = t.sms.sent.at(-1)!.code,
    wrong = valid === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++)
    await agent
      .post(path + '/confirm')
      .send({ code: wrong })
      .expect(400);
  await agent
    .post(path + '/confirm')
    .send({ code: valid })
    .expect(429);
  const tok = (start.headers['set-cookie'] as unknown as string[])
    .find((s) => s.startsWith('sjyc_signup_phone='))!
    .split(';')[0]!
    .split('=')[1]!;
  await t.prisma.signupPhoneChallenge.update({
    where: { ticketHash: (await import('../src/auth/tokens')).hashToken(tok) },
    data: { codeExpiresAt: new Date(Date.now() - 100), attempts: 0 },
  });
  await agent
    .post(path + '/confirm')
    .send({ code: valid })
    .expect(400);
});

it('메일 발송 중지 시 회원 유무와 상관없이 메일 요청만 503을 반환하고 토큰을 만들지 않는다', async () => {
  const user = await createUser(t);
  vi.stubEnv('MAIL_DELIVERY', 'disabled');
  resetEnvCache();
  try {
    for (const endpoint of ['password-reset', 'email-verification/resend']) {
      for (const email of [user.email, uniqueEmail('missing')]) {
        const result = await t.http
          .post('/api/v1/auth/' + endpoint)
          .send({ email })
          .expect(503);
        expect(result.body.error.code).toBe('NOT_CONFIGURED');
      }
    }
    expect(await t.prisma.authToken.count({ where: { userId: user.id } })).toBe(0);
    await t.http.get('/api/v1/health').expect(200);
    await t.http.get('/api/v1/auth/session').expect(401);
  } finally {
    vi.unstubAllEnvs();
    resetEnvCache();
  }
});

it('임시 코드는 새 일반회원의 가입만 완료하고 번호 인증과 관리자 권한을 부여하지 않는다', async () => {
  vi.stubEnv('SIGNUP_TEMPORARY_REGISTRATION', 'on');
  resetEnvCache();
  try {
    const client = supertest.agent(t.app.getHttpServer()),
      form = signupBody(uniqueEmail('temporary'));
    const signup = '/api/v1/auth/signup',
      verify = '/api/v1/auth/phone-verification';
    const sent = t.sms.sent.length;
    const started = await client.post(signup).send(form).expect(201);
    expect(started.body.data.verificationMode).toBe('preview');
    await client
      .post(verify + '/resend')
      .send({ phone: '010-1234-5678' })
      .expect(200);
    expect(t.sms.sent.length).toBe(sent);
    await t.http
      .post(verify + '/confirm')
      .send({ code: '284600' })
      .expect(400);
    await client
      .post(verify + '/confirm')
      .send({ code: '000123' })
      .expect(400);
    await client
      .post(verify + '/confirm')
      .send({ code: '284600' })
      .expect(200);
    await client
      .post(verify + '/confirm')
      .send({ code: '284600' })
      .expect(400);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: form.email } });
    expect(user).toMatchObject({
      signupPhoneVerifiedAt: null,
      phone: '010-1234-5678',
      emailVerified: false,
      roles: ['member'],
    });
    expect(user.temporarySignupAt).toBeInstanceOf(Date);
    await client.post(signup).send(form).expect(409);
    await client.post('/api/v1/auth/login').send({ email: form.email, password: form.password }).expect(200);
    await client.get('/api/v1/auth/session').expect(200);
    await t.prisma.user.update({ where: { id: user.id }, data: { roles: ['admin'] } });
    await client.get('/api/v1/auth/session').expect(401);
    await client.post('/api/v1/auth/login').send({ email: form.email, password: form.password }).expect(403);
  } finally {
    vi.unstubAllEnvs();
    resetEnvCache();
  }
});

it('임시 가입을 끄면 이전 임시 요청은 만료되고 새 요청과 기존 계정에는 실제 문자 절차가 적용된다', async () => {
  vi.stubEnv('SIGNUP_TEMPORARY_REGISTRATION', 'on');
  resetEnvCache();
  try {
    const agent = supertest.agent(t.app.getHttpServer()),
      signup = '/api/v1/auth/signup',
      verify = '/api/v1/auth/phone-verification/confirm';
    const old = await createUser(t, { email: uniqueEmail('previous') });
    await t.prisma.user.update({ where: { id: old.id }, data: { emailVerified: false } });
    const regular = await agent.post(signup).send(signupBody(old.email)).expect(201);
    expect(regular.body.data.verificationMode).toBe('sms');
    const fresh = supertest.agent(t.app.getHttpServer());
    await fresh
      .post(signup)
      .send(signupBody(uniqueEmail('switch')))
      .expect(201);
    vi.stubEnv('SIGNUP_TEMPORARY_REGISTRATION', 'off');
    resetEnvCache();
    await fresh.post(verify).send({ code: '284600' }).expect(400);
    const sms = await fresh
      .post(signup)
      .send(signupBody(uniqueEmail('real')))
      .expect(201);
    expect(sms.body.data.verificationMode).toBe('sms');
  } finally {
    vi.unstubAllEnvs();
    resetEnvCache();
  }
});
