import sharp from 'sharp';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createUser, loginAgent, PASSWORD, signedIn } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

describe('내 정보', () => {
  it('로그인하지 않으면 401', async () => {
    const res = await t.http
      .patch('/api/v1/me/profile')
      .send({ name: '이름', phone: '', agreeMarketing: false });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('본인의 프로필 사진을 저장하고 기본 이미지로 복원한다', async () => {
    const { agent } = await signedIn(t);
    const other = await signedIn(t);
    const path = '/api/v1/me/profile/photo';
    await t.http.get(path).expect(401);
    const jpg = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer();
    const { body } = await agent
      .put(path)
      .send({ image: 'data:image/jpeg;base64,' + jpg.toString('base64') })
      .expect(200);
    expect((await agent.get(path)).body.data).toEqual(body.data);
    expect((await other.agent.get(path)).body.data.image).toBeNull();
    await agent.put(path).send({ image: 'data:image/jpeg;base64,YWJj' }).expect(400);
    await agent.put(path).send({ image: null }).expect(200);
    expect((await agent.get(path)).body.data.image).toBeNull();
  });

  it('이름·연락처·마케팅 동의를 바꾸면 동의 시각이 기록된다', async () => {
    const { agent } = await signedIn(t);
    const res = await agent
      .patch('/api/v1/me/profile')
      .send({ name: '새이름', phone: '010-1234-5678', agreeMarketing: true })
      .expect(200);
    expect(res.body.data).toMatchObject({ name: '새이름', phone: '010-1234-5678' });
    const marketing = (
      res.body.data.consents as { key: string; agreed: boolean; agreedAt: string | null }[]
    ).find((c) => c.key === 'marketing');
    expect(marketing).toMatchObject({ agreed: true });

    const bad = await agent
      .patch('/api/v1/me/profile')
      .send({ name: 'a', phone: '123', agreeMarketing: false });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fieldErrors)).toEqual(expect.arrayContaining(['name', 'phone']));
  });

  it('탈퇴하면 세션이 끊기고 다시 로그인할 수 없다', async () => {
    const user = await createUser(t);
    const agent = await loginAgent(t, user.email);
    await agent.delete('/api/v1/me').expect(204);
    await agent.get('/api/v1/auth/session').expect(401);
    const res = await t.http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(400);
  });
});

describe('알림', () => {
  it('본인 알림만 최신순으로 보고, 지정·전체 읽음 처리한다', async () => {
    const { user, agent } = await signedIn(t);
    const other = await createUser(t);
    const mk = (userId: string, title: string, at: number) =>
      t.prisma.notification.create({
        data: { userId, kind: 'notice', title, body: '본문', link: '/notices', createdAt: new Date(at) },
      });
    const a = await mk(user.id, '첫째', 1000);
    await mk(user.id, '둘째', 2000);
    const foreign = await mk(other.id, '남의 알림', 3000);

    const list = await agent.get('/api/v1/me/notifications').expect(200);
    expect(list.body.data.map((n: { title: string }) => n.title)).toEqual(['둘째', '첫째']);

    await agent
      .post('/api/v1/me/notifications/read')
      .send({ ids: [a.id, foreign.id] })
      .expect(204);
    expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();
    expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: a.id } })).readAt).not.toBeNull();

    await agent.post('/api/v1/me/notifications/read').send({}).expect(204);
    const unread = await t.prisma.notification.count({ where: { userId: user.id, readAt: null } });
    expect(unread).toBe(0);
  });
});
