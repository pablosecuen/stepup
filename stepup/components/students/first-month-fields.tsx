"use client";

import { useState } from "react";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { BILLING_LABEL, BILLING_TYPE_OPTIONS } from "@/lib/students/constants";
import { DEFAULT_FIRST_MONTH_SITUATION, FIRST_MONTH_SITUATIONS, type FirstMonthSituation } from "@/lib/students/student-form-fields";
import { todayInArgentina } from "@/lib/format/date-format";
import type { BillingType } from "@/lib/db/database.types";

const RADIO_OPTION =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border-[1.5px] border-border bg-surface px-3 py-2.5 text-[15px] text-textPrimary has-[:checked]:border-ink has-[:checked]:bg-surface2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2";

/**
 * Forma de cobro, precio y, para un alumno MENSUAL, «¿Desde cuándo querés comenzar a controlar sus pagos?» — las tres opciones del original, con «Desde el próximo mes» como predeterminada
 * (un alumno recién creado nunca debe verse vencido antes de que la profesora elija «Este mes está pendiente»). Sólo existe en el ALTA: al editar, el plan y el monto se cambian desde Cobros.
 * Los campos viajan con el formulario (`firstMonthSituation`, `paidAt`, `confirmPending`) y el servidor vuelve a validar todo.
 */
export function NewStudentBillingFields() {
  const [billingType, setBillingType] = useState<BillingType>("por_clase");
  const [situation, setSituation] = useState<FirstMonthSituation>(DEFAULT_FIRST_MONTH_SITUATION);
  const [paidAt, setPaidAt] = useState("");
  const today = todayInArgentina();

  return (
    <>
      <Field label="Tipo de facturación *" htmlFor="billingType">
        <SelectInput id="billingType" name="billingType" required value={billingType} onChange={(event) => setBillingType(event.target.value as BillingType)}>
          {BILLING_TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {BILLING_LABEL[option]}
            </option>
          ))}
        </SelectInput>
      </Field>

      <Field label="Precio (ARS) *" htmlFor="price" hint="Ej: 36000 o 36.000 (punto para los miles, coma para los decimales). Tiene que ser mayor que cero.">
        <TextInput id="price" name="price" type="text" inputMode="decimal" autoComplete="off" required defaultValue="" placeholder="0" />
      </Field>

      {billingType === "mensual" && (
        <fieldset className="flex min-w-0 flex-col gap-2.5 sm:col-span-2" aria-describedby="first-month-help">
          <legend className="text-sm font-[650] text-textSecondary">¿Desde cuándo querés comenzar a controlar sus pagos?</legend>
          <p id="first-month-help" className="text-[13.5px] text-textMuted">
            Sólo cambia cómo arranca el control del mes actual; la mensualidad se sigue generando sola cada mes.
          </p>
          {FIRST_MONTH_SITUATIONS.map((option) => (
            <label key={option.value} className={RADIO_OPTION}>
              <input
                type="radio"
                name="firstMonthSituation"
                value={option.value}
                checked={situation === option.value}
                onChange={() => {
                  setSituation(option.value);
                  if (option.value === "paid" && !paidAt) setPaidAt(today);
                }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-ink"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-[650]">{option.label}</span>
                <span className="text-[13.5px] text-textSecondary">{option.description}</span>
              </span>
            </label>
          ))}

          {situation === "paid" && (
            <div className="sm:max-w-[calc(50%-10px)]">
              <Field label="Fecha real del pago" htmlFor="paidAt" hint="Es una declaración de que el mes ya está cubierto: no cambia el vencimiento ni genera recargo.">
                <TextInput id="paidAt" name="paidAt" type="date" max={today} required value={paidAt || today} onChange={(event) => setPaidAt(event.target.value)} />
              </Field>
            </div>
          )}

          {situation === "pending" && (
            <label className={`${RADIO_OPTION} border-warnLine bg-warnSoft`}>
              <input type="checkbox" name="confirmPending" value="true" required className="mt-0.5 h-5 w-5 shrink-0 accent-ink" />
              <span className="flex flex-col gap-0.5">
                <span className="font-[650]">Este mes está pendiente</span>
                <span className="text-[13.5px] text-textSecondary">Como el mes ya comenzó, este cargo puede estar vencido según la fecha configurada. Marcá la casilla para confirmar.</span>
              </span>
            </label>
          )}
        </fieldset>
      )}
    </>
  );
}
