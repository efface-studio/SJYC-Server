import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  WEB_PUBLIC_URL: z.url().default('http://localhost:3000'),
  API_PUBLIC_URL: z.url().default('http://localhost:4000/api/v1'),
  KAKAO_CLIENT_ID: z.string().optional(),
  KAKAO_CLIENT_SECRET: z.string().optional(),
  NAVER_CLIENT_ID: z.string().optional(),
  NAVER_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  /** 비우면 메일을 보내지 않고 로그로 남긴다 (운영은 필수) */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('중구청소년센터 <no-reply@localhost>'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** 환경 변수 — 처음 읽을 때 검증하고, 잘못되면 어떤 값이 문제인지 알려 주고 기동을 멈춘다 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`환경 변수가 올바르지 않습니다 — ${detail}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.SMTP_URL) {
    throw new Error('환경 변수가 올바르지 않습니다 — 운영에서는 SMTP_URL 이 필요합니다 (인증·재설정 메일)');
  }
  cached = parsed.data;
  return cached;
}

/** 테스트에서 환경 변수를 바꾼 뒤 다시 읽게 한다 */
export function resetEnvCache(): void {
  cached = null;
}

export const isProd = () => env().NODE_ENV === 'production';

/** CORS·CSRF 에서 허용하는 웹 Origin 목록 */
export const webOrigins = () =>
  env()
    .WEB_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
