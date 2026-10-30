import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PrivateButtonLink } from "@/components/ui/button";
import { StudentsBackLink } from "@/components/students/profile/students-back-link";
import { PaymentsBackLink } from "@/components/payments/payments-back-link";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatCivilDate } from "@/lib/format/date-format";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { LevelChip } from "@/components/students/student-card";

/**
 * Encabezado del perfil: «Volver» (enlace de texto), avatar, nombre, estado, niveles, modalidad y alta. La única acción del
 * encabezado es «Editar alumno» (secundaria): el cambio de estado vive en el Resumen, lejos de las acciones normales.
 */
export function StudentProfileHeader({ student, fromPayments = false }: { student: StudentRecord; fromPayments?: boolean }) {
  return (
    <header data-tf-header="">
      {fromPayments ? <PaymentsBackLink studentId={student.id} /> : <StudentsBackLink />}
      <div className="mt-2 flex flex-col gap-4 nav:flex-row nav:items-start nav:justify-between">
        <div className="flex min-w-0 items-start gap-4 nav:flex-1 nav:gap-5">
          <Avatar initial={avatarInitials(student.name)} tone={avatarToneFor(student.id)} size="profile" />
          <div className="min-w-0 flex-1">
            <p className="text-label font-bold uppercase text-textMuted">Alumno</p>
            <h1 data-tf-shared-name data-tf-shared-id={student.id} style={{ viewTransitionName: `tf-student-${student.id}` }} className="mt-0.5 font-display text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-textPrimary [overflow-wrap:anywhere] nav:text-[40px]">{student.name}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <StudentStatusBadge status={student.status} />
              {student.levels.length > 0 ? (
                student.levels.map((level) => <LevelChip key={level}>{level}</LevelChip>)
              ) : (
                <span className="text-[13.5px] text-textMuted">Sin nivel</span>
              )}
              <Badge>{MODALITY_LABEL[student.modality]}</Badge>
            </div>
            <p className="mt-2 text-[14.5px] text-textMuted">Alumno desde {formatCivilDate(student.dateJoined)}</p>
          </div>
        </div>
        <PrivateButtonLink href={`/alumnos/${student.id}/editar`} variant="secondary" className="self-start">
          <PencilSquareIcon className="h-5 w-5" aria-hidden />
          Editar alumno
        </PrivateButtonLink>
      </div>
    </header>
  );
}
