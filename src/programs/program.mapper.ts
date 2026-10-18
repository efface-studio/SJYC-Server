import type { Program as ProgramRow, ProgramApplication as ApplicationRow } from '@prisma/client';
import { computeRecruitStatus } from '../shared/domain/program';
import type { Program, ProgramApplication, StatusHistoryEntry } from '../shared/domain/types';

export function toProgram(p: ProgramRow, now = new Date()): Program {
  const program = {
    id: p.id,
    title: p.title,
    categoryId: p.categoryId,
    summary: p.summary,
    description: p.description,
    target: p.target,
    place: p.place,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt.toISOString(),
    recruitStartsAt: p.recruitStartsAt.toISOString(),
    recruitEndsAt: p.recruitEndsAt.toISOString(),
    capacity: p.capacity,
    appliedCount: p.appliedCount,
    status: p.status,
    cancelDeadline: p.cancelDeadline.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
  return { ...program, recruitStatus: computeRecruitStatus(program, now) };
}

/** 접수·승인 상태이고 취소 기한 전이면 취소 가능 */
export function toApplication(
  a: ApplicationRow & { program: Pick<ProgramRow, 'title' | 'cancelDeadline'> },
): ProgramApplication {
  const open = a.status === 'submitted' || a.status === 'approved';
  return {
    id: a.id,
    receiptNo: a.receiptNo,
    programId: a.programId,
    programTitle: a.program.title,
    userId: a.userId,
    applicantName: a.applicantName,
    phone: a.phone,
    note: a.note,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    history: a.history as unknown as StatusHistoryEntry[],
    cancellable: open && Date.now() < a.program.cancelDeadline.getTime(),
  };
}

export const historyEntry = (
  status: StatusHistoryEntry['status'],
  actor: StatusHistoryEntry['actor'],
  reason: string | null = null,
): StatusHistoryEntry => ({ at: new Date().toISOString(), status, actor, reason });
