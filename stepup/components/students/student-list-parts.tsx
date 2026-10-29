import { BookOpenIcon, CalendarIcon, CheckCircleIcon, ClockIcon, ExclamationCircleIcon, ExclamationTriangleIcon, MinusCircleIcon, SparklesIcon, StarIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { averageGradeLabel, nextClassLabel, paymentChip, studentBadges, type StatusIcon, type StudentBadgeKind } from "@/lib/students/list-presentation";
import type { StudentListRow } from "@/lib/students/list-filters";

const ICON = "h-3.5 w-3.5";

const CHIP_ICON: Record<StatusIcon, React.ReactNode> = {
  check: <CheckCircleIcon className={ICON} aria-hidden />,
  clock: <ClockIcon className={ICON} aria-hidden />,
  alert: <ExclamationCircleIcon className={ICON} aria-hidden />,
  warning: <ExclamationTriangleIcon className={ICON} aria-hidden />,
  cross: <XCircleIcon className={ICON} aria-hidden />,
  none: <MinusCircleIcon className={ICON} aria-hidden />,
};

const BADGE_ICON: Partial<Record<StudentBadgeKind, React.ReactNode>> = {
  destacado: <StarIcon className={ICON} aria-hidden />,
  nuevo: <SparklesIcon className={ICON} aria-hidden />,
  pago_vencido: <ExclamationCircleIcon className={ICON} aria-hidden />,
  tarea_pendiente: <BookOpenIcon className={ICON} aria-hidden />,
};

/** Estado de pago del mes: pastilla con ícono y texto (el color nunca va solo). */
export function PaymentStatusChip({ row }: { row: StudentListRow }) {
  const chip = paymentChip(row.payment);
  return (
    <Badge tone={chip.tone} icon={CHIP_ICON[chip.icon]}>
      {chip.text}
    </Badge>
  );
}

/** Insignias de la fila: estado del alumno, destacado, nuevo, pago vencido (con el período) y tarea pendiente. */
export function StudentBadges({ row }: { row: StudentListRow }) {
  const badges = studentBadges({ status: row.student.status, isFeatured: row.student.isFeatured, dateJoined: row.student.dateJoined, payment: row.payment, hasPendingHomework: row.aggregates.hasPendingHomework });
  if (badges.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Avisos del alumno">
      {badges.map((badge) => (
        <li key={badge.kind}>
          <Badge tone={badge.kind === "pago_vencido" ? "bad" : badge.kind === "nuevo" ? "info" : badge.kind === "destacado" ? "accent" : "neutral"} icon={BADGE_ICON[badge.kind]}>
            {badge.label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function NextClassText({ row, now }: { row: StudentListRow; now: Date }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <CalendarIcon className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
      <span>{nextClassLabel(row.nextClassStart, row.nextClassEnd, now)}</span>
    </span>
  );
}

export function GradeAndMonthText({ row }: { row: StudentListRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <StarIcon className="h-4 w-4 text-textMuted" aria-hidden />
        <span>{averageGradeLabel(row.aggregates.averageGrade)}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <BookOpenIcon className="h-4 w-4 text-textMuted" aria-hidden />
        <span>{row.aggregates.classesThisMonth} este mes</span>
      </span>
    </span>
  );
}
