import type { SettingsRecord } from '../domain/site-settings';
/**
 * 개발용 데이터.
 * - 프로그램·공지·신청·예약·문의·회원·동아리 가입/명단/소식은 샘플이다 (분류명만 공식 명칭).
 * - 동아리 소개·센터 갤러리·[참고] 공지는 공식 채널에서 수집한 참고 정보다 (./research.ts, 수집일 표시).
 * 데모 계정 비밀번호는 이 파일에만 기록한다 (mock 모드 전용, 실서버에는 존재하지 않음).
 */
import type {
  AttendanceSession,
  AuditEvent,
  Club,
  ClubApplication,
  ClubPost,
  ClubRole,
  Faq,
  Inquiry,
  MediaItem,
  Notice,
  Notification,
  PolicyDoc,
  Space,
  SpaceReservation,
  Program,
  ProgramApplication,
  ProgramCategory,
  User,
} from '../domain/types';
import { toDateInput } from '../lib/format';
import { REFERENCE_COLLECTED_AT, RESEARCH_CLUBS, RESEARCH_MEDIA, RESEARCH_NOTICES } from './research';

export const DEMO_PASSWORD = 'demo1234!';

export const DEMO_ACCOUNTS = [
  { email: 'member@demo.test', label: '일반 회원' },
  { email: 'leader@demo.test', label: '동아리 담당자' },
  { email: 'staff@demo.test', label: '센터 직원' },
  { email: 'admin@demo.test', label: '최고 관리자' },
  { email: 'developer@demo.test', label: '개발자' },
] as const;

export interface MockMembership {
  clubId: string;
  userId: string;
  role: ClubRole;
  joinedAt: string;
}

export interface MockDb {
  siteSettings?: SettingsRecord;
  version: 8;
  notifications: Notification[];
  media: MediaItem[];
  spaces: Space[];
  reservations: Omit<SpaceReservation, 'cancellable'>[];
  inquiries: Inquiry[];
  faqs: Faq[];
  policies: PolicyDoc[];
  seq: number;
  /** managedClubIds 는 clubManagers 에서 계산해 내려준다 */
  users: (Omit<User, 'managedClubIds'> & { password: string })[];
  clubManagers: { clubId: string; userId: string; assignedAt: string }[];
  categories: ProgramCategory[];
  programs: Program[];
  applications: ProgramApplication[];
  notices: Notice[];
  clubs: Club[];
  memberships: MockMembership[];
  clubPosts: (ClubPost & { clubId: string })[];
  clubApplications: ClubApplication[];
  audit: AuditEvent[];
  attendance: AttendanceSession[];
  /** 출석 코드 틀린 횟수·잠금 (회원별) */
  checkInFailures: { userId: string; count: number; lockedUntil: string | null }[];
}

const DAY = 86_400_000;

export function createSeed(now = new Date()): MockDb {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const at = (days: number, hour = 9) =>
    new Date(today.getTime() + days * DAY + hour * 3_600_000).toISOString();

  const consents = (marketing: boolean): User['consents'] => [
    { key: 'terms', required: true, agreed: true, agreedAt: at(-120) },
    { key: 'privacy', required: true, agreed: true, agreedAt: at(-120) },
    { key: 'marketing', required: false, agreed: marketing, agreedAt: marketing ? at(-120) : null },
  ];

  const user = (
    id: string,
    email: string,
    name: string,
    roles: User['roles'],
    extra: Partial<User> = {},
  ): MockDb['users'][number] => ({
    id,
    email,
    name,
    phone: '010-0000-0000',
    birthYear: 2009,
    roles,
    status: 'active',
    emailVerified: true,
    providers: [],
    consents: consents(false),
    createdAt: at(-120),
    password: DEMO_PASSWORD,
    ...extra,
  });

  const users = [
    user('u-member', 'member@demo.test', '김샘플', ['member'], { consents: consents(true) }),
    user('u-leader', 'leader@demo.test', '이데모', ['member'], { birthYear: 2008 }),
    user('u-staff', 'staff@demo.test', '박직원', ['staff'], { birthYear: 1990 }),
    user('u-admin', 'admin@demo.test', '최관리', ['admin'], { birthYear: 1985 }),
    user('u-developer', 'developer@demo.test', '강개발', ['developer'], { birthYear: 1993 }),
    user('u-5', 'sample5@demo.test', '정예시', ['member'], { birthYear: 2010 }),
    user('u-6', 'sample6@demo.test', '한테스트', ['member'], { birthYear: 2007 }),
    user('u-7', 'sample7@demo.test', '오가상', ['member'], { status: 'suspended' }),
    user('u-8', 'sample8@demo.test', '윤목업', ['member'], { birthYear: 1972 }),
  ];

  const categories: ProgramCategory[] = [
    ['autonomy', '자치활동', '청소년활동'],
    ['participation', '참여실현활동', '청소년활동'],
    ['culture', '문화예술활동', '청소년활동'],
    ['future', '미래활동', '청소년활동'],
    ['startup', '창업활동', '청소년활동'],
    ['local', '지역활동', '청소년활동'],
    ['value', '가치탐색활동', '청소년활동'],
    ['life', '생활실용활동', '청소년활동'],
    ['daily', '일상세움활동', '청소년활동'],
    ['sports', '생활체육', '체육/교육'],
    ['edu', '교육문화', '체육/교육'],
    ['school-career', '학교진로체험', '진로직업체험'],
    ['personal-career', '개별진로체험', '진로직업체험'],
    ['career-club', '진로동아리', '진로직업체험'],
    ['counsel', '상담/교육', '꿈드림'],
    ['job', '취업/자립', '꿈드림'],
  ].map(([id, name, group]) => ({ id: `c-${id}`, name: name!, group: group! }));

  const program = (
    id: string,
    p: Omit<Program, 'id' | 'recruitStatus' | 'updatedAt' | 'status' | 'cancelDeadline'> &
      Partial<Pick<Program, 'status' | 'cancelDeadline'>>,
  ): Program => ({
    id,
    status: 'published',
    cancelDeadline: new Date(Date.parse(p.startsAt) - 2 * DAY).toISOString(),
    recruitStatus: 'open',
    updatedAt: at(-10),
    ...p,
  });

  const programs: Program[] = [
    program('p-1', {
      title: '청소년 자치기구 정기 활동',
      categoryId: 'c-autonomy',
      summary: '센터 운영에 청소년의 목소리를 담는 자치기구 활동',
      description: '청소년이 직접 센터 프로그램을 기획하고 운영 의견을 내는 정기 활동입니다.',
      target: '9~24세 청소년',
      place: '2F 강의실',
      startsAt: at(14, 16),
      endsAt: at(70, 18),
      recruitStartsAt: at(-7),
      recruitEndsAt: at(10, 18),
      capacity: 20,
      appliedCount: 12,
    }),
    program('p-2', {
      title: '밴드 합주 입문 클래스',
      categoryId: 'c-culture',
      summary: '악기 경험이 적어도 참여할 수 있는 합주 입문 과정',
      description: '기타·베이스·드럼·키보드 파트로 나누어 한 곡을 함께 완성합니다.',
      target: '중·고등학생',
      place: '2F 뮤직스튜디오',
      startsAt: at(12, 17),
      endsAt: at(54, 19),
      recruitStartsAt: at(-5),
      recruitEndsAt: at(7, 18),
      capacity: 8,
      appliedCount: 8,
    }),
    program('p-3', {
      title: '주말 농구 교실',
      categoryId: 'c-sports',
      summary: '기본기부터 경기 운영까지 배우는 주말 농구',
      description: '드리블·패스·슛 기본기와 간단한 팀 경기를 진행합니다.',
      target: '초등 5학년 ~ 중학생',
      place: '3F 체육관',
      startsAt: at(9, 10),
      endsAt: at(65, 12),
      recruitStartsAt: at(-3),
      recruitEndsAt: at(6, 18),
      capacity: 24,
      appliedCount: 5,
    }),
    program('p-4', {
      title: '코딩으로 만드는 나만의 게임',
      categoryId: 'c-future',
      summary: '블록 코딩으로 간단한 게임을 기획하고 만들어 보는 과정',
      description: '게임 기획부터 테스트까지 직접 해보는 디지털 창작 활동입니다.',
      target: '중학생',
      place: '2F 미디어실',
      startsAt: at(35, 16),
      endsAt: at(77, 18),
      recruitStartsAt: at(5),
      recruitEndsAt: at(25, 18),
      capacity: 12,
      appliedCount: 0,
    }),
    program('p-5', {
      title: '지역 주민 생활 영어 회화',
      categoryId: 'c-edu',
      summary: '일상 상황 중심의 성인 대상 회화 과정',
      description: '여행·쇼핑·길 안내 등 생활 상황별 표현을 연습합니다.',
      target: '성인(지역 주민)',
      place: '2F 강의실',
      startsAt: at(11, 10),
      endsAt: at(80, 12),
      recruitStartsAt: at(-10),
      recruitEndsAt: at(8, 18),
      capacity: 15,
      appliedCount: 3,
    }),
    program('p-6', {
      title: '직업 인터뷰 프로젝트',
      categoryId: 'c-school-career',
      summary: '관심 직업 종사자를 인터뷰하고 결과를 발표하는 진로 체험',
      description: '팀별로 관심 직업을 정하고 인터뷰 질문지를 함께 준비합니다.',
      target: '중학생',
      place: '2F 강의실',
      startsAt: at(-20, 15),
      endsAt: at(-6, 17),
      recruitStartsAt: at(-40),
      recruitEndsAt: at(-25, 18),
      capacity: 25,
      appliedCount: 22,
    }),
    program('p-7', {
      title: '우리 동네 환경 지킴이',
      categoryId: 'c-local',
      summary: '센터 주변 환경을 살피고 개선 아이디어를 실천하는 지역 활동',
      description: '동네 산책길을 함께 걸으며 환경 문제를 기록하고 캠페인을 준비합니다.',
      target: '초등 4학년 ~ 고등학생',
      place: 'B1 청소년활동공간',
      startsAt: at(16, 14),
      endsAt: at(44, 16),
      recruitStartsAt: at(-2),
      recruitEndsAt: at(13, 18),
      capacity: 30,
      appliedCount: 10,
    }),
    program('p-8', {
      title: '학교 밖 청소년 학습 지원',
      categoryId: 'c-counsel',
      summary: '검정고시 등 개인 학습 목표에 맞춘 학습 지원',
      description: '학습 상담 후 개인별 계획에 따라 학습을 지원합니다.',
      target: '학교 밖 청소년',
      place: '2F 스마트 스터디룸',
      startsAt: at(8, 13),
      endsAt: at(90, 17),
      recruitStartsAt: at(-14),
      recruitEndsAt: at(5, 18),
      capacity: 10,
      appliedCount: 2,
    }),
    program('p-9', {
      title: '청소년 창업 아이디어 캠프',
      categoryId: 'c-startup',
      summary: '아이디어 발굴부터 발표까지 진행하는 창업 체험 캠프',
      description: '팀을 구성해 문제를 정의하고 해결 아이디어를 발표합니다.',
      target: '고등학생',
      place: 'B1 청소년극장',
      startsAt: at(-45, 10),
      endsAt: at(-44, 17),
      recruitStartsAt: at(-70),
      recruitEndsAt: at(-50, 18),
      capacity: 30,
      appliedCount: 30,
    }),
    program('p-10', {
      title: '(작성 중) 겨울방학 특강',
      categoryId: 'c-edu',
      summary: '게시 전 임시 저장 상태의 샘플',
      description: '관리자 화면에서만 보이는 임시 저장 프로그램입니다.',
      target: '미정',
      place: '미정',
      startsAt: at(60, 10),
      endsAt: at(75, 12),
      recruitStartsAt: at(40),
      recruitEndsAt: at(55, 18),
      capacity: 20,
      appliedCount: 0,
      status: 'draft',
    }),
  ];

  const application = (
    id: string,
    seq: number,
    p: Program,
    u: MockDb['users'][number],
    status: ProgramApplication['status'],
    createdDaysAgo: number,
  ): ProgramApplication => {
    const createdAt = at(-createdDaysAgo, 11);
    const history: ProgramApplication['history'] = [
      { at: createdAt, status: 'submitted', actor: 'applicant', reason: null },
    ];
    if (status !== 'submitted') {
      history.push({
        at: at(-createdDaysAgo + 1, 10),
        status,
        actor: status === 'cancelled' ? 'applicant' : 'staff',
        reason: status === 'rejected' ? '대상 연령이 맞지 않습니다.' : null,
      });
    }
    return {
      id,
      receiptNo: `DEV-${String(seq).padStart(5, '0')}`,
      programId: p.id,
      programTitle: p.title,
      userId: u.id,
      applicantName: u.name,
      phone: u.phone ?? '',
      note: '',
      status,
      createdAt,
      history,
      cancellable: false,
    };
  };

  const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)!;
  const applications = [
    application('a-1', 1, byId(programs, 'p-1'), byId(users, 'u-member'), 'submitted', 3),
    application('a-2', 2, byId(programs, 'p-6'), byId(users, 'u-member'), 'approved', 30),
    application('a-3', 3, byId(programs, 'p-3'), byId(users, 'u-5'), 'submitted', 1),
    application('a-4', 4, byId(programs, 'p-3'), byId(users, 'u-6'), 'submitted', 2),
    application('a-5', 5, byId(programs, 'p-5'), byId(users, 'u-8'), 'approved', 6),
    application('a-6', 6, byId(programs, 'p-1'), byId(users, 'u-leader'), 'submitted', 0),
    application('a-7', 7, byId(programs, 'p-7'), byId(users, 'u-6'), 'rejected', 1),
  ];

  const notice = (
    id: string,
    n: Omit<Notice, 'id' | 'updatedAt' | 'attachments'> & Partial<Notice>,
  ): Notice => ({
    id,
    attachments: [],
    updatedAt: n.publishedAt ?? at(-1),
    ...n,
  });
  const notices: Notice[] = [
    notice('n-1', {
      title: '센터 서비스 이용 안내',
      category: 'center',
      body: '프로그램 신청, 공간 예약과 동아리 가입 내역은 MY에서 확인할 수 있습니다.',
      status: 'published',
      pinned: true,
      publishedAt: at(-1, 10),
    }),
    notice('n-2', {
      title: '시설 정기 점검에 따른 일부 공간 이용 제한',
      category: 'center',
      body: '정기 점검 기간에는 일부 공간 이용이 제한될 수 있습니다.\n점검 일정은 확정 후 다시 안내합니다.',
      status: 'published',
      pinned: false,
      publishedAt: at(-4, 10),
      attachments: [
        {
          id: 'f-1',
          name: '샘플_안내문.txt',
          size: 64,
          url: 'data:text/plain;charset=utf-8,%EA%B0%9C%EB%B0%9C%EC%9A%A9%20%EC%83%98%ED%94%8C%20%EC%B2%A8%EB%B6%80%ED%8C%8C%EC%9D%BC%EC%9E%85%EB%8B%88%EB%8B%A4.',
        },
      ],
    }),
    notice('n-3', {
      title: '청소년 전용공간 이용 수칙',
      category: 'youth',
      body: '전용공간은 청소년이 안전하고 편안하게 이용할 수 있도록 이용 수칙을 지켜 주세요.',
      status: 'published',
      pinned: false,
      publishedAt: at(-7, 10),
    }),
    notice('n-4', {
      title: '동아리 활동 공간 예약 방법 변경',
      category: 'youth',
      body: '동아리 활동 공간 예약 방법이 변경될 예정입니다.',
      status: 'published',
      pinned: false,
      publishedAt: at(-12, 10),
    }),
    notice('n-5', {
      title: '생활체육 프로그램 수강 신청 유의사항',
      category: 'education',
      body: '수강 신청 전 대상 연령과 일정을 꼭 확인해 주세요.',
      status: 'published',
      pinned: false,
      publishedAt: at(-15, 10),
    }),
    notice('n-6', {
      title: '평생교육 강좌 개설 수요 조사',
      category: 'education',
      body: '지역 주민이 원하는 평생교육 강좌 주제를 조사합니다.',
      status: 'published',
      pinned: false,
      publishedAt: at(-21, 10),
    }),
    notice('n-7', {
      title: '(작성 중) 연말 행사 안내',
      category: 'center',
      body: '관리자 화면에서만 보이는 임시 저장 공지입니다.',
      status: 'draft',
      pinned: false,
      publishedAt: null,
      updatedAt: at(0, 8),
    }),
    ...RESEARCH_NOTICES.map((n, i) =>
      notice(`n-ref-${i + 1}`, {
        ...n,
        status: 'published',
        pinned: false,
        publishedAt: `${REFERENCE_COLLECTED_AT}T10:0${i}:00+09:00`,
      }),
    ),
  ];

  // 동아리 소개는 공식 채널 수집 정보, 명단·소식·가입 신청은 데모 계정으로 만든 샘플
  const clubs: Club[] = RESEARCH_CLUBS.map((c) => ({ ...c, memberCount: 0 }));
  const clubName = (id: string) => byId(clubs, id).name;

  const memberships: MockMembership[] = [
    { clubId: 'cl-frame', userId: 'u-leader', role: 'leader', joinedAt: at(-200) },
    { clubId: 'cl-frame', userId: 'u-member', role: 'member', joinedAt: at(-45) },
    { clubId: 'cl-frame', userId: 'u-5', role: 'member', joinedAt: at(-90) },
    { clubId: 'cl-simile', userId: 'u-6', role: 'leader', joinedAt: at(-300) },
    { clubId: 'cl-simile', userId: 'u-5', role: 'member', joinedAt: at(-150) },
    { clubId: 'cl-asta', userId: 'u-6', role: 'member', joinedAt: at(-100) },
  ];
  for (const c of clubs) c.memberCount = memberships.filter((m) => m.clubId === c.id).length;

  const clubPosts: MockDb['clubPosts'] = [
    {
      id: 'cp-1',
      clubId: 'cl-frame',
      kind: 'notice',
      title: '이번 달 촬영 주제 안내',
      body: '촬영 주제는 모임에서 함께 정합니다.',
      at: at(-2),
    },
    {
      id: 'cp-2',
      clubId: 'cl-frame',
      kind: 'schedule',
      title: '정기 모임',
      body: '장소는 담당 선생님이 안내합니다.',
      at: at(3, 13),
    },
    {
      id: 'cp-3',
      clubId: 'cl-simile',
      kind: 'activity',
      title: '시설 모니터링 결과 정리',
      body: '모니터링 결과를 공유했습니다.',
      at: at(-6),
    },
    {
      id: 'cp-4',
      clubId: 'cl-simile',
      kind: 'schedule',
      title: '정기 회의',
      body: '회의 안건은 단체 대화방에서 미리 받습니다.',
      at: at(4, 10),
    },
  ];

  const clubApplications: ClubApplication[] = [
    {
      id: 'ca-1',
      clubId: 'cl-asta',
      clubName: clubName('cl-asta'),
      userId: 'u-member',
      applicantName: '김샘플',
      motivation: '바리스타 진로에 관심이 있어 음료 실습을 함께 해 보고 싶습니다.',
      status: 'pending',
      reason: null,
      createdAt: at(-1, 15),
    },
    {
      id: 'ca-2',
      clubId: 'cl-after-school-academy',
      clubName: clubName('cl-after-school-academy'),
      userId: 'u-5',
      applicantName: '정예시',
      motivation: '방과후에 친구들과 악기와 연극 활동을 해 보고 싶습니다.',
      status: 'pending',
      reason: null,
      createdAt: at(-2, 15),
    },
  ];

  const audit: AuditEvent[] = [
    {
      id: 'ev-1',
      at: at(-1, 10),
      actorName: '박직원',
      action: 'notice.publish',
      targetType: 'notice',
      targetId: 'n-1',
      summary: '공지 게시: 센터 서비스 이용 안내',
    },
  ];

  // 공간명·층은 공식 홈페이지 층별 안내 기준, 수용 인원·설명은 샘플
  const spaces: Space[] = [
    ['gym', '체육관', '3F', 40, '농구·배드민턴 등 실내 체육 활동 공간'],
    ['multi', '복합문화공간', '3F', 30, '댄스·공연 연습 등 다목적 활동 공간'],
    ['lecture', '강의실', '2F', 24, '회의·교육용 책상과 스크린이 있는 공간'],
    ['media', '미디어실', '2F', 12, '영상 편집·미디어 활동 공간'],
    ['music', '라미의 뮤직스튜디오 (AGIT)', '2F', 8, '청소년 전용 합주·녹음 공간'],
    ['study', '스마트 스터디룸', '2F', 6, '소규모 스터디·모임 공간'],
    ['theater', '청소년극장', 'B1', 100, '공연·발표회 공간'],
  ].map(([id, name, floor, capacity, description]) => ({
    id: `s-${id}`,
    name: String(name),
    floor: String(floor),
    capacity: Number(capacity),
    description: String(description),
    reservable: id !== 'theater',
  }));

  const ymd = (days: number) => {
    const d = new Date(today.getTime() + days * DAY);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const reservations: MockDb['reservations'] = [
    {
      id: 'r-1',
      spaceId: 's-music',
      spaceName: '라미의 뮤직스튜디오 (AGIT)',
      userId: 'u-leader',
      applicantName: '이데모',
      phone: '01000000000',
      date: ymd(3),
      startTime: '15:00',
      endTime: '17:00',
      headcount: 5,
      purpose: '동아리 정기 모임',
      status: 'approved',
      reason: null,
      createdAt: at(-2, 10),
    },
    {
      id: 'r-2',
      spaceId: 's-study',
      spaceName: '스마트 스터디룸',
      userId: 'u-member',
      applicantName: '김샘플',
      phone: '01000000000',
      date: ymd(5),
      startTime: '16:00',
      endTime: '18:00',
      headcount: 4,
      purpose: '시험 대비 그룹 스터디',
      status: 'pending',
      reason: null,
      createdAt: at(-1, 13),
    },
  ];

  const inquiries: Inquiry[] = [
    {
      id: 'q-1',
      userId: 'u-member',
      authorName: '김샘플',
      category: 'program',
      title: '프로그램 중간 참여도 가능한가요?',
      body: '이미 시작한 프로그램에 중간부터 참여할 수 있는지 궁금합니다.',
      status: 'answered',
      createdAt: at(-5, 19),
      answer: {
        body: '[샘플 답변] 프로그램마다 다르며, 담당자가 확인 후 안내드립니다.',
        answeredAt: at(-4, 10),
        answeredBy: '박직원',
      },
    },
    {
      id: 'q-2',
      userId: 'u-5',
      authorName: '정예시',
      category: 'space',
      title: '체육관 예약 인원 문의',
      body: '체육관을 친구들과 이용하려고 하는데 최소 인원이 있나요?',
      status: 'open',
      createdAt: at(-1, 20),
      answer: null,
    },
  ];

  // 이 서비스의 사용 방법에 대한 안내만 담는다 (센터 운영 정책을 임의로 확정하지 않음)
  const faqs: Faq[] = [
    [
      'program',
      '프로그램은 어떻게 신청하나요?',
      '로그인 후 프로그램 상세 화면에서 [신청하기]를 누르고 연락처와 동의 항목을 입력하면 접수됩니다. 접수 결과는 마이페이지에서 확인할 수 있습니다.',
    ],
    [
      'program',
      '신청을 취소하고 싶어요.',
      '마이페이지 > 신청 내역에서 해당 신청을 열고 [신청 취소]를 누르세요. 취소 기한이 지난 경우에는 센터로 문의해 주세요.',
    ],
    [
      'space',
      '공간 예약은 바로 확정되나요?',
      '예약 신청 후 센터 담당자가 확인하면 [예약 확정]으로 바뀝니다. 진행 상태는 마이페이지 > 공간 예약에서 확인할 수 있습니다.',
    ],
    [
      'club',
      '동아리 가입 결과는 어디서 보나요?',
      '마이페이지의 동아리 가입 신청 목록에서 검토 결과와 사유를 확인할 수 있습니다.',
    ],
    [
      'account',
      '비밀번호를 잊어버렸어요.',
      '로그인 화면의 [비밀번호 찾기]에서 가입한 이메일을 입력하면 재설정 링크를 보내 드립니다.',
    ],
  ].map(([category, question, answer], i) => ({
    id: `fq-${i + 1}`,
    category: category as Faq['category'],
    question: question!,
    answer: answer!,
    order: i + 1,
    published: true,
  }));

  const draft = (key: PolicyDoc['key'], title: string, body: string): PolicyDoc => ({
    key,
    title,
    body: `${body}\n\n※ 센터 확정본이 아닌 초안입니다. 관리자 화면 > 정책 문서에서 확정본을 등록하면 이 내용이 교체됩니다.`,
    confirmed: false,
    effectiveAt: null,
    updatedAt: at(-1),
  });

  const policies: PolicyDoc[] = [
    draft(
      'privacy',
      '개인정보 처리방침',
      '센터가 확정한 개인정보 처리방침 전문이 아직 등록되지 않았습니다.\n\n등록 시 포함해야 할 항목: 처리 목적, 처리 항목, 보유·이용 기간, 제3자 제공, 처리 위탁, 정보주체와 법정대리인의 권리·의무 및 행사 방법, 파기 절차·방법, 안전성 확보 조치, 자동 수집 장치(쿠키)의 설치·운영 및 거부, 개인정보 보호책임자, 권익침해 구제 방법, 만 14세 미만 아동의 개인정보 처리, 처리방침 변경 이력.',
    ),
    draft(
      'terms',
      '서비스 이용약관',
      '센터가 확정한 서비스 이용약관 전문이 아직 등록되지 않았습니다.\n\n등록 시 포함해야 할 항목: 목적, 용어 정의, 약관의 효력과 변경, 회원가입과 탈퇴, 프로그램 신청·취소, 공간 예약·취소, 동아리 가입, 이용자의 의무, 서비스 제공의 중단, 게시물 관리, 책임 제한, 분쟁 해결.',
    ),
    draft(
      'cookies',
      '쿠키 정책',
      '이 서비스가 브라우저에 저장하는 항목은 다음과 같습니다.\n\n1. 로그인 세션 쿠키 (필수)\n- 목적: 로그인 상태 유지\n- 특징: HttpOnly·Secure 로 설정되어 스크립트에서 읽을 수 없습니다.\n- 보관: 로그아웃하거나 세션이 만료되면 삭제됩니다.\n\n2. XSRF-TOKEN 쿠키 (필수)\n- 목적: 요청 위조(CSRF) 공격 방지\n\n3. 브라우저 sessionStorage (개발용 데모 모드에서만)\n- 목적: 데모 샘플 데이터 보관\n- 보관: 브라우저 탭을 닫으면 삭제됩니다.\n\n광고·행태 분석·제3자 추적 쿠키는 사용하지 않습니다.\n\n브라우저 설정에서 쿠키를 차단할 수 있으나, 필수 쿠키를 차단하면 로그인이 필요한 기능(신청·예약·문의)을 이용할 수 없습니다.',
    ),
    draft(
      'no-email',
      '이메일무단수집거부',
      '본 웹사이트에 게시된 이메일 주소가 전자우편 수집 프로그램이나 그 밖의 기술적 장치를 이용하여 무단으로 수집되는 것을 거부하며, 이를 위반하는 경우 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」에 따라 처벌될 수 있음을 유념하시기 바랍니다.',
    ),
    draft(
      'security',
      '보안 취약점 신고',
      '서비스에서 보안 취약점을 발견하면 알려 주세요.\n\n신고 방법\n- 질문·문의 > 1:1 문의(분류: 기타)에 "보안 취약점" 으로 남기거나 대표전화로 연락해 주세요.\n- 전용 신고 이메일은 확정 후 안내합니다.\n\n신고 시 포함해 주세요\n- 취약점이 있는 화면 또는 주소\n- 재현 방법과 예상 영향\n- 연락받을 방법\n\n지켜 주세요\n- 다른 사람의 개인정보에 접근하거나 변경·삭제하지 마세요.\n- 서비스 중단을 일으키는 시험(대량 요청 등)을 하지 마세요.\n- 취약점이 해결되기 전에 외부에 공개하지 마세요.',
    ),
    draft(
      'copyright',
      '저작권 안내',
      '이 서비스에 게시된 글·사진·영상·로고의 저작권은 중구청소년센터 또는 원저작자에게 있습니다.\n\n- 센터의 사전 허락 없이 상업적으로 이용하거나 복제·배포·전송할 수 없습니다.\n- 이용자가 작성한 게시물(문의 등)의 저작권은 작성자에게 있으며, 센터는 서비스 운영에 필요한 범위에서만 이용합니다.\n- 저작권 침해가 의심되는 게시물은 질문·문의로 알려 주시면 확인 후 조치합니다.',
    ),
    draft(
      'user-rights',
      '이용자의 권리 및 유의사항',
      '이용자의 권리\n- 언제든지 자신의 개인정보를 열람·정정·삭제하거나 처리 정지를 요구할 수 있습니다. (MY > 내 정보, 1:1 문의, 대표전화)\n- 선택 동의(프로그램 소식 안내)는 언제든지 철회할 수 있습니다.\n- 만 14세 미만 아동의 법정대리인은 아동의 개인정보에 대해 같은 권리를 행사할 수 있습니다.\n- 회원 탈퇴는 MY > 내 정보 > 회원 탈퇴에서 할 수 있습니다.\n\n유의사항\n- 계정을 다른 사람과 함께 쓰거나 빌려주지 마세요.\n- 다른 사람의 정보를 입력해 신청·예약하지 마세요.\n- 허위 신청이나 반복적인 노쇼는 이용이 제한될 수 있습니다. (세부 기준은 운영 정책 확정 후 안내)',
    ),
  ];

  const notifications: Notification[] = [
    {
      id: 'nt-1',
      userId: 'u-member',
      kind: 'inquiry',
      title: '1:1 문의에 답변이 등록되었습니다',
      body: '프로그램 중간 참여도 가능한가요?',
      link: '/qna/q-1',
      createdAt: at(-4, 10),
      readAt: null,
    },
    {
      id: 'nt-2',
      userId: 'u-member',
      kind: 'notice',
      title: '새 공지가 게시되었습니다',
      body: '센터 서비스 이용 안내',
      link: '/notices/n-1',
      createdAt: at(-1, 10),
      readAt: at(-1, 12),
    },
  ];

  const names = (ids: string[]) => ids.map((id) => ({ userId: id, name: byId(users, id).name }));
  const attendanceSession = (
    id: string,
    target: { type: 'club' | 'program'; id: string; name: string },
    daysAgo: number,
    title: string,
    marks: [string, AttendanceSession['records'][number]['status']][],
  ): AttendanceSession => ({
    id,
    targetType: target.type,
    targetId: target.id,
    targetName: target.name,
    date: toDateInput(at(-daysAgo, 9)),
    title,
    checkInCode: null,
    checkInClosesAt: null,
    createdAt: at(-daysAgo - 1, 15),
    createdBy: '박직원',
    records: names(marks.map(([u]) => u)).map((n, i) => ({
      ...n,
      status: marks[i]![1],
      checkedAt: marks[i]![1] ? at(-daysAgo, 16) : null,
      method: marks[i]![1] ? ('manager' as const) : null,
      note: marks[i]![1] === 'excused' ? '학교 행사' : null,
    })),
  });
  const frame = { type: 'club' as const, id: 'cl-frame', name: byId(clubs, 'cl-frame').name };
  const attendance: AttendanceSession[] = [
    attendanceSession('at-1', frame, 14, '정기 모임', [
      ['u-leader', 'present'],
      ['u-member', 'present'],
      ['u-5', 'late'],
    ]),
    attendanceSession('at-2', frame, 7, '정기 모임', [
      ['u-leader', 'present'],
      ['u-member', 'absent'],
      ['u-5', 'excused'],
    ]),
    attendanceSession(
      'at-3',
      { type: 'program', id: 'p-6', name: byId(programs, 'p-6').title },
      10,
      '1회차',
      [['u-member', 'present']],
    ),
  ];

  return {
    version: 8,
    clubManagers: [{ clubId: 'cl-frame', userId: 'u-leader', assignedAt: at(-60) }],
    notifications,
    media: RESEARCH_MEDIA,
    spaces,
    reservations,
    inquiries,
    faqs,
    policies,
    seq: 100,
    users,
    categories,
    programs,
    applications,
    notices,
    clubs,
    memberships,
    clubPosts,
    clubApplications,
    audit,
    attendance,
    checkInFailures: [],
  };
}
