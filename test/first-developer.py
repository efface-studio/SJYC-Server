"""최초 등록 SQL을 네트워크가 분리된 임시 PostgreSQL 16에서 검증한다."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
INSTALL = (ROOT / "deploy/first-developer.psql").read_text()
APPLY = "SELECT sjyc_enrollment.apply_first_developer();"


def verify(container):
    def sql(statement, who="test_owner", args=(), denied=None):
        result = subprocess.run(
            ["docker", "exec", "-i", container, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1",
             "-U", who, "-d", "enrollment_test", *args],
            input=statement, capture_output=True, text=True, timeout=25,
        )
        if denied:
            assert result.returncode and denied in result.stderr, result.stderr
        else:
            assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def install(executor="test_operator", member="one", denied=None):
        return sql(INSTALL, args=("-v", f"member_id={member}", "-v", "email=one@example.test",
                                  "-v", f"executor={executor}"), denied=denied)

    sql("""
        CREATE ROLE test_owner LOGIN;
        CREATE ROLE test_operator LOGIN IN ROLE test_owner;
        CREATE ROLE test_app LOGIN;
        ALTER DATABASE enrollment_test OWNER TO test_owner;
    """, "postgres")
    migrations = sorted((ROOT / "prisma/migrations").glob("*/migration.sql"))
    sql("\n".join(p.read_text() for p in migrations))
    sql("""
        INSERT INTO "User" (id,email,name,roles,"updatedAt")
        SELECT id,id || '@example.test',id,ARRAY['admin'::"Role"],now()
        FROM unnest(ARRAY['one','two']) id;
        INSERT INTO "Session" (id,"tokenHash","userId","expiresAt")
        SELECT id,id,id,now() + interval '1 day' FROM "User";
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO test_app;
    """)

    # 일반 API 로그인은 설치·승인·실행 권한을 얻지 않는다.
    sql(INSTALL, who="test_app", denied="소유자 권한")
    install(executor="test_app", denied="승인 대상")
    install(member="two", denied="승인 대상")
    install()
    assert sql('SELECT roles FROM "User" WHERE id=\'one\'') == "{admin}"
    sql(APPLY, who="test_app", denied="permission denied for schema")
    sql("UPDATE sjyc_enrollment.first_developer SET member_id='two'", who="test_app",
        denied="permission denied for schema")
    sql(APPLY, denied="승인된 운영 DB 로그인")
    install(denied="already exists")

    # 승인 이후 달라진 회원 정보와 기존 개발자를 적용 시점에 다시 확인한다.
    sql("""UPDATE "User" SET status='suspended' WHERE id='one'""")
    sql(APPLY, "test_operator", denied="회원 정보 또는 역할")
    sql("""UPDATE "User" SET status='active',email='changed@example.test' WHERE id='one'""")
    sql(APPLY, "test_operator", denied="회원 정보 또는 역할")
    sql("""UPDATE "User" SET email='one@example.test' WHERE id='one';
           UPDATE "User" SET roles=ARRAY['developer'::"Role"],status='suspended' WHERE id='two'""")
    sql(APPLY, "test_operator", denied="이미 개발자")
    sql("""UPDATE "User" SET roles=ARRAY['admin'::"Role"],status='active' WHERE id='two'""")

    # 감사 기록이 실패하면 역할, 기존 세션 및 1회 승인도 함께 롤백한다.
    sql("""ALTER TABLE "AuditEvent" ADD CONSTRAINT test_audit_failure CHECK (action <> 'user.update')""")
    sql(APPLY, "test_operator", denied="test_audit_failure")
    assert sql("""SELECT roles FROM "User" WHERE id='one'""") == "{admin}"
    assert sql('SELECT count(*) FROM "Session"') == "2"
    assert sql("SELECT NOT EXISTS (SELECT FROM sjyc_enrollment.receipt)") == "t"
    sql('ALTER TABLE "AuditEvent" DROP CONSTRAINT test_audit_failure')

    with ThreadPoolExecutor(2) as pool:
        calls = [pool.submit(sql, APPLY, "test_operator") for _ in range(2)]
        assert sorted(call.result() for call in calls) == ["already_applied", "applied"]
    assert sql("""SELECT roles FROM "User" WHERE id='one'""") == "{developer}"
    assert sql("""SELECT roles FROM "User" WHERE id='two'""") == "{admin}"
    assert sql('SELECT "userId" FROM "Session"') == "two"
    assert sql("""SELECT count(*) FROM "AuditEvent" WHERE "actorName"='test_operator'
                  AND "targetId"='one' AND action='user.update' AND summary LIKE '%test_owner%'""") == "1"
    sql("""UPDATE "User" SET roles=ARRAY['admin'::"Role"] WHERE id='one'""")
    assert sql(APPLY, "test_operator") == "already_applied"
    assert sql("""SELECT roles FROM "User" WHERE id='one'""") == "{admin}"


if __name__ == "__main__":
    container = subprocess.check_output(
        ["docker", "run", "-d", "--rm", "--network", "none", "--tmpfs", "/var/lib/postgresql/data",
         "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=enrollment_test",
         "postgres:16-alpine"], text=True,
    ).strip()
    try:
        for _ in range(80):
            if subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
                              capture_output=True).returncode == 0:
                break
            time.sleep(0.25)
        verify(container)
        print("최초 등록, 권한 제한, 상태 변경, 동시 실행, 감사 기록 및 세션 검증 통과")
    finally:
        subprocess.run(["docker", "stop", container], check=True, stdout=subprocess.DEVNULL)
