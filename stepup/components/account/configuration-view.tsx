import { TeacherProfileForm } from "@/components/account/teacher-profile-form";
import { ChangePasswordButton } from "@/components/account/change-password-button";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import PrivateLink from "@/components/nav/private-link";
import { linkClass } from "@/components/ui/button";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/account/settings-ui";
import { Avatar } from "@/components/ui/avatar";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";

/**
 * Contenido de Configuración con la cuenta ya cargada. Es sólo presentación: la página resuelve los datos. Sólo lo que realmente se
 * configura acá: Cuenta (con el nombre visible), Contraseña, Políticas de cobro y Acciones sensibles (Eliminar cuenta). Disponibilidad
 * se administra desde Calendario y los niveles personalizados desde Alumnos (no se repiten acá); no hay copias de seguridad ni
 * sesiones (la base no guarda sesiones web: ver docs/design/web-v1/14-cuenta-configuracion-y-resumen.md). Con tan pocas secciones no
 * hace falta un índice lateral. Las tarjetas se reparten en dos columnas cuando entran y los bloques cortos (políticas, acciones
 * sensibles) tienen un ancho proporcionado a su contenido: no se estiran de lado a lado.
 */
export function ConfigurationView({
  email,
  displayName,
  billingEnabled = false,
  testData = null,
}: {
  email: string | null;
  displayName: string;
  /** Sólo con la facturación encendida: el diálogo de eliminar cuenta explica qué pasa con la suscripción. */
  billingEnabled?: boolean;
  /** Hay datos de prueba marcados: se ofrece consultarlos y volver a mostrarlos (`hidden`: hoy están ocultos). */
  testData?: { hidden: boolean } | null;
}) {
  const who = displayName.trim() || email || "";
  return (
    <div className="mt-6 flex min-w-0 flex-col gap-9">
      <SettingsSection id="cuenta" title="Cuenta" description="Tus datos de acceso y cómo aparecés en TeacherFlow." columns="lg:grid-cols-2">
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
          <SettingsRow title="Contraseña" description="Te enviamos un enlace a tu correo para elegir una nueva.">
            <ChangePasswordButton />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection id="preferencias" title="Preferencias" description="Organizá cómo funciona TeacherFlow." columns="max-w-[480px]">
        <SettingsCard><SettingsRow title="Tutorial de TeacherFlow" description="Volvé a recorrer las funciones principales."><PrivateLink href="/configuracion/tutorial" className={linkClass()}>Ver tutorial</PrivateLink></SettingsRow></SettingsCard>
        <SettingsCard>
          <SettingsRow title="Políticas de cobro" description="Los recargos por atraso están desactivados. El semáforo de mora usa plazos fijos." />
        </SettingsCard>
        <SettingsCard>
          <SettingsRow title="Revisar consistencia" description="Revisa tus cobros y pagos en busca de repetidos, importes que no coinciden con el plan o pagos sin cobro. Sólo lee: no cambia nada.">
            <PrivateLink href="/configuracion/consistencia" className={linkClass()}>
              Revisar ahora
            </PrivateLink>
          </SettingsRow>
        </SettingsCard>
        {testData && (
          <SettingsCard>
            <SettingsRow title="Datos de prueba" description={testData.hidden ? "Hay alumnos de prueba ocultos de la agenda, las listas y las estadísticas. Se pueden consultar y volver a mostrar." : "Hay alumnos de prueba marcados que hoy se muestran mezclados con tus datos."}>
              <PrivateLink href="/configuracion/datos-de-prueba" className={linkClass()}>
                Ver datos de prueba
              </PrivateLink>
            </SettingsRow>
          </SettingsCard>
        )}
      </SettingsSection>

      <SettingsSection
        id="acciones-sensibles"
        title="Acciones sensibles"
        description="Afectan a tu cuenta. Siempre piden confirmación antes de ejecutarse."
        tone="danger"
        columns="max-w-[560px]"
      >
        <SettingsCard tone="danger">
          <SettingsRow title="Eliminar cuenta" description="Borra tu cuenta y todos tus datos de forma permanente.">
            <DeleteAccountButton billingEnabled={billingEnabled} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
