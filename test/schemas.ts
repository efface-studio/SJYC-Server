import { z } from 'zod';

/** 웹 폼 스키마의 선택 체크박스와 같은 모양 (src/shared/domain/schemas.ts optionalChecked) */
export const optionalCheckedForTest = z
  .literal('on')
  .optional()
  .transform((v) => v === 'on');
