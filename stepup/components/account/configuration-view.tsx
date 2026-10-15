import { AdjustmentsHorizontalIcon, ClockIcon, ShieldExclamationIcon, TagIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { TeacherProfileForm } from "@/components/account/teacher-profile-form";
import { ChangePasswordButton } from "@/components/account/change-password-button";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { SettingsCard, SettingsIndex, SettingsLinkCard, SettingsRow, SettingsSection, type SettingsIndexItem } from "@/components/account/settings-ui";
import { Avatar } from "@/components/ui/avatar";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";

// Estructura de la página: Cuenta → Preferencias → Acciones sensibles (siempre al final y separadas). «Sesiones abiertas» NO está:
// la base sólo guarda el dispositivo de la app anterior (no sesiones web), así que no se muestra nada que no se pueda comprobar
// (ver docs/design/web-v1/14-cuenta-configuracion-y-resumen.md).
const SECTIONS: readonly SettingsIndexItem[] = [
  { id: "cuenta", label: "Cuenta", icon: UserCircleIcon },
  { id: "preferencias", label: "Preferencias", icon: AdjustmentsHorizontalIcon },
  { id: "acciones-sensibles", label: "Acciones sensibles", icon: ShieldExclamationIcon },
];

/**
 * Contenido de Configuración con la cuenta ya cargada. Es sólo presentación: la página resuelve los datos. Usa el ancho útil del
 * shell (la página usa `PAGE_WIDTH.wide`) con el índice a la izquierda y las tarjetas en dos o tres columnas cuando el contenido
 * lo permite; en móvil todo vuelve a una columna. Los formularios cortos no se estiran: viven dentro de su tarjeta.
 */
export function ConfigurationView({
  email,
  displayName,
  billingEnabled = false,
}: {
  email: string | null;
  displayName: string;
  /** Sólo con la facturación encendida: el diálogo de eliminar cuenta explica qué pasa con la suscripción. */
  billingEnabled?: boolean;
}) {
  const who = displayName.trim() || email || "";
  return (
    <div className="mt-6 flex flex-col gap-5 md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
      <SettingsIndex items={SECTIONS} />

      <div className="flex min-w-0 flex-col gap-9">
        <SettingsSection id="cuenta" title="Cuenta" description="Tus datos de acceso y cómo te ve la app." columns="lg:grid-cols-2">
          <SettingsCard>
            <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <Avatar initial={avatarInitials(who)} tone={avatarToneFor(email ?? who)} size="l" />
              <div className="min-w-0">
                {displayName.trim() && <p className="font-display text-[22px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{displayName.trim()}</p>}
                <p className="text-[14px] text-textMuted [overflow-wrap:anywhere]">
                  <span className="sr-only">Correo de acceso: </span>
                  {email ?? "—"}
                </p>
              </div>
            </div>
            <SettingsRow title="Nombre visible" description="Es el nombre que usa el saludo de Inicio.">
              <TeacherProfileForm displayName={displayName} />
            </SettingsRow>
          </SettingsCard>
          <SettingsCard>
            <SettingsRow title="Correo de acceso" description="Con este correo iniciás sesión.">
              <p className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">{email ?? "—"}</p>
            </SettingsRow>
            <SettingsRow title="Contraseña" description="Te enviamos un enlace a tu correo para elegir una nueva.">
              <ChangePasswordButton />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="preferencias" title="Preferencias" description="Cómo trabajás con la app." columns="min-[560px]:grid-cols-2 xl:grid-cols-3">
          <SettingsLinkCard href="/calendario/disponibilidad" title="Disponibilidad" description="Bloqueos semanales, vacaciones y feriados." icon={ClockIcon} />
          <SettingsLinkCard href="/alumnos" title="Niveles personalizados" description="Crear y renombrar niveles propios de tus alumnos, desde Alumnos." icon={TagIcon} />
          <SettingsCard>
            <SettingsRow title="Políticas de cobro" description="Los recargos por atraso están desactivados. El semáforo de mora usa plazos fijos." />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          id="acciones-sensibles"
          title="Acciones sensibles"
          description="Afectan a tu cuenta. Siempre piden confirmación antes de ejecutarse."
          tone="danger"
          columns="lg:grid-cols-2"
        >
          <SettingsCard tone="danger">
            <SettingsRow title="Eliminar cuenta" description="Borra tu cuenta y todos tus datos de forma permanente.">
              <DeleteAccountButton billingEnabled={billingEnabled} />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </div>
    </div>
  );
}
