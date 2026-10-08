import PrivateLink from "@/components/nav/private-link";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { BILLING_LABEL, MODALITY_LABEL } from "@/lib/students/constants";
import { Avatar } from "@/components/ui/avatar";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import { StudentStatusBadge } from "./student-status-badge";

/** Chip de nivel: se parte si el nombre del nivel es largo (nunca desborda ni se corta con «…»). */
export function LevelChip({ children }: { children: string }) {
  return (
    <span className="inline-flex min-h-[26px] max-w-full items-center rounded-pill border border-border bg-paperDeep px-2.5 py-0.5 text-[12.5px] font-[650] leading-tight text-textSecondary [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

/** Fila de la lista en móvil: avatar, nombre, nivel y modalidad, y el estado. Toda la tarjeta es el enlace al perfil. */
export function StudentCard({ student }: { student: StudentRecord }) {
  return (
    <PrivateLink
      href={`/alumnos/${student.id}`}
      className="flex min-h-[72px] items-center gap-3 rounded-lg border-[1.5px] border-border bg-surface px-3.5 py-3 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-borderMid hover:shadow-cardHover"
    >
      <Avatar initial={avatarInitials(student.name)} tone={avatarToneFor(student.id)} size="l" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-[18px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{student.name}</p>
        <p className="mt-0.5 text-[13.5px] text-textMuted [overflow-wrap:anywhere]">
          {student.levels.length > 0 ? `Nivel ${student.levels.join(", ")}` : "Sin nivel"} · {MODALITY_LABEL[student.modality]}
        </p>
      </div>
      <StudentStatusBadge status={student.status} />
    </PrivateLink>
  );
}

/** Tabla de la lista en escritorio (desde 820 px). La celda del nombre es el enlace al perfil. */
export function StudentsTable({ students }: { students: StudentRecord[] }) {
  return (
    <Table caption="Alumnos">
      <thead>
        <tr>
          <Th>Alumno</Th>
          <Th>Niveles</Th>
          <Th>Modalidad</Th>
          <Th>Facturación</Th>
          <Th align="right">Estado</Th>
        </tr>
      </thead>
      <tbody>
        {students.map((student) => (
          <Tr key={student.id}>
            <Td className="min-w-[220px]">
              <PrivateLink href={`/alumnos/${student.id}`} className="-my-1 flex min-h-11 items-center gap-3 rounded-md hover:underline hover:decoration-borderMid hover:underline-offset-[3px]">
                <Avatar initial={avatarInitials(student.name)} tone={avatarToneFor(student.id)} size="m" />
                <span className="font-[650] text-textPrimary [overflow-wrap:anywhere]">{student.name}</span>
              </PrivateLink>
            </Td>
            <Td>
              {student.levels.length > 0 ? (
                <ul className="flex max-w-[260px] flex-wrap gap-1.5">
                  {student.levels.map((level) => (
                    <li key={level} className="max-w-full">
                      <LevelChip>{level}</LevelChip>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-textMuted">Sin nivel</span>
              )}
            </Td>
            <Td>{MODALITY_LABEL[student.modality]}</Td>
            <Td>{BILLING_LABEL[student.billingType]}</Td>
            <Td align="right">
              <StudentStatusBadge status={student.status} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
