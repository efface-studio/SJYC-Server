import type { ClubApplication as ApplicationRow, Club as ClubRow, ClubPost as PostRow } from '@prisma/client';
import type { Club, ClubActivity, ClubApplication, ClubPost, MediaPhoto } from '../shared/domain/types';

export type ClubWithCount = ClubRow & { _count: { memberships: number } };
/** 회원 수는 가입 기록으로 센다 */
export const withMemberCount = { _count: { select: { memberships: true } } } as const;

export const toClub = (c: ClubWithCount): Club => ({
  id: c.id,
  name: c.name,
  field: c.field,
  summary: c.summary,
  description: c.description,
  meetingInfo: c.meetingInfo,
  target: c.target,
  memberCount: c._count.memberships,
  recruiting: c.recruiting,
  status: c.status,
  photos: c.photos as unknown as MediaPhoto[],
  activities: c.activities as unknown as ClubActivity[],
  sourceUrls: c.sourceUrls,
});

export const toClubPost = (p: PostRow): ClubPost => ({
  id: p.id,
  kind: p.kind,
  title: p.title,
  body: p.body,
  at: p.at.toISOString(),
});

export const toClubApplication = (a: ApplicationRow & { club: Pick<ClubRow, 'name'> }): ClubApplication => ({
  id: a.id,
  clubId: a.clubId,
  clubName: a.club.name,
  userId: a.userId,
  applicantName: a.applicantName,
  motivation: a.motivation,
  status: a.status,
  reason: a.reason,
  createdAt: a.createdAt.toISOString(),
});
