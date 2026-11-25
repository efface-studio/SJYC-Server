import { z } from 'zod';

/**
 * 폼 입력 검증 스키마. 클라이언트 검증은 사용성 목적이며 서버가 같은 규칙으로 다시 검증한다.
 * FormData 를 그대로 넘기므로 체크박스는 'on' | undefined 로 들어온다.
 */

const checked = z.literal('on', { error: '필수 항목에 동의해 주세요.' });
const optionalChecked = z
  .literal('on')
  .optional()
  .transform((v) => v === 'on');

const email = z
  .string()
  .trim()
  .min(1, { error: '이메일을 입력해 주세요.' })
  .pipe(z.email({ error: '올바른 이메일 형식이 아닙니다.' }));

const password = z
  .string()
  .min(8, { error: '비밀번호는 8자 이상이어야 합니다.' })
  .max(64, { error: '비밀번호는 64자 이하여야 합니다.' })
  .regex(/[A-Za-z]/, { error: '영문자를 1자 이상 포함해 주세요.' })
  .regex(/\d/, { error: '숫자를 1자 이상 포함해 주세요.' });

const phone = z
  .string()
  .trim()
  .regex(/^01[016789]-?\d{3,4}-?\d{4}$/, { error: '휴대전화 번호 형식을 확인해 주세요. 예) 010-1234-5678' });

const name = z
  .string()
  .trim()
  .min(2, { error: '이름은 2자 이상 입력해 주세요.' })
  .max(20, { error: '이름은 20자 이하로 입력해 주세요.' });

/** 다른 필드(동의 등)에 오류가 있어도 비밀번호 확인 오류를 함께 보여주도록 when 으로 실행 조건을 좁힌다 */
const passwordMatch = {
  error: '비밀번호가 일치하지 않습니다.',
  path: ['passwordConfirm'],
  when: (payload: { value: unknown }) => {
    const v = payload.value as { password?: unknown; passwordConfirm?: unknown };
    return typeof v.password === 'string' && typeof v.passwordConfirm === 'string';
  },
};

export const loginSchema = z.object({
  email,
  password: z.string().min(1, { error: '비밀번호를 입력해 주세요.' }),
});

const currentYear = new Date().getFullYear();

export const signupSchema = z
  .object({
    name,
    email,
    phone: z.union([z.literal(''), phone]).optional(),
    password,
    passwordConfirm: z.string(),
    birthYear: z.coerce
      .number({ error: '출생 연도를 입력해 주세요.' })
      .int()
      .min(1920, { error: '출생 연도를 확인해 주세요.' })
      .max(currentYear, { error: '출생 연도를 확인해 주세요.' }),
    agreeTerms: checked,
    agreePrivacy: checked,
    agreeMarketing: optionalChecked,
  })
  .refine((v) => v.password === v.passwordConfirm, passwordMatch);

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, passwordMatch);

export const profileSchema = z.object({
  name,
  phone: z.union([z.literal(''), phone]),
  agreeMarketing: optionalChecked,
});

export const withdrawSchema = z.object({
  confirmText: z.literal('탈퇴합니다', { error: '"탈퇴합니다"를 정확히 입력해 주세요.' }),
  agreeWithdraw: checked,
});

export const programApplySchema = z.object({
  phone,
  note: z.string().trim().max(300, { error: '300자 이하로 입력해 주세요.' }),
  agreePrivacy: checked,
});

export const clubApplySchema = z.object({
  motivation: z
    .string()
    .trim()
    .min(10, { error: '가입 동기를 10자 이상 입력해 주세요.' })
    .max(500, { error: '500자 이하로 입력해 주세요.' }),
  agreePrivacy: checked,
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: '시간을 선택해 주세요.' });
const inquiryCategory = z.enum(['program', 'space', 'club', 'account', 'etc'], {
  error: '분류를 선택해 주세요.',
});

export const reservationSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '이용 날짜를 선택해 주세요.' }),
    startTime: time,
    endTime: time,
    headcount: z.coerce
      .number({ error: '이용 인원을 입력해 주세요.' })
      .int({ error: '이용 인원은 정수로 입력해 주세요.' })
      .min(1, { error: '이용 인원은 1명 이상이어야 합니다.' })
      .max(300, { error: '이용 인원을 확인해 주세요.' }),
    phone,
    purpose: z
      .string()
      .trim()
      .min(5, { error: '이용 목적을 5자 이상 입력해 주세요.' })
      .max(300, { error: '300자 이하로 입력해 주세요.' }),
    agreePrivacy: checked,
  })
  .refine((v) => v.startTime < v.endTime, {
    error: '종료 시간은 시작 시간 이후여야 합니다.',
    path: ['endTime'],
  });

export const inquirySchema = z.object({
  category: inquiryCategory,
  title: z
    .string()
    .trim()
    .min(2, { error: '제목을 2자 이상 입력해 주세요.' })
    .max(100, { error: '100자 이하로 입력해 주세요.' }),
  body: z
    .string()
    .trim()
    .min(10, { error: '문의 내용을 10자 이상 입력해 주세요.' })
    .max(3000, { error: '3,000자 이하로 입력해 주세요.' }),
  agreePrivacy: checked,
});

/* ---------- 관리자 ---------- */

export const answerSchema = z.object({
  body: z
    .string()
    .trim()
    .min(2, { error: '답변을 2자 이상 입력해 주세요.' })
    .max(5000, { error: '5,000자 이하로 입력해 주세요.' }),
});

export const faqFormSchema = z.object({
  category: inquiryCategory,
  question: z.string().trim().min(2, { error: '질문을 입력해 주세요.' }).max(200),
  answer: z.string().trim().min(2, { error: '답변을 입력해 주세요.' }).max(5000),
  order: z.coerce.number({ error: '순서를 입력해 주세요.' }).int().min(0).max(999),
  published: optionalChecked,
});

export const policyFormSchema = z.object({
  body: z.string().trim().min(10, { error: '본문을 입력해 주세요.' }).max(50000),
  effectiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '시행일을 입력해 주세요.' }),
});

export const spaceFormSchema = z.object({
  description: z.string().trim().min(1, { error: '설명을 입력해 주세요.' }).max(500),
  capacity: z.coerce.number({ error: '수용 인원을 입력해 주세요.' }).int().min(1).max(1000),
  reservable: optionalChecked,
});

const publishStatus = z.enum(['draft', 'published', 'hidden'], { error: '상태를 선택해 주세요.' });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '날짜를 입력해 주세요.' });

export const noticeFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, { error: '제목을 2자 이상 입력해 주세요.' })
    .max(100, { error: '제목은 100자 이하로 입력해 주세요.' }),
  category: z.enum(['center', 'youth', 'education'], { error: '분류를 선택해 주세요.' }),
  body: z
    .string()
    .trim()
    .min(1, { error: '본문을 입력해 주세요.' })
    .max(10000, { error: '본문은 10,000자 이하로 입력해 주세요.' }),
  pinned: optionalChecked,
  status: publishStatus,
});

export const programFormSchema = z
  .object({
    title: z.string().trim().min(2, { error: '제목을 2자 이상 입력해 주세요.' }).max(100),
    categoryId: z.string().min(1, { error: '분류를 선택해 주세요.' }),
    summary: z
      .string()
      .trim()
      .min(1, { error: '요약을 입력해 주세요.' })
      .max(120, { error: '120자 이하로 입력해 주세요.' }),
    description: z.string().trim().min(1, { error: '상세 내용을 입력해 주세요.' }).max(10000),
    target: z.string().trim().min(1, { error: '대상을 입력해 주세요.' }).max(100),
    place: z.string().trim().min(1, { error: '장소를 입력해 주세요.' }).max(100),
    startsAt: dateOnly,
    endsAt: dateOnly,
    recruitStartsAt: dateOnly,
    recruitEndsAt: dateOnly,
    cancelDeadline: dateOnly,
    capacity: z.coerce
      .number({ error: '정원을 입력해 주세요.' })
      .int({ error: '정원은 정수로 입력해 주세요.' })
      .min(1, { error: '정원은 1명 이상이어야 합니다.' })
      .max(1000, { error: '정원은 1,000명 이하로 입력해 주세요.' }),
    status: publishStatus,
  })
  .refine((v) => v.startsAt <= v.endsAt, { error: '종료일은 시작일 이후여야 합니다.', path: ['endsAt'] })
  .refine((v) => v.recruitStartsAt <= v.recruitEndsAt, {
    error: '모집 마감일은 모집 시작일 이후여야 합니다.',
    path: ['recruitEndsAt'],
  })
  .refine((v) => v.recruitEndsAt <= v.startsAt, {
    error: '모집 마감일은 프로그램 시작일 이전이어야 합니다.',
    path: ['recruitEndsAt'],
  });

/** 외부 링크·이미지 주소 — https 만 허용 (javascript:, http: 등 차단) */
const httpsUrl = z
  .string()
  .trim()
  .pipe(
    z.url({
      protocol: /^https$/,
      hostname: /\./,
      error: 'https:// 로 시작하는 올바른 주소를 입력해 주세요.',
    }),
  );
/** 빈 값이면 null */
const optionalHttpsUrl = z
  .union([z.literal(''), httpsUrl])
  .nullish()
  .transform((v) => v || null);
const optionalDate = z
  .union([z.literal(''), dateOnly])
  .nullish()
  .transform((v) => v || null);

/**
 * 소개 확장 필드(target·photos·activities·sourceUrls)는 선택 항목이다.
 * 보내지 않으면 서버는 기존 값을 유지한다 (이전 버전 클라이언트·모바일 관리자 앱 호환).
 */
export const clubFormSchema = z.object({
  name: z.string().trim().min(2, { error: '동아리명을 2자 이상 입력해 주세요.' }).max(40),
  field: z.string().trim().min(1, { error: '활동 분야를 입력해 주세요.' }).max(40),
  summary: z.string().trim().min(1, { error: '한 줄 소개를 입력해 주세요.' }).max(120),
  description: z.string().trim().min(1, { error: '소개를 입력해 주세요.' }).max(5000),
  meetingInfo: z.string().trim().min(1, { error: '모임 안내를 입력해 주세요.' }).max(200),
  recruiting: optionalChecked,
  status: z.enum(['active', 'inactive']),
  target: z
    .string()
    .trim()
    .max(100, { error: '100자 이하로 입력해 주세요.' })
    .transform((v) => v || null)
    .nullish(),
  photos: z
    .array(
      z.object({
        url: httpsUrl,
        caption: z
          .string()
          .trim()
          .min(1, { error: '사진 설명을 입력해 주세요.' })
          .max(100, { error: '100자 이하로 입력해 주세요.' }),
        sourceUrl: httpsUrl,
        date: optionalDate,
      }),
    )
    .max(20, { error: '사진은 20장까지 등록할 수 있습니다.' })
    .optional(),
  activities: z
    .array(
      z.object({
        // 공식 게시물에 월까지만 나온 활동도 있다 (예: 2026-09)
        date: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}(-\d{2})?$/, { error: 'YYYY-MM-DD 또는 YYYY-MM 형식으로 입력해 주세요.' }),
        title: z
          .string()
          .trim()
          .min(1, { error: '활동명을 입력해 주세요.' })
          .max(100, { error: '100자 이하로 입력해 주세요.' }),
        url: optionalHttpsUrl,
      }),
    )
    .max(30, { error: '활동은 30개까지 등록할 수 있습니다.' })
    .optional(),
  sourceUrls: z.array(httpsUrl).max(10, { error: '출처는 10개까지 등록할 수 있습니다.' }).optional(),
});

export const clubIntroSchema = z.object({
  summary: z.string().trim().min(5, { error: '한 줄 소개를 5자 이상 입력해 주세요.' }).max(120),
  description: z.string().trim().min(10, { error: '소개를 10자 이상 입력해 주세요.' }).max(5000),
  meetingInfo: z.string().trim().min(2, { error: '모임 일정을 입력해 주세요.' }).max(100),
  recruiting: z.union([z.boolean(), optionalChecked]),
});

export const clubPostSchema = z.object({
  kind: z.enum(['notice', 'schedule', 'activity'], { error: '분류를 선택해 주세요.' }),
  title: z.string().trim().min(2, { error: '제목을 2자 이상 입력해 주세요.' }).max(100),
  body: z.string().trim().min(2, { error: '내용을 입력해 주세요.' }).max(2000),
});

export const managerEmailSchema = z.object({ email });

export const attendanceSessionSchema = z.object({
  date: dateOnly,
  title: z
    .string()
    .trim()
    .min(1, { error: '회차 이름을 입력해 주세요.' })
    .max(50, { error: '50자 이하로 입력해 주세요.' }),
});

export const checkInSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4}$/, { error: '출석 코드 4자리를 입력해 주세요.' }),
});

export const rejectReasonSchema = z.object({
  reason: z.string().trim().min(2, { error: '반려 사유를 2자 이상 입력해 주세요.' }).max(300),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type ProgramApplyInput = z.infer<typeof programApplySchema>;
export type ClubApplyInput = z.infer<typeof clubApplySchema>;
export type NoticeFormInput = z.infer<typeof noticeFormSchema>;
export type ProgramFormInput = z.infer<typeof programFormSchema>;
export type ClubFormInput = z.infer<typeof clubFormSchema>;
export type ReservationInput = z.infer<typeof reservationSchema>;
export type InquiryInput = z.infer<typeof inquirySchema>;
export type FaqFormInput = z.infer<typeof faqFormSchema>;
export type PolicyFormInput = z.infer<typeof policyFormSchema>;
export type SpaceFormInput = z.infer<typeof spaceFormSchema>;
export type AttendanceSessionInput = z.infer<typeof attendanceSessionSchema>;
export type ClubIntroInput = z.infer<typeof clubIntroSchema>;
export type ClubPostInput = z.infer<typeof clubPostSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;

export type FieldErrors = Record<string, string>;

type ParseResult<T extends z.ZodType> = { ok: true; data: z.output<T> } | { ok: false; errors: FieldErrors };

/**
 * 값 객체 → 스키마 검증. 필드별 첫 오류 메시지만 돌려준다. (모바일 앱은 이 함수를 직접 쓴다)
 * 배열 항목 오류는 최상위 키(`photos`)와 전체 경로(`photos.0.url`) 두 곳에 기록한다.
 */
export function parseValues<T extends z.ZodType>(schema: T, raw: Record<string, unknown>): ParseResult<T> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
    if (issue.path.length > 1) errors[issue.path.join('.')] ??= issue.message;
  }
  return { ok: false, errors };
}

/** FormData → 스키마 검증 (웹 폼). DOM 타입에 의존하지 않도록 순회 가능한 항목으로 받는다. */
export function parseForm<T extends z.ZodType>(
  schema: T,
  formData: { entries(): Iterable<[string, unknown]> },
): ParseResult<T> {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') raw[key] = value;
  }
  return parseValues(schema, raw);
}
