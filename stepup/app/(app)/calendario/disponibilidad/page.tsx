import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { FormPage } from "@/components/ui/form-page";
import { AvailabilityEditor } from "./availability-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disponibilidad · TeacherFlow" };

export default async function DisponibilidadPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  let availability;
  try {
    const ctx = await requireAuthenticatedDbContext();
    availability = await getTeacherAvailability(ctx);
  } catch {
    return (
      <div className={PAGE_WIDTH.narrow}>
        <PageTitle>Disponibilidad</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar tu disponibilidad." />
          </div>
          <PrivateButtonLink href="/calendario/disponibilidad" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  return (
    <FormPage
      backHref="/calendario"
      backLabel="Volver al Calendario"
      title="Disponibilidad"
      subtitle="Bloqueos semanales y excepciones (vacaciones, feriados) — se usan para avisar de conflictos al crear/reprogramar una clase."
    >
      <AvailabilityEditor initial={availability} />
    </FormPage>
  );
}
