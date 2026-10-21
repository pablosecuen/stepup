/**
 * Referencias a clases del calendario que la app móvil deja «colgando» al materializar una ocurrencia de una serie.
 *
 * Regla de la app original (`buildCompletedCalendarLesson` y las mutaciones de cancelación/reprogramación/restauración en
 * `calendarRecurrenceMutations.ts`): cuando una ocurrencia virtual de una serie se registra, se cancela, se reprograma o se restaura, la clase pasa a
 * guardarse con el id `calendar_<estado>_<clave de ocurrencia saneada>` (estado ∈ completed | cancelled | rescheduled | restored) y, al registrarla, sus notas
 * ganan la línea «Registro pedagógico: <id del registro>». Los registros (y los cobros por clase) que se crearon ANTES conservan el id virtual
 * `calendar_<clave saneada>`: es el MISMO identificador lógico con otro prefijo.
 *
 * Este módulo resuelve esa correspondencia SÓLO cuando es inequívoca y nunca inventa una clase:
 *   - registros: la clave de ocurrencia del propio registro (o el sufijo de su id) debe dar exactamente UNA clase que (a) tenga esa misma clave de ocurrencia, (b) el mismo
 *     inicio y (c) el alumno del registro entre sus integrantes, (d) que no declare en sus notas ser de OTRO registro, y (e) que ningún otro registro reclame ni apunte
 *     directamente. Si hay duda, queda SIN resolver (y se informa);
 *   - cobros por clase: el sufijo del id virtual debe dar exactamente una clase con esa clave de ocurrencia; si el cobro además apunta a un registro ya resuelto, ambos deben
 *     coincidir.
 * Puro: sin acceso a datos externos. Lo comparten el adaptador (para importar) y el comparador (para saber qué debería haber en el destino).
 */

type Obj = Record<string, unknown>;

export const MATERIALIZED_PREFIXES = ["completed", "cancelled", "rescheduled", "restored"] as const;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Igual que la app: la clave de ocurrencia con todo lo que no sea [a-zA-Z0-9_-] reemplazado por «_». */
export const sanitizeOccurrenceKey = (key: string): string => key.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Ids de registro que las notas de una clase declaran («Registro pedagógico: <id>»). */
export function registrationMarkers(notes: unknown): string[] {
  const text = typeof notes === "string" ? notes : "";
  return [...text.matchAll(/Registro pedagógico: (\S+)/g)].map((m) => m[1]);
}

const instant = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

interface CalendarRow {
  id: string;
  key: string | null;
  start: number | null;
  students: Set<string>;
  markers: string[];
}

export type RefOutcome =
  | { kind: "none" }
  | { kind: "exact"; id: string }
  | { kind: "resolved"; id: string; evidence: string[] }
  /**
   * Sin correspondencia inequívoca. `no_candidate`: en el respaldo NO existe ninguna clase de esa ocurrencia (la referencia ya estaba colgando en el origen);
   * `mismatch`: hay clase candidata pero su inicio o alumno no coinciden; `ambiguous`: hay más de una posibilidad o la reclama otro registro; `contradicted`: sus notas dicen ser de OTRO registro.
   */
  | { kind: "unresolved"; reason: "no_candidate" | "mismatch" | "ambiguous" | "contradicted" };

export class CalendarRefResolver {
  private readonly rows = new Map<string, CalendarRow>();
  private readonly registrationOutcomes = new Map<string, RefOutcome>();

  constructor(calendarLessons: readonly unknown[], registrations: readonly unknown[] = []) {
    for (const raw of calendarLessons) {
      if (!isObj(raw)) continue;
      const id = str(raw.id);
      if (!id) continue;
      const students = new Set<string>();
      const primary = str(raw.studentId) ?? str(raw.primaryStudentId);
      if (primary) students.add(primary);
      for (const p of arr(raw.participants)) if (isObj(p) && str(p.studentId)) students.add(str(p.studentId) as string);
      this.rows.set(id, { id, key: str(raw.recurrenceOccurrenceKey), start: instant(raw.start ?? raw.startAt), students, markers: registrationMarkers(raw.notes) });
    }
    this.resolveRegistrations(registrations);
  }

  /** Clases que podrían ser la materialización del id lógico `suffix` (con la misma clave de ocurrencia). */
  private candidates(suffix: string): CalendarRow[] {
    const found: CalendarRow[] = [];
    for (const prefix of MATERIALIZED_PREFIXES) {
      const row = this.rows.get(`calendar_${prefix}_${suffix}`);
      if (row && row.key !== null && sanitizeOccurrenceKey(row.key) === suffix) found.push(row);
    }
    return found;
  }

  private resolveRegistrations(registrations: readonly unknown[]): void {
    const exactTargets = new Map<string, number>();
    const pending: Array<{ id: string; cands: CalendarRow[] }> = [];
    for (const raw of registrations) {
      if (!isObj(raw)) continue;
      const id = str(raw.id);
      if (!id) continue;
      const cr = isObj(raw.calendarRegistration) ? raw.calendarRegistration : null;
      const ref = str(raw.calendarLessonId) ?? str(cr?.lessonId);
      if (!ref) {
        this.registrationOutcomes.set(id, { kind: "none" });
        continue;
      }
      if (this.rows.has(ref)) {
        this.registrationOutcomes.set(id, { kind: "exact", id: ref });
        exactTargets.set(ref, (exactTargets.get(ref) ?? 0) + 1);
        continue;
      }
      const suffixes = new Set<string>();
      const key = str(cr?.recurrenceOccurrenceKey);
      if (key) suffixes.add(sanitizeOccurrenceKey(key));
      if (ref.startsWith("calendar_")) suffixes.add(ref.slice("calendar_".length));
      let cands = [...new Set([...suffixes].flatMap((s) => this.candidates(s)))];
      // La clave de ocurrencia del propio registro manda: un candidato con otra clave no es evidencia.
      if (key) cands = cands.filter((c) => c.key !== null && sanitizeOccurrenceKey(c.key) === sanitizeOccurrenceKey(key));
      const start = instant(cr?.start);
      const student = str(cr?.studentId);
      const matching = cands.filter((c) => (start === null || c.start === null || c.start === start) && (student === null || c.students.has(student)));
      const uncontradicted = matching.filter((c) => c.markers.length === 0 || c.markers.includes(id));
      if (cands.length === 0) {
        this.registrationOutcomes.set(id, { kind: "unresolved", reason: "no_candidate" });
      } else if (uncontradicted.length === 0) {
        this.registrationOutcomes.set(id, { kind: "unresolved", reason: matching.length === 0 ? "mismatch" : "contradicted" });
      } else {
        const marked = uncontradicted.filter((c) => c.markers.includes(id));
        const chosen = uncontradicted.length === 1 ? uncontradicted[0] : marked.length === 1 ? marked[0] : null;
        if (!chosen) {
          this.registrationOutcomes.set(id, { kind: "unresolved", reason: "ambiguous" });
        } else {
          const evidence = ["clave de ocurrencia", ...(start !== null ? ["inicio"] : []), ...(student ? ["alumno"] : []), ...(chosen.markers.includes(id) ? ["nota «Registro pedagógico»"] : [])];
          this.registrationOutcomes.set(id, { kind: "resolved", id: chosen.id, evidence });
          pending.push({ id, cands: [chosen] });
        }
      }
    }
    // Una clase no puede ser el destino de dos registros: si dos la reclaman, o si otro registro ya apunta a ella, no hay correspondencia inequívoca.
    const claims = new Map<string, string[]>();
    for (const { id, cands } of pending) claims.set(cands[0].id, (claims.get(cands[0].id) ?? []).concat(id));
    for (const [lessonId, claimers] of claims) {
      if (claimers.length > 1 || (exactTargets.get(lessonId) ?? 0) > 0) for (const id of claimers) this.registrationOutcomes.set(id, { kind: "unresolved", reason: "ambiguous" });
    }
  }

  forRegistration(registrationId: string): RefOutcome {
    return this.registrationOutcomes.get(registrationId) ?? { kind: "none" };
  }

  /** Clase del calendario a la que apunta un cobro por clase (`calendarLessonId`), con el registro (`savedLessonId`) como comprobación cruzada. */
  forCharge(ref: string | null, savedLessonId: string | null = null): RefOutcome {
    if (!ref) return { kind: "none" };
    if (this.rows.has(ref)) return { kind: "exact", id: ref };
    if (!ref.startsWith("calendar_")) return { kind: "unresolved", reason: "no_candidate" };
    const cands = this.candidates(ref.slice("calendar_".length));
    if (cands.length === 0) return { kind: "unresolved", reason: "no_candidate" };
    if (cands.length > 1) return { kind: "unresolved", reason: "ambiguous" };
    const registration = savedLessonId ? this.registrationOutcomes.get(savedLessonId) : undefined;
    if ((registration?.kind === "resolved" || registration?.kind === "exact") && registration.id !== cands[0].id) return { kind: "unresolved", reason: "contradicted" };
    return { kind: "resolved", id: cands[0].id, evidence: ["id lógico de la ocurrencia", "clave de ocurrencia"] };
  }

  /** ¿Existe esa clase del calendario en el respaldo? */
  has(id: string | null): boolean {
    return id !== null && this.rows.has(id);
  }

  /** La referencia ya colgaba en el origen: no hay NINGUNA clase de esa ocurrencia en el respaldo. */
  static isMissingAtOrigin(outcome: RefOutcome): boolean {
    return outcome.kind === "unresolved" && outcome.reason === "no_candidate";
  }

  /** Id al que se debe apuntar en la web: el resuelto, el propio si ya existía, o el original si no hay evidencia (nunca uno inventado). */
  static target(outcome: RefOutcome, original: string | null): string | null {
    return outcome.kind === "resolved" ? outcome.id : original;
  }

  /**
   * Clase del calendario que debe quedar enlazada a un REGISTRO: la resuelta; ninguna (`null`, el registro se importa sin clase de calendario y conserva la referencia original) si esa clase
   * no existe en el origen; y el id original si hay duda (la importación se detiene a la vista en lugar de elegir una).
   */
  registrationTarget(registrationId: string, original: string | null): string | null {
    const outcome = this.forRegistration(registrationId);
    if (CalendarRefResolver.isMissingAtOrigin(outcome)) return null;
    return CalendarRefResolver.target(outcome, original);
  }

  /** Igual para el cobro por clase: sin clase en el origen no hay a qué enlazar (`null`). */
  chargeTarget(ref: string | null, savedLessonId: string | null): string | null {
    const outcome = this.forCharge(ref, savedLessonId);
    if (CalendarRefResolver.isMissingAtOrigin(outcome)) return null;
    return CalendarRefResolver.target(outcome, ref);
  }
}
