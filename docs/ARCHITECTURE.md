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

## 인증 (`/auth`)

| 경로                                                                                   | 내용                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /auth/session`                                                                    | 현재 세션 `{ user, expiresAt }`, 없으면 401                                          |
| `POST /auth/signup`                                                                    | 가입 + 인증 메일. 중복 이메일 409 `EMAIL_TAKEN`                                      |
| `POST /auth/email-verification/resend` · `GET /auth/email-verification/confirm?token=` | 재발송(가입 여부 무관 204) · 메일 링크 확인 후 웹 `/login?verified=1` 로 이동        |
| `POST /auth/login` · `POST /auth/logout`                                               | 세션 쿠키 발급·폐기. 틀린 비밀번호와 없는 계정은 같은 오류, IP+이메일 15분 10회 제한 |
| `POST /auth/password-reset` · `POST /auth/password-reset/confirm`                      | 가입 여부 무관 204, 30분 1회용 링크, 재설정 시 모든 세션 폐기                        |
| `GET /auth/oauth/{provider}/start`                                                     | 공급자 키 발급 전에는 웹 `/login?error=oauth_failed` 로 안내                         |

- 비밀번호: argon2id. 토큰(세션·인증 메일·재설정)은 256bit 임의 값, DB 에는 SHA-256 해시만 저장한다.
- 세션 유효 시간 `SESSION_TTL_HOURS`(기본 12시간), 절반 지나면 연장. 정지·탈퇴 회원의 세션은 즉시 무효.
- 권한: 전역 `AuthGuard` 가 기본으로 로그인을 요구하고(`@Public` 예외), `@RequirePermission` 은 공유 `can()` 으로 검사한다.

## 프로그램·신청

- 모집 상태는 공유 규칙 `computeRecruitStatus`(시각·정원)로 응답할 때 계산한다.
- 신청: 프로그램 행을 `FOR UPDATE` 로 잠근 트랜잭션에서 모집 기간·중복·정원을 확인한다. 활동 중(접수·승인) 신청은 회원·프로그램당 1건 — DB 부분 고유 인덱스로도 막는다.
- 접수 번호는 DB 시퀀스로 서버가 발급한다 (`SJYC-연도-000001`).
- 취소: 접수·승인 상태이고 취소 기한 전이면 가능, 정원(`appliedCount`)을 같은 트랜잭션에서 돌려놓는다.
