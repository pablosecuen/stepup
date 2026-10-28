import PrivateLink from "@/components/nav/private-link";
import { MODALITY_LABEL } from "@/lib/students/constants";
import type { StudentListRow } from "@/lib/students/list-filters";
import { Avatar } from "@/components/ui/avatar";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import { GradeAndMonthText, NextClassText, PaymentStatusChip, StudentBadges } from "./student-list-parts";
import { StudentRowActionsMenu } from "./row-actions-menu";

/** Chip de nivel: se parte si el nombre del nivel es largo (nunca desborda ni se corta con «…»). */
export function LevelChip({ children }: { children: string }) {
  return (
    <span className="inline-flex min-h-[26px] max-w-full items-center rounded-pill border border-border bg-paperDeep px-2.5 py-0.5 text-[12.5px] font-[650] leading-tight text-textSecondary [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

/** Fila de la lista en móvil: avatar, nombre, nivel y modalidad, próxima clase, estado de pago del mes, promedio, clases del mes y avisos. La tarjeta es el enlace al perfil; el menú de acciones del alumno queda al costado, fuera del enlace. */
export function StudentCard({ row, now }: { row: StudentListRow; now: Date }) {
  const { student } = row;
  return (
    <div className="flex items-start rounded-lg border-[1.5px] border-border bg-surface shadow-card transition-[border-color,box-shadow] duration-150 hover:border-borderMid hover:shadow-cardHover">
    <PrivateLink href={`/alumnos/${student.id}`} className="flex min-h-[72px] min-w-0 flex-1 items-start gap-3 rounded-lg px-3.5 py-3">
      <Avatar initial={avatarInitials(student.name)} tone={avatarToneFor(student.id)} size="l" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-[18px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{student.name}</p>
        <p className="mt-0.5 text-[13.5px] text-textMuted [overflow-wrap:anywhere]">
          {student.levels.length > 0 ? `Nivel ${student.levels.join(", ")}` : "Sin nivel"} · {MODALITY_LABEL[student.modality]}
        </p>
        <p className="mt-1 text-[13.5px] text-textSecondary">
          <NextClassText row={row} now={now} />
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <PaymentStatusChip row={row} />
          <span className="text-[13.5px] text-textSecondary">
            <GradeAndMonthText row={row} />
          </span>
        </div>
        <div className="mt-2 empty:hidden">
          <StudentBadges row={row} />
        </div>
      </div>
    </PrivateLink>
    <div className="pr-1 pt-1.5">
      <StudentRowActionsMenu student={{ id: student.id, name: student.name, status: student.status }} nextClassStart={row.nextClassStart} />
    </div>
    </div>
  );
}

/**
 * Tabla de la lista en escritorio (desde 820 px). TODA la fila abre el perfil con UN solo enlace (el del nombre): un pseudo-elemento
 * `after:absolute after:inset-0` del enlace cubre la fila entera (`<tr class="relative">`). Un único enlace = una sola parada de Tab y
 * un solo nombre accesible por fila («Abrir perfil de …»); Enter, Ctrl/Cmd+clic y botón central funcionan como en cualquier enlace.
 * Si en el futuro una fila suma botones independientes, deben llevar `relative z-10` para quedar por encima de la superficie
 * clicable y no disparar la navegación.
 */
export function StudentsTable({ rows, now }: { rows: StudentListRow[]; now: Date }) {
  return (
    <Table caption="Alumnos">
      <thead>
        <tr>
          <Th>Alumno</Th>
          <Th>Niveles</Th>
          <Th>Modalidad</Th>
          <Th>Próxima clase</Th>
          <Th>Estado de pago</Th>
          <Th>Notas y clases</Th>
          <Th>
            <span className="sr-only">Acciones</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { student } = row;
          return (
          <Tr key={student.id} className="relative cursor-pointer">
            <Td className="min-w-[220px]">
              <PrivateLink
                href={`/alumnos/${student.id}`}
                aria-label={`Abrir perfil de ${student.name}`}
                className="-my-1 flex min-h-11 items-center gap-3 rounded-md after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-[2.5px] focus-visible:after:-outline-offset-2 focus-visible:after:outline-ink group-hover:underline group-hover:decoration-borderMid group-hover:underline-offset-[3px]"
              >
                <Avatar initial={avatarInitials(student.name)} tone={avatarToneFor(student.id)} size="m" />
                <span className="font-[650] text-textPrimary [overflow-wrap:anywhere]">{student.name}</span>
              </PrivateLink>
              <div className="mt-1 empty:hidden">
                <StudentBadges row={row} />
              </div>
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
            <Td>
              <NextClassText row={row} now={now} />
            </Td>
            <Td>
              <PaymentStatusChip row={row} />
            </Td>
            <Td>
              <GradeAndMonthText row={row} />
            </Td>
            <Td className="w-14 text-right">
              <StudentRowActionsMenu student={{ id: student.id, name: student.name, status: student.status }} nextClassStart={row.nextClassStart} />
            </Td>
          </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
