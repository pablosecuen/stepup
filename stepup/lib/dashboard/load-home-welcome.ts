import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { getTeacherProfile } from "@/lib/repositories/teacher-profile";
import { hasAnyCalendarLesson } from "@/lib/repositories/calendar-lessons";
import { hasAnyLessonRegistration } from "@/lib/repositories/lesson-registrations";
import type { HomeData } from "@/lib/dashboard/load-home-data";
import type { HomeWelcome } from "@/lib/dashboard/home-welcome";

/**
 * Datos de la bienvenida de Inicio. SÓLO lectura y a prueba de fallos: el saludo y los primeros pasos nunca pueden
 * romper Inicio (los errores de sesión ya los trata `loadHomeData` antes de llegar acá), y ante cualquier duda
 * `hasAnyClass` queda en `null`, que equivale a mostrar el Inicio normal en vez de una bienvenida de cuenta vacía.
 *
 * Las lecturas de existencia (una fila cada una) sólo se hacen si lo ya cargado por `loadHomeData` no muestra ninguna
 * clase: una cuenta con actividad no paga ninguna consulta extra.
 */
export async function loadHomeWelcome(ctx: AuthenticatedDbContext, data: HomeData): Promise<HomeWelcome> {
  const [displayName, hasAnyClass] = await Promise.all([
    getTeacherProfile(ctx).then(
      (profile) => profile.displayName || null,
      () => null,
    ),
    data.hasClassSignal
      ? Promise.resolve<boolean | null>(true)
      : Promise.all([hasAnyCalendarLesson(ctx), hasAnyLessonRegistration(ctx)]).then(
          ([lesson, registration]) => lesson || registration,
          () => null,
        ),
  ]);
  return { displayName, hasAnyClass };
}
