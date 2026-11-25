# sjyc.efface.dev 운영 API

Cloudflare Tunnel은 웹 요청을 3200번, `/api/v1` 요청을 4200번 포트로 전달한다. API는 로그인한 운영 Mac 계정의 LaunchAgent에서 실행한다. Docker와 터널이 같은 호스트에서 실행 중이어야 한다.

## 데이터 및 환경 설정

운영 디렉터리는 `~/Library/Application Support/SJYC/production`이며 권한은 0700이다. 이곳의 `compose.yml`은 `compose.production.yml`의 사본이다. PostgreSQL과 Redis는 전용 영구 볼륨을 사용하며 루프백에서만 접근할 수 있다. 컨테이너 재시작에는 기존 비밀 파일과 볼륨을 사용한다.

- `postgres.password`는 PostgreSQL 초기화용 비밀번호 파일이다. `redis.conf`에는 운영 비밀번호, AOF 설정, 데이터 디렉터리 `/data`가 들어간다. Redis 프로세스가 읽을 수 있도록 파일을 마운트하며 호스트 상위 디렉터리는 운영 계정만 열 수 있다.
- `api.env`는 0600으로 저장한다. `NODE_ENV=production`, `LISTEN_HOST=127.0.0.1`, `PORT=4200`, HTTPS 공개 URL, 웹 Origin, 운영 DB와 Redis 연결 정보를 사용한다. API용 DB 역할은 데이터 조회·수정 권한만 사용한다.
- 마이그레이션 자격 증명은 별도의 0600 파일 `migrate.env`에서 읽는다. DB 변경은 `prisma migrate deploy`로 적용한다. 운영에서 개발용 시드를 실행하지 않는다.
- 메일 발송을 설정하기 전에는 `MAIL_DELIVERY=disabled`를 사용할 수 있다. 이때 이메일 재전송 및 비밀번호 재설정 요청은 503을 반환한다. 실제 SMTP와 발신자를 설정한 후 `MAIL_DELIVERY=smtp`로 전환한다. 실제 가입 문자에는 SOLAPI 발신자와 자격 증명이 필요하다.

## 실행 및 복구

빌드 결과인 `dist`와 같은 lockfile의 `node_modules`를 지속적으로 보관하는 릴리스 디렉터리에 설치한다. 임시 작업 디렉터리에 의존하는 심볼릭 링크는 사용하지 않는다.

```sh
runtime_dir="$HOME/Library/Application Support/SJYC/production"
docker compose -f "$runtime_dir/compose.yml" up -d
python3 deploy/install-launch-agent.py "$release_dir"
launchctl print "gui/$(id -u)/dev.efface.sjyc.production-api"
curl -fsS https://sjyc.efface.dev/api/v1/health
curl -i https://sjyc.efface.dev/api/v1/auth/session
```

`release_dir`에는 배포할 릴리스 디렉터리의 절대 경로를 지정한다. 환경 설정만 변경한 경우 `launchctl kickstart -k "gui/$(id -u)/dev.efface.sjyc.production-api"`로 다시 읽는다. 이전 코드로 복구하려면 이전 릴리스 경로를 설치 스크립트에 전달한다. 헬스체크는 PostgreSQL 및 Redis 연결이 모두 정상이면 200을 반환한다. 쿠키가 없는 세션 조회의 정상 응답은 401과 `UNAUTHENTICATED`이다.
