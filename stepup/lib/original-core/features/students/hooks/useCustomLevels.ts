// Puerto VERBATIM del original (`src/features/students/hooks/useCustomLevels.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useCallback, useEffect, useState } from '../../../shims/react.ts';
import type { CustomLevel } from '../types/index.ts';
import { addCustomLevel, getCustomLevels, hydrateCustomLevels, removeCustomLevel, renameCustomLevel, type CustomLevelMutationResult, type CustomLevelRemoveResult, type CustomLevelRenameResult } from './customLevelsStore.ts';

/**
 * Corrección (a pedido de Joaquín — niveles personalizados): hook de React
 * sobre `customLevelsStore.ts` — mismo patrón que `useMaterialsLibrary.ts`
 * (hidrata al montar, expone la lista actual + las mutaciones reales).
 */
export function useCustomLevels() {
  const [customLevels, setCustomLevels] = useState<CustomLevel[]>(() => getCustomLevels());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hydrateCustomLevels().then(() => {
      if (!cancelled) {
        setCustomLevels(getCustomLevels());
        setIsReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addLevel = useCallback(async (name: string): Promise<CustomLevelMutationResult> => {
    const result = await addCustomLevel(name);
    setCustomLevels(getCustomLevels());
    return result;
  }, []);

  const renameLevel = useCallback(async (id: string, name: string): Promise<CustomLevelRenameResult> => {
    const result = await renameCustomLevel(id, name);
    setCustomLevels(getCustomLevels());
    return result;
  }, []);

  const removeLevel = useCallback(async (id: string): Promise<CustomLevelRemoveResult> => {
    const result = await removeCustomLevel(id);
    setCustomLevels(getCustomLevels());
    return result;
  }, []);

  return { customLevels, isReady, addLevel, renameLevel, removeLevel };
}
