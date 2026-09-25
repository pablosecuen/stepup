import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { claimStudentCreation, getStudentCreationClaim } from "@/lib/repositories/student-drafts";
import { ErrorState } from "@/components/ui/states";
import { NewStudentForm } from "./new-student-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo alumno · TeacherFlow" };

/**
 * El borrador ("claim") de esta alta vive server-side (Fase 2, corrección
 * de carrera real) — esta página nunca genera nada del lado del cliente.
 * Sin `?draft=` en la URL: reclama uno nuevo y redirige — así una recarga
 * de la URL con `?draft=` conserva SIEMPRE el mismo borrador, y dos
 * pestañas nuevas (cada una sin `?draft=` al abrir el link "Nuevo
 * alumno") reciben cada una el suyo. Con `?draft=` inválido, ajeno o
 * vencido: se reclama uno nuevo igual (mismo criterio anti-enumeración
 * que el resto del proyecto — nunca se distingue el motivo) y se avisa
 * con `?renewed=1`. Con `?draft=` ya completado (`status='created'`): se
 * redirige directo a la ficha del alumno — ese borrador ya cumplió su
 * propósito, no tiene sentido volver a mostrar el formulario vacío.
 */
export default async function NuevoAlumnoPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; renewed?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const { draft, renewed } = await searchParams;

  let ctx;
  let customLevels;
  try {
    ctx = await requireAuthenticatedDbContext();
    customLevels = await listCustomLevels(ctx);
  } catch {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar el formulario. Volvé a intentarlo." />
      </div>
    );
  }

  if (!draft) {
    const claim = await claimStudentCreation(ctx);
    redirect(`/alumnos/nuevo?draft=${claim.claimId}`);
  }

  const claimState = await getStudentCreationClaim(ctx, draft);
  if (!claimState || claimState.expired) {
    const claim = await claimStudentCreation(ctx);
    redirect(`/alumnos/nuevo?draft=${claim.claimId}&renewed=1`);
  }
  if (claimState.status === "created" && claimState.studentId) {
    redirect(`/alumnos/${claimState.studentId}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/alumnos" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Alumnos
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Nuevo alumno</h1>
      <p className="mt-1.5 text-sm text-textMuted">Completá los datos básicos — podés ajustar el resto después desde su ficha.</p>

      {renewed === "1" && (
        <div role="status" className="mt-4 rounded-md border border-brandBlue/30 bg-brandBlue/5 px-4 py-3 text-sm text-brandBlueDark">
          Tu borrador anterior venció o no era válido — empezamos uno nuevo. Completá el formulario de nuevo.
        </div>
      )}

      <div className="mt-7">
        <NewStudentForm customLevels={customLevels} claimId={draft} />
      </div>
    </div>
  );
}
