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
async function clubWith(memberNames: string[]) {
  const club = await t.prisma.club.create({
    data: {
      name: `출석${Date.now()}${++n}`,
      field: '음악',
      summary: '-',
      description: '-',
      meetingInfo: '-',
    },
  });
  const members = [];
  for (const name of memberNames) {
    const u = await createUser(t, { name });
    await t.prisma.clubMembership.create({ data: { clubId: club.id, userId: u.id } });
    members.push(u);
  }
  return { club, members };
}

async function managerOf(clubId: string) {
  const u = await createUser(t);
  await t.prisma.clubManager.create({ data: { clubId, userId: u.id } });
  return { user: u, agent: await loginAgent(t, u.email) };
}

describe('출석부', () => {
  it('여러 회차를 동시에 열어도 각 코드가 발급된 회차만 출석시킨다', async () => {
    const { club, members } = await clubWith(['회원']);
    const { agent } = await managerOf(club.id);
    const pupil = await loginAgent(t, members[0]!.email);
    const sessions = await Promise.all(
      ['A', 'B', 'C'].map(async (title) => {
        const response = await agent
          .post('/api/v1/attendance/sessions')
          .send({ targetType: 'club', targetId: club.id, title, date: '2026-11-25' })
          .expect(201);
        return response.body.data.id as string;
      }),
    );
    const issued = await Promise.all(
      sessions.map(async (id) => {
        const response = await agent
          .post(`/api/v1/attendance/sessions/${id}/check-in`)
          .send({ open: true })
          .expect(200);
        return response.body.data.checkInCode as string;
      }),
    );
    expect(new Set(issued).size).toBe(sessions.length);
    for (const [index, code] of issued.entries()) {
      expect(code).toMatch(/^\d{4}$/);
      const result = await pupil.post('/api/v1/me/attendance/check-in').send({ code }).expect(200);
      expect(result.body.data.sessionId).toBe(sessions[index]);
    }
  });

  it('담당자는 자기 동아리만 관리하고, 회차를 만들면 명단이 채워진다', async () => {
    const { club, members } = await clubWith(['나회원', '가회원']);
    const other = await clubWith([]);
    const { agent } = await managerOf(club.id);

    const targets = await agent.get('/api/v1/attendance/targets').expect(200);
    expect(targets.body.data).toEqual([
      { type: 'club', id: club.id, name: club.name, rosterCount: 2, sessionCount: 0 },
    ]);
    await agent
      .post('/api/v1/attendance/sessions')
      .send({ targetType: 'club', targetId: other.club.id, date: '2026-10-20', title: '정기 모임' })
      .expect(403);
    const created = await agent
      .post('/api/v1/attendance/sessions')
      .send({ targetType: 'club', targetId: club.id, date: '2026-10-20', title: '정기 모임' })
      .expect(201);
    expect(created.body.data.records.map((r: { name: string }) => r.name)).toEqual(['가회원', '나회원']);

    const id = created.body.data.id as string;
    const outsider = await createUser(t);
    await agent
      .put(`/api/v1/attendance/sessions/${id}/records`)
      .send({ marks: [{ userId: outsider.id, status: 'present' }] })
      .expect(400);
    const marked = await agent
      .put(`/api/v1/attendance/sessions/${id}/records`)
      .send({
        marks: [
          { userId: members[0]!.id, status: 'late', note: '10분 지각' },
          { userId: members[1]!.id, status: 'absent' },
        ],
      })
      .expect(200);
    expect(
      marked.body.data.records.find((r: { userId: string }) => r.userId === members[0]!.id),
    ).toMatchObject({
      status: 'late',
      method: 'manager',
      note: '10분 지각',
    });
    const stats = await agent.get(`/api/v1/attendance/stats?targetType=club&targetId=${club.id}`).expect(200);
    expect(stats.body.data.map((s: { rate: number }) => s.rate)).toEqual([0, 100]);

    const member = await signedIn(t);
    await member.agent.get('/api/v1/attendance/targets').expect(403);
    await member.agent.get(`/api/v1/attendance/sessions/${id}`).expect(403);
  });

  it('동아리 QR은 명단·현재 위치·생성 반경·회차를 검증하고 수동 입력을 분리한다', async () => {
    const { club, members } = await clubWith(['현장회원', '원격회원']);
    const staff = await signedIn(t, ['staff']);
    const first = await loginAgent(t, members[0]!.email),
      second = await loginAgent(t, members[1]!.email);
    const outsider = await signedIn(t, ['member']);
    const created = await staff.agent
      .post('/api/v1/attendance/sessions')
      .send({ targetType: 'club', targetId: club.id, date: '2026-11-25', title: '현장 확인' })
      .expect(201);
    const path = '/api/v1/attendance/sessions/' + created.body.data.id + '/check-in',
      scan = '/api/v1/me/attendance/scan';
    const origin = { latitude: 37.55, longitude: 127.0, accuracy: 5, measuredAt: Date.now() };
    await staff.agent
      .post(path)
      .send({ open: true, position: { ...origin, measuredAt: Date.now() - 120000 } })
      .expect(400);
    const opened = (await staff.agent.post(path).send({ open: true, position: origin }).expect(200)).body
      .data;
    expect(opened.qrTicket).toMatch(/^\d{16}$/);
    expect(opened).not.toHaveProperty('position');
    const ticket = opened.qrTicket,
      code = opened.checkInCode;
    await first.post(scan).send({ kind: 'club', ticket }).expect(400);
    await first
      .post(scan)
      .send({ kind: 'club', ticket, position: { ...origin, accuracy: 400 } })
      .expect(400);
    await first
      .post(scan)
      .send({ kind: 'club', ticket, position: { ...origin, latitude: 37.551 } })
      .expect(400);
    await first
      .post(scan)
      .send({ kind: 'club', ticket, position: { ...origin, measuredAt: Date.now() - 70000 } })
      .expect(400);
    await first.post(scan).send({ kind: 'program', code }).expect(400);
    await outsider.agent.post(scan).send({ kind: 'club', ticket, position: origin }).expect(400);
    await first
      .post(scan)
      .send({ kind: 'club', ticket, position: { ...origin, latitude: 37.55089 } })
      .expect(200);
    await second.post('/api/v1/me/attendance/check-in').send({ code }).expect(200);
    const reopened = (await staff.agent.post(path).send({ open: true, position: origin }).expect(200)).body
      .data;
    expect(reopened.qrTicket).not.toEqual(ticket);
    await first.post(scan).send({ kind: 'club', ticket, position: origin }).expect(400);
    await staff.agent.post(path).send({ open: false }).expect(200);
    await first.post(scan).send({ kind: 'club', ticket: reopened.qrTicket, position: origin }).expect(400);
  });
  it('출석 코드로 본인 출석하고, 다섯 번 틀리면 잠근다', async () => {
    const { club, members } = await clubWith(['코드회원']);
    const staff = await signedIn(t, ['staff']);
    const s = await staff.agent
      .post('/api/v1/attendance/sessions')
      .send({ targetType: 'club', targetId: club.id, date: '2026-10-21', title: '체크인' })
      .expect(201);
    const opened = await staff.agent
      .post(`/api/v1/attendance/sessions/${s.body.data.id}/check-in`)
      .send({ open: true })
      .expect(200);
    const code = opened.body.data.checkInCode as string;
    expect(code).toMatch(/^\d{4}$/);

    const agent = await loginAgent(t, members[0]!.email);
    const ok = await agent.post('/api/v1/me/attendance/check-in').send({ code }).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'present', targetName: club.name });
    const mine = await agent.get('/api/v1/me/attendance').expect(200);
    expect(mine.body.data[0]).toMatchObject({ sessionId: s.body.data.id, status: 'present' });

    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i += 1) {
      await agent.post('/api/v1/me/attendance/check-in').send({ code: wrong }).expect(400);
    }
    await agent.post('/api/v1/me/attendance/check-in').send({ code }).expect(429);

    const closed = await staff.agent
      .post(`/api/v1/attendance/sessions/${s.body.data.id}/check-in`)
      .send({ open: false })
      .expect(200);
    expect(closed.body.data.checkInCode).toBeNull();
  });
});

describe('동아리 담당자 운영', () => {
  it('명단(연락처·출석률)·역할·소개·소식을 관리하고, 다른 동아리는 403', async () => {
    const { club, members } = await clubWith(['운영회원']);
    const other = await clubWith([]);
    const { agent } = await managerOf(club.id);

    const clubs = await agent.get('/api/v1/manage/clubs').expect(200);
    expect(clubs.body.data.map((c: { id: string }) => c.id)).toEqual([club.id]);
    await agent.get(`/api/v1/manage/clubs/${other.club.id}/members`).expect(403);

    const roster = await agent.get(`/api/v1/manage/clubs/${club.id}/members`).expect(200);
    expect(roster.body.data).toMatchObject([
      { userId: members[0]!.id, email: members[0]!.email, attendanceRate: null },
    ]);
    const role = await agent
      .patch(`/api/v1/manage/clubs/${club.id}/members/${members[0]!.id}`)
      .send({ role: 'leader' })
      .expect(200);
    expect(role.body.data.role).toBe('leader');

    const intro = await agent
      .patch(`/api/v1/manage/clubs/${club.id}/intro`)
      .send({
        summary: '함께 연주해요',
        description: '매주 모여 합주합니다.',
        meetingInfo: '토 14시',
        recruiting: true,
      })
      .expect(200);
    expect(intro.body.data).toMatchObject({ recruiting: true, meetingInfo: '토 14시' });

    const post = await agent
      .post(`/api/v1/manage/clubs/${club.id}/posts`)
      .send({ kind: 'notice', title: '공연 안내', body: '이번 주 공연이 있습니다.' })
      .expect(201);
    await agent.delete(`/api/v1/manage/clubs/${other.club.id}/posts/${post.body.data.id}`).expect(403);
    await agent.delete(`/api/v1/manage/clubs/${club.id}/posts/${post.body.data.id}`).expect(204);

    const applicant = await signedIn(t);
    const a = await applicant.agent
      .post(`/api/v1/clubs/${club.id}/applications`)
      .send({ motivation: '합주에 참여하고 싶습니다.', agreePrivacy: 'on' })
      .expect(201);
    await agent
      .post(`/api/v1/manage/clubs/${club.id}/applications/${a.body.data.id}/decision`)
      .send({ decision: 'approved' })
      .expect(200);
    await agent.delete(`/api/v1/manage/clubs/${club.id}/members/${applicant.user.id}`).expect(204);
    expect(await t.prisma.clubMembership.count({ where: { clubId: club.id } })).toBe(1);

    const member = await signedIn(t);
    await member.agent.get('/api/v1/manage/clubs').expect(403);
  });
});
