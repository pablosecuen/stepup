import { AdjustmentsHorizontalIcon, ArchiveBoxIcon, ClockIcon, ComputerDesktopIcon, ShieldExclamationIcon, TagIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { TeacherProfileForm } from "@/components/account/teacher-profile-form";
import { BudgetDistributionForm } from "@/components/account/budget-distribution-form";
import { ActiveSessionDetails, EndActiveSessionControl, type ActiveSessionInfo } from "@/components/account/active-session-card";
import { ChangePasswordButton } from "@/components/account/change-password-button";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { SettingsIndex, SettingsLinkRow, SettingsRow, SettingsSection, type SettingsIndexItem } from "@/components/account/settings-ui";
import { Avatar } from "@/components/ui/avatar";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import type { BudgetDistribution } from "@/lib/payments/budget-distribution";

// Estructura de la página: Cuenta → Preferencias → Sesión y datos → Acciones sensibles (siempre al final y separadas).
const SECTIONS: readonly SettingsIndexItem[] = [
  { id: "cuenta", label: "Cuenta", icon: UserCircleIcon },
  { id: "preferencias", label: "Preferencias", icon: AdjustmentsHorizontalIcon },
  { id: "sesion-y-datos", label: "Sesión y datos", icon: ComputerDesktopIcon },
  { id: "acciones-sensibles", label: "Acciones sensibles", icon: ShieldExclamationIcon },
];

/** Contenido de Configuración con la cuenta ya cargada. Es sólo presentación: la página resuelve los datos. */
export function ConfigurationView({
  email,
  displayName,
  budget,
  session,
  billingEnabled = false,
}: {
  email: string | null;
  displayName: string;
  budget: BudgetDistribution;
  session: ActiveSessionInfo | null;
  /** Sólo con la facturación encendida: el diálogo de eliminar cuenta explica qué pasa con la suscripción. */
  billingEnabled?: boolean;
}) {
  const who = displayName.trim() || email || "";
  return (
    <div className="mt-6 flex flex-col gap-5 md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
      <SettingsIndex items={SECTIONS} />

      <div className="flex min-w-0 flex-col gap-9">
        <SettingsSection id="cuenta" title="Cuenta" description="Tus datos de acceso y cómo te ve la app.">
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
          <SettingsRow title="Nombre visible" description="Es el nombre que usa el saludo de Inicio y el menú de cuenta.">
            <TeacherProfileForm displayName={displayName} />
          </SettingsRow>
          <SettingsRow title="Contraseña" description="Te enviamos un enlace a tu correo para elegir una nueva.">
            <ChangePasswordButton />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection id="preferencias" title="Preferencias" description="Cómo trabajás con la app.">
          <SettingsRow
            title="Distribución 50/30/20"
            description="Presupuesto sugerido sobre lo que ya cobraste — nunca conoce tus gastos ni tu ahorro bancario real."
          >
            <BudgetDistributionForm initial={budget} />
          </SettingsRow>
          <SettingsLinkRow href="/calendario/disponibilidad" title="Disponibilidad" description="Bloqueos semanales, vacaciones y feriados." icon={ClockIcon} />
          <SettingsLinkRow
            href="/alumnos"
            title="Niveles personalizados"
            description="Crear y renombrar niveles propios de tus alumnos, desde Alumnos."
            icon={TagIcon}
          />
          <SettingsRow
            title="Políticas de cobro"
            description="Los recargos por atraso están desactivados. El semáforo de mora usa plazos fijos."
          />
        </SettingsSection>

        <SettingsSection id="sesion-y-datos" title="Sesión y datos" description="El dispositivo autorizado y las copias de seguridad.">
          <SettingsRow title="Dispositivo autorizado" description="El dispositivo con el que tu cuenta está autorizada ahora.">
            <ActiveSessionDetails session={session} />
          </SettingsRow>
          <SettingsLinkRow href="/configuracion/respaldo" title="Respaldo" description="Recuperar datos del respaldo de la app móvil." icon={ArchiveBoxIcon} />
        </SettingsSection>

        <SettingsSection
          id="acciones-sensibles"
          title="Acciones sensibles"
          description="Afectan a tu cuenta o a tus dispositivos. Siempre piden confirmación antes de ejecutarse."
          tone="danger"
        >
          <SettingsRow title="Cerrar la sesión del dispositivo autorizado" description="Para cuando perdiste ese dispositivo o ya no lo controlás.">
            <EndActiveSessionControl session={session} />
          </SettingsRow>
          <SettingsRow title="Eliminar cuenta" description="Borra tu cuenta y todos tus datos de forma permanente.">
            <DeleteAccountButton billingEnabled={billingEnabled} />
          </SettingsRow>
        </SettingsSection>
      </div>
    </div>
  );
}
