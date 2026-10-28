// Puerto VERBATIM del original (`src/features/new-class/utils/activeFieldVisibility.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-13 (a pedido de Joaquín — PROBLEMA P0: "el teclado
 * sigue tapando el texto en el registro de clases", prueba física en
 * iPhone contra los commits `ee87cf7` y `29cd7d4`): evidencia real (dos
 * videos, `WhatsApp Video 2026-08-13 at 21.10.17.mp4` y `...21.10.31.mp4`)
 * muestra el campo "Tarea para realizar" completamente tapado por el
 * teclado, SIN NINGÚN desplazamiento — ni al enfocar, ni un instante
 * después, ni volviendo a tocarlo. El mecanismo anterior
 * (`useKeyboardFieldScroll.ts` + `keyboardAwareScrollTarget.ts`, del commit
 * `29cd7d4`) dependía de `onFocus` + un listener de `keyboardWillShow` dentro
 * del mismo hook, y calculaba el techo del teclado como
 * `windowHeight - keyboardHeight`, mezclado con `automaticallyAdjustKeyboardInsets`
 * TODAVÍA activo en el `ScrollView`. Auditoría confirmada (ver informe):
 * con `automaticallyAdjustKeyboardInsets` activo, iOS aplica SU PROPIO
 * ajuste de `contentInset`/`contentOffset` sobre el mismo `ScrollView` en
 * respuesta al MISMO evento de teclado que dispara nuestro `scrollTo` — dos
 * sistemas moviendo el mismo scroll al mismo tiempo, sin coordinación, con
 * el resultado real observado: el `scrollTo` manual queda absorbido/
 * revertido y el campo nunca se mueve. Este módulo es la mitad PURA
 * (testeable sin React ni RN) del reemplazo: un controlador de "campo
 * activo" inyectable por dependencias (`createActiveFieldVisibilityController`),
 * más la función geométrica (`computeFieldVisibilityScrollTargetY`) que ya
 * NO deriva el techo del teclado de `windowHeight - keyboardHeight` sino
 * que recibe `visibleBottomY` — la posición real medida del PIE del panel
 * (`measureInWindow` sobre el propio footer), que es el límite inferior
 * verdadero del área utilizable tanto si lo que reduce el espacio es el
 * teclado como si es el propio pie. La estrategia de insets pasó a ser
 * ÚNICA y totalmente manual: `automaticallyAdjustKeyboardInsets` se
 * desactiva en el `ScrollView` (ver `useActiveFieldVisibility.ts` y los
 * paneles) — nunca se combinan dos sistemas.
 *
 * Corrección 2026-08-18 (a pedido de Joaquín — P0: "el arreglo `bea8035` NO
 * resolvió el problema físico", segundo video físico real,
 * `WhatsApp Video 2026-08-18 at 10.57.25.mp4`): la premisa de la corrección
 * anterior (limpiar `activeField` en `keyboardHidden()`) es FALSA en iOS.
 * Al pasar el foco directamente de un `TextInput` del panel principal al
 * `TextInput` con `autoFocus` de `TextItemEditSheet` (un `Modal` aparte,
 * montado ENCIMA del panel que ya estaba abierto), el teclado puede
 * permanecer visible todo el tiempo — `keyboardDidHide` real puede NUNCA
 * llegar, sólo `keyboardDidChangeFrame` (el teclado cambia de "dueño" entre
 * dos ventanas nativas distintas sin cerrarse). `activeField` seguía
 * apuntando al campo del panel principal, y el `keyboardDidChangeFrame` del
 * editor superpuesto reactivaba `measureInWindow` + `scrollTo` sobre él —
 * el mismo tirón/superposición del primer video, reproducido de nuevo.
 *
 * CORRECCIÓN DEFINITIVA: dejar de confiar únicamente en "qué campo recuerda
 * este controlador como activo" y verificar, en cada punto donde se pediría
 * o aplicaría una medición, la PROPIEDAD REAL del foco — `isFieldFocused`
 * (inyectada, igual que `scrollTo`, para poder probarla con un doble falso)
 * consulta el foco nativo real (`TextInput.State.currentlyFocusedInput()`
 * en el hook real) y se compara contra `activeField`. Si no coinciden, el
 * controlador nunca mide ni desplaza — sin importar qué evento de teclado
 * haya llegado ni de dónde. Además, `blurField` invalida el campo activo
 * en el instante real en que pierde el foco (`onBlur`, cableado en cada
 * campo instrumentado) — nunca depende exclusivamente de que el teclado se
 * oculte.
 */

export interface FieldVisibilityGeometry {
  /** Offset actual de scroll del ScrollView (`contentOffset.y`). */
  currentScrollOffsetY: number;
  /** Posición Y (coordenadas de ventana) del campo activo, medida con `measureInWindow`. */
  fieldPageY: number;
  /** Alto real del campo en este momento (crece con texto multilínea). */
  fieldHeight: number;
  /**
   * Límite inferior REAL del área utilizable, en coordenadas de ventana —
   * la posición Y medida del propio pie del panel (footer), que ya
   * incorpora el teclado (el pie se reposiciona sobre él) sin necesidad de
   * derivarlo de `windowHeight - keyboardHeight` por separado.
   */
  visibleBottomY: number;
  /** Margen visual mínimo entre el campo y ese límite, en píxeles. */
  margin: number;
}

/**
 * El objetivo es que el extremo INFERIOR del campo (`fieldPageY + fieldHeight`,
 * donde vive el cursor en la última línea escrita) quede a `margin` px por
 * encima de `visibleBottomY` — nunca se desplaza de más si el campo ya está
 * cómodo (`deltaY <= 0`), y nunca se devuelve un offset negativo.
 */
export function computeFieldVisibilityScrollTargetY(geometry: FieldVisibilityGeometry): number {
  const { currentScrollOffsetY, fieldPageY, fieldHeight, visibleBottomY, margin } = geometry;
  const fieldBottomY = fieldPageY + fieldHeight;
  const desiredFieldBottomY = visibleBottomY - margin;
  const deltaY = fieldBottomY - desiredFieldBottomY;
  if (deltaY <= 0) {
    return Math.max(currentScrollOffsetY, 0);
  }
  return Math.max(currentScrollOffsetY + deltaY, 0);
}

/** Identidad estable de un campo — en el hook real es el `RefObject<TextInput>` mismo. */
export type FieldKey = object;

export interface FieldMeasurement {
  y: number;
  height: number;
}

export interface ScrollAction {
  scrolledTo: number;
}

export interface ActiveFieldVisibilityDeps {
  scrollTo: (y: number) => void;
  margin: number;
  /**
   * Corrección 2026-08-18: verifica que `field` sea REALMENTE el campo con
   * el foco nativo en este momento — no sólo el último que este
   * controlador recuerda haber enfocado. En iOS, el foco puede pasar de un
   * `TextInput` a otro (incluso en un `Modal` aparte) sin que el teclado
   * llegue a ocultarse nunca, así que `activeField` por sí solo no alcanza
   * para saber si este panel sigue siendo dueño real del teclado.
   */
  isFieldFocused: (field: FieldKey) => boolean;
}

export interface ActiveFieldVisibilityController {
  /** Un campo se enfocó — registra el campo activo y pide una medición. */
  focusField: (field: FieldKey) => number;
  /**
   * Se volvió a tocar un campo que YA estaba enfocado — `onFocus` no
   * vuelve a dispararse en ese caso (comportamiento real de React Native),
   * así que este es el único disparador para ese escenario. Siempre pide
   * una medición nueva, incluso si el campo activo no cambió.
   */
  pressInField: (field: FieldKey) => number;
  /** El campo activo (multilínea) cambió de alto real. No-op si no hay campo activo. */
  contentSizeChanged: () => number | null;
  /** El pie del panel reportó su posición real (nueva o cambiada de tamaño). */
  footerLayoutChanged: (topY: number) => number | null;
  /** El teclado terminó de mostrarse con una altura real conocida. */
  keyboardShown: (height: number) => number | null;
  /** El frame del teclado cambió sin ocultarse (ej. barra predictiva, teclado externo). */
  keyboardFrameChanged: (height: number) => number | null;
  /**
   * El teclado se ocultó — cancela cualquier medición en curso, sin
   * inventar scroll, Y limpia el campo activo (2026-08-17): un
   * `keyboardDidShow` posterior de un campo ajeno (p. ej. un editor
   * superpuesto en otro `Modal`) nunca debe reactivar la medición de un
   * campo que ya perdió el teclado de verdad.
   */
  keyboardHidden: () => void;
  /**
   * Corrección 2026-08-18: el campo activo perdió el foco nativo de
   * verdad (`onBlur`) — se invalida aunque el teclado siga abierto (nunca
   * depende exclusivamente de `keyboardHidden`/`keyboardDidHide`). Ignora
   * un blur de un campo que ya no es el activo — evita una carrera con un
   * enfoque más nuevo que haya llegado antes que este blur.
   */
  blurField: (field: FieldKey) => void;
  /** Cambió el alto de ventana (rotación / layout). No-op si no hay campo activo. */
  windowSizeChanged: () => number | null;
  /** Limpia el campo activo (transición grupal, cierre del panel) — cancela mediciones en vuelo. */
  clearActiveField: () => void;
  /** El panel se desmontó — mismo efecto que clearActiveField, nombrado para claridad de uso. */
  unmount: () => void;
  /** Resuelve una medición pedida (measureInWindow real) — ignora generaciones obsoletas o canceladas. */
  resolveFieldMeasurement: (generation: number, measurement: FieldMeasurement) => ScrollAction | null;
  /** Actualiza el offset de scroll conocido (desde `onScroll`). */
  setScrollOffset: (y: number) => void;
  getActiveField: () => FieldKey | null;
  getLastScrollTarget: () => number | null;
  getKeyboardHeight: () => number;
}

/**
 * Controlador puro (sin React ni RN) del "campo activo" — inyecta
 * `scrollTo` para poder probarlo con una función falsa. Cada disparador
 * (`focusField`/`pressInField`/`contentSizeChanged`/`footerLayoutChanged`/
 * `keyboardShown`/`keyboardFrameChanged`/`windowSizeChanged`) pide una
 * medición nueva con un número de generación creciente — `resolveFieldMeasurement`
 * sólo aplica la ÚLTIMA generación pedida; cualquier medición anterior que
 * resuelva tarde (el campo cambió, el panel se desmontó, el teclado se
 * cerró) se descarta sin efecto. Esto reemplaza, con una sola pieza de
 * estado explícita y testeable, la combinación de `generationRef` +
 * `isMountedRef` + `focusedFieldRef` que ya usaba el hook anterior — nunca
 * un intervalo, nunca un timer arbitrario.
 */
export function createActiveFieldVisibilityController(
  deps: ActiveFieldVisibilityDeps
): ActiveFieldVisibilityController {
  let activeField: FieldKey | null = null;
  let generation = 0;
  let pendingGeneration: number | null = null;
  let scrollOffsetY = 0;
  let visibleBottomY: number | null = null;
  let keyboardHeight = 0;
  let lastScrollTarget: number | null = null;

  function requestMeasurement(field: FieldKey): number {
    activeField = field;
    generation += 1;
    pendingGeneration = generation;
    return generation;
  }

  function requestMeasurementForActiveField(): number | null {
    if (!activeField) return null;
    // Corrección 2026-08-18: antes de siquiera pedir una medición, verificar
    // que el campo que este controlador recuerda como activo sea REALMENTE
    // el que tiene el foco nativo ahora mismo. Si perdió el foco sin que
    // llegara blurField/keyboardHidden todavía (carrera entre el evento de
    // teclado y el evento de foco), se invalida acá mismo — nunca se pide
    // measureInWindow ni se desplaza nada por un campo ajeno.
    if (!deps.isFieldFocused(activeField)) {
      activeField = null;
      pendingGeneration = null;
      return null;
    }
    return requestMeasurement(activeField);
  }

  return {
    focusField: requestMeasurement,
    pressInField: requestMeasurement,
    contentSizeChanged: requestMeasurementForActiveField,
    footerLayoutChanged: (topY: number) => {
      visibleBottomY = topY;
      return requestMeasurementForActiveField();
    },
    keyboardShown: (height: number) => {
      keyboardHeight = height;
      return requestMeasurementForActiveField();
    },
    keyboardFrameChanged: (height: number) => {
      keyboardHeight = height;
      if (height <= 0) return null;
      return requestMeasurementForActiveField();
    },
    keyboardHidden: () => {
      keyboardHeight = 0;
      pendingGeneration = null;
      // Corrección 2026-08-17 (a pedido de Joaquín — P0: "teclado lento y
      // panel trabado al editar" — CAUSA RAÍZ real, confirmada con video):
      // sin esto, `activeField` seguía apuntando al último campo enfocado
      // AUNQUE su teclado ya se hubiera cerrado de verdad. Como
      // `Keyboard.addListener` es global (no está limitado al panel que lo
      // registró), el próximo `keyboardDidShow`/`keyboardDidChangeFrame` de
      // CUALQUIER campo — incluido el `TextInput` con `autoFocus` de un
      // editor completamente aparte montado encima (`TextItemEditSheet`,
      // un `Modal` independiente) — reactivaba `measureInWindow` + `scrollTo`
      // sobre este campo ya desenfocado. Ese `scrollTo` fantasma del panel
      // de fondo competía en el mismo instante con la animación propia del
      // editor superpuesto: eso era el "panel se traba" real del video.
      // `activeField = null` deja al controlador sin nada que re-medir
      // hasta que un campo se enfoque de verdad de nuevo (`focusField`/
      // `pressInField`, que siempre se disparan primero).
      activeField = null;
    },
    blurField: (field: FieldKey) => {
      // Corrección 2026-08-18: sólo invalida si el blur pertenece al campo
      // que sigue siendo el activo — un blur tardío de un campo viejo (por
      // el orden real de eventos nativos) nunca debe pisar un enfoque más
      // nuevo que ya haya llegado.
      if (activeField !== field) return;
      activeField = null;
      pendingGeneration = null;
    },
    windowSizeChanged: requestMeasurementForActiveField,
    clearActiveField: () => {
      activeField = null;
      pendingGeneration = null;
      generation += 1;
    },
    unmount: () => {
      activeField = null;
      pendingGeneration = null;
      generation += 1;
    },
    resolveFieldMeasurement: (gen: number, measurement: FieldMeasurement) => {
      if (pendingGeneration === null || gen !== pendingGeneration) return null;
      pendingGeneration = null;
      // Corrección 2026-08-18: `measureInWindow` es asíncrono — el campo
      // pudo perder el foco real (otro modal, otro campo) MIENTRAS la
      // medición viajaba, incluso si era válido en el instante en que se
      // pidió. Se vuelve a comprobar la propiedad real del foco justo antes
      // de aplicar cualquier resultado — nunca se desplaza el panel de
      // fondo por un campo que ya no es el enfocado de verdad.
      if (!activeField || !deps.isFieldFocused(activeField)) {
        activeField = null;
        return null;
      }
      if (keyboardHeight <= 0 || visibleBottomY === null) return null;
      const target = computeFieldVisibilityScrollTargetY({
        currentScrollOffsetY: scrollOffsetY,
        fieldPageY: measurement.y,
        fieldHeight: measurement.height,
        visibleBottomY,
        margin: deps.margin,
      });
      if (Math.abs(target - scrollOffsetY) < 1) return null;
      lastScrollTarget = target;
      deps.scrollTo(target);
      return { scrolledTo: target };
    },
    setScrollOffset: (y: number) => {
      scrollOffsetY = y;
    },
    getActiveField: () => activeField,
    getLastScrollTarget: () => lastScrollTarget,
    getKeyboardHeight: () => keyboardHeight,
  };
}
