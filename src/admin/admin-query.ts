import { z } from 'zod';
import { pageQuery } from '../common/zod.pipe';

/** 관리자 목록 공통 쿼리 (클라이언트 AdminListQuery) — 잘못된 값은 기본값으로 */
export const adminListQuery = pageQuery.extend({
  q: z.string().max(100).optional(),
  status: z.string().max(32).optional(),
  sort: z.enum(['newest', 'oldest', 'title']).optional().catch(undefined),
});
export type AdminListQuery = z.infer<typeof adminListQuery>;

/** 정렬 → Prisma orderBy (title 은 가나다순) */
export const orderOf = (sort: AdminListQuery['sort'], date: string, title: string) =>
  sort === 'title'
    ? { [title]: 'asc' as const }
    : { [date]: sort === 'oldest' ? ('asc' as const) : ('desc' as const) };

/** 문자열 상태 필터를 허용된 값으로만 */
export const statusIn = <T extends string>(
  status: string | undefined,
  allowed: readonly T[],
): T | undefined => (allowed.includes(status as T) ? (status as T) : undefined);
