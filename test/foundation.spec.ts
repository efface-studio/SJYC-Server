import { createTestApp, type TestContext } from './app';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

describe('공통 계층', () => {
  it('헬스 체크는 DB·Redis 를 확인하고 envelope 로 감싼다', async () => {
    const res = await t.http.get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('없는 경로는 오류 envelope 의 NOT_FOUND', async () => {
    const res = await t.http.get('/api/v1/nope').expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('XSRF 쿠키를 심고, 브라우저 요청은 Origin·토큰이 맞아야 한다', async () => {
    const first = await t.http.get('/api/v1/health');
    const cookie = String(first.headers['set-cookie']);
    const token = /XSRF-TOKEN=([^;]+)/.exec(cookie)?.[1];
    expect(token).toBeTruthy();

    // 다른 사이트에서 온 요청은 거부
    const evil = await t.http
      .post('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Cookie', `XSRF-TOKEN=${token}`)
      .set('X-XSRF-TOKEN', token!);
    expect(evil.status).toBe(403);
    // 허용된 웹이라도 토큰이 없으면 거부
    const noToken = await t.http.post('/api/v1/health').set('Origin', 'http://localhost:3000');
    expect(noToken.status).toBe(403);
    // 허용된 웹 + 같은 토큰이면 통과(라우트가 없어 404)
    const ok = await t.http
      .post('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `XSRF-TOKEN=${token}`)
      .set('X-XSRF-TOKEN', token!);
    expect(ok.status).toBe(404);
    // Origin 이 없는 네이티브 앱 요청은 세션 검사로 넘어간다
    expect((await t.http.post('/api/v1/health')).status).toBe(404);
  });

  it('보안 헤더를 붙이고 요청 ID 를 돌려준다', async () => {
    const res = await t.http.get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
