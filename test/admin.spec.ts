import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createUser, loginAgent, signedIn } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

describe('관리자 접근', () => {
  it('일반 회원은 403, 직원은 대시보드·회원 조회만, 감사 로그는 최고 관리자부터', async () => {
    const member = await signedIn(t);
    await member.agent.get('/api/v1/admin/dashboard').expect(403);
    await t.http.get('/api/v1/admin/dashboard').expect(401);

    const staff = await signedIn(t, ['staff']);
    const dash = await staff.agent.get('/api/v1/admin/dashboard?periodDays=30').expect(200);
    expect(dash.body.data).toMatchObject({
      programsOpen: expect.any(Number),
      inquiriesOpen: expect.any(Number),
      recentApplications: expect.any(Array),
    });
    await staff.agent.get('/api/v1/admin/members').expect(200);
    await staff.agent
      .patch(`/api/v1/admin/members/${member.user.id}`)
      .send({ status: 'suspended' })
      .expect(403);
    await staff.agent.get('/api/v1/admin/audit-events').expect(403);
  });
});

describe('회원 관리', () => {
  it('이름·이메일 검색과 상태 필터, 담당 동아리 ID 를 함께 내려준다', async () => {
    const { agent } = await signedIn(t, ['admin']);
    const tag = `검색${Date.now()}`;
    const u = await createUser(t, { name: `${tag} 회원` });
    await createUser(t, { name: `${tag} 정지`, status: 'suspended' });
    const club = await t.prisma.club.create({
      data: { name: `담당${tag}`, field: '음악', summary: '-', description: '-', meetingInfo: '-' },
    });
    await t.prisma.clubManager.create({ data: { clubId: club.id, userId: u.id } });

    const all = await agent.get(`/api/v1/admin/members?q=${encodeURIComponent(tag)}`).expect(200);
    expect(all.body.data.total).toBe(2);
    const active = await agent.get(`/api/v1/admin/members?q=${encodeURIComponent(tag)}&status=active`);
    expect(active.body.data.items).toMatchObject([{ id: u.id, managedClubIds: [club.id] }]);
    expect(JSON.stringify(all.body.data)).not.toContain('passwordHash');

    const managerAgent = await loginAgent(t, u.email);
    const session = await managerAgent.get('/api/v1/auth/session').expect(200);
    expect(session.body.data.user.managedClubIds).toEqual([club.id]);
  });

  it('역할 부여 규칙: 자기 자신·개발자 계정·개발자 역할은 막고, 변경은 감사 로그에 남는다', async () => {
    const { user: admin, agent } = await signedIn(t, ['admin']);
    const target = await createUser(t, { name: '대상회원' });
    const dev = await createUser(t, { roles: ['developer'] });

    const self = await agent
      .patch(`/api/v1/admin/members/${admin.id}`)
      .send({ status: 'suspended' })
      .expect(409);
    expect(self.body.error.reason).toBe('INVALID_STATE');
    await agent.patch(`/api/v1/admin/members/${dev.id}`).send({ status: 'suspended' }).expect(403);
    await agent
      .patch(`/api/v1/admin/members/${target.id}`)
      .send({ roles: ['developer'] })
      .expect(403);
    await agent.patch(`/api/v1/admin/members/${target.id}`).send({ roles: [] }).expect(400);
    await agent.patch(`/api/v1/admin/members/${target.id}`).send({}).expect(400);

    const memberSession = await loginAgent(t, target.email);
    const ok = await agent.patch(`/api/v1/admin/members/${target.id}`).send({ roles: ['member', 'staff'] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.roles).toEqual(['member', 'staff']);
    await memberSession.get('/api/v1/auth/session').expect(401);
    const staffSession = await loginAgent(t, target.email);
    await agent
      .patch(`/api/v1/admin/members/${target.id}`)
      .send({ roles: ['staff', 'member'] })
      .expect(200);
    await staffSession.get('/api/v1/admin/dashboard').expect(200);
    const log = await agent.get(`/api/v1/admin/audit-events?q=${encodeURIComponent('대상회원')}`).expect(200);
    expect(log.body.data.items[0]).toMatchObject({ action: 'user.update', targetId: target.id });

    const developer = await signedIn(t, ['developer']);
    await developer.agent
      .patch(`/api/v1/admin/members/${target.id}`)
      .send({ roles: ['developer'] })
      .expect(200);
  });

  it('정지하면 그 회원의 세션이 즉시 끊긴다', async () => {
    const { agent } = await signedIn(t, ['admin']);
    const target = await signedIn(t);
    await target.agent.get('/api/v1/me/notifications').expect(200);
    await agent.patch(`/api/v1/admin/members/${target.user.id}`).send({ status: 'suspended' }).expect(200);
    await target.agent.get('/api/v1/me/notifications').expect(401);
  });
});
