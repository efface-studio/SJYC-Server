# CLAUDE.md

이슈·브랜치·커밋·PR·라벨·CI 규칙은 efface-studio 공통 규칙(AI-Markdown `CLAUDE.md`)을 따른다.
커밋 형식 `<gitmoji> (<type>) #<issue> :: <message>`, Claude 서명 금지, 병합은 `xixn2` 만.

## 프로젝트 컨텍스트

- **프로젝트명**: SJYC-Server (서울시 중구청소년센터 통합 관리 시스템 API)
- **스택**: NestJS 11 · Prisma 6 · PostgreSQL 16 · Redis 7 · zod 4 · pino · vitest + supertest, pnpm 11, Node 24 (hwaso 와 같은 스택)
- **클라이언트**: 웹 [SJYC-Client](https://github.com/efface-studio/SJYC-Client) · 앱 [SJYC-Mobile](https://github.com/efface-studio/SJYC-Mobile) — 둘 다 `ApiClient` 계약(웹 `src/api/client.ts`, `docs/api-contracts.md`)의 http 어댑터로 이 서버를 부른다
- **주요 명령어**:
  - 인프라: `pnpm infra:up` (PostgreSQL 5434 · Redis 6381)
  - 개발: `cp .env.example .env && pnpm db:migrate && pnpm dev` (http://localhost:4000/api/v1)
  - 검증: `pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  - 도메인 규칙 동기화: `pnpm sync:shared` (웹 저장소의 `src/domain`·`src/lib/format.ts`·`src/api/errors.ts`·mock 시드 → `src/shared`)
  - 개발·시연 데이터: `pnpm db:seed` (`--reset` 으로 다시 넣기, 운영 환경은 `SEED_DEMO=1` 일 때만)
- **기본 브랜치**: `main`
- **기타 규칙**:
  - 응답·경로·오류 코드는 웹 http 어댑터(`src/api/http.ts`) 계약을 따른다. 바꾸면 웹·앱과 함께 바꾼다.
  - 입력 검증·권한 규칙은 `src/shared`(웹 원본 복사본)를 쓴다 — 직접 고치지 말고 웹에서 고친 뒤 `pnpm sync:shared`.
  - 권한은 서버가 요청마다 검사한다. 화면의 메뉴 숨김은 보안 경계가 아니다.
  - 비밀 값은 `.env` 에만 두고 커밋하지 않는다. 운영 DB·외부 발송(메일 등)은 로컬에서 실행하지 않는다.
