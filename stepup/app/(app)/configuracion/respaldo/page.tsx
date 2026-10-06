import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { BackupImportWizard } from "@/components/backup/import-wizard";
import { ImportHistory } from "@/components/backup/import-history";

export const dynamic = "force-dynamic";
export const metadata = { title: "Respaldo · TeacherFlow" };

export default async function RespaldoPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/configuracion" className="inline-flex min-h-11 items-center text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Configuración
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Respaldo</h1>
      <p className="mt-1.5 text-sm text-textMuted">
        Recuperá datos del respaldo automático de la app móvil hacia la web — manual, opcional, nunca reemplaza lo que
        ya cargaste acá.
      </p>

      <div className="mt-7">
        <BackupImportWizard />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-textPrimary">Historial de importaciones</h2>
        <p className="mt-1 text-xs text-textMuted">Tus importaciones anteriores.</p>
        <div className="mt-3">
          <ImportHistory />
        </div>
      </div>
    </div>
  );
}
