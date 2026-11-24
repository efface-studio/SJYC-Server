import { RateLimitService } from '../src/common/rate-limit';
import { createTestApp, type TestContext } from './app';
import { signedIn } from './fixtures';
let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
it('사이트 설정 저장은 관리자 권한과 버전이 맞을 때만 성공하고 감사 기록을 남긴다', async () => {
  const initial = await t.http.get('/api/v1/site/settings').expect(200);
  const version = initial.body.data.version;
  const data = { version, values: { slogan: '테스트 방문 안내' } };
  const staff = await signedIn(t, ['staff']);
  await staff.agent.put('/api/v1/admin/site-settings').send(data).expect(403);
  const admin = await signedIn(t, ['admin']);
  await admin.agent
    .put('/api/v1/admin/site-settings')
    .send({ version, values: { film: '외부 주소' } })
    .expect(400);
  const changes = await Promise.all(
    [1, 2].map(() => admin.agent.put('/api/v1/admin/site-settings').send(data)),
  );
  expect(changes.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await t.http.get('/api/v1/site/settings')).body.data).toMatchObject({
    version: version + 1,
    values: data.values,
  });
  expect(await t.prisma.auditEvent.count({ where: { action: 'site.settings.update' } })).toBe(1);
});
it('서버 로그는 개발자에게만 경로 템플릿과 측정값을 반환한다', async () => {
  const admin = await signedIn(t, ['admin']);
  await admin.agent.get('/api/v1/admin/server-logs').expect('Cache-Control', 'private, no-store').expect(403);
  const dev = await signedIn(t, ['developer']);
  const response = await dev.agent.get('/api/v1/clubs/sjyc-private-example?q=private-query-example');
  const logs = await dev.agent
    .get('/api/v1/admin/server-logs')
    .expect('Cache-Control', 'private, no-store')
    .expect(200);
  const row = logs.body.data.entries.find((e: { id: string }) => e.id === response.headers['x-request-id']);
  expect(row).toMatchObject({ route: '/api/v1/clubs/:id', status: 404, level: 'warn' });
  expect(JSON.stringify(logs.body.data)).not.toContain('private-example');
  expect(JSON.stringify(logs.body.data)).not.toContain('private-query-example');
});

it('동시 요청의 고정 만료 시간을 유지하고 만료가 누락된 카운터도 복구한다', async () => {
  const limiter = t.app.get(RateLimitService);
  const results = await Promise.all(Array.from({ length: 5 }, () => limiter.exceeded('window-test', 3, 60)));
  expect(results.filter(Boolean)).toHaveLength(2);
  await t.redis.expire('rl:window-test', 10);
  await limiter.exceeded('window-test', 3, 60);
  expect(await t.redis.ttl('rl:window-test')).toBeLessThanOrEqual(10);
  await t.redis.persist('rl:window-test');
  expect(await limiter.exceeded('window-test', 3, 60)).toBe(true);
  expect(await t.redis.ttl('rl:window-test')).toBeGreaterThan(0);
});
