import type { StudentRecord } from "@/lib/repositories/students-mapping";

function BulletSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <p className="text-sm font-semibold text-textPrimary">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-textSecondary">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Resumen — mismo contenido que ResumenTab.tsx (móvil), sólo con datos reales: los campos que todavía no tienen dato
 * (próxima y última clase) no se muestran en vez de aparecer como "pendientes" (su dato real es el bloque B6).
 * `pendingHomework`/`alerts` SÍ son columnas reales de `students`.
 */
export function ResumenTabContent({ student }: { student: StudentRecord }) {
  return (
    <div className="flex flex-col gap-4">
      {student.pendingHomework && (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-sm font-semibold text-textPrimary">Tarea pendiente</p>
          <p className="mt-1 text-sm text-textSecondary">{student.pendingHomework}</p>
        </div>
      )}

      <BulletSection title="Alertas importantes" items={student.alerts} />
      <BulletSection title="Objetivos actuales" items={student.currentGoals} />
      <BulletSection title="Fortalezas" items={student.strengths} />
      <BulletSection title="Aspectos a mejorar" items={student.areasToImprove} />

      {!student.pendingHomework &&
        student.alerts.length === 0 &&
        student.currentGoals.length === 0 &&
        student.strengths.length === 0 &&
        student.areasToImprove.length === 0 && (
          <p className="text-sm text-textMuted">Todavía no hay objetivos, fortalezas ni observaciones cargadas.</p>
        )}
    </div>
  );
}
