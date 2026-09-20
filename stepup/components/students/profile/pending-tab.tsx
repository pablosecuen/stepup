/**
 * Estado honesto para una pestaña que depende de una fase futura — NUNCA
 * simula datos. Ver docs/WEB_PARITY_PLAN.md, fila "Perfil completo (7
 * pestañas)".
 */
export function PendingTabContent({ title, dependsOn }: { title: string; dependsOn: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-semibold text-textPrimary">{title}</p>
      <p className="mt-1.5 text-sm text-textMuted">Todavía no está implementado — depende de {dependsOn}.</p>
    </div>
  );
}
