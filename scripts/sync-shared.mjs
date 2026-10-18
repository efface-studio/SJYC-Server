// 웹 저장소(SJYC-Client)의 도메인 규칙을 src/shared 로 복사한다.
// 사용: pnpm sync:shared  (웹 저장소 위치: SJYC_CLIENT_DIR, 기본값 ../SJYC-Client → 없으면 ../center)
// 원본은 웹 저장소다. src/shared 는 직접 고치지 말고 웹에서 고친 뒤 동기화한다 — 검증·권한 규칙이 웹·앱·서버에서 같아야 한다.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = join(import.meta.dirname, '..');
const candidates = [
  process.env.SJYC_CLIENT_DIR,
  join(here, '..', 'SJYC-Client'),
  join(here, '..', 'center'),
].filter(Boolean);
const client = candidates.find((dir) => existsSync(join(dir, 'src', 'domain', 'types.ts')));
if (!client) {
  console.error('SJYC-Client 저장소를 찾지 못했습니다. SJYC_CLIENT_DIR 를 지정해 주세요.');
  process.exit(1);
}

/** [원본, 대상] — 모두 DOM·Next 에 의존하지 않는 순수 TS */
const FILES = [
  ['src/domain/types.ts', 'domain/types.ts'],
  ['src/domain/schemas.ts', 'domain/schemas.ts'],
  ['src/domain/permissions.ts', 'domain/permissions.ts'],
  ['src/domain/labels.ts', 'domain/labels.ts'],
  ['src/domain/program.ts', 'domain/program.ts'],
  ['src/domain/space.ts', 'domain/space.ts'],
  ['src/domain/attendance.ts', 'domain/attendance.ts'],
  ['src/lib/format.ts', 'lib/format.ts'],
  ['src/api/errors.ts', 'api/errors.ts'],
  // 개발·시연용 데이터 (pnpm db:seed) — 웹 mock 과 같은 샘플·참고 정보
  ['src/api/mock/seed.ts', 'mock/seed.ts'],
  ['src/api/mock/research.ts', 'mock/research.ts'],
];

const target = join(here, 'src', 'shared');
rmSync(target, { recursive: true, force: true });
for (const [from, to] of FILES) {
  mkdirSync(dirname(join(target, to)), { recursive: true });
  cpSync(join(client, from), join(target, to));
}
// mock 파일의 웹 별칭(@/domain, @/lib)을 상대 경로로 바꾼다
for (const file of ['mock/seed.ts', 'mock/research.ts']) {
  const path = join(target, file);
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll("from '@/domain/", "from '../domain/").replaceAll("from '@/lib/", "from '../lib/"));
}
console.log(`synced ${FILES.length} files from ${client}`);
