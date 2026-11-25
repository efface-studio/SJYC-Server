import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { env } from '../config/env';
import { AppException } from '../common/app-exception';

export const platformSchema = z.enum(['ios', 'android']);
export const flavorSchema = z.enum(['user', 'admin']);
export const channelSchema = z.enum(['preview', 'production']);
export const runtimeSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const variant = z.object({
  id: z.uuid(),
  runtime: runtimeSchema,
  assetCount: z.number().int().nonnegative().optional(),
});
const batchSchema = z.object({
  createdAt: z.iso.datetime(),
  message: z.string().max(240),
  channel: channelSchema,
  user: z.object({ ios: variant, android: variant }),
  admin: z.object({ ios: variant, android: variant }),
});
export type ReleaseBatch = z.infer<typeof batchSchema> & { directory: string };
export function releaseRoot() {
  const root = env().OTA_DIRECTORY;
  if (!root) throw new AppException('NOT_CONFIGURED', '앱 업데이트 저장소가 연결되지 않았습니다.');
  return root;
}
// 공개된 디렉터리는 불변이다. 앱의 주기적인 확인마다 디스크에서 다시 읽지 않는다.
const indexCache = new Map<string, ReleaseBatch>();
async function loadBatch(directory: string): Promise<ReleaseBatch> {
  const cached = indexCache.get(directory);
  if (cached) return cached;
  const batch = batchSchema.parse(JSON.parse(await readFile(join(directory, 'release.json'), 'utf8')));
  for (const flavor of ['user', 'admin'] as const) {
    for (const platform of ['ios', 'android'] as const) {
      const item = batch[flavor][platform];
      if (item.assetCount !== undefined) continue;
      const manifest = JSON.parse(await readFile(join(directory, flavor + '-' + platform + '.json'), 'utf8'));
      item.assetCount =
        (manifest.launchAsset ? 1 : 0) + (Array.isArray(manifest.assets) ? manifest.assets.length : 0);
    }
  }
  const row = { ...batch, directory };
  if (indexCache.size >= 256) {
    const first = indexCache.keys().next();
    if (!first.done) indexCache.delete(first.value);
  }
  indexCache.set(directory, row);
  return row;
}
export async function batches(): Promise<ReleaseBatch[]> {
  const parent = join(releaseRoot(), 'releases');
  let dirs;
  try {
    dirs = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(
    dirs
      .filter((e) => e.isDirectory() && /^\d{13}-[0-9a-f-]{36}$/.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .map((e) => loadBatch(join(parent, e.name))),
  );
}
