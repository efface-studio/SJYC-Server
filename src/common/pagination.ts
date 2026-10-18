import type { Page } from '../shared/domain/types';

/** 이미 정렬·필터된 전체 목록을 잘라 Page 로 만든다 (목록이 작은 화면용) */
export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize };
}

/** Prisma skip/take */
export const pageArgs = (page: number, pageSize: number) => ({ skip: (page - 1) * pageSize, take: pageSize });
