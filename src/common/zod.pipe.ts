import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from './app-exception';

/** 요청 본문·쿼리를 zod 스키마로 검증한다. 필드별 첫 오류를 fieldErrors 로, 첫 오류를 message 로 돌려준다 */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fieldErrors[key] ??= issue.message;
    }
    throw new AppException('VALIDATION', Object.values(fieldErrors)[0], { fieldErrors });
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 웹·앱은 폼 스키마의 출력값을 보낸다 (체크박스 → true/false). 같은 폼 스키마로 서버에서 다시 검증하도록
 * 최상위 boolean 을 폼 입력 형태('on' | 없음)로 되돌린 뒤 검증한다 — 검증 규칙을 한 곳(src/shared)에서만 관리한다.
 */
export function apiInput<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (v) =>
      isPlainObject(v)
        ? Object.fromEntries(
            Object.entries(v).map(([k, x]) => [k, x === true ? 'on' : x === false ? undefined : x]),
          )
        : v,
    schema,
  );
}

/** 목록 쿼리의 page·pageSize — 범위를 벗어나면 기본값으로 맞춘다 */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).catch(10).default(10),
});
