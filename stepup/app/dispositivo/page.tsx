import { redirect } from "next/navigation";
import { ComputerDesktopIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { getRenderUser } from "@/lib/auth/render-user";
import { sanitizeNextPath, DEFAULT_AUTH_REDIRECT } from "@/lib/auth/safe-redirect";
import { readDeviceAccess } from "@/lib/auth/device-session/server";
import { DeviceTransferForm, type DeviceTransferMode } from "./device-transfer-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dispositivo · TeacherFlow" };

/**
 * «Un solo dispositivo activo a la vez» (igual que la app original). Tres situaciones:
 *  - nadie tiene la cuenta autorizada (primer ingreso, sesión vencida): se autoriza este navegador solo, sin preguntar;
 *  - otro dispositivo la tiene: «Esta cuenta ya está en uso» y se pide confirmación antes de cerrar la otra sesión;
 *  - este navegador la tenía y otro la tomó: «Tu cuenta se abrió en otro dispositivo».
 * La pantalla sólo lee; autorizar es una acción (POST).
 */
export default async function DevicePage({ searchParams }: { searchParams: Promise<{ next?: string; motivo?: string }> }) {
  const { next: rawNext, motivo } = await searchParams;
  const next = sanitizeNextPath(rawNext, DEFAULT_AUTH_REDIRECT);
  if (!isSupabaseConfigured()) return <AuthNotConfigured />;

  const user = await getRenderUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const access = await readDeviceAccess(user.id);
  if (access.kind === "authorized") redirect(next);

  const mode: DeviceTransferMode = access.kind === "taken-elsewhere" || motivo === "otro" ? "taken-elsewhere" : access.kind === "confirm-transfer" ? "confirm-transfer" : "claim";

  if (mode === "claim") {
    return (
      <AuthShell title="Preparando tu cuenta" subtitle="Estamos autorizando este dispositivo." layout="card" status={{ tone: "info", icon: ComputerDesktopIcon }}>
        <DeviceTransferForm mode="claim" next={next} />
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={mode === "taken-elsewhere" ? "Tu cuenta se abrió en otro dispositivo" : "Esta cuenta ya está en uso"}
      subtitle={
        mode === "taken-elsewhere"
          ? "Por seguridad, sólo puede haber un dispositivo activo a la vez. La sesión en este dispositivo se cerró."
          : "Tu cuenta de TeacherFlow ya está abierta en otro dispositivo. Sólo puede haber uno activo a la vez."
      }
      layout="card"
      status={{ tone: "warn", icon: ExclamationTriangleIcon }}
    >
      <DeviceTransferForm mode={mode} next={next} />
    </AuthShell>
  );
}
