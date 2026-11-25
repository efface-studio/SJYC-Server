import { createHash } from 'node:crypto';
import type { OAuthProvider } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { env } from '../config/env';

const endpoints = {
  google: ['https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token'],
  apple: ['https://appleid.apple.com/auth/authorize', 'https://appleid.apple.com/auth/token'],
  kakao: ['https://kauth.kakao.com/oauth/authorize', 'https://kauth.kakao.com/oauth/token'],
  naver: ['https://nid.naver.com/oauth2.0/authorize', 'https://nid.naver.com/oauth2.0/token'],
} as const;
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function credentials(provider: OAuthProvider) {
  const e = env();
  return {
    google: { id: e.GOOGLE_CLIENT_ID, secret: e.GOOGLE_CLIENT_SECRET },
    apple: { id: e.APPLE_CLIENT_ID, secret: e.APPLE_CLIENT_SECRET },
    kakao: { id: e.KAKAO_CLIENT_ID, secret: e.KAKAO_CLIENT_SECRET },
    naver: { id: e.NAVER_CLIENT_ID, secret: e.NAVER_CLIENT_SECRET },
  }[provider];
}

export function configured(provider: OAuthProvider) {
  const { id, secret } = credentials(provider);
  return !!id && (provider === 'kakao' || !!secret);
}

const nonce = (verifier: string) =>
  createHash('sha256')
    .update('nonce:' + verifier)
    .digest('base64url');

const redirect = (provider: OAuthProvider) =>
  env().API_PUBLIC_URL.replace(/\/$/, '') + '/auth/social/' + provider + '/callback';

export function authorize(provider: OAuthProvider, state: string, verifier: string) {
  const { id } = credentials(provider);
  if (!configured(provider) || !id)
    throw new AppException('NOT_CONFIGURED', '이 로그인 수단을 아직 연결할 수 없습니다.');
  const url = new URL(endpoints[provider][0]);
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect(provider),
    response_type: 'code',
    state,
  }).toString();
  if (provider === 'google') {
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  }
  if (provider === 'apple' || provider === 'google') url.searchParams.set('nonce', nonce(verifier));
  return url.href;
}

export async function providerSubject(
  provider: OAuthProvider,
  code: string,
  state: string,
  verifier: string,
) {
  const { id, secret } = credentials(provider);
  if (!id) throw new AppException('NOT_CONFIGURED');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id,
    code,
    redirect_uri: redirect(provider),
  });
  if (secret) form.set('client_secret', secret);
  if (provider === 'google') form.set('code_verifier', verifier);
  if (provider === 'naver') form.set('state', state);
  const response = await fetch(endpoints[provider][1], {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new AppException('VALIDATION');
  const token = z
    .object({ access_token: z.string().optional(), id_token: z.string().optional() })
    .parse(await response.json());
  if (provider === 'apple' || provider === 'google') {
    const apple = provider === 'apple';
    const { payload } = await jwtVerify(token.id_token ?? '', apple ? appleKeys : googleKeys, {
      issuer: apple ? 'https://appleid.apple.com' : ['https://accounts.google.com', 'accounts.google.com'],
      audience: id,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'nonce'],
    });
    if (payload.nonce !== nonce(verifier)) throw new AppException('VALIDATION');
    return z.string().min(1).max(255).parse(payload.sub);
  }
  if (!token.access_token) throw new AppException('VALIDATION');
  const info = await fetch(
    provider === 'kakao' ? 'https://kapi.kakao.com/v2/user/me' : 'https://openapi.naver.com/v1/nid/me',
    {
      headers: { Authorization: 'Bearer ' + token.access_token },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!info.ok) throw new AppException('VALIDATION');
  const data: unknown = await info.json();
  if (provider === 'kakao')
    return String(z.object({ id: z.number().int().positive().safe() }).parse(data).id);
  return z
    .object({ resultcode: z.literal('00'), response: z.object({ id: z.string().min(1).max(255) }) })
    .parse(data).response.id;
}
