import { AuthShell } from "./auth-shell";
import { FormInfoBox } from "./form-boxes";

// Mismo título y estructura que `SupabaseNotConfiguredScreen.tsx` en móvil
// ("Sincronización no configurada" + caja informativa). La segunda frase
// se adapta a la web: móvil dice que todo se sigue guardando "en este
// dispositivo" (su modelo de almacenamiento local real) — la web hoy sólo
// muestra datos de ejemplo, nunca guarda nada real, así que decir eso acá
// sería falso. Se reemplaza por la frase equivalente y honesta para este
// entorno, sin inventar ninguna función nueva.
export function AuthNotConfigured() {
  return (
    <AuthShell title="Sincronización no configurada" subtitle="Todavía no hay una cuenta de nube conectada a esta app.">
      <p className="text-sm text-textSecondary">
        TeacherFlow Web sigue disponible en modo de vista previa, con datos de ejemplo.
      </p>
      <FormInfoBox>
        Esta pantalla se activa sola apenas se complete la configuración de Supabase — no hace falta hacer nada acá
        por ahora.
      </FormInfoBox>
    </AuthShell>
  );
}
