import supertest from 'supertest';
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

let n = 0;
const createClub = (opts: { recruiting?: boolean; status?: 'active' | 'inactive' } = {}) =>
  t.prisma.club.create({
    data: {
      name: `동아리 ${Date.now()}${++n}`,
      field: '음악',
      summary: '요약',
      description: '설명',
      meetingInfo: '매주 토요일',
      recruiting: opts.recruiting ?? true,
      status: opts.status ?? 'active',
      photos: [{ url: '/p.jpg', caption: '공연', sourceUrl: 'https://example.org', date: null }],
      sourceUrls: ['https://example.org'],
    },
  });
const join = (clubId: string, userId: string, role: 'leader' | 'member' = 'member') =>
  t.prisma.clubMembership.create({ data: { clubId, userId, role } });
const apply = { motivation: '밴드 활동을 함께 하고 싶습니다.', agreePrivacy: 'on' };

describe('동아리 조회', () => {
  it('활동 중인 동아리만 보이고, 회원 수는 가입 기록으로 센다', async () => {
    const c = await createClub();
    const off = await createClub({ status: 'inactive' });
    await join(c.id, (await createUser(t)).id);
    const http = supertest(t.app.getHttpServer());

    const list = await http.get('/api/v1/clubs').expect(200);
    const ids = list.body.data.map((x: { id: string }) => x.id);
    expect(ids).toContain(c.id);
    expect(ids).not.toContain(off.id);
    const one = await http.get(`/api/v1/clubs/${c.id}`).expect(200);
    expect(one.body.data).toMatchObject({ memberCount: 1, recruiting: true, photos: [{ caption: '공연' }] });
    await http.get(`/api/v1/clubs/${off.id}`).expect(404);
  });

  it('명단·소식은 동아리원만 보고, 이름은 가린다', async () => {
    const c = await createClub();
    const leader = await createUser(t, { name: '김리더' });
    await join(c.id, leader.id, 'leader');
    await t.prisma.clubPost.create({ data: { clubId: c.id, kind: 'notice', title: '공지', body: '본문' } });
    const { user, agent } = await signedIn(t);
    await agent.get(`/api/v1/clubs/${c.id}/members`).expect(403);
    await agent.get(`/api/v1/clubs/${c.id}/posts`).expect(403);
    await t.http.get(`/api/v1/clubs/${c.id}/members`).expect(401);

    await join(c.id, user.id);
    const members = await agent.get(`/api/v1/clubs/${c.id}/members`).expect(200);
    expect(members.body.data[0]).toMatchObject({ displayName: '김*더', role: 'leader' });
    expect(JSON.stringify(members.body.data)).not.toContain('김리더');
    const posts = await agent.get(`/api/v1/clubs/${c.id}/posts`).expect(200);
    expect(posts.body.data).toMatchObject([{ kind: 'notice', title: '공지' }]);
  });
});

describe('가입 신청', () => {
  it('모집 중일 때 검토 중으로 접수하고, 중복·가입한 동아리·모집 마감은 막는다', async () => {
    const c = await createClub();
    const { user, agent } = await signedIn(t);
    const res = await agent.post(`/api/v1/clubs/${c.id}/applications`).send(apply).expect(201);
    expect(res.body.data).toMatchObject({ status: 'pending', clubName: c.name, applicantName: user.name });
    const dup = await agent.post(`/api/v1/clubs/${c.id}/applications`).send(apply).expect(409);
    expect(dup.body.error.reason).toBe('DUPLICATE');
    const short = await agent
      .post(`/api/v1/clubs/${c.id}/applications`)
      .send({ ...apply, motivation: '짧음' });
    expect(short.status).toBe(400);

    const mine = await agent.get('/api/v1/me/club-applications').expect(200);
    expect(mine.body.data.map((a: { id: string }) => a.id)).toEqual([res.body.data.id]);

    const joined = await createClub();
    await join(joined.id, user.id);
    const already = await agent.post(`/api/v1/clubs/${joined.id}/applications`).send(apply).expect(409);
    expect(already.body.error.reason).toBe('DUPLICATE');
    const myClubs = await agent.get('/api/v1/me/clubs').expect(200);
    expect(myClubs.body.data).toMatchObject([{ club: { id: joined.id, memberCount: 1 }, role: 'member' }]);

    const closed = await createClub({ recruiting: false });
    const r = await agent.post(`/api/v1/clubs/${closed.id}/applications`).send(apply).expect(409);
    expect(r.body.error.reason).toBe('RECRUIT_CLOSED');
  });

  it('동시에 여러 번 눌러도 검토 중 신청은 1건', async () => {
    const c = await createClub();
    const u = await createUser(t);
    const agents = await Promise.all([1, 2, 3].map(() => loginAgent(t, u.email)));
    const results = await Promise.all(
      agents.map((a) => a.post(`/api/v1/clubs/${c.id}/applications`).send(apply)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await t.prisma.clubApplication.count({ where: { clubId: c.id } })).toBe(1);
  });
});
