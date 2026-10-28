// Puerto VERBATIM del original (`src/features/new-class/hooks/savedLessonsStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { SavedLesson } from '../types/index.ts';
import { loadLessons } from '../../../shared/storage/teacherFlowStorage.ts';

/**
 * Fase 6D — módulo neutral de acceso a clases guardadas.
 *
 * Antes este store vivía dentro de `useSaveClass.ts`, y
 * `perClassChargeReconciliationService.ts` lo importaba desde ahí para leer
 * `getSavedLessons()`/`hydrateSavedLessons()` — mientras que `useSaveClass.ts`
 * a su vez importaba `reconcilePerClassCharges` de ese mismo servicio de
 * pagos. Eso era un ciclo de imports real (no sólo de tipos), reportado por
 * Metro como "Require cycle". Se extrajo el store a este módulo, sin dueño
 * de dominio (ni `new-class` ni `payments`), para que ambos lo importen sin
 * importarse entre sí. Mismo comportamiento exacto: mismo store en memoria,
 * misma hidratación perezosa, misma clave de AsyncStorage (`loadLessons`
 * sigue leyendo `@teacherflow/lessons`, sin cambios en `teacherFlowStorage.ts`).
 */
const lessonsStore: SavedLesson[] = [];
let lessonsHydrationPromise: Promise<void> | null = null;

export function getSavedLessons(): SavedLesson[] {
  return lessonsStore.map((lesson) => ({ ...lesson }));
}

export function hydrateSavedLessons(): Promise<void> {
  if (!lessonsHydrationPromise) {
    lessonsHydrationPromise = loadLessons<SavedLesson[]>().then((saved) => {
      if (saved && lessonsStore.length === 0) {
        lessonsStore.push(...saved);
      }
    });
  }
  return lessonsHydrationPromise;
}

export function replaceSavedLessonsStore(lessons: SavedLesson[]): void {
  lessonsStore.splice(0, lessonsStore.length, ...lessons);
}
