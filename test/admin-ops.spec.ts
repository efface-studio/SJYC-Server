import { addDays, weekdayOf } from '../src/shared/domain/space';
import { todayKst } from '../src/shared/lib/format';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createProgram, createSpace, createUser, loginAgent, signedIn } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

const apply = { phone: '010-1234-5678', note: '', agreePrivacy: 'on' };
const notificationsOf = (userId: string) =>
  t.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

describe('프로그램 신청 처리', () => {
  it('일괄 승인·반려는 접수 건만 처리하고, 반려는 사유가 필요하며 정원을 돌려준다', async () => {
    const p = await createProgram(t, { capacity: 5 });
    const users = await Promise.all([1, 2, 3].map(() => createUser(t)));
    const ids: string[] = [];
    for (const u of users) {
      const agent = await loginAgent(t, u.email);
      const res = await agent.post(`/api/v1/programs/${p.id}/applications`).send(apply).expect(201);
      ids.push(res.body.data.id);
    }
    const { agent } = await signedIn(t, ['staff']);

    await agent
      .post('/api/v1/admin/applications/decisions')
      .send({ ids: [ids[0]], decision: 'rejected' })
      .expect(400);
    const approved = await agent
      .post('/api/v1/admin/applications/decisions')
      .send({ ids: [ids[0], 'missing'], decision: 'approved' })
      .expect(200);
    expect(approved.body.data.succeeded).toEqual([ids[0]]);
    expect(approved.body.data.failed).toEqual([{ id: 'missing', reason: '신청을 찾을 수 없습니다.' }]);

    const rejected = await agent
      .post('/api/v1/admin/applications/decisions')
      .send({ ids: [ids[0], ids[1]], decision: 'rejected', reason: '대상 연령이 아닙니다' })
      .expect(200);
    expect(rejected.body.data.succeeded).toEqual([ids[1]]);
    expect(rejected.body.data.failed[0].id).toBe(ids[0]);
    expect((await t.prisma.program.findUniqueOrThrow({ where: { id: p.id } })).appliedCount).toBe(2);

    const [n] = await notificationsOf(users[1]!.id);
    expect(n).toMatchObject({ kind: 'application', title: '프로그램 신청이 반려되었습니다' });
    expect(n!.body).toContain('대상 연령이 아닙니다');
    const one = await agent.get(`/api/v1/admin/applications/${ids[1]}`).expect(200);
    expect(one.body.data.history.map((h: { status: string }) => h.status)).toEqual(['submitted', 'rejected']);
    const list = await agent.get(`/api/v1/admin/applications?programId=${p.id}&status=submitted`).expect(200);
    expect(list.body.data.items.map((a: { id: string }) => a.id)).toEqual([ids[2]]);
  });
});

describe('공간 예약 처리', () => {
  it('대기 예약만 확정·반려하고 신청자에게 알린다, 공간 예약 중지도 바꾼다', async () => {
    const s = await createSpace(t);
    let date = addDays(todayKst(), 1);
    while (weekdayOf(date) === 0 || weekdayOf(date) === 6) date = addDays(date, 1);
    const user = await signedIn(t);
    const r = await user.agent
      .post(`/api/v1/spaces/${s.id}/reservations`)
      .send({
        date,
        startTime: '10:00',
        endTime: '11:00',
        headcount: 2,
        phone: '01012345678',
        purpose: '스터디 모임',
        agreePrivacy: 'on',
      })
      .expect(201);

    const { agent } = await signedIn(t, ['staff']);
    const ok = await agent
      .post(`/api/v1/admin/reservations/${r.body.data.id}/decision`)
      .send({ decision: 'approved' })
      .expect(200);
    expect(ok.body.data.status).toBe('approved');
    const again = await agent
      .post(`/api/v1/admin/reservations/${r.body.data.id}/decision`)
      .send({ decision: 'rejected', reason: '점검' })
      .expect(409);
    expect(again.body.error.reason).toBe('INVALID_STATE');
    expect((await notificationsOf(user.user.id))[0]).toMatchObject({
      kind: 'reservation',
      title: '공간 예약이 확정되었습니다',
    });

    const listed = await agent.get(`/api/v1/admin/reservations?spaceId=${s.id}&date=${date}`).expect(200);
    expect(listed.body.data.total).toBe(1);
    const off = await agent
      .put(`/api/v1/admin/spaces/${s.id}`)
      .send({ description: '점검 중', capacity: 10, reservable: false })
      .expect(200);
    expect(off.body.data.reservable).toBe(false);
  });
});

describe('문의 답변', () => {
  it('답변하면 상태가 바뀌고 작성자에게 알린다', async () => {
    const user = await signedIn(t);
    const q = await user.agent
      .post('/api/v1/inquiries')
      .send({ category: 'etc', title: '주차 문의', body: '센터에 주차할 수 있나요?', agreePrivacy: 'on' })
      .expect(201);
    const { user: staff, agent } = await signedIn(t, ['staff']);
    const open = await agent.get('/api/v1/admin/inquiries?status=open').expect(200);
    expect(open.body.data.items.map((x: { id: string }) => x.id)).toContain(q.body.data.id);
    const res = await agent
      .put(`/api/v1/admin/inquiries/${q.body.data.id}/answer`)
      .send({ body: '지하 주차장을 이용하실 수 있습니다.' })
      .expect(200);
    expect(res.body.data).toMatchObject({ status: 'answered', answer: { answeredBy: staff.name } });
    expect((await notificationsOf(user.user.id))[0]).toMatchObject({
      kind: 'inquiry',
      link: `/qna/${q.body.data.id}`,
    });
  });
});

describe('동아리 관리', () => {
  const club = {
    name: '밴드부',
    field: '음악',
    summary: '함께 연주해요',
    description: '소개',
    meetingInfo: '매주 토요일',
    recruiting: true,
    status: 'active',
  };

  it('등록·가입 승인(회원 등록)·담당자 지정/해제를 처리한다', async () => {
    const { agent } = await signedIn(t, ['staff']);
    const created = await agent
      .post('/api/v1/admin/clubs')
      .send({ ...club, name: `밴드부${Date.now()}` })
      .expect(201);
    const clubId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ memberCount: 0, photos: [], recruiting: true });

    const applicant = await signedIn(t);
    const a = await applicant.agent
      .post(`/api/v1/clubs/${clubId}/applications`)
      .send({ motivation: '드럼을 배우고 싶습니다.', agreePrivacy: 'on' })
      .expect(201);
    const decide = (decision: string) =>
      agent.post(`/api/v1/admin/club-applications/${a.body.data.id}/decision`).send({ decision });
    expect((await decide('approved')).status).toBe(200);
    expect((await agent.get(`/api/v1/admin/clubs/${clubId}`)).body.data.memberCount).toBe(1);
    expect((await decide('approved')).status).toBe(409);

    const manager = await createUser(t);
    const managersUrl = `/api/v1/admin/clubs/${clubId}/managers`;
    await agent.post(managersUrl).send({ email: 'nobody@test.local' }).expect(400);
    await agent.post(managersUrl).send({ email: manager.email.toUpperCase() }).expect(201);
    const dup = await agent.post(managersUrl).send({ email: manager.email }).expect(409);
    expect(dup.body.error.reason).toBe('DUPLICATE');
    const managers = await agent.get(managersUrl).expect(200);
    expect(managers.body.data).toMatchObject([{ userId: manager.id, email: manager.email }]);
    const session = await (await loginAgent(t, manager.email)).get('/api/v1/auth/session');
    expect(session.body.data.user.managedClubIds).toEqual([clubId]);

    await agent.delete(`${managersUrl}/${manager.id}`).expect(204);
    await agent.delete(`${managersUrl}/${manager.id}`).expect(404);
    const member = await signedIn(t);
    await member.agent.get('/api/v1/admin/clubs').expect(403);
  });
});
