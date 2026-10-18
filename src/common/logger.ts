import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

/** 로그에서 세션·토큰·비밀번호·개인정보를 가린다 */
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-xsrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordConfirm',
  '*.token',
  '*.code',
  '*.phone',
];

/** URL 쿼리로 오는 인증 값 — 요청 로그에서 값만 가린다 */
const SECRET_QUERY = /^(code|state|token|password)$/i;

export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let hit = false;
  for (const key of new Set(params.keys())) {
    if (SECRET_QUERY.test(key)) {
      params.set(key, '[redacted]');
      hit = true;
    }
  }
  return hit ? `${url.slice(0, q)}?${params.toString()}` : url;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: REDACT, censor: '[redacted]' },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  serializers: {
    req: (req: { id: string; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: redactUrl(req.url),
    }),
  },
  autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
});
