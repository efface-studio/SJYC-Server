import { z } from 'zod';
import { optionalCheckedForTest } from '../../test/schemas';
import { AppException } from './app-exception';
import { apiInput, ZodPipe } from './zod.pipe';
import { toErrorResponse } from './http-exception.filter';

describe('ZodPipe', () => {
  it('필드별 첫 오류를 fieldErrors 로, 첫 오류를 message 로 돌려준다', () => {
    const pipe = new ZodPipe(z.object({ title: z.string().min(2, { error: '제목' }), n: z.number() }));
    try {
      pipe.transform({ title: 'a', n: 'x' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      const { status, body } = toErrorResponse(e);
      expect(status).toBe(400);
      expect(body.code).toBe('VALIDATION');
      expect(body.message).toBe('제목');
      expect(Object.keys(body.fieldErrors ?? {})).toEqual(['title', 'n']);
    }
  });

  it('apiInput: 클라이언트가 보낸 boolean 을 폼 입력 형태로 되돌려 같은 스키마로 검증한다', () => {
    const schema = apiInput(z.object({ agree: z.literal('on'), pinned: optionalCheckedForTest }));
    expect(schema.parse({ agree: true, pinned: false })).toEqual({ agree: 'on', pinned: false });
    expect(schema.safeParse({ agree: false }).success).toBe(false);
  });

  it('알 수 없는 오류는 내용을 숨기고 SERVER', () => {
    const { status, body } = toErrorResponse(new Error('db password leaked'));
    expect(status).toBe(500);
    expect(body.message).not.toContain('password');
  });
});
