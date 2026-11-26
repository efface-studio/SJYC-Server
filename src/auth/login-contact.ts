import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { contactRule, type LoginAudience, type ContactRule } from '../shared/domain/login-contact';
import { AppException } from '../common/app-exception';

export class ContactRequired extends AppException {
  constructor(missing: string[]) {
    super('FORBIDDEN', missing.join(' 및 ') + ' 인증을 완료한 뒤 로그인해 주세요.');
  }
}

export const policyKey = (audience: LoginAudience) => 'auth:contact:' + audience;
export async function readContact(db: Pick<PrismaService, 'siteSettings'>, audience: LoginAudience) {
  const row = await db.siteSettings.findUnique({ where: { id: policyKey(audience) } });
  return { version: row?.version ?? 0, rule: row ? contactRule.parse(row.values) : null };
}
type Account = Pick<User, 'emailVerified' | 'phone' | 'signupPhoneVerifiedAt'>;
export function checkContact(rule: ContactRule | null, account: Account) {
  if (!rule) return;
  const missing = [];
  if (!rule.allowUnverifiedEmail && !account.emailVerified) missing.push('이메일');
  if (!rule.allowUnverifiedPhone && !(account.phone && account.signupPhoneVerifiedAt))
    missing.push('휴대전화');
  if (missing.length) throw new ContactRequired(missing);
}
export function phoneUpdate(previous: string | null, next: string | null) {
  const changed = (previous ?? '').replace(/\D/g, '') !== (next ?? '').replace(/\D/g, '');
  return { phone: next, ...(changed ? { signupPhoneVerifiedAt: null } : {}) };
}
