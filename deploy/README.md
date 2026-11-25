# sjyc.efface.dev 운영 API

Cloudflare Tunnel은 웹 요청을 3200번, `/api/v1` 요청을 현재 운영 API 슬롯으로 전달한다. 기본 슬롯(blue)은 4200번, 보조 슬롯(green)은 4251번이다. API는 로그인한 운영 Mac 계정의 LaunchAgent에서 실행한다. Docker와 터널이 같은 호스트에서 실행 중이어야 한다.

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

`release_dir`에는 배포할 릴리스 디렉터리의 절대 경로를 지정한다. 운영 중 설정 변경과 롤백은 아래 슬롯 교체 절차로 적용한다. 헬스체크는 PostgreSQL 및 Redis 연결이 모두 정상이면 200을 반환한다. 쿠키가 없는 세션 조회의 정상 응답은 401과 `UNAUTHENTICATED`이다.

신규 일반회원에게 임시 가입 코드를 제공하려면 운영 환경에서 `SIGNUP_TEMPORARY_REGISTRATION=on`을 설정합니다. 유효한 가입 요청에서 `284600`을 입력하면 일반회원으로 가입할 수 있습니다. 번호 소유 인증 시각은 비워 둡니다. 실제 문자 발송을 시작할 때 이 옵션을 끄면 대기 중인 임시 요청도 만료되며, 이미 가입한 일반회원은 비밀번호로 계속 로그인할 수 있습니다.

직원·최고 관리자·개발자 연락처 인증을 도입하기 전에는 `OPERATOR_CONTACT_POLICY=deferred`로 설정할 수 있다. 비밀번호 확인 또는 이미 연결된 소셜 계정으로 새로 로그인한 활성 운영자에게 적용한다. 가입 코드와 연락처 인증 기록은 별도로 관리한다. 메일·문자 인증을 도입하면 값을 기본값인 `required`로 되돌리고 API 슬롯을 교체한다. 미인증 운영자의 기존 세션에도 다음 요청부터 인증 요건이 적용된다.

## 운영 중 서버 교체

`production/active-api-slot`에는 현재 공개 요청을 처리하는 슬롯 이름을 기록한다. 이 파일이 있으면 설치기는 다음 릴리스를 반대 슬롯에 준비한다. 동일한 설정으로 다시 실행해도 이미 실행 중인 프로세스는 유지된다.

1. 배포 전에 필요한 하위 호환 마이그레이션을 확인하고 새 릴리스를 대기 슬롯에 설치한다.
2. 대기 슬롯의 헬스체크와 변경된 API를 루프백에서 검증한다.
3. 같은 Cloudflare Tunnel에 새 슬롯을 가리키는 보조 커넥터를 연결한다. 별도 metrics 포트에서 준비 상태와 연결 수를 확인한다.
4. 주 커넥터의 설정에 새 슬롯을 반영하고 보조 커넥터가 서비스하는 동안 주 커넥터를 재연결한다. 웹과 API의 외부 응답을 계속 점검한다.
5. 주 커넥터가 준비되면 보조 커넥터를 해제하고 외부 응답을 다시 확인한 뒤 `active-api-slot`을 갱신한다. 직전 API는 복구용으로 계속 실행한다.

## Mac 화면 꺼짐과 잠자기

`dev.efface.sjyc.awake`는 로그인 시 `/usr/bin/caffeinate -is`를 실행하는 전용 LaunchAgent다. 배포 디렉터리의 같은 이름 plist를 `~/Library/LaunchAgents`에 설치하고 `launchctl bootstrap`으로 등록한다. 화면 잠금과 디스플레이 자동 꺼짐은 허용하며 유휴 상태에서 시스템이 잠드는 것을 막는다. `pmset -g assertions`와 LaunchAgent PID로 적용 상태를 확인한다. 이 호스트가 실제로 시스템 잠자기에 들어가거나 인터넷 연결을 잃으면 외부 요청을 처리할 수 없다.
