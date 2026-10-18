import { HttpException } from '@nestjs/common';
import { DEFAULT_MESSAGE, type ApiErrorCode, type ConflictReason } from '../shared/api/errors';

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER: 500,
  NOT_CONFIGURED: 503,
  NETWORK: 503,
};

export interface AppExceptionOptions {
  /** CONFLICT 세부 사유 — 화면이 안내 문구를 고르는 데 쓴다 */
  reason?: ConflictReason;
  /** 필드별 오류 메시지 — 폼 필드 아래에 그대로 표시된다 */
  fieldErrors?: Record<string, string>;
}

/**
 * 도메인 에러. 클라이언트 계약(src/shared/api/errors.ts)의 코드와 사용자에게 보여줄 한국어 메시지를 담는다.
 * 상태 코드는 code 로 정해진다.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message?: string,
    readonly detail: AppExceptionOptions = {},
  ) {
    super(message ?? DEFAULT_MESSAGE[code], STATUS[code]);
  }
}
