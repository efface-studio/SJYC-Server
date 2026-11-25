import type { RedisService } from '../redis/redis.service';
import type { ServerRequestLog } from '../shared/domain/site-settings';
const DAY = 86_400_000;
// 서울 날짜 기준으로 경로 템플릿·메서드·상태만 보관한다.
const dateKey = (at: number) => new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
export async function countError(redis: RedisService, entry: ServerRequestLog) {
  const key = 'dev:errors:' + dateKey(Date.parse(entry.at));
  await redis
    .multi()
    .hincrby(key, entry.status + ' ' + entry.method + ' ' + entry.route, 1)
    .expire(key, 32 * 86400)
    .exec();
}
export async function errorTotals(redis: RedisService, days: number) {
  const dates = Array.from({ length: days }, (_, i) => dateKey(Date.now() - i * DAY));
  const pipeline = redis.pipeline();
  for (const date of dates) pipeline.hgetall('dev:errors:' + date);
  const result = await pipeline.exec();
  const totals = new Map<string, { total: number; days: { date: string; count: number }[] }>();
  for (const [i, [error, raw]] of (result ?? []).entries()) {
    if (error) throw error;
    for (const [signature, value] of Object.entries(raw as Record<string, string>)) {
      const item = totals.get(signature) ?? { total: 0, days: [] };
      item.total += Number(value);
      item.days.push({ date: dates[i]!, count: Number(value) });
      totals.set(signature, item);
    }
  }
  return totals;
}
