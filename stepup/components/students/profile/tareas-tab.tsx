import type { PendingHomeworkTask } from "@/lib/lessons/homework";
import { EmptyState } from "@/components/ui/states";
import { formatCivilDate } from "@/lib/format/date-format";

/** Tareas pendientes reales — puerto de `computePendingHomeworkTasks` (móvil), nunca fixtures. */
export function TareasTabContent({ tasks }: { tasks: PendingHomeworkTask[] }) {
  if (tasks.length === 0) {
    return <EmptyState message="No hay tareas pendientes." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => (
        <li key={task.taskId} className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-sm text-textPrimary">{task.description}</p>
          {task.dueDate && <p className="mt-1 text-xs text-textMuted">Entrega: {formatCivilDate(task.dueDate)}</p>}
        </li>
      ))}
    </ul>
  );
}
