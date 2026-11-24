"""중구청소년센터 운영 상태가 변할 때 전용 Discord 채널에 알린다."""
import json
import os
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

SITE = 'https://sjyc.efface.dev'
CHECKS = {'서비스 정상': 'up', '서비스 장애': 'down'}
DEPLOYMENTS = {'success': '성공', 'failure': '실패', 'error': '오류'}


def check(url, api=False):
    try:
        with urlopen(Request(url, headers={'User-Agent': 'SJYC-health'}), timeout=12) as response:
            if response.status != 200 or response.url.split('/')[2] != SITE.split('/')[2]:
                return False
            if api:
                data = json.loads(response.read(4096))
                return data == {'success': True, 'data': {'status': 'ok'}}
            return 'text/html' in response.headers.get_content_type() and '중구청소년센터' in response.read(262144).decode('utf-8', 'replace')
    except (OSError, URLError, ValueError):
        return False


def github(path):
    request = Request('https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + path,
                      headers={'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
                               'Accept': 'application/vnd.github+json'})
    with urlopen(request, timeout=12) as response:
        return json.load(response)


def last_state():
    runs = github('/actions/workflows/site-status.yml/runs?event=schedule&status=success&per_page=3')
    for run in runs['workflow_runs']:
        jobs = github('/actions/runs/' + str(run['id']) + '/jobs')['jobs']
        for job in jobs:
            for step in job['steps']:
                if step['name'] in CHECKS and step['conclusion'] == 'success':
                    return CHECKS[step['name']]
    return None


def notify(text):
    payload = json.dumps({'content': text, 'allowed_mentions': {'parse': []}}).encode()
    request = Request(os.environ['DISCORD_STATUS_WEBHOOK_URL'], data=payload,
                      headers={'Content-Type': 'application/json', 'User-Agent': 'SJYC-Operations'})
    try:
        with urlopen(request, timeout=12) as response:
            if response.status not in (200, 204):
                raise RuntimeError('Discord 전송 실패')
    except (OSError, URLError):
        raise RuntimeError('Discord 전송 실패') from None


def main():
    event = os.environ['GITHUB_EVENT_NAME']
    if event == 'deployment_status':
        payload = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        label = DEPLOYMENTS.get(payload['deployment_status']['state'])
        if label:
            notify('중구청소년센터 운영 배포 ' + label + ' · ' + SITE)
        return
    web, api = check(SITE), check(SITE + '/api/v1/health', api=True)
    state = 'up' if web and api else 'down'
    previous = last_state() if event == 'schedule' else None
    if event == 'workflow_dispatch' or state != previous:
        title = '수동 점검' if event == 'workflow_dispatch' else ('서비스 복구' if state == 'up' and previous else '서비스 상태')
        notify('중구청소년센터 ' + title + ' · 웹 ' + ('정상' if web else '점검 필요') +
               ' / API ' + ('정상' if api else '점검 필요') + ' · ' + SITE)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        print('state=' + state, file=output)


if __name__ == '__main__':
    main()
