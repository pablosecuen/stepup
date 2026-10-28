"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeBillingPlanAction, changeMonthlyAmountAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { todayInArgentina } from "@/lib/format/date-format";
import { formatMoneyForInput, parseMoneyInput } from "@/lib/format/money-input";
import { formatMoney } from "@/lib/format/number-format";
import type { StudentBillingPlan } from "@/lib/payments/billing-plan";
import { PLAN_TYPE_OPTIONS, WEEKDAY_OPTIONS, buildPlanFromForm, describePlan, initialPlanFormValues, type BillingPlanFormValues, type BillingPlanType } from "@/lib/payments/plan-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput, checkClass, choiceGroupClass, choiceRowClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

/**
 * «Plan de cobro» del alumno (pestaña Cobros): muestra el plan vigente y abre «Editar plan de cobro» y, si es mensual, «Modificar monto mensual». Puerto de
 * `EditBillingPlanSheet` y `ModifyMonthlyAmountSheet` (móvil): el plan se guarda en una transacción con auditoría y el monto de un plan YA mensual sólo se cambia
 * desde «Modificar monto mensual», que corrige el cargo del mes y el plan juntos (o deja el importe pendiente para el próximo mes).
 */
export function BillingPlanCard({ studentId, studentName, plan }: { studentId: string; studentName: string; plan: StudentBillingPlan }) {
  const [mode, setMode] = useState<"idle" | "plan" | "amount">("idle");
  const description = describePlan(plan);
  return (
    <section aria-labelledby={`plan-${studentId}`}>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 id={`plan-${studentId}`} className="font-display text-card font-semibold">
              Plan de cobro: {description.title}
            </h2>
            <ul className="mt-1.5 text-[14.5px] text-textSecondary">
              {description.lines.map((line) => (
                <li key={line} className="[overflow-wrap:anywhere]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setMode("plan")}>
              Editar plan de cobro
            </Button>
            {plan.type === "monthly" && (
              <Button variant="secondary" onClick={() => setMode("amount")}>
                Modificar monto mensual
              </Button>
            )}
          </div>
        </div>
      </Card>
      {mode === "plan" && <EditPlanDialog studentId={studentId} studentName={studentName} plan={plan} onClose={() => setMode("idle")} />}
      {mode === "amount" && plan.type === "monthly" && <MonthlyAmountDialog studentId={studentId} studentName={studentName} plan={plan} onClose={() => setMode("idle")} />}
    </section>
  );
}

function EditPlanDialog({ studentId, studentName, plan, onClose }: { studentId: string; studentName: string; plan: StudentBillingPlan; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const today = todayInArgentina();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<BillingPlanFormValues>(() => initialPlanFormValues(plan.type, plan, today, "amount" in plan ? formatMoneyForInput(plan.amount) : ""));
  const set = <K extends keyof BillingPlanFormValues>(key: K, value: BillingPlanFormValues[K]) => setValues((prev) => ({ ...prev, [key]: value }));

  function selectType(type: BillingPlanType) {
    setError(null);
    // Conserva el importe ya tipeado al cambiar de tipo; el resto de los datos vuelve a los valores propios del tipo elegido.
    setValues((prev) => ({ ...initialPlanFormValues(type, plan, today, prev.amountText), type }));
  }

  function submit() {
    setError(null);
    const built = buildPlanFromForm(values, plan);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    startTransition(async () => {
      const result = await guardNetwork(() => changeBillingPlanAction({ studentId, plan: built.plan }));
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      title="Plan de cobro"
      size="md"
      onClose={onClose}
      onBeforeClose={() => !pending}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="primary" busy={pending} onClick={submit}>
            {pending ? "Guardando…" : "Guardar plan de cobro"}
          </Button>
        </>
      }
    >
      <p className="text-[14.5px] text-textSecondary">
        Definí cómo se cobra a {studentName}. Los alumnos por período (semanal, quincenal, mensual o paquete) no reciben preguntas de cobro al registrar cada clase.
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      <div role="radiogroup" aria-label="Tipo de plan" className={choiceGroupClass}>
        {PLAN_TYPE_OPTIONS.map((option) => (
          <label key={option.value} className={choiceRowClass}>
            <input type="radio" name={`${uid}-type`} className={checkClass} checked={values.type === option.value} onChange={() => selectType(option.value)} disabled={pending} />
            <span className="min-w-0">
              <span className="block font-[650] text-textPrimary">{option.label}</span>
              <span className="block text-[13.5px] text-textMuted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {values.type !== "complimentary" && (
        <Field label={values.type === "class_package" ? "Precio del paquete (ARS)" : "Importe (ARS)"} htmlFor={`${uid}-amount`} hint="Ej: 36000 o 36.000 (punto para los miles, coma para los decimales).">
          <TextInput id={`${uid}-amount`} type="text" inputMode="decimal" autoComplete="off" value={values.amountText} onChange={(event) => set("amountText", event.target.value)} disabled={pending} />
        </Field>
      )}
      {values.type === "weekly" && (
        <fieldset>
          <legend className="mb-1.5 text-[14.5px] font-[650] text-textPrimary">Día de vencimiento</legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map((day) => (
              <label key={day.value} className={`flex min-h-11 min-w-12 cursor-pointer items-center justify-center rounded-md border-[1.5px] px-3 text-[14.5px] font-[650] ${values.dueWeekday === day.value ? "border-ink bg-ink text-white" : "border-border bg-surface text-textPrimary"}`}>
                <input type="radio" name={`${uid}-weekday`} className="sr-only" checked={values.dueWeekday === day.value} onChange={() => set("dueWeekday", day.value)} disabled={pending} />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {values.type === "biweekly" && (
        <Field label="Fecha de referencia del ciclo" htmlFor={`${uid}-anchor`} hint="Los períodos de 14 días se cuentan desde esta fecha.">
          <TextInput id={`${uid}-anchor`} type="date" value={values.anchorDate} onChange={(event) => set("anchorDate", event.target.value)} disabled={pending} />
        </Field>
      )}
      {values.type === "monthly" && <p className="text-[14.5px] text-textSecondary">Vence el día 10 de cada mes, igual para todos los alumnos mensuales.</p>}
      {values.type === "class_package" && (
        <>
          <Field label="Clases incluidas" htmlFor={`${uid}-classes`}>
            <TextInput id={`${uid}-classes`} type="text" inputMode="numeric" autoComplete="off" value={values.includedClassesText} onChange={(event) => set("includedClassesText", event.target.value)} disabled={pending} />
          </Field>
          <Field label="Vigente desde" htmlFor={`${uid}-from`}>
            <TextInput id={`${uid}-from`} type="date" value={values.validFrom} onChange={(event) => set("validFrom", event.target.value)} disabled={pending} />
          </Field>
          <Field label="Vigente hasta (opcional)" htmlFor={`${uid}-until`} hint="Dejalo vacío si el paquete no vence.">
            <TextInput id={`${uid}-until`} type="date" value={values.validUntil} onChange={(event) => set("validUntil", event.target.value)} disabled={pending} />
          </Field>
        </>
      )}
    </Dialog>
  );
}

function MonthlyAmountDialog({ studentId, studentName, plan, onClose }: { studentId: string; studentName: string; plan: Extract<StudentBillingPlan, { type: "monthly" }>; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amountText, setAmountText] = useState(formatMoneyForInput(plan.amount));
  const [effectiveFrom, setEffectiveFrom] = useState<"this_month" | "next_month">("this_month");

  function submit() {
    setError(null);
    const parsed = parseMoneyInput(amountText);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (!(parsed.amount > 0)) {
      setError("El nuevo importe mensual debe ser un número mayor a cero.");
      return;
    }
    startTransition(async () => {
      const result = await guardNetwork(() => changeMonthlyAmountAction({ studentId, newAmount: parsed.amount, effectiveFrom }));
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      title="Modificar monto mensual"
      size="sm"
      onClose={onClose}
      onBeforeClose={() => !pending}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="primary" busy={pending} onClick={submit}>
            {pending ? "Guardando…" : "Guardar monto"}
          </Button>
        </>
      }
    >
      <p className="text-[14.5px] text-textSecondary">
        Monto mensual actual de {studentName}: <span className="font-bold tf-num text-textPrimary">{formatMoney(plan.amount)}</span>.
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      <Field label="Nuevo importe mensual (ARS)" htmlFor={`${uid}-amount`} hint="Ej: 36000 o 36.000 (punto para los miles, coma para los decimales).">
        <TextInput id={`${uid}-amount`} type="text" inputMode="decimal" autoComplete="off" value={amountText} onChange={(event) => setAmountText(event.target.value)} disabled={pending} />
      </Field>
      <div role="radiogroup" aria-label="Desde cuándo se aplica" className={choiceGroupClass}>
        <label className={choiceRowClass}>
          <input type="radio" name={`${uid}-when`} className={checkClass} checked={effectiveFrom === "this_month"} onChange={() => setEffectiveFrom("this_month")} disabled={pending} />
          <span className="min-w-0">
            <span className="block font-[650] text-textPrimary">Aplicar este mes</span>
            <span className="block text-[13.5px] text-textMuted">Corrige el cargo del mes y el plan. No se puede si el mes ya está pagado ni bajar de lo ya pagado.</span>
          </span>
        </label>
        <label className={choiceRowClass}>
          <input type="radio" name={`${uid}-when`} className={checkClass} checked={effectiveFrom === "next_month"} onChange={() => setEffectiveFrom("next_month")} disabled={pending} />
          <span className="min-w-0">
            <span className="block font-[650] text-textPrimary">Aplicar desde el próximo mes</span>
            <span className="block text-[13.5px] text-textMuted">El cargo de este mes queda como está; el nuevo importe rige desde el mes siguiente.</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
