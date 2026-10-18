import supertest from 'supertest';
import { addDays, weekdayOf } from '../src/shared/domain/space';
import { todayKst } from '../src/shared/lib/format';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { createSpace, createUser, loginAgent, signedIn } from './fixtures';

let t: TestContext;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(() => clearRateLimits(t));

/** 내일 이후 첫 평일 (09–21시 예약 가능) */
const weekday = (() => {
  for (let i = 1; ; i += 1) {
    const d = addDays(todayKst(), i);
    if (weekdayOf(d) >= 1 && weekdayOf(d) <= 5) return d;
  }
})();
const sunday = (() => {
  for (let i = 1; ; i += 1) {
    const d = addDays(todayKst(), i);
    if (weekdayOf(d) === 0) return d;
  }
})();
const body = (over: Record<string, unknown> = {}) => ({
  date: weekday,
  startTime: '10:00',
  endTime: '12:00',
  headcount: 4,
  phone: '010-1234-5678',
  purpose: '동아리 정기 모임',
  agreePrivacy: 'on',
  ...over,
});

describe('공간 조회', () => {
  it('누구나 목록·상세·예약 가능 시간을 보고, 대기·확정 예약 시간은 막혀 있다', async () => {
    const s = await createSpace(t);
    const http = supertest(t.app.getHttpServer());
    const list = await http.get('/api/v1/spaces').expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(s.id);
    await http.get(`/api/v1/spaces/${s.id}`).expect(200);
    await http.get('/api/v1/spaces/nope').expect(404);
    await http.get(`/api/v1/spaces/${s.id}/availability?date=tomorrow`).expect(400);

    const { agent } = await signedIn(t);
    await agent.post(`/api/v1/spaces/${s.id}/reservations`).send(body()).expect(201);
    const slots = await http.get(`/api/v1/spaces/${s.id}/availability?date=${weekday}`).expect(200);
    const taken = slots.body.data.filter((x: { available: boolean }) => !x.available);
    expect(taken.map((x: { start: string }) => x.start)).toEqual(['10:00', '11:00']);
    const closed = await http.get(`/api/v1/spaces/${s.id}/availability?date=${sunday}`).expect(200);
    expect(closed.body.data).toEqual([]);
  });
});

describe('공간 예약', () => {
  it('로그인해야 예약하고, 대기 상태로 접수되며 전화번호는 숫자만 저장한다', async () => {
    const s = await createSpace(t);
    await t.http.post(`/api/v1/spaces/${s.id}/reservations`).send(body()).expect(401);
    const { user, agent } = await signedIn(t);
    const res = await agent.post(`/api/v1/spaces/${s.id}/reservations`).send(body()).expect(201);
    expect(res.body.data).toMatchObject({
      status: 'pending',
      spaceName: s.name,
      applicantName: user.name,
      phone: '01012345678',
      cancellable: true,
    });
  });

  it('시간 규칙·수용 인원·예약 중지를 서버가 검사한다', async () => {
    const s = await createSpace(t, { capacity: 5 });
    const { agent } = await signedIn(t);
    const post = (over: Record<string, unknown>, id = s.id) =>
      agent.post(`/api/v1/spaces/${id}/reservations`).send(body(over));

    expect((await post({ date: todayKst() })).status).toBe(400);
    expect((await post({ date: addDays(todayKst(), 31) })).status).toBe(400);
    expect((await post({ date: sunday })).status).toBe(400);
    expect((await post({ startTime: '08:00' })).status).toBe(400);
    expect((await post({ startTime: '10:00', endTime: '14:00' })).status).toBe(400);
    const over = await post({ headcount: 6 });
    expect(over.status).toBe(400);
    expect(over.body.error.fieldErrors.headcount).toBeDefined();

    const off = await createSpace(t, { reservable: false });
    const closed = await post({}, off.id);
    expect(closed.status).toBe(409);
    expect(closed.body.error.reason).toBe('RECRUIT_CLOSED');
  });

  it('겹치는 시간은 동시에 요청해도 하나만 접수된다', async () => {
    const s = await createSpace(t);
    const users = await Promise.all(Array.from({ length: 4 }, () => createUser(t)));
    const agents = await Promise.all(users.map((u) => loginAgent(t, u.email)));
    const results = await Promise.all(
      agents.map((a, i) =>
        a
          .post(`/api/v1/spaces/${s.id}/reservations`)
          .send(body({ startTime: i % 2 ? '10:00' : '11:00', endTime: i % 2 ? '12:00' : '13:00' })),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.reason === 'DUPLICATE')).toBe(
      true,
    );
    // 맞닿은 시간은 겹치지 않는다
    const { agent } = await signedIn(t);
    const winner = results.find((r) => r.status === 201)!.body.data;
    await agent
      .post(`/api/v1/spaces/${s.id}/reservations`)
      .send(body({ startTime: winner.endTime, endTime: '15:00' }))
      .expect(201);
  });
});

describe('내 예약', () => {
  it('본인 예약만 보이고, 이용일 전에는 취소하며 취소하면 시간이 다시 열린다', async () => {
    const s = await createSpace(t);
    const { agent } = await signedIn(t);
    const created = await agent.post(`/api/v1/spaces/${s.id}/reservations`).send(body()).expect(201);
    const id = created.body.data.id as string;

    const list = await agent.get('/api/v1/me/reservations').expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([id]);
    const other = await signedIn(t);
    expect((await other.agent.get('/api/v1/me/reservations').expect(200)).body.data).toEqual([]);
    await other.agent.post(`/api/v1/me/reservations/${id}/cancel`).expect(404);

    const cancelled = await agent.post(`/api/v1/me/reservations/${id}/cancel`).expect(201);
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', cancellable: false });
    const again = await agent.post(`/api/v1/me/reservations/${id}/cancel`).expect(409);
    expect(again.body.error.reason).toBe('INVALID_STATE');
    await other.agent.post(`/api/v1/spaces/${s.id}/reservations`).send(body()).expect(201);
  });

  it('이용일이 지났거나 오늘이면 취소할 수 없다', async () => {
    const s = await createSpace(t);
    const { user, agent } = await signedIn(t);
    const r = await t.prisma.spaceReservation.create({
      data: {
        spaceId: s.id,
        userId: user.id,
        applicantName: user.name,
        phone: '01012345678',
        date: todayKst(),
        startTime: '10:00',
        endTime: '11:00',
        headcount: 1,
        purpose: '오늘 이용',
      },
    });
    const res = await agent.post(`/api/v1/me/reservations/${r.id}/cancel`).expect(409);
    expect(res.body.error.reason).toBe('INVALID_STATE');
  });
});
