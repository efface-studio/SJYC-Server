/**
 * 도메인 타입 — 서버 API 계약 초안(docs/api-contracts.md)과 1:1 로 맞춘다.
 * 실제 서버 스키마가 아니라 설계 후보이며, 서버 확정 시 이 파일을 기준으로 차이를 정리한다.
 * 웹 전용 API(DOM 등)에 의존하지 않아 모바일 앱에서도 재사용할 수 있다.
 */

/** 높은 순: developer(개발자, 최상위) > admin(최고 관리자) > staff(센터 직원) > member(회원) */
export type Role = 'member' | 'staff' | 'admin' | 'developer';
export type OAuthProvider = 'kakao' | 'naver' | 'apple' | 'google';
export type UserStatus = 'active' | 'suspended' | 'withdrawn';

export interface ConsentRecord {
  key: 'terms' | 'privacy' | 'marketing';
  required: boolean;
  agreed: boolean;
  agreedAt: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  birthYear: number | null;
  roles: Role[];
  status: UserStatus;
  emailVerified: boolean;
  providers: OAuthProvider[];
  consents: ConsentRecord[];
  createdAt: string;
  /** 담당자로 지정된 동아리 ID — 서버가 계산해 내려준다 (센터 직원 이상은 모든 동아리를 관리하므로 비어 있어도 된다) */
  managedClubIds: string[];
}

export interface Session {
  user: User;
  expiresAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ---------- 프로그램 ---------- */

export interface ProgramCategory {
  id: string;
  name: string;
  group: string;
}

export type PublishStatus = 'draft' | 'published' | 'hidden';
/** 서버가 날짜·정원으로 계산해 내려주는 모집 상태 */
export type RecruitStatus = 'upcoming' | 'open' | 'full' | 'closed';

export interface Program {
  id: string;
  title: string;
  categoryId: string;
  summary: string;
  description: string;
  target: string;
  place: string;
  startsAt: string;
  endsAt: string;
  recruitStartsAt: string;
  recruitEndsAt: string;
  capacity: number;
  appliedCount: number;
  status: PublishStatus;
  recruitStatus: RecruitStatus;
  cancelDeadline: string;
  updatedAt: string;
}

export type ApplicationStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface StatusHistoryEntry {
  at: string;
  status: ApplicationStatus;
  actor: 'applicant' | 'staff' | 'system';
  reason: string | null;
}

export interface ProgramApplication {
  id: string;
  /** 서버가 발급한 접수 번호. 미발급이면 null — 클라이언트에서 만들지 않는다. */
  receiptNo: string | null;
  programId: string;
  programTitle: string;
  userId: string;
  applicantName: string;
  phone: string;
  note: string;
  status: ApplicationStatus;
  createdAt: string;
  history: StatusHistoryEntry[];
  cancellable: boolean;
}

/* ---------- 공지 ---------- */

export type NoticeCategory = 'center' | 'youth' | 'education';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  url: string;
}

export interface Notice {
  id: string;
  title: string;
  category: NoticeCategory;
  /** 일반 텍스트. HTML 본문을 도입하면 서버·클라이언트 양쪽에서 sanitize 해야 한다. */
  body: string;
  status: PublishStatus;
  pinned: boolean;
  publishedAt: string | null;
  updatedAt: string;
  attachments: Attachment[];
}

/* ---------- 동아리 ---------- */

/** 센터 공식 채널에서 가져온 사진 — 출처를 함께 보관한다 (사용 권한은 센터 확인 필요) */
export interface MediaPhoto {
  url: string;
  caption: string;
  sourceUrl: string;
  date: string | null;
}

export interface ClubActivity {
  /** YYYY-MM-DD 또는 월까지만 확인된 경우 YYYY-MM */
  date: string;
  title: string;
  url: string | null;
}

export interface Club {
  id: string;
  name: string;
  field: string;
  summary: string;
  description: string;
  meetingInfo: string;
  /** 대상 (예: 중·고등학생) — 확인되지 않으면 null */
  target: string | null;
  memberCount: number;
  recruiting: boolean;
  status: 'active' | 'inactive';
  photos: MediaPhoto[];
  activities: ClubActivity[];
  /** 정보 출처 (공식 홈페이지·SNS 게시물) */
  sourceUrls: string[];
}

export type ClubRole = 'leader' | 'member';

export interface ClubMember {
  /** 동아리원에게는 마스킹된 이름만 내려온다 */
  displayName: string;
  role: ClubRole;
  joinedAt: string;
}

/** 동아리별 담당자 — 센터 직원이 회원을 지정하며, 그 동아리의 운영(회원·가입·출석·소식·소개)을 맡는다 */
export interface ClubManager {
  clubId: string;
  userId: string;
  name: string;
  email: string;
  assignedAt: string;
}

/** 담당자·직원이 보는 동아리 회원 명단 (연락처 포함 — 운영 목적 외 사용 금지) */
export interface ClubRosterEntry {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  role: ClubRole;
  joinedAt: string;
  /** 0–100, 출석 기록이 없으면 null */
  attendanceRate: number | null;
}

export interface ClubPost {
  id: string;
  kind: 'notice' | 'schedule' | 'activity';
  title: string;
  body: string;
  at: string;
}

export type ClubApplicationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ClubApplication {
  id: string;
  clubId: string;
  clubName: string;
  userId: string;
  applicantName: string;
  motivation: string;
  status: ClubApplicationStatus;
  reason: string | null;
  createdAt: string;
}

export interface MyClub {
  club: Club;
  role: ClubRole;
}

/* ---------- 출석 ---------- */

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type AttendanceTargetType = 'club' | 'program';

/** 출석을 관리하는 대상 — 동아리 또는 프로그램 */
export interface AttendanceTarget {
  type: AttendanceTargetType;
  id: string;
}

export interface AttendanceTargetSummary extends AttendanceTarget {
  name: string;
  /** 출석부 명단 인원 (동아리원 / 승인된 신청자) */
  rosterCount: number;
  sessionCount: number;
}

export interface AttendanceRecord {
  userId: string;
  name: string;
  /** 아직 체크하지 않았으면 null */
  status: AttendanceStatus | null;
  checkedAt: string | null;
  /** self: 본인이 출석 코드로 체크, manager: 담당자가 체크 */
  method: 'self' | 'manager' | null;
  note: string | null;
}

/** 출석부 한 회차 */
export interface AttendanceSession {
  id: string;
  targetType: AttendanceTargetType;
  targetId: string;
  targetName: string;
  /** YYYY-MM-DD (KST) */
  date: string;
  title: string;
  /** 본인 출석 체크가 열려 있으면 서버가 발급한 4자리 코드, 아니면 null (담당자에게만 내려온다) */
  qrTicket?: string | null;
  checkInCode: string | null;
  checkInClosesAt: string | null;
  createdAt: string;
  createdBy: string;
  records: AttendanceRecord[];
}

export interface AttendanceMark {
  userId: string;
  status: AttendanceStatus | null;
  note?: string | null;
}

/** 회원별 누적 출석 (출석률 = (출석 + 지각) / 체크된 회차, 공결은 분모에서 뺀다) */
export interface AttendanceMemberStat {
  userId: string;
  name: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** 0–100, 체크된 회차가 없으면 null */
  rate: number | null;
}

/** 내 출석 기록 한 줄 */
export interface MyAttendance {
  sessionId: string;
  targetType: AttendanceTargetType;
  targetId: string;
  targetName: string;
  date: string;
  title: string;
  status: AttendanceStatus | null;
  checkedAt: string | null;
}

/* ---------- 공간 예약 ---------- */

export interface Space {
  id: string;
  name: string;
  floor: string;
  capacity: number;
  description: string;
  /** 예약 접수 여부 (관리자가 휴관·점검 시 끈다) */
  reservable: boolean;
}

export interface TimeSlot {
  start: string; // HH:MM
  end: string; // HH:MM
  available: boolean;
}

export type ReservationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface SpaceReservation {
  id: string;
  spaceId: string;
  spaceName: string;
  userId: string;
  applicantName: string;
  phone: string;
  date: string; // YYYY-MM-DD (KST)
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  headcount: number;
  purpose: string;
  status: ReservationStatus;
  reason: string | null;
  createdAt: string;
  cancellable: boolean;
}

/* ---------- 문의·FAQ ---------- */

export type InquiryCategory = 'program' | 'space' | 'club' | 'account' | 'etc';
export type InquiryStatus = 'open' | 'answered';

export interface Inquiry {
  id: string;
  userId: string;
  authorName: string;
  category: InquiryCategory;
  title: string;
  body: string;
  status: InquiryStatus;
  createdAt: string;
  answer: { body: string; answeredAt: string; answeredBy: string } | null;
}

export interface Faq {
  id: string;
  category: InquiryCategory;
  question: string;
  answer: string;
  order: number;
  published: boolean;
}

/* ---------- 알림 ---------- */

export type NotificationKind =
  'application' | 'reservation' | 'club_application' | 'club_manager' | 'inquiry' | 'notice';

/** 서버가 처리 결과(승인·반려·답변 등)를 본인에게 알리는 항목. 읽지 않은 수는 readAt === null 로 센다. */
export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** 서비스 내부 경로 (예: /my/applications/a-1) */
  link: string;
  createdAt: string;
  readAt: string | null;
}

/* ---------- 센터 소식·갤러리 ---------- */

/** 센터 공식 채널(SNS·유튜브)의 사진·영상 — 출처를 함께 보관한다 (사용 권한은 센터 확인 필요) */
export interface MediaItem {
  kind: 'photo' | 'video';
  title: string;
  /** 사진 원본 또는 영상 재생 주소 */
  url: string;
  thumbnailUrl: string;
  /** 게시물 원문 주소 */
  sourceUrl: string;
  /** YYYY-MM-DD, 확인되지 않으면 null */
  date: string | null;
}

/* ---------- 정책 문서 ---------- */

export type PolicyKey =
  'privacy' | 'terms' | 'cookies' | 'no-email' | 'security' | 'copyright' | 'user-rights';

export interface PolicyDoc {
  key: PolicyKey;
  title: string;
  /** 일반 텍스트 */
  body: string;
  /** 센터가 확정본을 등록했는지 — false 면 화면에 "확정본 미등록"을 표시한다 */
  confirmed: boolean;
  effectiveAt: string | null;
  updatedAt: string;
}

/* ---------- 관리자 ---------- */

export interface AuditEvent {
  id: string;
  at: string;
  actorName: string;
  action: string;
  targetType:
    | 'notice'
    | 'program'
    | 'application'
    | 'user'
    | 'club'
    | 'club_application'
    | 'space'
    | 'reservation'
    | 'inquiry'
    | 'faq'
    | 'policy'
    | 'site_settings'
    | 'attendance';
  targetId: string;
  summary: string;
}

export interface DashboardSummary {
  generatedAt: string;
  programsOpen: number;
  applicationsSubmitted: number;
  applicationsInPeriod: number;
  clubApplicationsPending: number;
  reservationsPending: number;
  inquiriesOpen: number;
  noticesPublished: number;
  recentApplications: ProgramApplication[];
  recentNotices: Notice[];
}

export interface BulkResult {
  succeeded: string[];
  failed: { id: string; reason: string }[];
}
