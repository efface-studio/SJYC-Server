import supertest from 'supertest';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createProgram, createUser, loginAgent, signedIn } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

const apply = { phone: '010-1234-5678', note: '', agreePrivacy: 'on' };

describe('프로그램 조회', () => {
  it('게시된 것만, 모집 중 → 예정 → 마감 순으로 보여주고 검색·상태로 거른다', async () => {
    const tag = `조회${Date.now()}`;
    const open = await createProgram(t, { title: `${tag} 모집중` });
    await createProgram(t, { title: `${tag} 예정`, recruitStartsInDays: 3 });
    await createProgram(t, { title: `${tag} 마감`, recruitEndsInDays: -1 });
    await createProgram(t, { title: `${tag} 비공개`, status: 'draft' });

    const res = await t.http.get(`/api/v1/programs?q=${encodeURIComponent(tag)}`).expect(200);
    expect(res.body.data.items.map((p: { title: string }) => p.title)).toEqual([
      `${tag} 모집중`,
      `${tag} 예정`,
      `${tag} 마감`,
    ]);
    expect(res.body.data).toMatchObject({ total: 3, page: 1, pageSize: 9 });
    const onlyOpen = await t.http.get(`/api/v1/programs?q=${encodeURIComponent(tag)}&recruitStatus=open`);
    expect(onlyOpen.body.data.items.map((p: { id: string }) => p.id)).toEqual([open.id]);

    const draft = await createProgram(t, { status: 'draft' });
    await t.http.get(`/api/v1/programs/${draft.id}`).expect(404);
    const one = await t.http.get(`/api/v1/programs/${open.id}`).expect(200);
    expect(one.body.data).toMatchObject({ id: open.id, recruitStatus: 'open', appliedCount: 0 });
  });
});

describe('프로그램 신청', () => {
  it('로그인해야 신청하고, 접수 번호는 서버가 발급하며 중복 신청은 막는다', async () => {
    const p = await createProgram(t);
    await t.http.post(`/api/v1/programs/${p.id}/applications`).send(apply).expect(401);
    const { agent } = await signedIn(t);
    const res = await agent.post(`/api/v1/programs/${p.id}/applications`).send(apply).expect(201);
    expect(res.body.data).toMatchObject({ status: 'submitted', programTitle: p.title, cancellable: true });
    expect(res.body.data.receiptNo).toMatch(/^SJYC-\d{4}-\d{6}$/);

    const dup = await agent.post(`/api/v1/programs/${p.id}/applications`).send(apply).expect(409);
    expect(dup.body.error.reason).toBe('DUPLICATE');
    const bad = await agent.post(`/api/v1/programs/${p.id}/applications`).send({ ...apply, phone: '12' });
    expect(bad.status).toBe(400);
  });

  it('모집 기간이 아니면 RECRUIT_CLOSED', async () => {
    const p = await createProgram(t, { recruitStartsInDays: 2 });
    const { agent } = await signedIn(t);
    const res = await agent.post(`/api/v1/programs/${p.id}/applications`).send(apply).expect(409);
    expect(res.body.error.reason).toBe('RECRUIT_CLOSED');
  });

  it('동시에 신청해도 정원을 넘지 않는다', async () => {
    const p = await createProgram(t, { capacity: 2 });
    const users = await Promise.all(Array.from({ length: 5 }, () => createUser(t)));
    const agents = await Promise.all(users.map((u) => loginAgent(t, u.email)));
    const results = await Promise.all(
      agents.map((a) => a.post(`/api/v1/programs/${p.id}/applications`).send(apply)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.reason === 'CAPACITY_FULL'),
    ).toBe(true);
    expect((await t.prisma.program.findUniqueOrThrow({ where: { id: p.id } })).appliedCount).toBe(2);
  });
});

describe('내 신청', () => {
  it('본인 신청만 보이고, 기한 안에는 취소하며 정원이 돌아온다', async () => {
    const p = await createProgram(t, { capacity: 1 });
    const { agent } = await signedIn(t);
    const created = await agent.post(`/api/v1/programs/${p.id}/applications`).send(apply).expect(201);
    const id = created.body.data.id as string;

    const list = await agent.get('/api/v1/me/applications').expect(200);
    expect(list.body.data.map((a: { id: string }) => a.id)).toContain(id);
    const other = await signedIn(t);
    await other.agent.get(`/api/v1/me/applications/${id}`).expect(404);
    await other.agent.post(`/api/v1/me/applications/${id}/cancel`).expect(404);

    const cancelled = await agent.post(`/api/v1/me/applications/${id}/cancel`).expect(201);
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', cancellable: false });
    expect(cancelled.body.data.history.map((h: { status: string }) => h.status)).toEqual([
      'submitted',
      'cancelled',
    ]);
    expect((await t.prisma.program.findUniqueOrThrow({ where: { id: p.id } })).appliedCount).toBe(0);
    await agent.post(`/api/v1/me/applications/${id}/cancel`).expect(409);
  });

  it('취소 기한이 지나면 취소할 수 없다', async () => {
    const p = await createProgram(t, { cancelDeadlineInDays: -1 });
    const { agent } = await signedIn(t);
    const created = await agent.post(`/api/v1/programs/${p.id}/applications`).send(apply).expect(201);
    expect(created.body.data.cancellable).toBe(false);
    const res = await agent.post(`/api/v1/me/applications/${created.body.data.id}/cancel`).expect(409);
    expect(res.body.error.reason).toBe('CANCEL_DEADLINE_PASSED');
  });

  it('분류 목록은 누구나 본다', async () => {
    const res = await supertest(t.app.getHttpServer()).get('/api/v1/program-categories').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('신청 내용 수정', () => {
  it('작성자만 변경하며 동시 편집과 재전송에도 원문과 수정 이력을 보존한다', async () => {
    const target = await createProgram(t);
    const { agent } = await signedIn(t);
    const other = await signedIn(t);
    const reviewer = await signedIn(t, ['admin']);
    const result = await agent.post(`/api/v1/programs/${target.id}/applications`).send(apply).expect(201);
    const path = `/api/v1/me/applications/${result.body.data.id}`;
    const edits = ['첫 번째로 변경한 신청 내용입니다.', '두 번째로 변경한 신청 내용입니다.'];
    await other.agent.patch(path).send({ value: edits[0], revision: 0 }).expect(404);
    const attempts = await Promise.all(edits.map((value) => agent.patch(path).send({ value, revision: 0 })));
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = attempts.find((r) => r.status === 200)!.body.data;
    expect(saved.contentEdits).toEqual([{ previous: apply.note, next: saved.note, at: expect.any(String) }]);
    const retry = await agent.patch(path).send({ value: saved.note, revision: 0 }).expect(200);
    expect(retry.body.data.contentEdits).toEqual(saved.contentEdits);
    const next = await agent.patch(path).send({ value: apply.note, revision: 1 }).expect(200);
    expect(next.body.data.contentEdits).toHaveLength(2);
    const admin = await reviewer.agent.get(`/api/v1/admin/applications/${saved.id}`).expect(200);
    expect(admin.body.data.contentEdits).toEqual(next.body.data.contentEdits);
  });
});
