import type {
  ClubRole,
  AttendanceStatus,
  AttendanceTargetType,
  ApplicationStatus,
  ClubApplicationStatus,
  InquiryCategory,
  InquiryStatus,
  NoticeCategory,
  NotificationKind,
  OAuthProvider,
  PolicyKey,
  PublishStatus,
  RecruitStatus,
  ReservationStatus,
  UserStatus,
} from './types';

export type Tone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'info';

interface Label {
  text: string;
  tone: Tone;
}

/** 공식 홈페이지 커뮤니티 분류명을 그대로 사용 */
export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  center: '센터공지',
  youth: '청소년활동공지',
  education: '체육/교육문화공지',
};

export const RECRUIT_STATUS: Record<RecruitStatus, Label> = {
  upcoming: { text: '모집 예정', tone: 'info' },
  open: { text: '모집 중', tone: 'brand' },
  full: { text: '정원 마감', tone: 'warning' },
  closed: { text: '모집 종료', tone: 'neutral' },
};

export const PUBLISH_STATUS: Record<PublishStatus, Label> = {
  draft: { text: '임시 저장', tone: 'neutral' },
  published: { text: '게시', tone: 'success' },
  hidden: { text: '비공개', tone: 'warning' },
};

export const APPLICATION_STATUS: Record<ApplicationStatus, Label> = {
  submitted: { text: '접수', tone: 'info' },
  approved: { text: '승인', tone: 'success' },
  rejected: { text: '반려', tone: 'danger' },
  cancelled: { text: '취소', tone: 'neutral' },
};

export const CLUB_APPLICATION_STATUS: Record<ClubApplicationStatus, Label> = {
  pending: { text: '검토 대기', tone: 'info' },
  approved: { text: '승인', tone: 'success' },
  rejected: { text: '반려', tone: 'danger' },
  cancelled: { text: '취소', tone: 'neutral' },
};

export const USER_STATUS: Record<UserStatus, Label> = {
  active: { text: '정상', tone: 'success' },
  suspended: { text: '이용 정지', tone: 'danger' },
  withdrawn: { text: '탈퇴', tone: 'neutral' },
};

export const RESERVATION_STATUS: Record<ReservationStatus, Label> = {
  pending: { text: '승인 대기', tone: 'info' },
  approved: { text: '예약 확정', tone: 'success' },
  rejected: { text: '반려', tone: 'danger' },
  cancelled: { text: '취소', tone: 'neutral' },
};

export const CLUB_ROLE_LABEL: Record<ClubRole, string> = { leader: '대표', member: '동아리원' };

export const CLUB_POST_KIND_LABEL: Record<'notice' | 'schedule' | 'activity', string> = {
  notice: '공지',
  schedule: '일정',
  activity: '활동',
};

export const ATTENDANCE_STATUS: Record<AttendanceStatus, Label> = {
  present: { text: '출석', tone: 'success' },
  late: { text: '지각', tone: 'warning' },
  absent: { text: '결석', tone: 'danger' },
  excused: { text: '공결', tone: 'info' },
};

export const ATTENDANCE_TARGET_LABEL: Record<AttendanceTargetType, string> = {
  club: '동아리',
  program: '프로그램',
};

export const INQUIRY_STATUS: Record<InquiryStatus, Label> = {
  open: { text: '답변 대기', tone: 'info' },
  answered: { text: '답변 완료', tone: 'success' },
};

export const INQUIRY_CATEGORY_LABEL: Record<InquiryCategory, string> = {
  program: '프로그램',
  space: '공간 예약',
  club: '동아리',
  account: '회원·계정',
  etc: '기타',
};

export const POLICY_TITLE: Record<PolicyKey, string> = {
  privacy: '개인정보 처리방침',
  terms: '서비스 이용약관',
  cookies: '쿠키 정책',
  'no-email': '이메일무단수집거부',
  security: '보안 취약점 신고',
  copyright: '저작권 안내',
  'user-rights': '이용자의 권리 및 유의사항',
};

/** 푸터·정책 탭 노출 순서. 오픈소스 라이선스는 서버 문서가 아니라 설치 패키지에서 생성한 목록이다. */
export const POLICY_NAV: { key: PolicyKey | 'opensource'; title: string }[] = [
  { key: 'privacy', title: POLICY_TITLE.privacy },
  { key: 'terms', title: POLICY_TITLE.terms },
  { key: 'opensource', title: '오픈소스 라이선스' },
  { key: 'cookies', title: POLICY_TITLE.cookies },
  { key: 'no-email', title: POLICY_TITLE['no-email'] },
  { key: 'security', title: POLICY_TITLE.security },
  { key: 'copyright', title: POLICY_TITLE.copyright },
  { key: 'user-rights', title: POLICY_TITLE['user-rights'] },
];

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  application: '프로그램 신청',
  reservation: '공간 예약',
  club_application: '동아리 가입',
  inquiry: '1:1 문의',
  notice: '공지',
  club_manager: '동아리 담당',
};

export const OAUTH_PROVIDER_LABEL: Record<OAuthProvider, string> = {
  kakao: '카카오',
  naver: '네이버',
  apple: 'Apple',
  google: 'Google',
};
