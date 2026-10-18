// 통합 테스트 환경 변수 — 실제 PostgreSQL·Redis 를 쓰고, 외부 연동(메일)은 테스트 더블로 교체한다.
const defaults: Record<string, string> = {
  DATABASE_URL_TEST: 'postgresql://sjyc:sjyc@localhost:5434/sjyc_test',
  // 개발 서버는 db 0 을 쓴다 — 테스트는 db 15 만 쓰고 비운다 (app.ts 에서 db 0 이면 거부)
  REDIS_URL_TEST: 'redis://localhost:6381/15',
  WEB_ORIGIN: 'http://localhost:3000',
  WEB_PUBLIC_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:4000/api/v1',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.REDIS_URL = process.env.REDIS_URL_TEST;
