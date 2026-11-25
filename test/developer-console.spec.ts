import { countError } from '../src/operations/error-metrics';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createProgram, signedIn } from './fixtures';
import type { DevView } from '../src/shared/domain/developer-console';
let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.app.close());
beforeEach(() => clearRateLimits(t));
const base = '/api/v1/admin/developer';

it('최고 관리자는 다섯 화면을 조회하고, 변경은 개발자만 가능하며 직원은 조회할 수 없다', async () => {
  const admin = await signedIn(t, ['admin']),
    staff = await signedIn(t, ['staff']),
    dev = await signedIn(t, ['developer']);
  for (const section of ['permissions', 'logs', 'security', 'operations', 'system']) {
    await t.http
      .get(base + '/view')
      .query({ section })
      .expect(401);
    await staff.agent
      .get(base + '/view')
      .query({ section })
      .expect(403);
    const snapshot = await admin.agent
      .get(base + '/view')
      .query({ section })
      .expect(200);
    expect(snapshot.body.data.groups.length).toBeGreaterThan(0);
    expect(snapshot.body.data.forms).toBeUndefined();
    const { body } = await dev.agent
      .get(base + '/view')
      .query({ section })
      .expect(200);
    expect(body.data.groups.length).toBeGreaterThan(0);
  }
  const config = await admin.agent
    .get(base + '/view')
    .query({ section: 'operations', item: 'settings' })
    .expect(200);
  expect(config.body.data.groups.flatMap((g: { rows: unknown[] }) => g.rows)).toContainEqual({
    title: '유지보수 모드',
    detail: '해제',
  });
  await admin.agent
    .get(base + '/view')
    .query({ section: 'permissions', item: 'new' })
    .expect(403);
  await admin.agent
    .post(base + '/actions')
    .send({ command: 'refresh-stats' })
    .expect(403);
});

it('직원 역할의 사용·수정·해제, 세션 종료와 감사 이력을 검증한다', async () => {
  const dev = await signedIn(t, ['developer']),
    staff = await signedIn(t, ['staff']);
  const act = (data: object) => dev.agent.post(base + '/actions').send(data);
  const read = async (section: string, item = ''): Promise<DevView> =>
    (
      await dev.agent
        .get(base + '/view')
        .query({ section, item })
        .expect(200)
    ).body.data;
  await act({ command: 'save-role', values: { label: '읽기 담당', permissions: 'developer.access' } }).expect(
    400,
  );
  await act({ command: 'save-role', values: { label: '읽기 담당', permissions: 'member.read' } }).expect(201);
  const role = (await read('permissions')).groups.flatMap((g) => g.rows).find((r) => r.title === '읽기 담당')!
    .next!.item!;
  await act({ command: 'assign-role', id: dev.user.id, values: { roleId: role } }).expect(403);
  await act({ command: 'assign-role', id: staff.user.id, values: { roleId: role } }).expect(201);
  const me = await staff.agent.get('/api/v1/auth/session').expect(200);
  expect(me.body.data.user.permissionScope).toEqual(['admin.access', 'member.read']);
  await staff.agent.get('/api/v1/admin/inquiries').expect(403);
  await act({ command: 'delete-role', id: role, version: 1 }).expect(409);
  await act({ command: 'assign-role', id: staff.user.id, version: 1, values: { roleId: '' } }).expect(201);
  await act({ command: 'delete-role', id: role, version: 1 }).expect(201);
  const removed = (await read('logs', 'audit')).groups[0]!.rows.find(
    (r) => r.title === '미사용 직원 역할 삭제',
  )!;
  const changes = (await read('logs', removed.next!.item!)).groups[0]!.rows;
  expect(changes.find((row) => row.title === '변경 전')?.detail).toContain('읽기 담당');
  const session = await read('security', staff.user.id);
  expect(JSON.stringify(session)).not.toMatch(/tokenHash|passwordHash/);
  await act({ command: 'revoke', id: staff.user.id }).expect(201);
  await staff.agent.get('/api/v1/me/notifications').expect(401);
  expect(
    (await read('logs', 'audit')).groups[0]!.rows.some((r) => r.title.includes('로그인 기기 종료')),
  ).toBe(true);
});
it('운영 제어가 지정한 실제 신청만 막고 설정 충돌을 탐지한다', async () => {
  const dev = await signedIn(t, ['developer']),
    member = await signedIn(t);
  const program = await createProgram(t);
  const config = {
    command: 'save-controls',
    values: { maintenance: 'true', message: '프로그램 점검', targets: 'programs', disabled: '' },
  };
  await dev.agent
    .post(base + '/actions')
    .send(config)
    .expect(201);
  await dev.agent
    .post(base + '/actions')
    .send(config)
    .expect(409);
  const res = await member.agent
    .post('/api/v1/programs/' + program.id + '/applications')
    .send({})
    .expect(503);
  expect(res.body.error.message).toBe('프로그램 점검');
  await member.agent.get('/api/v1/programs/' + program.id).expect(200);
  await dev.agent
    .post(base + '/actions')
    .send({ ...config, version: 1, values: { ...config.values, maintenance: 'false' } })
    .expect(201);
  await dev.agent
    .post(base + '/actions')
    .send({ command: 'refresh-stats' })
    .expect(201);
});

it('오류 누계를 날짜별 상세와 연결한다', async () => {
  const dev = await signedIn(t, ['developer']);
  const route = '/api/v1/test-metrics/:id';
  const event = {
    id: 'test-event',
    at: new Date().toISOString(),
    method: 'GET',
    route,
    status: 503,
    durationMs: 5,
    level: 'error' as const,
  };
  await countError(t.redis, event);
  await countError(t.redis, event);
  for (const period of ['top', 'top30']) {
    const { body } = await dev.agent
      .get(base + '/view')
      .query({ section: 'logs', item: period })
      .expect(200);
    const next = (body.data as DevView).groups
      .flatMap((g) => g.rows)
      .find((r) => r.title === '503 GET ' + route)!.next!;
    const detail = await dev.agent
      .get(base + '/view')
      .query(next)
      .expect(200);
    expect(detail.body.data.groups[0].rows[0].value).toBe('2건');
    expect(detail.body.data.groups[1].rows[0].value).toBe('2건');
  }
});
