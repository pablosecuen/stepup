import type { ComponentType, SVGProps } from "react";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import type { BadgeTone } from "@/components/ui/badge";
import type { ReminderCategoryKind } from "@/lib/dashboard/reminders-center";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Ícono y tono de cada categoría de recordatorios (Inicio y /recordatorios usan los mismos). Hoy sólo existen las clases sin alumnos. */
export const REMINDER_ICONS: Record<ReminderCategoryKind, { icon: IconComponent; tone: BadgeTone }> = {
  clases_sin_alumnos: { icon: UserGroupIcon, tone: "warn" },
};
