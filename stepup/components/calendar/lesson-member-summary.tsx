import { ArrowUpRightIcon, ChevronDownIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { PrivateButtonLink } from "@/components/ui/button";

export function LessonMemberSummary({ members }: { members: readonly { id: string; name: string }[] }) {
  if (members.length === 0) return null;
  if (members.length === 1) return <PrivateButtonLink href={`/alumnos/${members[0].id}`} variant="secondary" className="self-start">Ver alumno<ArrowUpRightIcon className="h-4 w-4" aria-hidden /></PrivateButtonLink>;
  return <details className="group border-y border-border" data-lesson-members>
    <summary className="tf-motion-button flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-1 text-[14px] font-semibold text-textPrimary [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2"><UserGroupIcon className="h-4 w-4 shrink-0" aria-hidden />{members.length} miembros</span>
      <span className="flex items-center gap-1 text-[12px] font-normal text-textSecondary">Ver alumnos<ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden /></span>
    </summary>
    <ul aria-label="Alumnos de esta clase" className="divide-y divide-border pb-1">
      {members.map((student) => <li key={student.id}>
        <PrivateLink href={`/alumnos/${student.id}`} className="tf-motion-link flex min-h-12 items-center gap-2.5 rounded-md px-1 py-2 text-[14px] text-textPrimary" aria-label={`Ver alumno: ${student.name}`}>
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lavenderSoft text-[10px] text-ink">{student.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("")}</span>
          <span data-tf-shared-name data-tf-shared-id={student.id} className="min-w-0 flex-1 [overflow-wrap:anywhere]">{student.name}</span>
          <ArrowUpRightIcon className="h-4 w-4 shrink-0" aria-hidden />
        </PrivateLink>
      </li>)}
    </ul>
  </details>;
}
