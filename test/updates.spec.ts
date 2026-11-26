import { createSign, generateKeyPairSync, randomUUID, verify, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearRateLimits, createTestApp, type TestContext } from './app';
import { signedIn } from './fixtures';
import { resetEnvCache } from '../src/config/env';

describe('두 앱의 플랫폼별 OTA 전체 배포', () => {
  let t: TestContext, root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'sjyc-ota-test-'));
    vi.stubEnv('OTA_DIRECTORY', root);
    vi.stubEnv('OTA_ROLLBACK_KEY_FILE', join(root, 'qa-key.pem'));
    resetEnvCache();
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
    resetEnvCache();
    await rm(root, { recursive: true, force: true });
  });
  it('게시 전·런타임 불일치에는 204, 네 조합 모두 서명된 번들만 제공하고 실제 실행 보고를 분리한다', async () => {
    const releases = join(root, 'releases'),
      dir = join(releases, Date.now() + '-' + randomUUID());
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const get = (flavor: string, platform: string, runtime = 'sdk57') =>
      t.http.get('/api/v1/ota/manifest').set({
        'expo-platform': platform,
        'x-sjyc-flavor': flavor,
        'expo-runtime-version': runtime,
        'expo-channel-name': 'preview',
      });
    await writeFile(join(root, 'qa-key.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }), {
      mode: 0o600,
    });
    await get('user', 'ios').expect(204);
    await t.http.get('/api/v1/admin/app-updates').expect(401);
    const member = await signedIn(t, ['member']);
    await member.agent.get('/api/v1/admin/app-updates').expect(403);
    const file = await import('node:fs/promises');
    const stage = join(releases, '.staging-qa');
    await mkdir(stage, { recursive: true });
    const variants = {
      user: { ios: { id: randomUUID(), runtime: 'sdk57' }, android: { id: randomUUID(), runtime: 'sdk57' } },
      admin: { ios: { id: randomUUID(), runtime: 'sdk57' }, android: { id: randomUUID(), runtime: 'sdk57' } },
    };
    for (const flavor of ['user', 'admin'] as const)
      for (const platform of ['ios', 'android'] as const) {
        const body = JSON.stringify({ id: variants[flavor][platform].id, runtimeVersion: 'sdk57' });
        await writeFile(join(stage, flavor + '-' + platform + '.json'), body);
        await writeFile(
          join(stage, flavor + '-' + platform + '.sig'),
          createSign('RSA-SHA256').update(body).sign(privateKey, 'base64'),
        );
      }
    await writeFile(
      join(stage, 'release.json'),
      JSON.stringify({
        ...variants,
        message: '통합 검수',
        createdAt: new Date().toISOString(),
        channel: 'preview',
      }),
    );
    await get('user', 'ios').expect(204);
    await file.rename(stage, dir);
    for (const flavor of ['user', 'admin'] as const)
      for (const platform of ['ios', 'android'] as const) {
        const response = await get(flavor, platform).expect(200);
        const signature = String(response.headers['expo-signature']).match(/sig="([^"]+)"/)![1]!;
        expect(
          verify('RSA-SHA256', Buffer.from(response.text), publicKey, Buffer.from(signature, 'base64')),
        ).toBe(true);
        expect(JSON.parse(response.text).id).toBe(variants[flavor][platform].id);
      }
    await get('user', 'ios', 'older').expect(204);
    await get('user', 'windows').expect(400);
    const device = randomUUID();
    await get('user', 'ios').set('eas-client-id', device).expect(200);
    await get('user', 'ios')
      .set('eas-client-id', device)
      .set('expo-current-update-id', variants.user.ios.id)
      .expect(204);
    const asset = Buffer.from('test asset');
    const hash = createHash('sha256').update(asset).digest('hex');
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', hash), asset);
    expect((await t.http.get('/api/v1/ota/assets/' + hash).expect(200)).body).toEqual(asset);
    await t.http.get('/api/v1/ota/assets/invalid').expect(404);
    const admin = await signedIn(t, ['admin']);
    const list = await admin.agent.get('/api/v1/admin/app-updates').expect(200);
    expect(list.body.data).toHaveLength(4);
    expect(list.body.data.find((v: { id: string }) => v.id === variants.user.ios.id)).toMatchObject({
      live: true,
      seen: 1,
      running: 1,
    });
    const id = variants.user.ios.id;
    const change = (targetId: string, body: object) =>
      admin.agent.post('/api/v1/admin/app-updates/' + targetId + '/control').send(body);
    await member.agent
      .post('/api/v1/admin/app-updates/' + id + '/control')
      .send({ action: 'rollout', percent: 25 })
      .expect(403);
    await change(id, { action: 'rollout', percent: 12 }).expect(400);
    await change(id, { action: 'rollout', percent: 10 }).expect(201);
    await get('user', 'ios').expect(204);
    await get('admin', 'ios').expect(200);
    await change(id, { action: 'rollout', percent: 100 }).expect(201);
    await get('user', 'ios').expect(200);
    const newer = join(releases, Date.now() + 100 + '-' + randomUUID());
    await file.cp(dir, newer, { recursive: true });
    const next = structuredClone(variants);
    for (const flavor of ['user', 'admin'] as const)
      for (const platform of ['ios', 'android'] as const) {
        const variant = next[flavor][platform];
        variant.id = randomUUID();
        const content = JSON.stringify({
          id: variant.id,
          runtimeVersion: 'sdk57',
          testAsset: 'second release',
        });
        await writeFile(join(newer, flavor + '-' + platform + '.json'), content);
        await writeFile(
          join(newer, flavor + '-' + platform + '.sig'),
          createSign('RSA-SHA256').update(content).sign(privateKey, 'base64'),
        );
      }
    await writeFile(
      join(newer, 'release.json'),
      JSON.stringify({
        ...next,
        message: '두 번째',
        channel: 'preview',
        createdAt: new Date(Date.now() + 50).toISOString(),
      }),
    );
    await change(next.user.ios.id, { action: 'rollback', target: 'previous' }).expect(201);
    const restored = await get('user', 'ios').expect(200);
    const result = JSON.parse(restored.text);
    expect(result.id).not.toBe(id);
    expect(result.testAsset).toBeUndefined();
    expect(
      verify(
        'sha256',
        Buffer.from(restored.text),
        publicKey,
        Buffer.from(String(restored.headers['expo-signature']).match(/sig="([^"]+)"/)![1]!, 'base64'),
      ),
    ).toBe(true);
    await change(next.user.ios.id, { action: 'rollout', percent: 100 }).expect(409);
    await change(result.id, { action: 'rollback', target: 'embedded' }).expect(201);
    const directive = await get('user', 'ios').set('expo-current-update-id', result.id).expect(200);
    expect(directive.headers['content-type']).toContain('multipart/mixed');
    await get('user', 'ios').set('expo-current-update-id', id).set('expo-embedded-update-id', id).expect(204);
    await get('admin', 'ios').expect(200);
  });
  it('수동 예약과 잔여 배포의 대상을 분리하고 지정한 차수만 되돌린다', async () => {
    await clearRateLimits(t);
    const base = '/api/v1/admin/app-updates';
    const admin = await signedIn(t, ['admin']),
      dev = await signedIn(t, ['developer']),
      first = await signedIn(t),
      second = await signedIn(t);
    const options = { percent: false, bar: false, notes: false };
    await admin.agent
      .post(base + '/settings')
      .send({ version: 0, automatic: false })
      .expect(403);
    await dev.agent
      .post(base + '/settings')
      .send({ version: 0, automatic: false, splash: options })
      .expect(201);
    const folder = join(root, 'releases', Date.now() + '-' + randomUUID());
    await mkdir(folder);
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await writeFile(join(root, 'qa-key.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const variant = () => ({
      ios: { id: randomUUID(), runtime: 'waveqa' },
      android: { id: randomUUID(), runtime: 'waveqa' },
    });
    const release = {
      user: variant(),
      admin: variant(),
      channel: 'preview',
      message: '예약 검증',
      createdAt: new Date().toISOString(),
    };
    for (const f of ['user', 'admin'] as const)
      for (const platform of ['ios', 'android'] as const) {
        const bytes = JSON.stringify({ id: release[f][platform].id, runtimeVersion: 'waveqa' });
        await writeFile(join(folder, f + '-' + platform + '.json'), bytes);
        await writeFile(
          join(folder, f + '-' + platform + '.sig'),
          createSign('sha256').update(bytes).sign(privateKey, 'base64'),
        );
      }
    await writeFile(join(folder, 'release.json'), JSON.stringify(release));
    const id = release.user.ios.id;
    const rows = async () =>
      (await admin.agent.get(base).expect(200)).body.data.find((r: { id: string }) => r.id === id);
    const wave = (input: object) => admin.agent.post(base + '/' + id + '/waves').send(input);
    const headers = {
      'expo-platform': 'ios',
      'x-sjyc-flavor': 'user',
      'expo-runtime-version': 'waveqa',
      'expo-channel-name': 'preview',
    };
    const get = (ticket = '') =>
      t.http
        .get('/api/v1/ota/manifest')
        .set(headers)
        .set('expo-extra-params', 'sjyc_audience="' + ticket + '"');
    const firstCtx = (await first.agent.get('/api/v1/ota/context').expect(200)).body.data;
    const secondCtx = (await second.agent.get('/api/v1/ota/context').expect(200)).body.data;
    expect(firstCtx.splash).toEqual(options);
    expect(firstCtx.ticket).toHaveLength(43);
    expect((await t.http.get('/api/v1/ota/context')).body.data.ticket).toBeNull();
    await get(firstCtx.ticket).expect(204);
    expect(await rows()).toMatchObject({ manual: true, planVersion: 0, waves: [] });
    await dev.agent
      .post(base + '/settings')
      .send({ version: 1, automatic: true })
      .expect(201);
    await get().expect(204);
    const target = { action: 'publish', percent: 100, scope: { kind: 'users', emails: [first.user.email] } };
    await first.agent
      .post(base + '/' + id + '/waves')
      .send({ ...target, version: 0 })
      .expect(403);
    const at = new Date(Date.now() + 3600000).toISOString();
    await wave({ ...target, version: 0, at }).expect(201);
    await get(firstCtx.ticket).expect(204);
    const scheduled = (await rows()).waves[0];
    expect(scheduled).toMatchObject({ state: 'scheduled', count: 1 });
    await wave({ action: 'cancel', waveId: scheduled.id, version: 1 }).expect(201);
    await wave({ ...target, version: 1 }).expect(409);
    await wave({ ...target, version: 2 }).expect(201);
    expect(JSON.parse((await get(firstCtx.ticket).expect(200)).text).id).toBe(id);
    await get(secondCtx.ticket).expect(204);
    await get().expect(204);
    const active = (await rows()).waves[1];
    await wave({ action: 'publish', scope: { kind: 'everyone' }, percent: 100, version: 3 }).expect(201);
    await get(secondCtx.ticket).expect(200);
    await wave({ action: 'undo', waveId: active.id, version: 4 }).expect(201);
    const rolled = await get(firstCtx.ticket)
      .set('expo-current-update-id', id)
      .buffer(true)
      .parse((response, done) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (part) => {
          body += part;
        });
        response.on('end', () => done(null, { raw: body }));
        response.on('error', done);
      })
      .expect(200);
    expect(rolled.headers['content-type']).toContain('multipart/mixed');
    const parts = String(rolled.body.raw);
    const directive = parts.match(/(\{"type":"rollBackToEmbedded".*\})/)![1]!;
    const signature = parts.match(/sig="([^"]+)"/)![1]!;
    expect(verify('sha256', Buffer.from(directive), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
    expect(JSON.parse((await get(secondCtx.ticket).expect(200)).text).id).toBe(id);
    await get().expect(204);

    // 같은 릴리스의 다른 플랫폼에서 두 명 중 한 명을 먼저 예약하고 나머지 한 명을 즉시 배포한다.
    const android = release.user.android.id,
      endpoint = base + '/' + android + '/waves';
    const checkAndroid = async (ticket: string) =>
      (
        await t.http
          .get('/api/v1/ota/manifest')
          .set({ ...headers, 'expo-platform': 'android' })
          .set('expo-extra-params', 'sjyc_audience="' + ticket + '"')
      ).status;
    await admin.agent
      .post(endpoint)
      .send({
        action: 'publish',
        scope: { kind: 'users', emails: [first.user.email, second.user.email] },
        percent: 50,
        version: 0,
        at: new Date(Date.now() + 1800).toISOString(),
      })
      .expect(201);
    await admin.agent
      .post(endpoint)
      .send({ action: 'publish', scope: { kind: 'everyone' }, percent: 100, version: 1 })
      .expect(201);
    const firstPass = await Promise.all([checkAndroid(firstCtx.ticket), checkAndroid(secondCtx.ticket)]);
    expect(firstPass.sort()).toEqual([200, 204]);
    expect(await checkAndroid('')).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 1850));
    expect(await checkAndroid(firstCtx.ticket)).toBe(200);
    expect(await checkAndroid(secondCtx.ticket)).toBe(200);
    expect(await checkAndroid('')).toBe(200);
    const adminVariant = base + '/' + release.admin.ios.id + '/waves';
    await admin.agent
      .post(adminVariant)
      .send({ action: 'publish', scope: { kind: 'role', role: 'developer' }, percent: 100, version: 0 })
      .expect(201);
    await admin.agent
      .post(adminVariant)
      .send({
        action: 'publish',
        scope: { kind: 'permission', permission: 'site.manage' },
        percent: 100,
        version: 1,
      })
      .expect(201);
    await admin.agent
      .post(adminVariant)
      .send({
        action: 'publish',
        scope: { kind: 'users', emails: [first.user.email] },
        percent: 100,
        version: 2,
      })
      .expect(400);
    await first.agent.post('/api/v1/auth/logout');
    await get(firstCtx.ticket).expect(204);
  });
});
