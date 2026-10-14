import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SubscriptionActions } from "@/components/billing/subscription-actions";
import type { BillingView } from "@/lib/billing/view";

// Tarjeta «Tu suscripción»: estado con texto (nunca sólo color), qué pasó, qué sigue y las acciones que de verdad funcionan.
// Presentacional: todo lo que muestra lo decidió el servidor (lib/billing/view.ts).

export function SubscriptionCard({ view, demo = false }: { view: BillingView; demo?: boolean }) {
  return (
    <Card aria-labelledby="suscripcion-titulo">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone={view.badge.tone}>{view.badge.label}</Badge>
        {view.plan && (
          <p className="text-[14.5px] text-textSecondary">
            <span className="font-[650] text-textPrimary">Plan {view.plan.name}</span> · {view.plan.price} {view.plan.cadence}
          </p>
        )}
      </div>

      <h2 id="suscripcion-titulo" className="mt-3 font-display text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-textPrimary nav:text-[30px]">
        {view.headline}
      </h2>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-textSecondary">{view.body}</p>

      {view.facts.length > 0 && (
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {view.facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[13px] font-medium text-textMuted">{fact.label}</dt>
              <dd className="mt-0.5 text-[15px] font-[650] text-textPrimary">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(view.pendingChange || view.notices.length > 0) && (
        <div className="mt-4 flex flex-col gap-3">
          {view.pendingChange && (
            <Notice tone="info" title="Cambio de plan programado">
              Pasás al plan {view.pendingChange.planName} ({view.pendingChange.price}) en tu próxima renovación, el {view.pendingChange.effective}. No hay prorrateo ni crédito: hasta entonces seguís con tu plan actual.
            </Notice>
          )}
          {view.notices.map((notice) => (
            <Notice key={notice.title} tone={notice.tone === "neutral" ? "info" : notice.tone} title={notice.title}>
              {notice.text}
            </Notice>
          ))}
        </div>
      )}

      <SubscriptionActions actions={view.actions} cancelAccessUntil={view.cancelAccessUntil} demo={demo} />
    </Card>
  );
}
