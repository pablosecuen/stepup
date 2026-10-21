import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadTestDataSummary } from "@/lib/repositories/excluded-students";
import { ErrorState } from "@/components/ui/states";
import PrivateLink from "@/components/nav/private-link";
import { linkClass } from "@/components/ui/button";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { SettingsBreadcrumb, SettingsCard, SettingsRow } from "@/components/account/settings-ui";
import { TestDataToggle } from "@/components/account/test-data-toggle";
import { formatCivilDate } from "@/lib/format/date-format";
import { instantDateKey } from "@/lib/calendar/civil-calendar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Datos de prueba · TeacherFlow" };

const STATUS_LABEL: Record<string, string> = { activo: "Activo", pausado: "Pausado", inactivo: "Inactivo", archivado: "Archivado" };

/**
 * Datos de prueba marcados por la profesora (alumnos QA/PRUEBA y todo lo que cuelga de ellos). Mientras estén ocultos no aparecen en la agenda, las clases por registrar, las listas ni las estadísticas.
 * Acá se consultan y se pueden volver a mostrar; nada se borra nunca.
 */
export default async function DatosDePruebaPage() {
  if (!isSupabaseConfigured()) return <AuthNotConfigured inShell />;

  let summary;
  try {
    const ctx = await requireAuthenticatedDbContext();
    summary = await loadTestDataSummary(ctx);
  } catch {
    return (
      <div className={PAGE_WIDTH.wide}>
        <SettingsBreadcrumb current="Datos de prueba" />
        <div className="mt-5">
          <ErrorState message="No pudimos cargar los datos de prueba." />
        </div>
      </div>
    );
  }

  const hidden = summary.hiddenCount > 0;
  return (
    <div className={PAGE_WIDTH.wide}>
      <SettingsBreadcrumb current="Datos de prueba" />
      <div className="mt-1">
        <PageHeader title="Datos de prueba" subtitle="Alumnos de prueba y todo lo que cuelga de ellos. Nunca se borran: sólo se ocultan o se vuelven a mostrar." />
      </div>

      {summary.students.length === 0 ? (
        <p className="mt-6 text-[15px] text-textMuted">No hay datos marcados como prueba.</p>
      ) : (
        <div className="mt-6 flex min-w-0 flex-col gap-6">
          <SettingsCard>
            <SettingsRow
              title={hidden ? "Los datos de prueba están ocultos" : "Los datos de prueba se están mostrando"}
              description={
                hidden
                  ? "No aparecen en la agenda, las clases por registrar, las listas de Alumnos y Series ni en las estadísticas. Podés consultarlos abajo."
                  : "Aparecen mezclados con tus datos en todas las pantallas. Podés volver a ocultarlos."
              }
            >
              <TestDataToggle hidden={hidden} />
            </SettingsRow>
          </SettingsCard>

          <section aria-labelledby="prueba-alumnos">
            <h2 id="prueba-alumnos" className="font-display text-section font-semibold text-textPrimary">
              Alumnos marcados como prueba
            </h2>
            <p className="mt-0.5 text-[14.5px] text-textMuted">Abrí cada ficha para ver su historial completo.</p>
            <ul className="mt-3 flex flex-col gap-3">
              {summary.students.map((student) => (
                <li key={student.studentId} className="rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <PrivateLink href={`/alumnos/${student.studentId}`} className={linkClass()}>
                      {student.name}
                    </PrivateLink>
                    <p className="text-[13.5px] text-textMuted">
                      {student.hidden ? "Oculto" : "Visible"} · {STATUS_LABEL[student.status] ?? student.status} · creado el {formatCivilDate(instantDateKey(student.createdAt))}
                    </p>
                  </div>
                  <p className="mt-1.5 text-[14.5px] text-textSecondary">
                    {student.seriesCount} serie(s) · {student.lessonCount} clase(s) guardada(s) · {student.registrationCount} registro(s) · {student.chargeCount} cobro(s) anulado(s) o de prueba
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
