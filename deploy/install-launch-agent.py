"""macOS 운영 터널에서 사용할 빌드를 launchd에 등록한다."""
import argparse
import os
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path

root = Path.home() / "Library/Application Support/SJYC/production"
args = argparse.ArgumentParser(description="실행 중인 운영 API를 보존하고 릴리스를 준비합니다.")
args.add_argument("release", type=Path)
args.add_argument("--slot", choices=["blue", "green"])
options = args.parse_args()
release = options.release.resolve(strict=True)
marker = root / "active-api-slot"
active_slot = marker.read_text().strip() if marker.exists() else None
if active_slot not in (None, "blue", "green"):
    sys.exit("운영 API 슬롯 설정을 확인해 주세요.")
slot = options.slot or ("green" if active_slot == "blue" else "blue")
service = "dev.efface.sjyc.production-api" + ("-green" if slot == "green" else "")
env_file = root / "api.env"
node = shutil.which("node")
if not node or not (release / "dist/main.js").is_file() or not (release / "node_modules").is_dir():
    sys.exit("빌드된 서버, 의존성, Node 경로를 확인해 주세요.")
if not env_file.is_file() or env_file.stat().st_mode & 0o077:
    sys.exit("운영 설정 파일 권한을 0600으로 설정해 주세요.")

domain = f"gui/{os.getuid()}"
target = Path.home() / "Library/LaunchAgents" / (service + ".plist")
config = {
    "Label": service,
    "ProgramArguments": [node, "--env-file=" + str(env_file), str(release / "dist/main.js")],
    "WorkingDirectory": str(release),
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 5,
    "Umask": 0o077,
    "StandardOutPath": str(root / "api.log"),
    "StandardErrorPath": str(root / "error.log"),
}
if slot == "green":
    config["EnvironmentVariables"] = {"PORT": "4251"}
    config["StandardOutPath"] = str(root / "api-green.log")
    config["StandardErrorPath"] = str(root / "error-green.log")
encoded = plistlib.dumps(config)
loaded = subprocess.run(["launchctl", "print", f"{domain}/{service}"], capture_output=True).returncode == 0
if loaded and target.is_file() and plistlib.loads(target.read_bytes()) == config:
    sys.exit(0)
if loaded and active_slot == slot:
    sys.exit("현재 요청을 처리하는 슬롯입니다. 다른 슬롯에서 릴리스를 준비해 주세요.")


def load_agent():
    # bootout이 반환된 뒤에도 launchd가 기존 프로세스를 회수하는 중일 수 있다.
    for attempt in range(20):
        result = subprocess.run(["launchctl", "bootstrap", domain, str(target)], capture_output=True)
        if result.returncode == 0:
            return
        if result.returncode != 5 or attempt == 19:
            sys.stderr.buffer.write(result.stderr)
            result.check_returncode()
        time.sleep(0.5)


previous = target.read_bytes() if target.is_file() else None
if loaded:
    subprocess.run(["launchctl", "bootout", f"{domain}/{service}"], check=True)
temporary = target.with_suffix(".plist.tmp")
temporary.write_bytes(encoded)
temporary.chmod(0o600)
temporary.replace(target)
try:
    load_agent()
except subprocess.CalledProcessError:
    if previous is not None:
        target.write_bytes(previous)
        if loaded:
            load_agent()
    raise

print(f"{slot} API 준비 완료 ({4251 if slot == 'green' else 4200}번 포트)")
