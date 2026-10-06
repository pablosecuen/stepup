import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { BackupImportWizard } from "@/components/backup/import-wizard";
import { ImportHistory } from "@/components/backup/import-history";
import { SettingsBreadcrumb } from "@/components/account/settings-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Respaldo · TeacherFlow" };

export default async function RespaldoPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <SettingsBreadcrumb current="Respaldo" />
      <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Respaldo</h1>
      <p className="mt-1.5 text-sm text-textMuted">
        Recuperá datos del respaldo automático de la app móvil hacia la web — manual, opcional, nunca reemplaza lo que
        ya cargaste acá.
      </p>

      <section aria-labelledby="respaldo-recuperar" className="mt-7">
        <h2 id="respaldo-recuperar" className="text-lg font-semibold tracking-tight text-textPrimary">
          Recuperar datos
        </h2>
        <div className="mt-3">
          <BackupImportWizard />
        </div>
      </section>

      <section aria-labelledby="respaldo-historial" className="mt-10">
        <h2 id="respaldo-historial" className="text-lg font-semibold tracking-tight text-textPrimary">
          Historial de importaciones
        </h2>
        <p className="mt-1 text-sm text-textMuted">Tus importaciones anteriores.</p>
        <div className="mt-3">
          <ImportHistory />
        </div>
      </section>
    </div>
  );
}
