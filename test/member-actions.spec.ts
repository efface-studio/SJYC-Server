import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createProgram, signedIn, createUser, loginAgent } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.app.close());
beforeEach(() => clearRateLimits(t));
const actions = (id: string) => '/api/v1/admin/members/' + id + '/actions';

it('회원 관리 권한과 보호 계정을 검사하고 재설정 링크를 한 번만 허용한다', async () => {
  const admin = await signedIn(t, ['admin']);
  const target = await signedIn(t);
  const developer = await createUser(t, { roles: ['developer'] });
  const reset = { action: 'reset-password' };
  await target.agent.post(actions(admin.user.id)).send(reset).expect(403);
  await admin.agent.post(actions(developer.id)).send(reset).expect(403);
  await admin.agent.post(actions(admin.user.id)).send(reset).expect(403);
  const issue = async () =>
    new URL(
      (
        await admin.agent
          .post(actions(target.user.id))
          .send(reset)
          .expect(201)
          .expect('Cache-Control', 'no-store')
      ).body.data.resetUrl,
    ).searchParams.get('token');
  const old = await issue(),
    token = await issue();
  const confirm = (value: string | null) =>
    t.http.post('/api/v1/auth/password-reset/confirm').send({ token: value, password: 'reset-test-2026' });
  await confirm(old).expect(400);
  await confirm(token).expect(204);
  await confirm(token).expect(400);
  await target.agent.get('/api/v1/me/notifications').expect(401);
  const log = await t.prisma.auditEvent.findMany({ where: { targetId: target.user.id } });
  expect(log).toHaveLength(2);
  expect(JSON.stringify(log)).not.toContain(token);
});

it('동아리 가입과 프로그램 정원을 중복 처리하지 않고 탈퇴 후 모든 변경을 차단한다', async () => {
  const { agent } = await signedIn(t, ['admin']);
  const target = await signedIn(t);
  const id = target.user.id;
  const c = await t.prisma.club.create({
    data: { name: '활동 등록 검증', field: '음악', summary: '-', description: '-', meetingInfo: '-' },
  });
  const p = await createProgram(t, { capacity: 1 });
  const options = async () =>
    (await agent.get('/api/v1/admin/members/' + id + '/activity-options').expect(200)).body.data;
  expect((await options()).clubs).toContainEqual({ id: c.id, title: c.name });
  const command = (body: object) => agent.post(actions(id)).send(body);
  await command({ action: 'profile', name: '변경 회원', phone: '010-1111-2222' }).expect(201);
  await command({ action: 'join-club', clubId: c.id }).expect(201);
  await command({ action: 'join-club', clubId: c.id }).expect(409);
  const enroll = () => command({ action: 'enroll', programId: p.id });
  expect((await Promise.all([enroll(), enroll()])).map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await t.prisma.program.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
    appliedCount: 1,
  });
  expect((await options()).programs).not.toContainEqual({ id: p.id, title: p.title });
  await command({ action: 'withdraw' }).expect(201);
  await target.agent.get('/api/v1/me/notifications').expect(401);
  await command({ action: 'sign-out' }).expect(409);
  await agent
    .patch('/api/v1/admin/members/' + id)
    .send({ status: 'active' })
    .expect(409);
  expect(await t.prisma.programApplication.count({ where: { userId: id, programId: p.id } })).toBe(1);
});

it('관리자가 본인 활동을 등록·해제하고 모든 세션을 종료해도 역할·상태는 보호한다', async () => {
  const { user, agent } = await signedIn(t, ['admin']);
  const otherDevice = await loginAgent(t, user.email);
  const c = await t.prisma.club.create({
    data: { name: '본인 활동 검증', field: '음악', summary: '-', description: '-', meetingInfo: '-' },
  });
  const p = await createProgram(t);
  const path = '/api/v1/admin/members/' + user.id;
  const command = (data: object) => agent.post(actions(user.id)).send(data);
  const options = await agent.get(path + '/activity-options').expect(200);
  expect(options.body.data.clubs).toContainEqual({ id: c.id, title: c.name });
  await command({ action: 'withdraw' }).expect(403);
  await command({ action: 'reset-password' }).expect(403);
  await agent
    .patch(path)
    .send({ roles: ['developer'] })
    .expect(409);
  await agent.patch(path).send({ status: 'suspended' }).expect(409);
  await command({ action: 'join-club', clubId: c.id }).expect(201);
  await command({ action: 'enroll', programId: p.id }).expect(201);
  const application = await t.prisma.programApplication.findFirstOrThrow({
    where: { userId: user.id, programId: p.id },
  });
  await agent.post('/api/v1/me/applications/' + application.id + '/cancel').expect(201);
  await agent.delete('/api/v1/manage/clubs/' + c.id + '/members/' + user.id).expect(204);
  expect(await t.prisma.program.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
    appliedCount: 0,
  });
  await command({ action: 'sign-out' }).expect(201);
  for (const device of [agent, otherDevice]) await device.get('/api/v1/me/notifications').expect(401);
  expect(await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
    roles: ['admin'],
    status: 'active',
  });
});
