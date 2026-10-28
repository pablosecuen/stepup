import { redirect } from "next/navigation";
import { ComputerDesktopIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { getRenderUser } from "@/lib/auth/render-user";
import { sanitizeNextPath, DEFAULT_AUTH_REDIRECT } from "@/lib/auth/safe-redirect";
import { listActiveWebDevices, readDeviceAccess } from "@/lib/auth/device-session/server";
import { DeviceTransferForm, type DeviceTransferMode } from "./device-transfer-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dispositivo · TeacherFlow" };

/**
 * Hasta dos navegadores/PWA: un lugar libre se ocupa sin expulsar a nadie;
 * con ambos ocupados se elige explícitamente la sesión a reemplazar.
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
  const devices = await listActiveWebDevices(user.id);

  if (mode === "claim") {
    return (
      <AuthShell title="Preparando tu cuenta" subtitle="Estamos autorizando este dispositivo." layout="card" status={{ tone: "info", icon: ComputerDesktopIcon }}>
        <DeviceTransferForm mode="claim" next={next} />
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={mode === "taken-elsewhere" ? "Este dispositivo fue reemplazado" : "Tenés dos dispositivos activos"}
      subtitle={
        mode === "taken-elsewhere"
          ? "Podés usar tu cuenta en dos dispositivos a la vez. Para volver a entrar acá, elegí cuál reemplazar si ambos lugares están ocupados."
          : "Para entrar desde un tercer dispositivo, elegí qué sesión cerrar. La otra seguirá abierta."
      }
      layout="card"
      status={{ tone: "warn", icon: ExclamationTriangleIcon }}
    >
      <DeviceTransferForm mode={mode} next={next} devices={devices.map(row=>({ id:row.device_id,generation:Number(row.generation),label:row.label,lastSeen:row.last_seen_at }))} />
    </AuthShell>
  );
}
