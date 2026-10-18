export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NOT_CONFIGURED'
  | 'NETWORK'
  | 'SERVER';

/** CONFLICT 세부 사유 — 화면 안내 문구를 고르는 데만 쓴다 */
export type ConflictReason =
  | 'DUPLICATE'
  | 'CAPACITY_FULL'
  | 'RECRUIT_CLOSED'
  | 'EMAIL_TAKEN'
  | 'CANCEL_DEADLINE_PASSED'
  | 'INVALID_STATE';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly reason: ConflictReason | null;
  readonly fieldErrors: Record<string, string> | null;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { reason?: ConflictReason; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.reason = opts.reason ?? null;
    this.fieldErrors = opts.fieldErrors ?? null;
  }
}

export const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: '로그인이 필요하거나 로그인이 만료되었습니다.',
  FORBIDDEN: '이 작업을 수행할 권한이 없습니다.',
  NOT_FOUND: '요청한 정보를 찾을 수 없습니다.',
  VALIDATION: '입력값을 확인해 주세요.',
  CONFLICT: '현재 상태에서는 처리할 수 없습니다.',
  RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  NOT_CONFIGURED: '아직 설정되지 않은 기능입니다.',
  NETWORK: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  SERVER: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

/** 사용자에게 보여줄 안전한 메시지. 알 수 없는 오류의 내부 내용은 노출하지 않는다. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message || DEFAULT_MESSAGE[error.code];
  return DEFAULT_MESSAGE.SERVER;
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
