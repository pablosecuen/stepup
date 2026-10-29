"use client";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { saveNavigationPreference } from "@/lib/actions/navigation-preference";
import { SettingsRow } from "@/components/account/settings-ui";
import { Notice } from "@/components/ui/notice";

/**
 * «Ubicación de la navegación»: una fila de Configuración como las demás (`SettingsRow`: relleno de la tarjeta, título → explicación → control),
 * con el grupo de opciones en un `fieldset` para que el lector de pantalla lo anuncie como grupo. La preferencia guardada y su acción no cambian.
 */
export function NavigationPreference({ value }: { value: "barra" | "menu" }) {
  const [pending, run] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <SettingsRow title="Ubicación de la navegación" description="Elegí la barra inferior o los accesos dentro del logo. Se guarda en este navegador, como preferencia del dispositivo.">
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-2">
        <legend className="sr-only">Ubicación de la navegación</legend>
        {([['barra', 'Barra inferior'], ['menu', 'Menú del logo']] as const).map(([key, label]) => <label key={key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-[15px] text-textPrimary has-[:checked]:border-borderStrong has-[:checked]:bg-surface2 has-[:checked]:font-[650]">
          <input type="radio" name="navigation-location" value={key} checked={value === key} className="h-5 w-5 shrink-0" onChange={() => run(async () => {
            try { const result = await guardNetwork(() => saveNavigationPreference(key)); setError(result.error ?? ""); if (!result.error) router.refresh(); }
            catch { setError("No pudimos guardar la preferencia. Volvé a intentarlo."); }
          })} />{label}
        </label>)}
        {error && <Notice tone="bad">{error}</Notice>}
      </fieldset>
    </SettingsRow>
  );
}
