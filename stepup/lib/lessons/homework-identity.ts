import { isHomeworkTaskResolved, type HomeworkReviewOutcome, type PendingHomeworkTask } from "./homework.ts";

/** Imported reviews retain mobile IDs. Resolve exact aliases within one owner/student. */
export function homeworkTaskAliases(input: {
  originRegistrationId: string;
  legacyOriginRegistrationId?: string | null;
  studentId: string;
  legacyStudentId?: string | null;
  individual: boolean;
}): string[] {
  const origins = [...new Set([input.originRegistrationId, input.legacyOriginRegistrationId].filter((id): id is string => Boolean(id)))];
  const students = [...new Set([input.studentId, input.legacyStudentId].filter((id): id is string => Boolean(id)))];
  return input.individual
    ? origins.flatMap((origin) => students.map((student) => `individual:${origin}:${student}`))
    : origins.map((origin) => `common:${origin}`);
}

export function pendingHomeworkWithReviews(tasks: PendingHomeworkTask[], aliases: ReadonlyMap<string, string>, reviews: {
  task_id: string; outcome: HomeworkReviewOutcome; reviewed_at: string; lesson_registration_id: string;
}[], currentRegistrationId?: string): PendingHomeworkTask[] {
  const resolved = new Set(reviews.filter((r) => isHomeworkTaskResolved(r.outcome)).map((r) => aliases.get(r.task_id)));
  const selections = new Map(reviews.filter((r) => r.lesson_registration_id === currentRegistrationId)
    .sort((a, b) => Date.parse(a.reviewed_at) - Date.parse(b.reviewed_at)).map((r) => [aliases.get(r.task_id), r.outcome]));
  return tasks.filter((t) => !resolved.has(t.taskId)).map((t) => ({ ...t,
    ...(selections.has(t.taskId) ? { currentReviewOutcome: selections.get(t.taskId) } : {}),
  })).sort((a, b) => Date.parse(a.assignedAt) - Date.parse(b.assignedAt));
}
