import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

/** 로그에서 세션·토큰·비밀번호·개인정보를 가린다 */
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-xsrf-token"]',
  'res.headers["set-cookie"]',
  'res.headers.location',
  '*.password',
  '*.passwordConfirm',
  '*.token',
  '*.code',
  '*.phone',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: REDACT, censor: '[redacted]' },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export function routeTemplate(req: Request): string {
  const template: unknown = req.route?.path;
  return typeof template === 'string' ? template : '(경로 미지정)';
}

export const httpLogger = pinoHttp<Request>({
  logger,
  genReqId: (_req, res) => {
    const id = randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  serializers: {
    req: (req: { id: string; method: string }) => ({
      id: req.id,
      method: req.method,
    }),
  },
  customSuccessObject: (req, _res, entry) => ({ ...entry, route: routeTemplate(req) }),
  customErrorObject: (req, _res, _err, entry) => ({ ...entry, route: routeTemplate(req) }),
  autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
});
