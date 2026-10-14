import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { BackupImportWizard } from "@/components/backup/import-wizard";
import { ImportHistory } from "@/components/backup/import-history";
import { SettingsBreadcrumb } from "@/components/account/settings-ui";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";
// R6: analizar (descarga de hasta 20 MB + validación + vista previa) y confirmar una importación grande llevan segundos; la base corta cualquier operación a los 8 s
// (revierte todo), así que 60 s sobran para la Server Action sin dejar el límite de la plataforma como única defensa.
export const maxDuration = 60;
export const metadata = { title: "Respaldo · TeacherFlow" };

export default async function RespaldoPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  return (
    <div className={PAGE_WIDTH.wide}>
      <SettingsBreadcrumb current="Respaldo" />
      <div className="mt-1">
        <PageHeader
          title="Respaldo"
          subtitle="Traé a la web los datos de la copia de seguridad que hace tu app móvil. Es opcional y manual: primero ves qué se importaría y recién después confirmás. Por defecto no se reemplaza nada de lo que ya cargaste acá."
        />
      </div>

      <section aria-labelledby="respaldo-recuperar" className="mt-8">
        <h2 id="respaldo-recuperar" className="font-display text-section font-semibold text-textPrimary">
          Recuperar datos
        </h2>
        <div className="mt-3 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-6">
          <BackupImportWizard />
        </div>
      </section>

      <section aria-labelledby="respaldo-historial" className="mt-10">
        <h2 id="respaldo-historial" className="font-display text-section font-semibold text-textPrimary">
          Historial de importaciones
        </h2>
        <p className="mt-0.5 text-[14.5px] text-textMuted">Tus importaciones anteriores.</p>
        <div className="mt-3">
          <ImportHistory />
        </div>
      </section>
    </div>
  );
}
