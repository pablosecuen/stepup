"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { Button, linkClass } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import PrivateLink from "@/components/nav/private-link";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { guardNetwork } from "@/lib/actions/network-guard";
import { changePlanAction, startCheckoutAction, type BillingActionResult } from "@/lib/actions/billing";
import { actionError, safeProviderRedirect } from "@/lib/billing/redirect";
import type { PlanOptionView } from "@/lib/billing/view";

// Elección de plan + datos del pago. El navegador sólo envía un CÓDIGO de plan: precio, moneda, período y propietaria los resuelve
// el servidor. El nombre y el DNI/CUIT viven SÓLO en el estado de este componente: no se autocompletan, no se guardan en el
// navegador y se borran apenas se crea el pago (o se abandona la pantalla).

export type PickerMode = "subscribe" | "change";

export function PlanPicker({ options, mode, currentPlanCode, grandfathered, demo }: { options: readonly PlanOptionView[]; mode: PickerMode; currentPlanCode: string | null; grandfathered: boolean; demo: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(options.find((option) => option.code !== currentPlanCode)?.code ?? options[0]?.code ?? "");
  const [name, setName] = useState("");
  const [identification, setIdentification] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<"name" | "identification" | null>(null);
  const [pending, startTransition] = useTransition();
  const identificationRef = useRef<HTMLInputElement>(null);

  function clearPersonalData() {
    setName("");
    setIdentification("");
    if (identificationRef.current) identificationRef.current.value = "";
  }

  function submit() {
    setError(null);
    setField(null);
    startTransition(async () => {
      if (mode === "change") {
        const result = await guardNetwork(() => changePlanAction(selected));
        const failure = actionError(result);
        if (failure) return setError(failure);
        router.push("/facturacion");
        return;
      }
      const result = await guardNetwork(() => startCheckoutAction({ planCode: selected, name, identification }));
      const failure = actionError(result);
      if (failure) {
        setError(failure);
        if ("field" in result && result.field) setField(result.field);
        return;
      }
      // Se crea el pago: lo escrito se borra del estado de la pantalla ANTES de salir.
      clearPersonalData();
      const target = result.ok ? safeProviderRedirect(result.redirectUrl, window.location.origin) : null;
      if (target) window.location.assign(target);
      else setError("No pudimos abrir el sitio de pago. No se hizo ningún cobro; probá de nuevo en unos minutos.");
    });
  }

  const canSubmit = selected !== "" && selected !== currentPlanCode && (mode === "change" || (name.trim().length >= 3 && identification.trim().length >= 7));

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="min-w-0">
        <legend className="mb-3 font-display text-[22px] font-semibold tracking-tight text-textPrimary">{mode === "change" ? "Elegí tu nuevo plan" : "Elegí tu plan"}</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {options.map((option) => {
            const isCurrent = option.code === currentPlanCode;
            const isSelected = selected === option.code;
            return (
              <label
                key={option.code}
                className={`relative flex cursor-pointer flex-col gap-1 rounded-lg border-[1.5px] p-4 transition-[border-color,box-shadow,background-color] duration-150 has-[:focus-visible]:shadow-focus ${
                  isCurrent ? "cursor-not-allowed border-border bg-paperDeep opacity-80" : isSelected ? "border-ink bg-surface shadow-card" : "border-borderMid bg-surface hover:border-ink"
                }`}
              >
                <input type="radio" name="plan" value={option.code} checked={isSelected} disabled={isCurrent} onChange={() => setSelected(option.code)} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-[20px] font-semibold text-textPrimary">{option.name}</span>
                  {isCurrent ? (
                    <span className="rounded-pill border border-border bg-paperDeep px-2 py-0.5 text-[12px] font-[650] text-textSecondary">Plan actual</span>
                  ) : (
                    isSelected && (
                      <span className="inline-flex items-center gap-1 text-[12.5px] font-[650] text-ink">
                        <CheckCircleIcon className="h-5 w-5" aria-hidden />
                        Elegido
                      </span>
                    )
                  )}
                </span>
                <span className="font-display text-[30px] font-medium leading-none tracking-[-0.02em] text-textPrimary">{option.price}</span>
                <span className="text-[14px] text-textSecondary">{option.cadence}</span>
                {option.perMonth && <span className="text-[13.5px] text-textMuted">Equivale a {option.perMonth}</span>}
                {option.saving ? <span className="mt-1 text-[13.5px] font-[650] text-ok">{option.saving}</span> : <span className="mt-1 text-[13.5px] text-textMuted">Sin compromiso de permanencia</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      {mode === "subscribe" && grandfathered && (
        <Notice tone="info" title="Tu cuenta tiene acceso sin cargo">
          Si te suscribís ahora, tu cuenta pasa a las reglas normales de una suscripción: se renueva sola, tiene 5 días de gracia si un cobro es rechazado y modo limitado si no se regulariza.
        </Notice>
      )}

      {mode === "subscribe" ? (
        <section aria-labelledby="datos-pago" className="rounded-lg border-[1.5px] border-border bg-surface p-4 nav:p-5">
          <h2 id="datos-pago" className="font-display text-[22px] font-semibold tracking-tight text-textPrimary">
            Tus datos para el cobro
          </h2>
          <p className="mt-1 text-[14.5px] text-textSecondary">Los pide el servicio de cobro para registrar tu suscripción. La tarjeta la cargás después, en su sitio seguro.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Nombre y apellido" htmlFor="pago-nombre" error={field === "name" ? error : undefined}>
              <TextInput id="pago-nombre" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" maxLength={80} aria-invalid={field === "name" || undefined} disabled={demo} />
            </Field>
            <Field label="DNI o CUIT/CUIL" htmlFor="pago-documento" hint="Sólo números." error={field === "identification" ? error : undefined}>
              <TextInput
                id="pago-documento"
                ref={identificationRef}
                value={identification}
                onChange={(event) => setIdentification(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                aria-invalid={field === "identification" || undefined}
                aria-describedby="pago-privacidad"
                disabled={demo}
              />
            </Field>
          </div>
          <p id="pago-privacidad" className="mt-3 flex gap-2 text-[13.5px] leading-relaxed text-textMuted">
            <LockClosedIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Tu documento viaja directo de nuestro servidor al servicio de cobro. No lo guardamos en TeacherFlow, no queda en ningún registro y se borra de esta pantalla apenas continuás. TeacherFlow nunca ve los datos de tu tarjeta.
            </span>
          </p>
          <PrivateLink href="/facturacion/condiciones" className={linkClass()}>
            Leer las condiciones de la suscripción
          </PrivateLink>
        </section>
      ) : (
        <Notice tone="info" title="Cuándo se aplica">
          El cambio rige desde tu próxima renovación, sin prorrateo ni crédito: hasta entonces seguís con tu plan actual.
        </Notice>
      )}

      {error && field === null && <FormErrorBox message={error} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="accent" size="lg" busy={pending} disabled={!canSubmit || demo} onClick={submit}>
          {mode === "change" ? "Programar el cambio" : pending ? "Preparando el pago..." : "Continuar al pago seguro"}
        </Button>
        {demo && <p className="text-[13.5px] text-textMuted">Vista de demostración: los botones están desactivados.</p>}
      </div>
    </div>
  );
}
