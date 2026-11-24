import { z } from 'zod';
import { mobileBannersSetting } from './mobile-banners';

const short = z.string().trim().min(1, '내용을 입력해 주세요.').max(120);
const line = z.string().trim().min(1).max(600);
const phone = z.string().regex(/^[+0-9][0-9 -]{3,24}$/, '연결 가능한 전화번호를 입력해 주세요.');
const time = '([01]\\d|2[0-3]):[0-5]\\d';
const span = z
  .string()
  .regex(new RegExp('^' + time + '-' + time + '$'), '09:00-18:00 형식으로 입력해 주세요.')
  .refine((v) => v.slice(0, 5) < v.slice(6), '종료 시각은 시작 시각 이후여야 합니다.');
const pairRows = z
  .string()
  .min(1)
  .max(5000)
  .refine(
    (v) =>
      v.split('\n').every((row) => {
        const parts = row.split('|');
        return parts.length === 2 && parts.every((p) => p.trim().length > 0);
      }),
    '각 줄에 항목 | 내용을 입력해 주세요.',
  );
const image = z
  .string()
  .regex(
    /^\/(?:brand|media)\/(?:[\w-]+\/)*[\w-]+\.(?:png|jpe?g|webp|svg)$/i,
    '사이트의 /media/ 또는 /brand/ 이미지 경로를 입력해 주세요.',
  );
const channel = z
  .url({ protocol: /^https$/ })
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return !u.username && !u.password;
    } catch {
      return false;
    }
  }, '공개 HTTPS 주소를 입력해 주세요.');
export const NAV_LINKS = {
  programs: '프로그램',
  spaces: '공간 예약',
  clubs: '동아리',
  kdream: '꿈드림',
  notices: '공지사항',
  about: '센터 안내',
} as const;
export const HOME_SECTIONS = {
  services: '센터 이용 바로가기',
  programs: '모집 중인 프로그램',
  news: '공지·방문 안내',
  more: '센터 소식과 문의',
} as const;
function order(keys: string[]) {
  return z
    .string()
    .max(160)
    .refine((v) => {
      const a = v ? v.split(',') : [];
      return a.every((k) => keys.includes(k)) && new Set(a).size === a.length;
    }, '중복된 항목이나 알 수 없는 메뉴가 있습니다.');
}
export const settingsSchema = z
  .object({
    name: short,
    formalName: short,
    englishName: short,
    slogan: line,
    address: line,
    postalCode: z.string().regex(/^\d{5}$/),
    nearestStation: line,
    tel: phone,
    telDisplay: short,
    fax: phone,
    director: short,
    businessNumber: short,
    mailOrderNumber: short,
    weekdayHours: span,
    saturdayHours: span,
    sundayHours: span,
    deskWeekday: span,
    deskSaturday: span,
    closedSunday: z.enum(['second', 'none']),
    deskNote: line,
    directions: pairRows,
    floors: pairRows,
    services: pairRows,
    youtube: channel,
    instagram: channel,
    facebook: channel,
    blog: channel,
    navOrder: order(Object.keys(NAV_LINKS)),
    homeOrder: order(Object.keys(HOME_SECTIONS)),
    programImage: image,
    spaceImage: image,
    clubImage: image,
    heroLogo: image,
    headerLogo: image,
    footerLogo: image,
    poster: image,
    film: z.string().regex(/^\/media\/(?:[\w-]+\/)*[\w-]+\.mp4$/),
    accent: z.string().regex(/^#[a-f0-9]{6}$/i),
    mobileBanners: mobileBannersSetting,
    seoTitle: short,
    seoDescription: line,
  })
  .partial()
  .strict();
export type SiteSettings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof SiteSettings;
export const settingsWriteSchema = z
  .object({ version: z.number().int().nonnegative(), values: settingsSchema })
  .strict();
export type SettingsRecord = z.infer<typeof settingsWriteSchema>;
export interface ServerRequestLog {
  id: string;
  at: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  level: 'info' | 'warn' | 'error';
}
export interface ServerLogSnapshot {
  source: 'server' | 'mock';
  startedAt: string | null;
  capacity: number;
  entries: ServerRequestLog[];
}
