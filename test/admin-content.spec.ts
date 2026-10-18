import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createProgram, ensureCategory, signedIn } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

const notice = { title: '휴관 안내', category: 'center', body: '본문입니다', pinned: true, status: 'draft' };

describe('관리자 공지', () => {
  it('회원은 403, 직원은 등록·수정·삭제하고 처음 게시할 때만 게시일을 정한다', async () => {
    const member = await signedIn(t);
    await member.agent.post('/api/v1/admin/notices').send(notice).expect(403);

    const { agent } = await signedIn(t, ['staff']);
    const created = await agent.post('/api/v1/admin/notices').send(notice).expect(201);
    expect(created.body.data).toMatchObject({ status: 'draft', pinned: true, publishedAt: null });
    const id = created.body.data.id as string;

    const published = await agent
      .put(`/api/v1/admin/notices/${id}`)
      .send({ ...notice, status: 'published' })
      .expect(200);
    const firstPublishedAt = published.body.data.publishedAt as string;
    expect(firstPublishedAt).not.toBeNull();
    const edited = await agent
      .put(`/api/v1/admin/notices/${id}`)
      .send({ ...notice, title: '휴관 안내(수정)', status: 'published' })
      .expect(200);
    expect(edited.body.data.publishedAt).toBe(firstPublishedAt);

    const list = await agent.get(`/api/v1/admin/notices?status=published&q=${encodeURIComponent('휴관')}`);
    expect(list.body.data.items.map((n: { id: string }) => n.id)).toContain(id);
    await agent.delete(`/api/v1/admin/notices/${id}`).expect(204);
    await agent.get(`/api/v1/admin/notices/${id}`).expect(404);
    await agent
      .post('/api/v1/admin/notices')
      .send({ ...notice, title: '' })
      .expect(400);
  });
});

describe('관리자 프로그램', () => {
  const form = (categoryId: string, over: Record<string, unknown> = {}) => ({
    title: '여름 캠프',
    categoryId,
    summary: '요약',
    description: '설명',
    target: '중학생',
    place: '센터',
    startsAt: '2027-03-10',
    endsAt: '2027-03-12',
    recruitStartsAt: '2027-02-01',
    recruitEndsAt: '2027-02-20',
    cancelDeadline: '2027-03-01',
    capacity: 20,
    status: 'published',
    ...over,
  });

  it('날짜를 서울 시각(시작 09:00·마감 18:00)으로 저장하고 날짜 순서를 검증한다', async () => {
    const category = await ensureCategory(t);
    const { agent } = await signedIn(t, ['staff']);
    const res = await agent.post('/api/v1/admin/programs').send(form(category.id)).expect(201);
    expect(res.body.data).toMatchObject({
      startsAt: '2027-03-10T00:00:00.000Z',
      recruitEndsAt: '2027-02-20T09:00:00.000Z',
      recruitStatus: 'upcoming',
    });
    await agent
      .post('/api/v1/admin/programs')
      .send(form(category.id, { endsAt: '2027-03-01' }))
      .expect(400);
    await agent.post('/api/v1/admin/programs').send(form('nope')).expect(400);
  });

  it('정원은 신청 인원보다 줄일 수 없고, 신청이 있으면 삭제할 수 없다', async () => {
    const category = await ensureCategory(t);
    const p = await createProgram(t, { capacity: 5 });
    const applicant = await signedIn(t);
    await applicant.agent
      .post(`/api/v1/programs/${p.id}/applications`)
      .send({ phone: '010-1234-5678', note: '', agreePrivacy: 'on' })
      .expect(201);

    const { agent } = await signedIn(t, ['staff']);
    const shrink = await agent.put(`/api/v1/admin/programs/${p.id}`).send(form(category.id, { capacity: 0 }));
    expect(shrink.status).toBe(400);
    const del = await agent.delete(`/api/v1/admin/programs/${p.id}`).expect(409);
    expect(del.body.error.reason).toBe('INVALID_STATE');

    const empty = await createProgram(t);
    await agent.delete(`/api/v1/admin/programs/${empty.id}`).expect(204);
    await agent.get(`/api/v1/admin/programs/${empty.id}`).expect(404);
  });
});

describe('관리자 FAQ·정책 문서', () => {
  it('FAQ 를 관리하고, 정책 개정은 최고 관리자만 하며 확정본으로 표시한다', async () => {
    const staff = await signedIn(t, ['staff']);
    const faq = await staff.agent
      .post('/api/v1/admin/faqs')
      .send({ category: 'etc', question: '주차되나요?', answer: '네, 가능합니다.', order: 1 })
      .expect(201);
    expect(faq.body.data.published).toBe(false);
    await staff.agent
      .put(`/api/v1/admin/faqs/${faq.body.data.id}`)
      .send({ category: 'etc', question: '주차되나요?', answer: '네.', order: 1, published: true })
      .expect(200);
    await staff.agent.delete(`/api/v1/admin/faqs/${faq.body.data.id}`).expect(204);

    await t.prisma.policy.upsert({
      where: { key: 'terms' },
      create: { key: 'terms', title: '이용약관', body: '초안' },
      update: {},
    });
    const update = { body: '제1조 목적 — 이 약관은 ...', effectiveAt: '2027-01-01' };
    await staff.agent.put('/api/v1/admin/policies/terms').send(update).expect(403);
    const { agent } = await signedIn(t, ['admin']);
    const res = await agent.put('/api/v1/admin/policies/terms').send(update).expect(200);
    expect(res.body.data).toMatchObject({ confirmed: true, effectiveAt: '2026-12-31T15:00:00.000Z' });
    await agent.put('/api/v1/admin/policies/nope').send(update).expect(404);

    const log = await agent.get(`/api/v1/admin/audit-events?q=${encodeURIComponent('이용약관')}`).expect(200);
    expect(log.body.data.items[0]).toMatchObject({ action: 'policy.update', targetId: 'terms' });
  });
});
