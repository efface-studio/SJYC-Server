import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env, isProd, webOrigins } from '../config/env';

export const XSRF_COOKIE = 'XSRF-TOKEN';
export const XSRF_HEADER = 'x-xsrf-token';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * CSRF 방어 (double-submit) — 웹은 XSRF-TOKEN 쿠키를 읽어 X-XSRF-TOKEN 헤더로 되돌려 보낸다.
 * - 브라우저 요청(Origin 헤더 있음): 허용된 웹 Origin 이고 헤더·쿠키 토큰이 같아야 한다.
 * - Origin 이 없는 요청(네이티브 앱): 다른 사이트가 사용자의 브라우저로 위조할 수 없으므로 세션만 검사한다.
 */
export function csrf(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[XSRF_COOKIE]) {
    res.cookie(XSRF_COOKIE, randomBytes(24).toString('base64url'), {
      sameSite: 'lax',
      secure: isProd(),
      domain: env().COOKIE_DOMAIN,
      path: '/',
    });
  }
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const cookie = req.cookies?.[XSRF_COOKIE] as string | undefined;
  const header = req.get(XSRF_HEADER);
  if (webOrigins().includes(origin) && cookie && header && same(cookie, header)) return next();
  res.status(403).json({
    success: false,
    error: {
      code: 'FORBIDDEN',
      message: '보안 확인에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    },
  });
}
