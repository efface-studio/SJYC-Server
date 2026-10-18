import { createHash, randomBytes } from 'node:crypto';

/** URL·쿠키에 넣는 임의 토큰 (256bit) */
export const randomToken = () => randomBytes(32).toString('base64url');

/** 저장용 해시 — 원문 토큰은 DB 에 남기지 않는다 */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
