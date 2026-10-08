import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { Button } from "@/components/ui/button";
import { NewPasswordForm } from "./new-password-form";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { newPasswordGate } from "@/lib/auth/recovery-session";
import { abandonRecoveryAction } from "@/lib/auth/actions";
import { clearRecoveryMarker, hasValidRecoveryMarker, setRecoveryMarker } from "@/lib/auth/recovery-cookie";

export const dynamic = "force-dynamic";
export const metadata = { title: "Elegí una contraseña nueva · TeacherFlow" };

// Mismos título/subtítulo que NewPasswordScreen.tsx en móvil. Móvil sólo
// permite llegar acá tras el evento PASSWORD_RECOVERY (nunca por
// navegación manual); acá el equivalente en el servidor es exigir una sesión
// activa Y el marcador que deja la verificación de un enlace/código de
// recuperación (ver lib/auth/recovery-marker.ts): una sesión vieja que ya estaba
// abierta en el dispositivo no alcanza, para no cambiar por accidente su contraseña.
export default async function NuevaContrasenaPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const access = await newPasswordGate({
    adapter: createSupabaseAuthAdapter(),
    markers: { set: setRecoveryMarker, isValid: hasValidRecoveryMarker, clear: clearRecoveryMarker },
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <AuthShell layout="card" title="Elegí una contraseña nueva" subtitle="Después de guardarla, vas a iniciar sesión de nuevo con ella.">
      <NewPasswordForm />
      {/* Abandonar la recuperación: borra el marcador y cierra la sesión que dejó el enlace. */}
      <form action={abandonRecoveryAction} aria-label="Cancelar la recuperación de contraseña">
        <Button type="submit" variant="ghost" block>
          Cancelar
        </Button>
      </form>
    </AuthShell>
  );
}
