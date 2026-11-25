import type { User } from '@prisma/client';
import { env } from '../config/env';
import { can } from '../shared/domain/permissions';

type LoginAccount = Pick<User, 'roles' | 'status' | 'emailVerified' | 'signupPhoneVerifiedAt'>;

export function hasVerifiedContact(account: LoginAccount) {
  return account.emailVerified || account.signupPhoneVerifiedAt !== null;
}

/** 운영 역할은 서버에 저장된 계정에서만 읽는다. 담당 동아리 지정은 별도 권한이다. */
export function defersOperatorContact(account: LoginAccount) {
  return env().OPERATOR_CONTACT_POLICY === 'deferred' && can(account, 'admin.access');
}
