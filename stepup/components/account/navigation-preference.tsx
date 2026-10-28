"use client";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { saveNavigationPreference } from "@/lib/actions/navigation-preference";
import { Notice } from "@/components/ui/notice";

export function NavigationPreference({ value }: { value: "barra" | "menu" }) {
  const [pending, run] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return <fieldset disabled={pending}>
    <legend className="font-semibold">Ubicación de la navegación</legend>
    <p className="mt-1 text-sm text-textSecondary">Elegí la barra inferior o los accesos dentro del logo. Se guarda en este navegador, como preferencia del dispositivo.</p>
    {([['barra', 'Barra inferior'], ['menu', 'Menú del logo']] as const).map(([key, label]) => <label key={key} className="mt-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border p-3">
      <input type="radio" name="navigation-location" value={key} checked={value === key} className="h-5 w-5" onChange={() => run(async () => {
        try { const result = await guardNetwork(() => saveNavigationPreference(key)); setError(result.error ?? ""); if (!result.error) router.refresh(); }
        catch { setError("No pudimos guardar la preferencia. Volvé a intentarlo."); }
      })} />{label}
    </label>)}
    {error && <Notice tone="bad">{error}</Notice>}
  </fieldset>;
}

