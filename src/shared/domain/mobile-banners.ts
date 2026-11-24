import { z } from 'zod';

export const bannerKinds = ['행사', '동아리 모집', '프로그램', '공지'] as const;
export const bannerImages = ['program', 'club', 'space'] as const;
const day = z.union([z.literal(''), z.iso.date()]);
const publicImage = z
  .url({ protocol: /^https$/ })
  .max(1200)
  .refine((v) => {
    try {
      const u = new URL(v);
      return !u.username && !u.password;
    } catch {
      return false;
    }
  });
const item = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    title: z.string().trim().min(1).max(70),
    kind: z.enum(bannerKinds),
    image: z.union([z.enum(bannerImages), publicImage]),
    path: z.string().regex(/^\/(?:programs|clubs|notices|spaces)(?:\/[a-zA-Z0-9_-]+)?$/),
    enabled: z.boolean(),
    startsOn: day,
    endsOn: day,
  })
  .strict()
  .refine((b) => !b.startsOn || !b.endsOn || b.startsOn <= b.endsOn, '마지막 게시일이 시작일보다 빠릅니다.');
const config = z
  .object({
    automatic: z.boolean(),
    seconds: z
      .number()
      .int()
      .min(0)
      .max(20)
      .refine((v) => v === 0 || v >= 3),
    items: z
      .array(item)
      .max(15)
      .refine((a) => new Set(a.map((b) => b.id)).size === a.length),
  })
  .strict();
export type MobileBanner = z.infer<typeof item>;
export type BannerConfig = z.infer<typeof config>;
export const defaultBanners: BannerConfig = { automatic: true, seconds: 5, items: [] };
export function readBanners(raw?: string): BannerConfig {
  if (!raw) return defaultBanners;
  try {
    return config.parse(JSON.parse(raw));
  } catch {
    return defaultBanners;
  }
}
export const mobileBannersSetting = z
  .string()
  .max(30000)
  .refine((s) => {
    try {
      return config.safeParse(JSON.parse(s)).success;
    } catch {
      return false;
    }
  }, '배너의 제목, 이미지, 앱 경로, 게시 기간과 전환 시간을 확인해 주세요.');
export const newBanner = (): MobileBanner => ({
  id: 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
  title: '',
  kind: '행사',
  image: 'program',
  path: '/programs',
  enabled: true,
  startsOn: '',
  endsOn: '',
});
export const visibleBanners = (items: MobileBanner[], date: string) =>
  items.filter((b) => b.enabled && (!b.startsOn || b.startsOn <= date) && (!b.endsOn || b.endsOn >= date));
export function moveBanner(items: MobileBanner[], index: number, step: -1 | 1) {
  const dest = index + step;
  if (dest < 0 || dest >= items.length) return items;
  const rows = items.slice();
  [rows[index], rows[dest]] = [rows[dest]!, rows[index]!];
  return rows;
}
