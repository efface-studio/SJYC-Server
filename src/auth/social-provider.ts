import { createHash } from 'node:crypto';
import type { OAuthProvider } from '@prisma/client';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
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
  if (provider === 'google') return false;
  if (provider === 'apple') {
    const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, API_PUBLIC_URL } = env();
    return (
      !!id &&
      new URL(API_PUBLIC_URL).protocol === 'https:' &&
      !!(secret || (APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY))
    );
  }
  return !!id && (provider === 'kakao' || !!secret);
}

async function tokenSecret(provider: OAuthProvider) {
  const { id, secret } = credentials(provider);
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = env();
  if (provider !== 'apple' || !id || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) return secret;
  const key = await importPKCS8(APPLE_PRIVATE_KEY.replaceAll('\\n', '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(id)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

export function availableProviders(nativeIOS = false) {
  return (['kakao', 'naver', 'apple', 'google'] as const).filter((p) =>
    p === 'apple' && nativeIOS ? !!env().APPLE_IOS_BUNDLE_ID : configured(p),
  );
}

export async function nativeAppleSubject(identityToken: string, nonce: string) {
  const audience = env().APPLE_IOS_BUNDLE_ID;
  if (!audience) throw new AppException('NOT_CONFIGURED');
  try {
    const { payload } = await jwtVerify(identityToken, appleKeys, {
      issuer: 'https://appleid.apple.com',
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'nonce'],
    });
    if (payload.nonce === nonce) return z.string().min(1).max(255).parse(payload.sub);
  } catch {
    /* Do not expose tokens or provider errors. */
  }
  throw new AppException('VALIDATION', 'Apple 인증을 확인할 수 없습니다. 다시 시도해 주세요.');
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
  // Only the stable subject is needed. Apple's code-only flow supports a GET callback.
  if (provider === 'apple') url.searchParams.set('response_mode', 'query');
  if (provider === 'apple' || provider === 'google') url.searchParams.set('nonce', nonce(verifier));
  return url.href;
}

export async function providerSubject(
  provider: OAuthProvider,
  code: string,
  state: string,
  verifier: string,
) {
  const { id } = credentials(provider);
  if (!configured(provider) || !id) throw new AppException('NOT_CONFIGURED');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id,
    code,
    redirect_uri: redirect(provider),
  });
  const secret = await tokenSecret(provider);
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
