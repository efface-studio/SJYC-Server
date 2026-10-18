import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { DEFAULT_MESSAGE, type ApiErrorCode, type ConflictReason } from '../shared/api/errors';
import { AppException } from './app-exception';
import { logger } from './logger';

export interface ErrorBody {
  code: ApiErrorCode;
  message: string;
  reason?: ConflictReason;
  fieldErrors?: Record<string, string>;
}

const STATUS_CODE: Record<number, ApiErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION',
  422: 'VALIDATION',
  429: 'RATE_LIMITED',
};

/** 예외 → 응답 상태와 오류 본문. 알 수 없는 오류의 내부 내용은 노출하지 않는다 */
export function toErrorResponse(e: unknown): { status: number; body: ErrorBody } {
  if (e instanceof AppException) {
    return {
      status: e.getStatus(),
      body: { code: e.code, message: e.message, ...e.detail },
    };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      return {
        status: 409,
        body: { code: 'CONFLICT', message: '이미 처리된 요청입니다.', reason: 'DUPLICATE' },
      };
    }
    if (e.code === 'P2025') {
      return { status: 404, body: { code: 'NOT_FOUND', message: DEFAULT_MESSAGE.NOT_FOUND } };
    }
  }
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const code = STATUS_CODE[status] ?? 'SERVER';
    return { status, body: { code, message: DEFAULT_MESSAGE[code] } };
  }
  return { status: 500, body: { code: 'SERVER', message: DEFAULT_MESSAGE.SERVER } };
}

/** 모든 오류를 `{ success: false, error }` 형태로 돌려준다 (웹·앱 http 어댑터 계약) */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) logger.error({ err: exception }, '처리하지 못한 오류');
    res.status(status).json({ success: false, error: body });
  }
}
