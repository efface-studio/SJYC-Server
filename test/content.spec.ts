import supertest from 'supertest';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { signedIn } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

const http = () => supertest(t.app.getHttpServer());
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

describe('공지', () => {
  it('게시된 것만, 고정 공지 먼저 최신순으로 보여주고 분류·검색·페이지를 지원한다', async () => {
    const tag = `공지${Date.now()}`;
    const make = (title: string, extra: object = {}) =>
      t.prisma.notice.create({
        data: { title: `${tag} ${title}`, category: 'center', body: '본문', status: 'published', ...extra },
      });
    await make('오래된', { publishedAt: ago(5) });
    await make('최신', { publishedAt: ago(1) });
    const pinned = await make('고정', { publishedAt: ago(9), pinned: true });
    const draft = await make('임시', { status: 'draft' });
    await make('청소년', { publishedAt: ago(2), category: 'youth' });

    const res = await http()
      .get(`/api/v1/notices?q=${encodeURIComponent(tag)}`)
      .expect(200);
    expect(res.body.data.items.map((n: { title: string }) => n.title.replace(`${tag} `, ''))).toEqual([
      '고정',
      '최신',
      '청소년',
      '오래된',
    ]);
    expect(res.body.data).toMatchObject({ total: 4, page: 1, pageSize: 10 });
    const youth = await http().get(`/api/v1/notices?q=${encodeURIComponent(tag)}&category=youth`);
    expect(youth.body.data.total).toBe(1);
    const page2 = await http().get(`/api/v1/notices?q=${encodeURIComponent(tag)}&pageSize=3&page=2`);
    expect(page2.body.data.items).toHaveLength(1);

    await http().get(`/api/v1/notices/${pinned.id}`).expect(200);
    await http().get(`/api/v1/notices/${draft.id}`).expect(404);
  });
});

describe('FAQ·정책·센터 소식', () => {
  it('공개 FAQ 를 순서대로, 정책 문서를 키로, 센터 소식을 최신순으로 보여준다', async () => {
    await t.prisma.faq.createMany({
      data: [
        { category: 'program', question: '둘째', answer: '답', order: 2 },
        { category: 'program', question: '첫째', answer: '답', order: 1 },
        { category: 'program', question: '숨김', answer: '답', order: 0, published: false },
      ],
    });
    const faqs = await http().get('/api/v1/faqs').expect(200);
    expect(faqs.body.data.map((f: { question: string }) => f.question)).toEqual(['첫째', '둘째']);

    await t.prisma.policy.upsert({
      where: { key: 'privacy' },
      create: { key: 'privacy', title: '개인정보 처리방침', body: '본문' },
      update: {},
    });
    const policy = await http().get('/api/v1/policies/privacy').expect(200);
    expect(policy.body.data).toMatchObject({ key: 'privacy', confirmed: false, effectiveAt: null });
    await http().get('/api/v1/policies/nope').expect(404);

    const base = {
      kind: 'photo' as const,
      url: '/a.jpg',
      thumbnailUrl: '/a.jpg',
      sourceUrl: 'https://example.org',
    };
    await t.prisma.mediaItem.createMany({
      data: [
        { ...base, title: '날짜 없음', date: null },
        { ...base, title: '이전', date: '2026-03-01' },
        { ...base, title: '최근', date: '2026-09-01' },
      ],
    });
    const media = await http().get('/api/v1/media').expect(200);
    expect(media.body.data.map((m: { title: string }) => m.title)).toEqual(['최근', '이전', '날짜 없음']);
  });
});

describe('1:1 문의', () => {
  const input = {
    category: 'space',
    title: '대관 문의',
    body: '주말에도 이용할 수 있나요?',
    agreePrivacy: 'on',
  };

  it('로그인해야 쓰고, 본인 문의만 보며 입력을 검증한다', async () => {
    await t.http.post('/api/v1/inquiries').send(input).expect(401);
    const { user, agent } = await signedIn(t);
    const created = await agent.post('/api/v1/inquiries').send(input).expect(201);
    expect(created.body.data).toMatchObject({ status: 'open', authorName: user.name, answer: null });
    const bad = await agent.post('/api/v1/inquiries').send({ ...input, body: '짧음' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fieldErrors.body).toBeDefined();

    const list = await agent.get('/api/v1/me/inquiries').expect(200);
    expect(list.body.data.map((q: { id: string }) => q.id)).toEqual([created.body.data.id]);
    await agent.get(`/api/v1/me/inquiries/${created.body.data.id}`).expect(200);
    const other = await signedIn(t);
    await other.agent.get(`/api/v1/me/inquiries/${created.body.data.id}`).expect(404);
  });

  it('답변이 등록되면 함께 내려온다', async () => {
    const { user, agent } = await signedIn(t);
    const q = await t.prisma.inquiry.create({
      data: {
        userId: user.id,
        authorName: user.name,
        category: 'etc',
        title: '질문',
        body: '내용입니다',
        status: 'answered',
        answerBody: '답변입니다',
        answeredAt: new Date(),
        answeredBy: '센터',
      },
    });
    const res = await agent.get(`/api/v1/me/inquiries/${q.id}`).expect(200);
    expect(res.body.data.answer).toMatchObject({ body: '답변입니다', answeredBy: '센터' });
  });
});
