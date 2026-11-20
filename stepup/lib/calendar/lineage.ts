import { getLocalDateKey } from "./timezone.ts";

/** Forma mínima que necesita la agrupación por linaje. */
export interface RuleForLineage {
  recurrenceId: string;
  status: "active" | "paused" | "ended";
  endDate: string | null;
  timezone: string;
  supersedesRecurrenceId: string | null;
  effectiveFromDate: string | null;
}

/**
 * Tramos ANTERIORES todavía relevantes de un linaje (de la sucesora vigente hacia atrás, el más cercano primero): los que
 * no están finalizados y todavía tienen clases por delante (`endDate` vacía o de hoy en adelante). La pantalla Series los
 * muestra junto a la sucesora ("desde 12/10" / "hasta 11/10") — antes quedaban ocultos, y nada explicaba por qué el
 * Calendario seguía mostrando el patrón viejo hasta la fecha efectiva. Un tramo ya terminado es historia: no se lista.
 */
export function listLineagePredecessors<T extends RuleForLineage>(rules: T[], head: T, nowIso: string): T[] {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));
  const result: T[] = [];
  const visited = new Set<string>([head.recurrenceId]);
  let current: T | undefined = head.supersedesRecurrenceId ? byId.get(head.supersedesRecurrenceId) : undefined;
  while (current && !visited.has(current.recurrenceId)) {
    visited.add(current.recurrenceId);
    const today = getLocalDateKey(nowIso, current.timezone);
    if (current.status !== "ended" && (!current.endDate || current.endDate >= today)) result.push(current);
    current = current.supersedesRecurrenceId ? byId.get(current.supersedesRecurrenceId) : undefined;
  }
  return result;
}

/**
 * Puerto de `selectManageableRecurrenceSeries` (móvil,
 * `calendarRecurrenceSplit.ts`) — agrupa por LINAJE real de recurrencia
 * (`supersedesRecurrenceId`, escrito exclusivamente por el split "esta y
 * las siguientes"), nunca por `studentId` ni por ningún campo que pueda
 * coincidir en `undefined`/`null` entre dos series realmente distintas
 * (mismo criterio que `resolveTrainingBillingLineage` en el móvil de
 * cobros). Devuelve UNA regla "vigente" por cada linaje relevante — nunca
 * agrupa dos series distintas en una sola tarjeta, nunca separa dos tramos
 * de la misma serie en dos tarjetas.
 */
export function selectManageableRecurrenceSeries<T extends RuleForLineage>(rules: T[], nowIso: string): T[] {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));

  function lineageRootId(candidate: T, visited: Set<string>): string {
    if (visited.has(candidate.recurrenceId)) return candidate.recurrenceId;
    visited.add(candidate.recurrenceId);
    if (!candidate.supersedesRecurrenceId) return candidate.recurrenceId;
    const predecessor = byId.get(candidate.supersedesRecurrenceId);
    if (!predecessor) return candidate.recurrenceId;
    return lineageRootId(predecessor, visited);
  }

  const grouped = new Map<string, { rule: T; index: number }[]>();
  rules.forEach((rule, index) => {
    const today = getLocalDateKey(nowIso, rule.timezone);
    const isFutureRelevant = rule.status !== "ended" && (!rule.endDate || rule.endDate >= today);
    if (!isFutureRelevant) return;
    const root = lineageRootId(rule, new Set());
    const bucket = grouped.get(root) ?? [];
    bucket.push({ rule, index });
    grouped.set(root, bucket);
  });

  const result: T[] = [];
  grouped.forEach((candidates) => {
    const explicitSuccessors = candidates.filter((item) => item.rule.supersedesRecurrenceId && item.rule.effectiveFromDate);
    if (explicitSuccessors.length > 0) {
      explicitSuccessors.sort((a, b) => (b.rule.effectiveFromDate! < a.rule.effectiveFromDate! ? -1 : 1));
      result.push(explicitSuccessors[0].rule);
      return;
    }
    candidates.sort((a, b) => b.index - a.index);
    result.push(candidates[0].rule);
  });

  return result;
}

/** Lo que hace falta además para reconocer una serie que LLEGÓ a su fecha de finalización (la que fija la profesora en «Fecha de finalización»). */
export interface RuleForFinished extends RuleForLineage {
  /** Fin propio de la fila (corte o fin fijado al crear), sin la fecha de finalización de la serie. */
  rawEndDate: string | null;
  /** Fecha de finalización de la serie entera (la misma en todos los tramos del linaje) o null. */
  seriesEndDate: string | null;
  /** Estado real de la fila: «ended» lo deja sólo «Eliminar serie» o un tramo reemplazado; nunca una fecha que llegó. */
  dbStatus: "active" | "paused" | "ended";
  startDate: string;
}

/**
 * Series que LLEGARON a su fecha de finalización: una por linaje, representada por el último tramo que corrió hasta ese límite. Es lo que se
 * lista en «Finalizadas»: antes desaparecían de la pantalla y no había dónde consultarlas ni cambiar su fecha.
 *
 * Una serie ELIMINADA explícitamente nunca entra: «Eliminar serie» cierra el tramo por estado (`ended`) o le pone un fin propio ANTERIOR a la
 * fecha de la serie, y en los dos casos ningún tramo llegó a correr hasta el límite. Tampoco entra una serie cuyo límite todavía no llegó (ésa sigue
 * en «Vigentes») ni una que terminó por un fin propio sin fecha de finalización (no hay forma de distinguirla de una eliminada sin un marcador nuevo).
 */
export function selectFinishedRecurrenceSeries<T extends RuleForFinished>(rules: T[], nowIso: string): T[] {
  const manageableRoots = new Set(selectManageableRecurrenceSeries(rules, nowIso).map((rule) => lineageRootId(rules, rule.recurrenceId)));
  const byRoot = new Map<string, T[]>();
  rules.forEach((rule) => {
    const root = lineageRootId(rules, rule.recurrenceId);
    byRoot.set(root, [...(byRoot.get(root) ?? []), rule]);
  });
  const result: T[] = [];
  byRoot.forEach((members, root) => {
    if (manageableRoots.has(root)) return;
    const seriesEnd = members.map((member) => member.seriesEndDate).find((value): value is string => !!value);
    if (!seriesEnd) return;
    const today = getLocalDateKey(nowIso, members[0].timezone);
    if (seriesEnd >= today) return;
    const firstDay = (rule: T) => (rule.effectiveFromDate && rule.effectiveFromDate > rule.startDate ? rule.effectiveFromDate : rule.startDate);
    // Un tramo que corrió hasta el límite: no cerrado por estado, sin fin propio anterior a la fecha de la serie y que ya había empezado cuando ésta llegó.
    const ran = members.filter((member) => member.dbStatus !== "ended" && (member.rawEndDate === null || member.rawEndDate >= seriesEnd) && firstDay(member) <= seriesEnd);
    if (ran.length === 0) return;
    ran.sort((a, b) => (firstDay(a) === firstDay(b) ? (a.recurrenceId < b.recurrenceId ? -1 : 1) : firstDay(a) < firstDay(b) ? -1 : 1));
    result.push(ran[ran.length - 1]);
  });
  return result;
}

/**
 * TODOS los tramos del linaje de una serie (la raíz y todos sus descendientes por `supersedesRecurrenceId`: tramos anteriores, la vigente y los cambios programados, incluso los ya cerrados).
 * La fecha de finalización de la serie rige para todos ellos; las series independientes (aunque sean del mismo alumno) nunca entran. Corta ante un ciclo.
 */
export function lineageMemberIds<T extends RuleForLineage>(rules: T[], ruleId: string): string[] {
  const root = lineageRootId(rules, ruleId);
  const children = new Map<string, string[]>();
  rules.forEach((rule) => {
    if (!rule.supersedesRecurrenceId) return;
    const list = children.get(rule.supersedesRecurrenceId) ?? [];
    list.push(rule.recurrenceId);
    children.set(rule.supersedesRecurrenceId, list);
  });
  const members: string[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    members.push(id);
    (children.get(id) ?? []).forEach((child) => queue.push(child));
  }
  return members;
}

/** Raíz del linaje de una serie (siguiendo `supersedesRecurrenceId` hacia atrás); corta ante un ciclo o un antecesor desconocido. */
export function lineageRootId<T extends RuleForLineage>(rules: T[], ruleId: string): string {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));
  const visited = new Set<string>();
  let currentId = ruleId;
  for (;;) {
    visited.add(currentId);
    const current = byId.get(currentId);
    const previousId = current?.supersedesRecurrenceId;
    if (!previousId || visited.has(previousId) || !byId.has(previousId)) return currentId;
    currentId = previousId;
  }
}

/**
 * La serie VIGENTE (la que se administra) del linaje al que pertenece `ruleId` — el mismo criterio que la lista de Series
 * (`selectManageableRecurrenceSeries`). Sirve para abrir la serie exacta de una clase aunque esa clase sea de un tramo anterior: la
 * pantalla muestra el tramo y deja editar la vigente. `null` si el linaje entero ya terminó (no hay nada vigente que administrar).
 */
export function findManageableForRule<T extends RuleForLineage>(rules: T[], ruleId: string, nowIso: string): T | null {
  const root = lineageRootId(rules, ruleId);
  return selectManageableRecurrenceSeries(rules, nowIso).find((candidate) => lineageRootId(rules, candidate.recurrenceId) === root) ?? null;
}

/**
 * Tramos ANTERIORES de un linaje que todavía generan clases en o después de `effectiveDate` (no finalizados y con `endDate` vacía o
 * no anterior a esa fecha). Un cambio de alumnos «desde una fecha» tiene que aplicarse también a ellos: si sólo se cambiara la serie
 * vigente (la sucesora), las clases del tramo anterior que caen entre esa fecha y el inicio de la vigente seguirían con los alumnos
 * viejos.
 */
export function listPredecessorsRunningFrom<T extends RuleForLineage>(rules: T[], headId: string, effectiveDate: string): T[] {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));
  const result: T[] = [];
  const visited = new Set<string>([headId]);
  let current = byId.get(headId);
  let previousId = current?.supersedesRecurrenceId ?? null;
  while (previousId && !visited.has(previousId)) {
    visited.add(previousId);
    current = byId.get(previousId);
    if (!current) break;
    if (current.status !== "ended" && (!current.endDate || current.endDate >= effectiveDate)) result.push(current);
    previousId = current.supersedesRecurrenceId;
  }
  return result;
}

export interface EditableSegment<T> {
  /** Tramo que contiene la fecha efectiva: es el que se corta y sucede por el patrón nuevo. */
  target: T;
  /** Tramos POSTERIORES al de la fecha (la serie vigente y los intermedios): el patrón nuevo los reemplaza, así que se finalizan. */
  superseded: T[];
}

/**
 * Qué tramo del linaje se edita «desde una fecha». La pantalla siempre trabaja sobre la serie VIGENTE (`headId`, la última sucesora),
 * pero la fecha puede caer ANTES de su inicio —típico tras un cambio mal fechado—: el patrón de esa fecha lo da el tramo anterior que
 * todavía la cubre. Antes se rechazaba («la fecha efectiva es anterior al inicio de la serie»), y quedaba imposible corregir «desde hoy».
 * Ahora se corta el tramo que cubre la fecha y se finalizan los posteriores. `null` si ningún tramo no finalizado cubre esa fecha.
 */
export function resolveEditableSegment<T extends RuleForLineage & { startDate: string }>(rules: T[], headId: string, effectiveDate: string): EditableSegment<T> | null {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));
  const head = byId.get(headId);
  if (!head) return null;
  const covers = (rule: T) => rule.status !== "ended" && rule.startDate <= effectiveDate && (!rule.endDate || rule.endDate >= effectiveDate);
  if (head.startDate <= effectiveDate) return { target: head, superseded: [] };

  const later: T[] = [head];
  const visited = new Set<string>([head.recurrenceId]);
  let current: T | undefined = head.supersedesRecurrenceId ? byId.get(head.supersedesRecurrenceId) : undefined;
  while (current && !visited.has(current.recurrenceId)) {
    visited.add(current.recurrenceId);
    if (covers(current)) return { target: current, superseded: later.filter((rule) => rule.status !== "ended") };
    later.push(current);
    current = current.supersedesRecurrenceId ? byId.get(current.supersedesRecurrenceId) : undefined;
  }
  return null;
}
