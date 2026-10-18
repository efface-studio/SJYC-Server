import type { User as UserRow } from '@prisma/client';
import type { ConsentRecord, User } from '../shared/domain/types';

/** DB 행 → 응답용 회원 (비밀번호 해시 등은 내보내지 않는다) */
export function toUser(
  u: UserRow & { managedClubIds?: string[] },
  managedClubIds: string[] = u.managedClubIds ?? [],
): User {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    birthYear: u.birthYear,
    roles: u.roles,
    status: u.status,
    emailVerified: u.emailVerified,
    providers: u.providers,
    consents: u.consents as unknown as ConsentRecord[],
    createdAt: u.createdAt.toISOString(),
    managedClubIds,
  };
}
