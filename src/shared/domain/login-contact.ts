import { z } from 'zod';

export const loginAudience = z.enum(['user', 'admin']);
export type LoginAudience = z.infer<typeof loginAudience>;
export const contactRule = z.object({allowUnverifiedEmail:z.boolean(),allowUnverifiedPhone:z.boolean()}).strict();
export type ContactRule = z.infer<typeof contactRule>;
export const contactPatch = z.object({ ...contactRule.shape, audience:loginAudience,version:z.number().int().nonnegative() }).strict();
export type ContactPatch = z.infer<typeof contactPatch>;
export type ContactSettings = Record<LoginAudience, {version:number; rule:ContactRule|null}>;
export const contactLabels={allowUnverifiedEmail:'이메일 미인증 로그인 허용',allowUnverifiedPhone:'휴대전화 미인증 로그인 허용'} as const;
export const audienceLabels={user:'사용자 앱',admin:'관리자 앱'} as const;
