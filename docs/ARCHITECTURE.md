# 아키텍처

## 구성

| 계층        | 위치                                 | 내용                                                                                           |
| ----------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 진입        | `src/main.ts`, `src/bootstrap.ts`    | `/api/v1` 접두사, 보안 헤더(helmet), CORS(허용 웹 Origin), 전역 IP rate limit, CSRF, 요청 로그 |
| 공통        | `src/common`                         | 오류(`AppException`)·오류 필터, 응답 envelope, zod 검증 파이프, rate limit, 로거               |
| 데이터      | `prisma/schema.prisma`, `src/prisma` | PostgreSQL. 열거형 값은 도메인 문자열과 같게(소문자) 둔다                                      |
| 짧은 상태   | `src/redis`                          | rate limit 카운터, 출석 코드 시도 횟수                                                         |
| 도메인 규칙 | `src/shared`                         | 웹 저장소 원본 복사본 (타입·검증 스키마·권한·출석·공간·프로그램 규칙)                          |

## API 계약

- 성공: `{ "success": true, "data": ... }`, 본문 없는 성공은 204
- 실패: `{ "success": false, "error": { "code", "message", "reason?", "fieldErrors?" } }`
  - code: `VALIDATION`(400) · `UNAUTHENTICATED`(401) · `FORBIDDEN`(403) · `NOT_FOUND`(404) · `CONFLICT`(409, reason 으로 세부 사유) · `RATE_LIMITED`(429) · `NOT_CONFIGURED`(503) · `SERVER`(500)
  - 알 수 없는 오류의 내부 내용은 응답에 넣지 않고 로그에만 남긴다
- 입력 검증: 웹 폼 스키마를 그대로 쓴다. 클라이언트는 스키마 출력(체크박스 → `true/false`)을 보내므로 `apiInput()` 이 폼 입력 형태로 되돌린 뒤 같은 스키마로 검증한다.

## 인증·CSRF

- 세션: 서버가 발급하는 불투명 토큰을 HttpOnly 쿠키로만 전달한다 (DB 에는 SHA-256 해시만 저장). JS 저장소에 토큰을 두지 않는다.
- CSRF(double-submit): 서버가 `XSRF-TOKEN` 쿠키를 심고, 웹은 상태 변경 요청에 `X-XSRF-TOKEN` 헤더로 되돌려 보낸다.
  - `Origin` 이 있는 브라우저 요청은 허용된 웹 Origin 이고 헤더·쿠키 토큰이 같아야 한다.
  - `Origin` 이 없는 요청(네이티브 앱)은 다른 사이트가 사용자의 브라우저로 위조할 수 없으므로 세션만 검사한다.
- 배포: 웹이 XSRF 쿠키를 읽으려면 웹과 API 가 같은 사이트여야 한다 — 웹에서 `/api` 를 API 로 프록시(권장)하거나, 하위 도메인으로 나누고 `COOKIE_DOMAIN` 을 상위 도메인으로 지정한다.

## 로컬 인프라

`docker compose up -d` — PostgreSQL 16 (5434, 테스트 DB `sjyc_test` 자동 생성) · Redis 7 (6381).
3306 은 기존 MariaDB, 5433·6380 은 hwaso 가 쓰므로 피한다.

## 테스트

- `test/*.spec.ts`: 실제 PostgreSQL(`sjyc_test`)·Redis(db 15)로 앱을 띄우는 통합 테스트. 실행 전 마이그레이션 적용 후 모든 테이블을 비운다 (DB 이름이 `_test` 로 끝나지 않으면 거부).
- `src/**/*.test.ts`: 단위 테스트.
- 외부 연동(메일 등)은 테스트 더블로 교체한다.
