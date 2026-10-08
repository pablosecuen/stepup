import { ClipboardDocumentListIcon } from "@heroicons/react/24/outline";
import type { PendingHomeworkTask } from "@/lib/lessons/homework";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatCivilDate, formatInstantDate } from "@/lib/format/date-format";

/** Tareas pendientes reales — puerto de `computePendingHomeworkTasks` (móvil), nunca fixtures. */
export function TareasTabContent({ tasks }: { tasks: PendingHomeworkTask[] }) {
  if (tasks.length === 0) {
    return <EmptyState icon={ClipboardDocumentListIcon} message="No hay tareas pendientes." />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {tasks.map((task) => (
        <li key={task.taskId}>
          <Card className="!p-4">
            <p className="text-[15px] text-textPrimary [overflow-wrap:anywhere]">{task.description}</p>
            <p className="mt-1.5 text-[13.5px] text-textMuted">
              Asignada el {formatInstantDate(task.assignedAt)}
              {task.dueDate && <> · Entrega: {formatCivilDate(task.dueDate)}</>}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
