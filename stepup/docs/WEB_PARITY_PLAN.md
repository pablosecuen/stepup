# TeacherFlow Web — Plan de paridad funcional con el móvil

Este documento es el plan de trabajo vivo para llevar TeacherFlow Web a paridad funcional completa con la app móvil (`C:\Users\joaqu\Downloads\aca va tdo\TeacherFlow_NuevaClase\TeacherFlow`), que es la **fuente de verdad funcional única**. Se actualiza al cerrar cada fase — nunca se marca "completo" sólo porque la interfaz existe (ver reglas de la tarea).

**Documento complementario:** `docs/WEB_VISUAL_STRUCTURE.md` (encontrado ya presente en este repo al iniciar esta fase, con timestamp muy reciente — no fue creado por esta sesión; probablemente producto de una sesión o herramienta paralela, o aportado por el usuario. Se leyó y se usó como referencia cruzada de rutas/componentes; su contenido es consistente con, y complementario a, este documento). Ese documento cubre el inventario de **pantallas, componentes y navegación** (UI); este documento cubre **datos, reglas de negocio, esquema y pruebas** (arquitectura). Antes de tocar UI en las Fases 2+, revisar ambos.

**HEAD de referencia:**
- Móvil: `2068b3a982cffff39c7d830ea33bf0dc31df0923`
- Web (inicio de esta fase): `89c874db58865e0830d226785d6d8d701e05c62c`, rama `teacherflow-web`

**Infraestructura Supabase YA EXISTENTE** (creada por la app móvil, en el mismo proyecto `foljsapgewxnatgreggz` — nunca redefinir ni recrear):
- `active_sessions` (+ RPC `transfer_active_session`, `touch_active_session`, `end_active_session`) — aplicación de sesión única.
- `cloud_backups` (+ RPC `upload_cloud_backup`) — respaldo en la nube.
- `auth.*` (Supabase Auth) — ya integrado en la web (`lib/supabase/*`, `lib/auth/*`).

## Cómo leer la matriz

- **Estado:** `inexistente` (nada en la web) · `visual ficticio` (UI con fixtures, sin backend) · `parcial` (backend real pero incompleto) · `completo` (almacenamiento + reglas + interfaz + pruebas funcionando juntos).
- **Tablas necesarias:** nombres reales de `supabase/migrations/`.
- Esta matriz agrupa funciones relacionadas en una fila cuando comparten módulo/tabla/prueba — no es una fila por cada botón individual (eso sería miles de filas); el detalle línea-por-línea de UI ya vive en `docs/WEB_VISUAL_STRUCTURE.md`.

---

## Fase 1 — Base de datos y arquitectura — **COMPLETA** (esta sesión)

| Entregable | Archivo(s) | Estado |
|---|---|---|
| Esquema Supabase completo (35 tablas) | `supabase/migrations/20260916120000` … `20260916121000` (10 archivos) | Completo — sintaxis real validada con `libpg-query` (parser real de Postgres), **nunca aplicado contra una base real** (sin Docker/Supabase CLI en este entorno; ver §"Validación pendiente") |
| RLS por propietario en las 35 tablas | mismas migraciones — `owner_id = auth.uid()`, `USING`+`WITH CHECK` en todas | Completo (sintaxis), aplicación pendiente |
| FKs, constraints, índices, idempotencia | mismas migraciones — índices únicos parciales reemplazan los ids string-codificados del móvil (`paymentIdempotency.ts`) por su equivalente relacional exacto | Completo |
| Auditoría/historial | `student_status_history`, `student_level_history`, `student_price_history`, `monthly_amount_corrections`, `initial_paid_surcharge_corrections`, `first_month_proration_decisions`, `pending_training_billing_operations` — todas append-only | Completo |
| Adaptadores/repositorios web | `lib/db/server-context.ts` (contexto autenticado real), `lib/db/database.types.ts` (tipos de fila), `lib/repositories/students-mapping.ts` + `students.ts` (patrón de referencia completo: mapeo puro + I/O real) | Patrón completo y probado; el resto de los repositorios (calendario, cobros, etc.) se escriben en su propia fase (Fase 2+), siguiendo este mismo patrón |
| Preparación del importador de backup | Ver §"Compatibilidad con TeacherFlowBackupV2" abajo — columna `legacy_mobile_id` en toda tabla, sin implementar importación todavía | Preparado, no implementado (Fase 9) |
| Pruebas de aislamiento entre dos usuarios | `supabase/tests/rls_isolation_test.sql` (pgTAP real, 17 aserciones) | **Escrito, NO ejecutado** — bloqueado por falta de Docker/Supabase CLI en este entorno (ver §"Validación pendiente") |
| Pruebas de los repositorios | `lib/repositories/__tests__/students-mapping.test.ts` (11 pruebas reales, `node --test`) | Completo y verde |

### Validación pendiente (Fase 1)

Este entorno de desarrollo no tiene Docker ni el CLI de Supabase instalados, y esta sesión nunca usó ni pidió la contraseña de Postgres ni la `service_role key` del proyecto real (regla explícita de la tarea). Como consecuencia:

1. **Las migraciones nunca se aplicaron contra ninguna base real** (ni local ni el proyecto de producción). Se validó únicamente su **sintaxis SQL real** con `libpg-query` (el parser C que usa el propio Postgres) — las 11 archivos `.sql` (10 migraciones + 1 archivo de pruebas) pasan. Esto NO prueba semántica (orden de creación de tablas referenciadas, nombres de columna en JOINs reales, comportamiento real de un trigger) — sólo gramática.
2. **`supabase/tests/rls_isolation_test.sql` nunca corrió.** Es pgTAP real y completo (17 aserciones: alumno propio visible/ajeno invisible en SELECT/UPDATE/DELETE cruzado, INSERT con `owner_id` falsificado rechazado, mismas pruebas sobre `recurrence_rules`/`payments`/`payment_charges`/`teacher_availability`, acceso anónimo a cero filas), pero "escrito" no es "verificado".
3. **Paso siguiente real, a cargo del usuario o de una sesión con las herramientas instaladas:**
   ```bash
   # una vez con supabase CLI + Docker Desktop instalados:
   supabase link --project-ref foljsapgewxnatgreggz   # sólo vincula, no aplica nada todavía
   supabase db push --dry-run                          # revisa el plan antes de aplicar
   supabase db push                                     # aplica las 10 migraciones (requiere autorización — nunca lo hago yo sin pedido explícito)
   supabase test db                                     # corre supabase/tests/rls_isolation_test.sql de verdad
   ```
   Hasta que esto corra una vez, tratar el esquema como "escrito, no verificado" — mismo criterio que ya usa este proyecto para la validación física en dispositivo.

### Compatibilidad con TeacherFlowBackupV2 (preparación, sin importar nada)

Cada tabla que tiene equivalente directo en el backup móvil tiene una columna `legacy_mobile_id text` + `unique(owner_id, legacy_mobile_id)`, reservada para el futuro importador (Fase 9): permite mapear el id string que ya existe en un backup real a la fila Postgres real sin re-detectar duplicados a mano. Mapeo de colecciones del backup a tablas:

| Colección `TeacherFlowBackupV2` | Tabla(s) Postgres |
|---|---|
| `students` + `profiles` | `students` (unificadas — ver comentario en la migración) |
| `pedagogicalLessons` | `lesson_registrations` + `lesson_registration_students/attendance/evaluations/homework_reviews` |
| `calendarLessons` | `calendar_lessons` + `calendar_lesson_participants` |
| `recurrenceRules` | `recurrence_rules` + `recurrence_rule_participants` |
| `recurrenceExceptions` | `recurrence_exceptions` |
| `teacherAvailability` | `teacher_availability` |
| `paymentCharges` / `payments` / `paymentAllocations` / `paymentAdjustments` | `payment_charges` / `payments` / `payment_allocations` / `payment_adjustments` |
| `trainingBillingAgreements` | `training_billing_agreements` |
| `monthlyAmountCorrections` / `initialPaidSurchargeCorrections` / `firstMonthProrationDecisions` | tablas homónimas en `snake_case` |
| `packagePurchases` / `packageCreditMovements` | tablas homónimas |
| `customLevels` | `custom_levels` |
| `surchargeSettings` / `budgetDistribution` | `surcharge_settings` / `budget_distribution_settings` |
| `teacherProfile` | `teacher_profiles` |
| `reportRecords` | `report_records` (`permanentPdfUri` local → `pdf_url` en Supabase Storage) |

No incluido en el backup, no necesita tabla (confirmado por auditoría): `materials_library`, `active_class_session`, banderas de UI locales (ver reporte completo del sub-agente que auditó `src/shared/backup/`, disponible en el historial de esta sesión).

---

## Fase 2 — Alumnos — **COMPLETA** (commits `74418a8` + `c6ba561`)

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Listado real con estado | `StudentsListScreen.tsx`, `studentStore.ts` | `/alumnos` | completo | `students` | `lib/students/search.test.ts`, `filters.test.ts` | Fase 1 (esquema) | 2 |
| Crear alumno | `NewStudentScreen.tsx` (sin `studentId`), `studentMapper.ts` | `/alumnos/nuevo` | completo | `students` | `students-mapping.test.ts` + Server Action con validación server-side | Fase 1 (repositorio ya escrito) | 2 |
| Editar alumno | `NewStudentScreen.tsx` (con `studentId`) | `/alumnos/[id]/editar` | completo | `students` | idem — `notFound()` no distingue inexistente de ajeno (anti-enumeración) | Fase 1 | 2 |
| Perfil completo (7 pestañas) | `StudentProfileScreen.tsx` + `tabs/*` | `/alumnos/[id]` | completo (resumen/información/estado/niveles/clases/progreso/tareas) · sólo la pestaña Cobros muestra estado vacío real a la espera de Fase 5, nunca datos inventados | `students`, `student_status_history`, `student_level_history`, `student_price_history`, `lesson_registrations` (+ hijas) | — | Fase 2 (base) + Fase 4 (clases/progreso/tareas dentro del perfil) | 2 (resumen/información), 4 (clases/progreso/tareas), 5 (cobros) |
| Buscar | `SearchBar.tsx`, `matchesStudentSearch` (motor único de búsqueda) | `/alumnos` | parcial — puerto de `matchesStudentSearch` (normalización, prefijo, multi-palabra) sin la capa de tolerancia a typos (Damerau-Levenshtein) ni iniciales; diferencia conocida, documentada en el commit, no silenciada | — | `lib/students/__tests__/search.test.ts` | — | 2 |
| Filtros y orden | `FiltersPanel.tsx`, `StudentsFilterState` | `/alumnos` | completo | — | `filters.test.ts` (`DEFAULT_FILTER_STATE.status='activo'` confirmado) | — | 2 |
| Estados activo/pausado/inactivo/archivado | `ChangeStatusSheet.tsx`, `applyStatusChange` | `/alumnos/[id]` | completo (cambio de estado + historial) — poda de series futuras al archivar (`removeFromFuture`) queda para cuando exista `recurrence_rules` con datos reales de una profesora, no bloquea el cierre de Fase 2 | `students`, `student_status_history` | — | Fase 3 (recurrencia, para la poda) | 2 (cambio simple), 3 (poda) |
| Niveles estándar y personalizados | `customLevelsCore.ts`, `CreateCustomLevelSheet.tsx` | `/alumnos/[id]`, gestión desde perfil | completo | `custom_levels` | — | Fase 1 (tabla) | 2 |
| Modalidad / información académica | `InformacionTab.tsx` | `/alumnos/[id]` | completo | `students` | — | Fase 2 (base) | 2 |
| Próxima clase | derivado, no almacenado | `/alumnos/[id]` | inexistente — requiere `calendar_lessons` real (Fase 3, ahora disponible) pero la vista SQL/consulta todavía no se conectó al perfil | vista SQL sobre `calendar_lessons` | Consulta, nunca columna (decisión de arquitectura, ver Fase 1) | Fase 3 | 2/3 |
| Historial (clases) | `ClasesTab.tsx`, `buildStudentSessionHistory` | `/alumnos/[id]?tab=clases` | completo — historial real (nunca se borra un registro), incluye clases ligadas a Calendario y clases ad-hoc (`/registro/libre/[registrationId]`), un alumno archivado conserva todo su historial | `lesson_registrations` | — | Fase 4 | 2/4 |
| Tareas y anotaciones | `TareasTab.tsx`, `homeworkPendingDomain.ts` | `/alumnos/[id]?tab=tareas` | completo — identidad `task_id` estable (`common:<id>`/`individual:<id>:<studentId>`) portada exacta, nunca reinventada | `lesson_registration_homework_reviews` | `lib/lessons/__tests__/homework.test.ts` | Fase 4 | 2/4 |
| Estado de pago | derivado (`PaymentStatus`, semáforo 4 colores) | — | inexistente | vista SQL sobre `payment_charges`/`payments` | Portar `calculateChargeState`/etapas de vencimiento sin cambiar los días/porcentajes | Fase 5 | 2/5 |
| Archivar/restaurar/eliminar | `studentArchiveService.ts`, `studentDeletionCascade.ts` (10 colecciones) | `/alumnos/[id]` | parcial — archivar/restaurar reales y probados; la cascada completa de 10 colecciones sólo puede cerrarse cuando existan todas esas tablas con datos (Fases 3-5) | todas las que referencian `student_id` | Cascada completa: portar `studentDeletionCascade.ts` función por función, nunca una reimplementación aproximada | Fase 2-5 (según qué tablas ya existan con datos) | 2 |
| Alumnos inactivos fuera de cobros nuevos | `selectTrainingChargeCandidates`, `isStudentBillableForPeriod` | — | inexistente | `payment_charges` | Ya replicado en el esquema (ver Fase 5); portar la función pura exacta | Fase 5 | 5 |
| Reemplazar `FIXTURE_STUDENTS` | `lib/fixtures.ts` | `/alumnos`, `/inicio`, `/cobros` | `/alumnos` completo — `/inicio` y `/cobros` todavía usan otros fixtures propios (`FIXTURE_TODAY_LESSONS`, `FIXTURE_CHARGES`), pendientes de sus propias fases | `students` | — | Cierre de Fase 2 | 2 |

**Migración aplicada y verificada:** `supabase/migrations/20260920120000_student_mutation_rpcs.sql` (`rename_custom_level`, `change_student_status`) — aplicada por el usuario vía `supabase db push`, confirmada por sondeo real contra PostgREST (las dos RPC existen y responden `403`/`28000` "No hay una sesión autenticada" ante una llamada anónima con payload correctamente formado — antes daban `404 PGRST202`). Auditoría de seguridad posterior encontró que ninguna de las dos tenía `revoke ... from public` (Postgres otorga EXECUTE a PUBLIC por defecto al crear una función) — corregido en `20260921100000_rpc_hardening_and_participants_from_date.sql` (también aplicada y verificada).

**Verificación visual:** completa con sesión real (ver §Verificación real de esta ronda en la sección de Fase 3, más abajo) — listado, crear, editar, perfil, búsqueda, filtros, los 4 estados, niveles personalizados con renombrado en cascada verificado end-to-end, recarga directa, navegación atrás/adelante, ID manipulado, todo probado con datos reales y funcionando. typecheck/lint/tests/build en verde.

---

## Fase 3 — Calendario — **COMPLETA y verificada con datos reales** (ver §Verificación real de esta ronda, abajo)

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Vistas semanal/diaria + navegación | `CalendarTabScreen.tsx`, `WeekTimeGrid.tsx` | `/calendario` (semana y día, navegación por query string, zona horaria Argentina real) | completo | `calendar_lessons`, `recurrence_rules`, `recurrence_exceptions` | `lib/calendar/__tests__/timezone.test.ts` (7), `recurrence-engine.test.ts` (9), `occurrences.test.ts` (6) | Fase 1 | 3 |
| Crear clase única | `NewCalendarLessonSheet.tsx` | `/calendario/nueva` | completo y **verificado con datos reales** (creación, conflicto real, clases consecutivas sin falso conflicto, disponibilidad bloqueando/permitiendo) | `calendar_lessons` | RPC `create_calendar_lesson` validada con `libpg-query` y probada end-to-end en el navegador | Fase 1 | 3 |
| Crear serie (ciclos de 1 a 4 semanas) | `NewCalendarLessonSheet.tsx`, `splitRecurrenceFromDate` | `/calendario/nueva` | completo y **verificado con datos reales** (`WeekdayScheduleEditor`, selector de ciclo 1-4 semanas, cada semana con su propio día/horario; probado con 1 y con 2 alumnos, aparece correctamente agrupada en Series) — bug crítico real de tipo SQL encontrado y corregido en esta ronda, ver §Verificación real de esta ronda | `calendar_lessons`, `recurrence_rules`, `recurrence_rule_participants` | `recurrence-engine.test.ts`; RPC `create_recurrence_series` validada con `libpg-query` y probada end-to-end en el navegador | Fase 1 | 3 |
| Individuales/grupales, entrenamientos, participantes múltiples | `AddParticipantsSheet.tsx`, `EditActivityKindSheet.tsx` | `/calendario/nueva` | completo — sólo alumnos ACTIVOS son candidatos nuevos; `activityKindSupportsHomework` portado exacto | `calendar_lesson_participants`, `recurrence_rule_participants` | `lib/calendar/__tests__/mutations.test.ts` | Fase 3 (base) | 3 |
| Disponibilidad | `TeacherAvailabilitySheet.tsx`, `teacherAvailabilityEngine.ts` | `/calendario/disponibilidad` | completo | `teacher_availability` | `lib/calendar/__tests__/availability.test.ts` (8) | Fase 1 (tabla) | 3 |
| Conflictos de horario / consecutivas sin falsa superposición | `calendarConflicts.ts` (puerto: `lib/calendar-conflicts.ts`) | `/calendario/nueva`, Server Action `checkConflictsAndAvailability` | completo — conectado a creación real, `<`/`>` estrictos (clases consecutivas nunca chocan) | — | 7 pruebas previas + reutilizadas sin reescritura | ninguna | 3 |
| Editar una clase / editar toda la serie / "esta y las siguientes" | `EditFutureRecurrenceSheet.tsx`, `applyFuturePatternFromDate`, `planActivityKindThisAndFutureSplit` | `/calendario/series` ("Editar futuras" para el patrón, "Modificar participantes" para el roster) | completo y **verificado con datos reales**: "Editar futuras" probado cambiando el patrón de una serie real (lunes → martes) — el original quedó truncado y la sucesora activa, la lista de "series vigentes" siguió mostrando 1 sola fila (agrupación por linaje confirmada en runtime, no sólo en pruebas unitarias); "Modificar participantes" probado agregando un segundo alumno a una serie existente — el roster cambió en la MISMA regla, sin crear una serie nueva | `recurrence_rules`, `recurrence_exceptions`, `calendar_lessons` | `lib/calendar/__tests__/split.test.ts` (9), `lineage.test.ts` (7), `participants-split.test.ts` (4); ambas RPC probadas end-to-end en el navegador | Fase 3 (base) | 3 |
| Pausar/reanudar/finalizar series | `RecurrenceRulesSheet.tsx`, `selectManageableRecurrenceSeries` | `/calendario/series` | completo y **verificado con datos reales** (pausar → "Pausada"/"Reanudar" real; finalizar → la serie desaparece de "vigentes" real) — agrupación por LINAJE real (`supersedesRecurrenceId`), nunca por `studentId` ni por coincidencia de `undefined`; botón "Ir a la última serie" para listas largas | `recurrence_rules` | `lineage.test.ts` (7) | Fase 3 (base) | 3 |
| Cancelar / reprogramar / reemplazar | `CalendarLessonActionsSheet.tsx`, `SelectLessonToRescheduleSheet.tsx` | `/calendario` (modal de detalle real) | completo — reemplazo vía `freedByLessonId` con las 4 condiciones exactas del móvil (`getCancelledSlotReuseDecision`); reprogramar tiene paso real de vista previa/confirmación antes de persistir (elegir horario → revisar → confirmar o volver), duración fija igual a la clase original (mismo criterio que el móvil, que tampoco la deja editar en este flujo); nombres/niveles de participantes se resuelven siempre en el servidor contra los alumnos reales (se corrigió un bug real: antes se guardaban vacíos para cualquier participante no principal) | `calendar_lessons`, `recurrence_exceptions` | `mutations.test.ts` (5) | Fase 3 (base) | 3 |
| Estados completada/pendiente/cancelada/reprogramada + historial | `CalendarLessonStatus` | `/calendario` | completo | `calendar_lessons`, `recurrence_exceptions` | `occurrences.test.ts` | Fase 3 (base) | 3 |
| Escala de colores congelada | `calendarVisualLegend.ts` (puerto: `lib/calendar-theme.ts`) | `/calendario` | completo (visual) | — | — | ninguna | ya cerrado |
| Reemplazar `CALENDAR_FIXTURE_LESSONS` | `lib/calendar-fixtures.ts` (eliminado) | `/calendario` | completo — `/inicio` todavía usa su propio `FIXTURE_TODAY_LESSONS`, no tocado (pertenece a Fase 6) | `calendar_lessons` | — | Cierre de Fase 3 | 3 |

**Migraciones aplicadas y verificadas:**
- `supabase/migrations/20260920130000_calendar_mutation_rpcs.sql` (6 funciones originales de calendario) — aplicada, sondeo real confirma las 6 RPC activas.
- `supabase/migrations/20260921100000_rpc_hardening_and_participants_from_date.sql` (migración correctiva, aditiva, nunca edita las anteriores) — aplicada y verificada por sondeo real. Corrige 3 brechas de seguridad/corrección encontradas al auditar las RPC:
  1. `rename_custom_level`/`change_student_status` (Fase 2) no tenían `revoke ... from public`.
  2. `create_calendar_lesson`/`create_recurrence_series`/`cancel_calendar_occurrence`/`reschedule_calendar_occurrence` no verificaban que el `student_id`/`recurrence_id` referenciado perteneciera al propio `owner_id` — un chequeo de FOREIGN KEY en Postgres se evalúa sin aplicar RLS sobre la tabla referenciada, así que un usuario autenticado que conociera/adivinara un UUID ajeno podía insertar filas hijas referenciándolo. Las 4 funciones ahora verifican propiedad explícitamente.
  3. `split_recurrence_this_and_future` comparaba una fecha contra `timestamptz` con el timezone de la sesión (UTC), no `America/Argentina/Buenos_Aires` — corregido.
  
  También da de baja `set_recurrence_participants(uuid, uuid[])` (código muerto, nunca invocado desde ninguna acción real) y agrega `apply_recurrence_participants_from_date` — ver fila "esta y las siguientes" arriba.
- `supabase/migrations/20260921110000_fix_participant_loop_type_bug.sql` — aplicada y **verificada con datos reales** (no sólo por sondeo): corrige el bug crítico de `create_recurrence_series`/`split_recurrence_this_and_future` descrito en §Verificación real de esta ronda (variable de bucle `jsonb` en vez de `text` sobre `jsonb_array_elements_text`, que rompía toda creación de serie y todo "esta y las siguientes" con participantes).

**No implementado deliberadamente en esta fase (pertenece a Fase 4/5, nunca simulado):** ningún cargo, cuota, ni registro de clase dictada se genera desde el Calendario. Finalizar una serie detiene sus ocurrencias futuras pero no toca `payment_charges` (no existen filas de calendario ligadas a cobros todavía). `activityKind='training'` puede más adelante enlazarse a `training_billing_agreements` (Fase 5) — el campo existe en el esquema, la web no lo usa todavía.

**Cobertura de pruebas:** 55 pruebas nuevas de lógica pura en `lib/calendar/__tests__/` (timezone 7, recurrence-engine 9, availability 8, lineage 7, split 9, occurrences 6, mutations 5, participants-split 4), sumadas a las 83 de Fase 1/2 → **138 pruebas totales, todas verdes**. Pruebas pgTAP nuevas (`supabase/tests/calendar_rpc_ownership_test.sql`, 12 aserciones) cubriendo específicamente las referencias cruzadas de propietario corregidas en las RPC — escritas y validadas con `libpg-query`, **todavía no ejecutadas** (mismo bloqueo de entorno sin Docker/CLI que `rls_isolation_test.sql` de Fase 1). No hay pruebas de concurrencia real contra la base (dos splits simultáneos, reintento a mitad de operación) — mismo bloqueo, pendiente real.

### Verificación real de esta ronda (sesión de prueba real, datos ficticios "QA")

Primera vez que se prueban Alumnos y Calendario con una sesión real autenticada en el navegador, en dos rondas consecutivas. Resultado final: **todo lo probado funciona correctamente de punta a punta**, incluida la pantalla Series y "esta y las siguientes", que en la primera ronda estaban bloqueadas por un bug crítico ya corregido y re-verificado.

**Alumnos — todo lo probado funcionó correctamente:** listado (vacío y con datos), crear (2 alumnos de prueba), editar, ver perfil, cambiar estado (pausado/archivado/restaurar, incluida la regla de que sólo se puede "restaurar" desde un estado no-activo, nunca saltar directo entre dos estados no-activos), niveles personalizados (crear + **renombrar en cascada verificado end-to-end**: el cambio se reflejó tanto en el selector de filtros como en la ficha del alumno), búsqueda, filtros, recarga directa de URL (incluida con `?tab=`), navegación atrás/adelante, ID inexistente/manipulado → 404 genérico. Consola sin errores propios de la app.

**Calendario — todo lo probado funcionó correctamente:** vista semana/día, navegación, "Hoy", crear clase única, crear serie con 1 y con 2 participantes, disponibilidad (bloqueo semanal creado y verificado real: dentro del bloqueo rechazado con el motivo correcto, fuera del bloqueo permitido), conflicto real detectado, **clases consecutivas sin falso conflicto**, cancelar, reprogramar con vista previa real, reemplazar con otro alumno (4 condiciones confirmadas con datos reales), ID manipulado en `freedByLessonId` rechazado (constraint real). **Series con datos reales:** 2 series creadas (una con 1 alumno, otra con 2), ambas agrupadas correctamente y visibles; "Editar futuras" cambió el patrón de lunes a martes y la serie siguió contando como 1 sola vigente (linaje real, no 2); "Modificar participantes" agregó un segundo alumno a una serie existente sin crear una serie nueva; Pausar → "Pausada"/Reanudar → "Activa"; Finalizar → la serie desapareció de "vigentes" (sin borrar historial).

**Bug #1 (corregido, primera ronda):** `createSingleLessonAction`/`createRecurrenceSeriesAction` nunca redirigían tras guardar exitosamente. Corregido con `redirect("/calendario")` fuera del `try/catch`.

**Bug #2 — crítico (corregido y re-verificado en esta ronda):** `create_recurrence_series` y `split_recurrence_this_and_future` fallaban siempre que `participant_ids` tenía al menos un elemento, con `22P02 invalid input syntax for type json` — la variable de bucle que recorría `jsonb_array_elements_text(...)` estaba declarada `jsonb` en vez de `text`. Bug preexistente en la migración original de Fase 3, nunca antes probada con datos reales, heredado al reescribir esas funciones en la migración de seguridad anterior. Migración correctiva `supabase/migrations/20260921110000_fix_participant_loop_type_bug.sql` — **aplicada por el usuario y confirmada**: se crearon 2 series reales (1 y 2 participantes) y se ejecutó "esta y las siguientes" con éxito, sin ningún error de tipo.

**Bug #3 — pérdida de campos del formulario (corregido en esta ronda):** en `/calendario/nueva`, cuando el servidor rechazaba el envío, el formulario perdía los campos ya completados. Causa raíz real, confirmada con una prueba dirigida (marcador en el DOM): React 19 remonta el estado de todos los `useState` del componente en cada ida y vuelta de un Server Action, aunque el nodo `<form>` del DOM sobreviva — y además ejecuta un `form.reset()` nativo DESPUÉS de que React ya renderizó, así que ni un ajuste de estado "durante el render" alcanza a sobrevivir a ese reset posterior. Solución: el servidor ahora devuelve un "eco" de los valores enviados (`FormState.values`) en cada `return` de error, y el cliente los re-sincroniza en un `useEffect` (que corre después del reset nativo, ganándole la carrera) — nunca en un ajuste síncrono durante el render, que sí pierde contra el reset. Verificado en ambos modos (clase única y serie): tras un rechazo, fecha/hora/duración/alumno/fecha de inicio/patrón semanal se conservan intactos; sólo hay que corregir el campo que causó el error.

**Hallazgo menor (no corregido, de bajo impacto):** un recurso devuelve `404` y aparece un error cosmético de instrumentación de Turbopack (`Failed to execute 'measure' on 'Performance'`) en la consola del navegador en modo desarrollo — no afecta ninguna funcionalidad observada, probablemente un artefacto del entorno de desarrollo, no del código de la aplicación.

**Datos de prueba creados durante esta verificación (no reales, no eliminados):** dos alumnos ficticios ("QA Alumno Editado", ex "QA Alumno Prueba"; "QA Alumno Dos"), un nivel personalizado ("Grupo QA Renombrado", ex "Grupo QA"), varias clases sueltas (creadas/canceladas/reprogramadas/reemplazadas), dos series recurrentes de prueba (una finalizada durante la verificación, una activa con patrón martes 18:00 y ambos alumnos), y un bloqueo semanal de disponibilidad (jueves 10:00–12:00, motivo "Trabajo"). La aplicación todavía no tiene un mecanismo de eliminación permanente de alumnos (sólo archivar, ver Fase 2) — no existe una forma segura y probada de borrarlos, así que **quedan identificados por el nombre "QA"**.

**No verificado (pendiente real, no fabricado):**
- RLS con dos sesiones reales — sólo había disponible una cuenta de prueba; las pruebas pgTAP (`rls_isolation_test.sql`, `calendar_rpc_ownership_test.sql`) cubren esto de forma automatizada pero siguen sin ejecutarse (sin Docker/CLI en este entorno).
- Concurrencia real contra la base (doble toque simultáneo, dos splits a la vez, interrupción a mitad de operación) — requiere dos requests verdaderamente simultáneas, no reproducible de forma confiable desde una sesión de navegador manual.

**Verificación visual:** completa en ambas rondas, con sesión real. typecheck/lint/tests(138)/build en verde en cada ronda, incluida esta última tras los 2 fixes.

---

## Fase 4 — Registro de clases y entrenamientos — **completa y verificada con datos reales** (registro programado + ad-hoc + notas por habilidad + auditoría real de ediciones; `Cancelada`/`Reprogramada` quedan explícitamente fuera de alcance — ver nota de dependencia de Fase 5 más abajo). Ver §Verificación real de esta ronda (cierre de brechas) para el detalle completo.

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Clases por registrar | `PendingClasses.tsx`, `pendingClasses.ts` (`isOccurrenceEligibleForPendingRegistration`) | `/registro` | completo — `buildPendingLessons`/`isEligibleForPendingRegistration` (`lib/lessons/pending.ts`), mismo criterio exacto: elegible desde `max(inicio, fin-10min)`, `status ∈ {scheduled, rescheduled}` (una reprogramada SÍ es el destino real que hay que registrar), nunca vence; una grupal parcial muestra progreso real (`N de M`), nunca desaparece | `calendar_lessons`, `lesson_registrations`, `lesson_registration_students` | `lib/lessons/__tests__/pending.test.ts` (8) | Fase 3 | 4 |
| Registro individual/grupal | `NewClassScreen.tsx`, `RegisterPendingClassSheet.tsx` | `/registro/[calendarLessonId]` | completo — un mismo flujo cubre individual (1 participante) y grupal (N), cada participante se abre/completa de forma independiente | `lesson_registrations`, `lesson_registration_students` | — | Fase 3 | 4 |
| Asistencia y resultado por participante | `AttendanceSection.tsx`, `StudentAttendanceEntry` | `/registro/[calendarLessonId]` | completo — los 4 estados reales (`presente`/`tarde`/`ausente_aviso`/`ausente`), `'sin_registrar'` tratado como legado/no resuelto, nunca un 5º botón inventado | `lesson_registration_attendance` | `lib/lessons/__tests__/attendance.test.ts` (2) | Fase 4 (base) | 4 |
| Tareas pendientes | `HomeworkSection.tsx`, `homeworkPendingDomain.ts` | `/registro/[calendarLessonId]`, ficha del alumno → Tareas | completo — identidad `common:<id>`/`individual:<id>:<studentId>` portada exacta, `getBlockingHomeworkTasks` como ÚNICA fuente de bloqueo (regresión 2026-09-12 del móvil replicada: un entrenamiento con tarea heredada nunca bloquea) | `lesson_registration_homework_reviews` | `lib/lessons/__tests__/homework.test.ts` (5) | Fase 4 (base) | 4 |
| Notas / calificación | `EvaluationSection.tsx`, `calculateAverageGrade` | `/registro/[calendarLessonId]`, ficha del alumno → Progreso | completo — `0` nunca es nota real (excluida del promedio y normalizada a `NULL`), promedio sólo sobre valores reales, redondeo a 1 decimal exacto | `lesson_registration_evaluations` | `lib/lessons/__tests__/grades.test.ts` (10) | Fase 4 (base) | 4 |
| Duración real | duración real en minutos (móvil: contador simple) | `/registro/[calendarLessonId]` (al finalizar) | completo — se pidió como minutos (igual que el móvil), se guarda como `actual_started_at`/`actual_ended_at` (el esquema ya definido en Fase 1 usa un par de timestamps en vez de un contador — información equivalente, nunca se toca `calendar_lessons.start_at`/`end_at` sólo por esto); validación de orden temporal real en la RPC | `lesson_registrations` | — | Fase 4 (base) | 4 |
| Entrenamientos sin tareas cuando no corresponda | `activityKindSupportsHomework` | `/registro/[calendarLessonId]` | completo — reutiliza la función YA portada en Fase 3 (`lib/calendar/activity-kind.ts`), nunca reimplementada | — | `lib/lessons/__tests__/homework.test.ts` | ninguna (ya existía) | 4 |
| Completar participantes de forma independiente | `ParticipantRegistrationBlock.tsx`, `groupRegistrationDomain.ts` | `/registro/[calendarLessonId]` | completo — `pending`/`completed`/`omitted` portado exacto; `omitted` nunca cuenta como completo (reversible, sigue bloqueando finalizar); progreso real `N de M` persistido en `participant_status`, cerrar/reabrir lo conserva | `lesson_registration_students.participant_status` | `lib/lessons/__tests__/group-progress.test.ts` (6) | Fase 4 (base) | 4 |
| Finalizar registro / editar registros | `EditRegisteredLessonSheet.tsx` | `/registro/[calendarLessonId]` (misma pantalla sirve de edición cuando ya está `completed`) | completo — transaccional (una sola RPC), idempotente (reintentar sobre uno ya `completed` no duplica ni falla), re-valida participantes completos server-side (defensa en profundidad); edición nunca toca alumno/fecha/hora (regla exacta del móvil), sólo resultado/asistencia/evaluación/tarea/duración; un campo no enviado nunca sobreescribe lo ya guardado (`p_payload ? 'campo'`) | `lesson_registrations` (+ hijas) | — | Fase 4 (base) | 4 |
| Conservar historial académico | — | ficha del alumno → Clases/Progreso/Tareas | completo — nunca se borra un registro; un alumno archivado conserva su historial completo (las consultas no filtran por `status` del alumno) | mismas tablas (append/update) | — | Fase 4 (base) | 4 |
| Registro ad-hoc (sin reserva de Calendario) | `NewClassScreen.tsx` | `/registro/nuevo` (crear) → `/registro/libre/[registrationId]` (detalle/edición) | completo — reutiliza la MISMA `RegistrationWorkspace` que el camino ligado a Calendario (nunca duplica lógica de guardado); `calendar_lesson_id` siempre `null`, nunca crea ninguna fila de Calendario; idempotente real por `operation_id` (UUID persistido en `sessionStorage`, sobrevive una recarga, `INSERT ... ON CONFLICT DO NOTHING`) — doble clic/reintento/recarga nunca duplican ni modifican participantes, un `operation_id` nuevo sí crea un registro legítimo distinto; "Resultado" acotado a `clase_dictada`/`profesora_ausente`/`feriado` (ver nota de alcance abajo); fecha argentina real (`localDateTimeToInstantIso`, mismo helper ya usado y verificado en Fase 3) | `lesson_registrations` (columnas `outcome`/`holiday_exception`/`modality`/`scheduled_end_at`/`operation_id`, nuevas) | `lib/lessons/__tests__/adhoc.test.ts` (8) + verificación real (ver §Cierre de brechas) | Fase 4 (base) | 4 |
| Notas por habilidad | `SkillGradeChips.tsx`, `skill_grades` jsonb | `/registro/[calendarLessonId]`, `/registro/libre/[registrationId]`, ficha del alumno → Progreso | completo — 8 áreas reales (habla/escucha/lectura/escritura/gramática/vocabulario/pronunciación/participación), 0 nunca se persiste como nota real (`normalizeSkillGradeValue`), precarga real al editar, un campo omitido nunca borra las demás áreas ya calificadas | `lesson_registration_evaluations.skill_grades` (ya existía desde Fase 1, nunca antes expuesta en la interfaz) | `lib/lessons/__tests__/grades.test.ts` (ya cubría `normalizeSkillGradeValue`) | ninguna (esquema y RPC ya existían) | 4 |
| Auditoría de ediciones | `editHistory`/`LessonEditAuditEntry` | (interna — se conserva, sin una pantalla dedicada de historial en esta ronda) | completo en el alcance académico — una única RPC atómica (`edit_completed_lesson_registration`, `security definer`) hace snapshot + aplica todos los cambios académicos en la MISMA transacción, idempotente por `edit_operation_id` (persistido en `sessionStorage` por registro); la tabla sólo acepta `SELECT` para `authenticated` (RLS + `revoke` a nivel de tabla) — ni siquiera el dueño puede insertar/editar/borrar un snapshot directo; nunca campos financieros (`billedAmount`/`appliedPolicy` del móvil), mismo criterio de exclusión de Fase 5 del resto de esta fase | `lesson_registration_edit_history` (nueva) | verificación real (17 checks, ver §Cierre de brechas) | Fase 4 (base) | 4 |

**Diferencias reales entre registro programado y ad-hoc (documentadas, no inventadas — confirmadas leyendo el HEAD actual del móvil):**
- El ad-hoc del móvil (`NewClassScreen.tsx` sin `calendarRegistration`) NUNCA ofrece `activityKind` — el tipo de ruta de navegación `NewClass` no tiene ese campo, y el formulario nunca lo expone para elegir. Confirmado también que no existe ningún otro punto de entrada ad-hoc para entrenamientos. Por eso `/registro/nuevo` sólo registra clases (`activity_kind: 'class'`) — no es una limitación inventada, es la realidad actual del móvil.
- "Resultado" del móvil (`EventType`) tiene 6 valores ofrecibles hoy: `clase_dictada`, `profesora_ausente`, `cancelada_con_aviso`, `cancelada_tarde`, `reprogramada`, `feriado`. Esta ronda porta 3 (`clase_dictada`, `profesora_ausente`, `feriado`) — los otros 3 exigen campos que pertenecen a Fase 5 (`lateCancellationPolicy`/`lateCancellationPercentage`, motor financiero todavía no implementado) o un mecanismo de enlace a OTRO registro ad-hoc (`reprogramada`/`rescheduledFromLessonId`) que duplicaría el reprogramar real de Calendario ya construido y verificado en Fase 3. `alumno_ausente` tampoco se porta: el propio móvil dejó de ofrecerlo para elegir (`PendingClassOutcomeSelector.tsx`) — la ausencia de un participante se expresa con su asistencia individual, ya portada.
- El registro programado (ligado a Calendario) sigue exactamente igual que antes de esta ronda — `outcome` queda fijo en `clase_dictada` para ese camino (nunca se ofrece cambiarlo ahí), cero regresión sobre lo ya verificado.

**Migraciones aplicadas y confirmadas reales (`supabase migration list`, local = remoto):**
- `20260922100000_adhoc_registration_and_edit_history.sql` — aditiva. Agrega a `lesson_registrations`: `outcome`/`holiday_exception`/`modality`/`scheduled_end_at`/`operation_id` (todas irrelevantes para el camino ligado a Calendario, que sigue exactamente igual). Agrega `lesson_registration_edit_history`. Reemplaza `start_lesson_registration` (ahora idempotente por `operation_id` vía `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` — nunca reprocesa participantes ni toca nada si la operación ya existía) y agrega `edit_completed_lesson_registration` (RPC atómica única para editar un registro finalizado: snapshot + todos los cambios académicos en una sola transacción, `security definer` con `search_path=''`, idempotente por `edit_operation_id`).
- `20260923100000_revoke_anon_execute_lesson_registration_rpcs.sql` — corrige un hallazgo real de esta ronda: `anon` podía ejecutar las 4 RPC pese al `revoke ... from public` ya aplicado (Supabase otorga `EXECUTE` directo a `anon` al crear cada función, aparte de `PUBLIC`). Confirmado con `pg_proc.proacl` real antes/después y con `curl` anónimo real.
- `20260924100000_fix_json_null_attendance_evaluation.sql` — corrige un bug real reproducido en el navegador: un JSON `null` explícito en `attendance`/`evaluation` (camino real de "Profesora ausente"/"Feriado" sin excepción) no es SQL NULL en Postgres, rompía con `23502`. Corregido con `nullif(x, 'null'::jsonb)`.

Las tres validadas statement por statement y función por función con `libpg-query` antes de aplicarse, cada una con autorización explícita previa.

**Cobertura de pruebas:** 182 pruebas de lógica pura, todas verdes (34 del cierre de brechas + 139 de Fase 1-3 + 8 en `lib/lessons/__tests__/adhoc.test.ts` + 1 en `lib/repositories/__tests__/lesson-registrations-mapping.test.ts`). `supabase/tests/lesson_registration_rpc_ownership_test.sql` tiene **51 aserciones reales** (idempotencia por `operation_id`, atomicidad/idempotencia de `edit_completed_lesson_registration`, rechazo de `anon`, RLS cruzada entre dueños) — escritas y validadas con `libpg-query`, **no ejecutadas como pgTAP real** (la extensión está disponible en el proyecto pero no se instaló sin autorización aparte). Cubiertas de forma **equivalente y real** por 17 verificaciones ejecutadas directamente contra el proyecto real (transacción con `begin`/`rollback`, siempre revertida, cero residuos confirmados) — ver §Cierre de brechas (ronda 3) para el detalle exacto de cada una. No hay pruebas de concurrencia genuina (dos requests HTTP simultáneas) — mismo bloqueo ya documentado en Fase 3, la garantía la da una propiedad de Postgres (UNIQUE + `ON CONFLICT`), no algo demostrable desde este entorno.

### Verificación real de esta ronda

**Migración `20260921120000_lesson_registration_rpcs.sql` aplicada por el usuario y confirmada** (probada de forma anónima contra las 3 RPC: `403 "No hay una sesión autenticada"` en vez de `404 PGRST202`). typecheck/lint/tests(173)/build en verde.

**Verificación real en navegador (cuenta de prueba QA, datos QA-prefixed):**
- Clase individual pendiente creada en el Calendario (hora ya transcurrida) → apareció en `/registro` con el mismo criterio de elegibilidad (`max(inicio, fin-10min)`). Registrada completa: asistencia, nota (8→ luego editada a 9), observaciones, fortalezas, a mejorar, tarea individual nueva — todo persistido y visible en la ficha real del alumno (pestañas Clases/Progreso/Tareas), promedio recalculado correctamente (8.0 → 9.0 tras la edición).
- Clase grupal (2 alumnos) registrada parcialmente (1 de 2), cerrada y reabierta desde `/registro` → el progreso real persistió (`"1 de 2 alumnos completados"`, botón "Continuar registro"), confirmando que la fuente real es `lesson_registration_students.participant_status` y no un estado efímero del navegador. Uno de los participantes tenía una tarea individual pendiente de una clase anterior: el botón "Completar alumno" bloqueó correctamente con "Tiene tareas anteriores sin revisar." hasta revisarla (outcome "Realizada"); luego se completó el segundo alumno, se cargó una tarea común para el grupo y se finalizó — la tarea común quedó correctamente atribuida a ambos alumnos en sus fichas reales.
- **Entrenamiento con tarea heredada sin revisar (reproducción directa de la regresión 2026-09-12 del móvil):** se registró un entrenamiento para el mismo alumno que tenía la tarea común pendiente. La tarjeta del participante NO mostró la sección "Tareas anteriores" (`activityKindSupportsHomework` la excluye para `training`), "Completar alumno" no bloqueó, y "Finalizar registro" se habilitó y ejecutó sin error — la tarea heredada nunca bloqueó nada, tal como exige la regla portada.
- Edición de un registro ya finalizado: se reabrió el registro individual finalizado, se cambió asistencia/nota/duración y se guardó — ver bug #1 más abajo (encontrado y corregido en esta misma ronda).
- Validación de orden temporal real: duración real negativa (`-5`) al guardar cambios sobre un registro finalizado fue rechazada por la RPC (mensaje de error mostrado, sin persistir el cambio); duración `0` es tratada como "no enviado" (`Number("0") || null` → no pisa el valor existente), comportamiento no destructivo aunque no es una validación explícita de "positivo" — riesgo bajo, mismo patrón de conversión ya usado en Fase 3.
- ID de registro inexistente (`/registro/00000000-0000-0000-0000-000000000000`) → ver bug #2 más abajo (encontrado y corregido en esta misma ronda).
- Responsive verificado en 390/768/1440px en `/registro`, `/registro/[calendarLessonId]` y la ficha del alumno — sin desbordes, tabs con scroll horizontal en 768px.
- Consola del navegador revisada en una pestaña limpia tras todos los cambios: sin errores (los `500`/`TypeError` observados durante la sesión fueron artefactos transitorios de HMR mientras se editaba el código en vivo — confirmado releyendo el log del servidor de desarrollo, no se repiten en una carga fresca).

**Bug #1 — pérdida silenciosa de cambios al editar un registro finalizado (corregido en esta ronda):** en `registration-workspace.tsx`, el botón principal "Guardar cambios"/"Finalizar registro" sólo llamaba a `finalizeRegistrationAction` (tarea común + duración, sólo campos de encabezado) — nunca incluía los cambios de asistencia/nota/observaciones que el usuario hubiera editado en una tarjeta de participante ya abierta. El usuario veía la navegación exitosa y creía haber guardado todo, pero esos cambios se perdían en silencio (el único camino real para persistirlos era el botón secundario "Guardar sin completar" de cada tarjeta). Causa raíz: el formulario de cada participante vivía en estado local de `ParticipantCard`, invisible para el padre. Corregido levantando ese estado a `RegistrationWorkspace` (`formByStudentId`) y haciendo que "Guardar cambios"/"Finalizar registro" vuelque primero el formulario vigente de cada participante (`participantStatus: null`, preserva su estado real) antes de tocar el encabezado. Verificado: asistencia "Tarde" + 5 min de tardanza + nota 9 editadas sobre un registro finalizado, tras "Guardar cambios" y recargar la página, los tres valores persistieron.

**Bug #2 — 404 real enmascarado como error genérico (corregido en esta ronda):** en `app/(app)/registro/[calendarLessonId]/page.tsx`, `notFound()` se llamaba **dentro** del bloque `try`, así que el `catch` genérico atrapaba la señal interna de Next.js (`notFound()` lanza una excepción especial para renderizar el 404 real) y mostraba "No pudimos cargar este registro." en su lugar — mismo mensaje que un error real, sin distinguir "no existe/no es tuyo" de una falla real. `alumnos/[id]/page.tsx` ya evitaba este error llamando a `notFound()` fuera del try/catch; `registro/[calendarLessonId]/page.tsx` no seguía ese mismo patrón. Corregido moviendo la verificación `if (!detail || !calendarLesson) notFound();` fuera del try/catch. Verificado: `/registro/00000000-0000-0000-0000-000000000000` ahora devuelve el 404 real de Next.js (confirmado también en el log del servidor: `GET /registro/00000000-0000-0000-0000-000000000000 404`).

### Cierre de brechas (ronda 2) — registro ad-hoc, notas por habilidad, auditoría de ediciones; (ronda 3) idempotencia real, atomicidad, endurecimiento de seguridad — todo verificado con datos reales

**Migraciones de esta ronda, las tres aplicadas y confirmadas:**
- `20260922100000_adhoc_registration_and_edit_history.sql` — registro ad-hoc, auditoría, `operation_id`/`edit_operation_id`, `edit_completed_lesson_registration` (`security definer`, `search_path=''`).
- `20260923100000_revoke_anon_execute_lesson_registration_rpcs.sql` — corrige un hallazgo real: `revoke ... from public` nunca quita el grant directo que Supabase da a `anon` al crear una función. Confirmado con `pg_proc.proacl` real antes/después; confirmado también con `curl` anónimo real (`403 28000` → `401/403 42501 "permission denied"`).
- `20260924100000_fix_json_null_attendance_evaluation.sql` — corrige un bug real reproducido en el navegador: `"attendance": null` (JSON null explícito, camino real de "Profesora ausente"/"Feriado" sin excepción, donde la tarjeta de asistencia nunca se muestra) rompía `save_participant_registration`/`edit_completed_lesson_registration` con `23502 not null constraint` — Postgres nunca trata un jsonb `null` como SQL NULL en una comparación `is not null`. Corregido con `nullif(x, 'null'::jsonb)` en las 4 posiciones reales afectadas.

**Verificación real de migración** (`supabase migration list`, real, no supuesta): local y remoto coinciden en las 16 migraciones, incluidas las 3 de esta ronda. `edit_completed_lesson_registration`/`operation_id`/`lesson_registration_edit_history` confirmados reales vía `information_schema`/`pg_proc`/`pg_policy` contra el proyecto real (nunca supuestos por el nombre del archivo). `active_sessions` (2 filas) y `cloud_backups` (20 filas) — ajenas a Fase 4, confirmado que ninguna migración de esta fase las tocó — siguen intactas.

**Pruebas SQL/RLS — 17 verificaciones reales ejecutadas contra el proyecto real** (pgTAP no se instaló sin autorización aparte — se usó el camino equivalente que Joaquín autorizó explícitamente: una transacción real con `begin`/`rollback`, cuenta descartable, siempre revertida, cero datos residuales confirmados después). Las 51 aserciones de `lesson_registration_rpc_ownership_test.sql` siguen escritas y validadas con `libpg-query`, pendientes de ejecución real sólo si se autoriza instalar la extensión `pgtap` (disponible, `default_version 1.3.3`, no instalada) — no se instaló sin pedir permiso aparte. Todas las verificaciones reales de esta ronda:
1. Dos llamadas con igual `operation_id` → mismo registro (mismo `id`).
2. Existe una sola fila para ese `operation_id`.
3. El segundo intento con un alumno de más NO modifica el roster real (sigue en 1 participante).
4. `operation_id` nuevo → registro legítimo distinto.
5. `finalize_lesson_registration` deja `status = completed`.
6. Primera edición real crea exactamente 1 snapshot.
7. Reintentar con el mismo `edit_operation_id` (payload alterado) NUNCA duplica el snapshot.
8. Reintentar con el mismo `edit_operation_id` NUNCA reaplica el cambio (el dato académico queda como la primera aplicación real).
9. `edit_operation_id` distinto → SEGUNDO snapshot real, con el cambio real aplicado.
10. Edición inválida (alumno ajeno) → rechazada.
11. Edición inválida → NO deja snapshot huérfano (sigue en 2, sin cambios).
12. INSERT directo en la auditoría → rechazado.
13. UPDATE directo en la auditoría → rechazado.
14. DELETE directo en la auditoría → rechazado.
15. Otro propietario (usuario B) → rechazado al editar el registro de A.
16. Usuario B → no puede LEER (RLS) la auditoría del registro de A.
17. (fuera del script, verificado aparte con `curl` anónimo real) `anon` → `42501` en las 4 RPC.

**Verificación real en navegador (cuenta QA, datos identificados con prefijo `PRUEBA WEB F4`):**
- **A. Registro ad-hoc:** creada una clase real (`QA Alumno Dos`, 23/9 10:00, 45 min, Presencial, Realizada) desde `/registro/nuevo` → confirmado que NUNCA aparece en `/calendario` (semana completa revisada) → confirmado que SÍ aparece en la ficha del alumno (pestaña Clases, enlace a `/registro/libre/[id]`) → recargada la página ANTES de enviar y confirmado con `sessionStorage.getItem(...)` que el mismo `operation_id` sobrevivió la recarga real → confirmado que `operation_id` se limpia de `sessionStorage` recién después de la respuesta exitosa.
- **B. Registro académico:** asistencia, nota general (9), las 8 notas por habilidad (habla/escucha/lectura/escritura/gramática/vocabulario/pronunciación/participación, valores reales distintos cada una), fortalezas, a mejorar, observación y tarea individual — todo cargado, finalizado, y confirmado persistente tras recargar `/registro/libre/[id]` (lectura directa de cada `<input>` real). Confirmado además en la ficha del alumno → Progreso: promedio general 9.0, las 8 notas por habilidad visibles con sus valores reales, fecha en formato día/mes/año.
- **C. Auditoría:** editada la clase finalizada (asistencia → Tarde) → confirmado 1 snapshot real. Reintentado con el MISMO `edit_operation_id` (inyectado manualmente en `sessionStorage` para simular una respuesta perdida real) cambiando la asistencia a Ausente → confirmado que sigue en 1 snapshot y la asistencia sigue en "tarde" (nunca se reaplicó). Editado de nuevo con un `edit_operation_id` nuevo (asistencia → Ausente con aviso) → confirmado 2do snapshot real, ordenado cronológicamente, con el cambio real aplicado esta vez.
- **D. Otros resultados:** "Profesora ausente" y "Feriado" (sin excepción) — confirmado que NUNCA muestran asistencia/evaluación/tarea, sólo un resumen y "Finalizar registro" directo; finalizados sin error tras el fix del bug de JSON null. "Feriado" CON excepción — confirmado que se comporta exactamente como una clase realizada (asistencia/evaluación/tareas visibles, incluida la tarea individual pendiente de la clase anterior, bloqueando correctamente hasta revisarla).
- **Responsive:** 375px, 768px y escritorio — formulario ad-hoc y pantalla de registro completa (incluidos los 8 sliders de habilidad) revisados en los tres anchos, sin overflow horizontal, sliders usables, botones accesibles.
- **Consola:** revisada en una pestaña nueva tras todos los cambios — sin errores.
- **Regresión — registro ligado a Calendario:** editado un registro real de la ronda anterior (`QA Fase4 Individual`, ya finalizado) a través del mismo flujo nuevo (`editCompletedRegistrationAction`/RPC atómica) → funcionó sin error, generó su propio snapshot real de auditoría. Calendario y Alumnos revisados aparte — sin cambios, sin errores.

**Datos QA creados en esta ronda (identificados, no reales, ninguno borrado — la auditoría de ediciones referencia estos registros por FK, borrarlos rompería el historial de pruebas):**
- 4 registros ad-hoc finalizados sobre `QA Alumno Dos` (alumno ya existente de rondas anteriores): 23/9 10:00 "Realizada" (con 2 ediciones reales de auditoría), 23/9 11:00 "Profesora ausente", 24/9 09:00 "Feriado" sin excepción, 24/9 14:00 "Feriado" con excepción.
- Tarea individual `PRUEBA WEB F4 tarea individual` (entrega 30/9/2026) y observación `PRUEBA WEB F4 - observación de verificación real`, ambas visibles en la ficha de `QA Alumno Dos`.
- Ninguna fila creada en `calendar_lessons` (verificado real, ninguna de las 4 clases ad-hoc aparece ahí).

**Genuinamente pendiente (no ejecutado en este entorno, documentado explícitamente, no fabricado):**
- RLS con dos sesiones REALMENTE simultáneas (dos navegadores/dispositivos a la vez) — la verificación de esta ronda usó una sesión real + una cuenta descartable simulada por `request.jwt.claims` dentro de una transacción, que prueba RLS/ownership real pero no dos conexiones concurrentes genuinas.
- Concurrencia real (dos requests HTTP disparadas al mismo instante) — la garantía de que `operation_id`/`edit_operation_id` la sostienen sin ambigüedad es una propiedad de Postgres (restricción UNIQUE + `ON CONFLICT`/lock de fila), no algo que este entorno pueda demostrar disparando dos requests genuinamente simultáneas.
- Las 51 aserciones de `lesson_registration_rpc_ownership_test.sql` como suite pgTAP real — cubiertas de forma equivalente (17 verificaciones reales, ver arriba), pero no ejecutadas como pgTAP en sí (la extensión no se instaló sin autorización aparte).
- `Cancelada` (con aviso/tarde) y `Reprogramada` del resultado ad-hoc — confirmado que existen como opciones reales en el móvil (`PendingClassOutcomeSelector.tsx`) pero exigen campos de Fase 5 (`lateCancellationPolicy`/`lateCancellationPercentage`) o duplicarían el reprogramar de Calendario ya construido en Fase 3 — **dependencia explícita de Fase 5, no paridad completa mientras falten.**
- Pequeño detalle cosmético observado en esta ronda: el campo "Duración (min)" de `/registro/nuevo` a veces muestra un valor 1 minuto menor al tecleado justo después de perder el foco (ej. "60" → "59") — el valor real enviado al guardar es siempre correcto (confirmado contra la base), es sólo un artefacto visual del re-render del input numérico controlado. No bloquea el uso; queda anotado para una futura pasada de pulido visual.
- Sin una entrada para RETOMAR un registro ad-hoc abandonado a mitad de camino (nunca finalizado) desde `/registro` — sólo los pendientes ligados a Calendario aparecen ahí; un ad-hoc a medio completar sólo es alcanzable si la profesora recuerda la URL directa. Gap de UX real, documentado, no bloqueante para el alcance de esta fase.

---

## Fase 5 — Cobros

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Mensualidad normal | `monthlyChargeGenerationPlan.ts`, `buildMonthlyCharge` | `/cobros` (hoy `FIXTURE_CHARGES`, 2 registros) | visual ficticio | `payment_charges` | Portar el motor puro sin cambiar reglas (vencimiento día 10, etc.) | Fase 1 | 5 |
| Pago por clase | `perClassChargeGenerationPlan.ts` | — | inexistente | `payment_charges` (`saved_lesson_id`) | — | Fase 4 (`lesson_registrations`) | 5 |
| Cuota de entrenamiento separada + precio por serie | `trainingChargeGenerationPlan.ts`, `TrainingBillingAgreementSheet.tsx` | — | inexistente | `training_billing_agreements`, `payment_charges` (`type='entrenamiento'`) | Portar `buildTrainingBillingConfigurationPlan` (commit `2068b3a`, ronda 3 de esta misma sesión — preview y ejecución YA unificadas, no reintroducir el bug del id de acuerdo distinto) | Fase 1 + Fase 3 (series) | 5 |
| Un cargo por alumno/serie/período; nunca duplicar | `paymentIdempotency.ts`, `buildTrainingChargeId` | — | inexistente | índices únicos parciales (ya escritos, Fase 1) | Pruebas de concurrencia (doble toque, reintento, reinicio) — mismo patrón que `trainingBillingCriticalFlows.test.ts` del móvil | Fase 1 (constraints) | 5 |
| Vencimiento global + etapas de atraso + recargos | `paymentDueStage.ts`, `surchargeSettings.ts` | — | inexistente | `payment_charges`, `surcharge_settings` | Portar `resolveEffectiveSurchargeTierValues` (vigencia diferida por `pendingEffectiveFrom`) | Fase 1 (tabla) | 5 |
| Pagos completos/parciales/retroactivos + distribución | `registerPaymentPlan.ts`, `planPaymentRegistration` | — | inexistente | `payments`, `payment_allocations` | Portar el reparto "obligación más antigua primero" sin cambiarlo | Fase 5 (base) | 5 |
| Registrar/corregir/reemplazar/anular pagos | `RegisterPaymentSheet.tsx`, `VoidPaymentDialog.tsx` | — | inexistente | `payments` (`voided_at`/`replaces_payment_id`) | — | Fase 5 (base) | 5 |
| Condonaciones y ajustes | `SurchargeSettingsPanel.tsx` (condonación puntual) | — | inexistente | `payment_adjustments` | — | Fase 5 (base) | 5 |
| Historial financiero | `PaymentHistorySection.tsx` | — | inexistente | `payments`, `payment_allocations`, `payment_charges` | — | Fase 5 (base) | 5 |
| Alumnos inactivos fuera de nuevos cargos | `selectTrainingChargeCandidates` (regla ESTRICTA: estado actual, no fecha de baja) | — | inexistente | `payment_charges`, `students.status` | Portar la regla exacta (más estricta que la mensualidad de clases — documentada explícitamente en el móvil) | Fase 2 + 5 | 5 |
| Finalizar serie detiene cargos futuros, conserva historial | reutiliza `recurrence_rules.status`/`end_date` (nunca un campo propio) | — | inexistente | `recurrence_rules`, `payment_charges` | — | Fase 3 + 5 | 5 |
| Centro de cobros reactivo | `useCollectionsCenter.ts`, `buildCollectionsCenterEntries` | — | inexistente | vista/consulta sobre `payment_charges`+`payments`+`payment_adjustments` | Portar `buildCollectionsCenterEntries` (función pura) + patrón de revalidación (Next.js: `revalidatePath`/React Query, equivalente a `subscribePayments` del móvil) | Fase 5 (base) | 5 |
| Reemplazar `FIXTURE_CHARGES` | `lib/fixtures.ts` | `/cobros` | visual ficticio | `payment_charges` | — | Cierre de Fase 5 | 5 |

---

## Fase 6 — Inicio

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Clases de hoy / próximas | `buildDashboardData.ts` | `/inicio` (hoy `FIXTURE_TODAY_LESSONS`) | visual ficticio | consulta sobre `calendar_lessons` | Portar `buildDashboardData` (función pura) | Fase 3 | 6 |
| Clases/entrenamientos por registrar | `PendingClass`, `pendingClasses.ts` | — | inexistente | consulta sobre `calendar_lessons`+`lesson_registrations` | — | Fase 4 | 6 |
| Alertas de cobro | `RemindersCenterSummary`, `remindersCenter.ts` | — | inexistente | consulta sobre `payment_charges` | Portar las 4 categorías exactas (`clases_sin_alumnos`, `clases_sin_registrar`, `pagos_por_vencer`, `pagos_vencidos`) | Fase 5 | 6 |
| Accesos rápidos | `QuickActions.tsx` | — | inexistente | — | — | Fase 2-5 | 6 |
| Resúmenes reales | `FinancialSummary`, `useHomeFinancialSummary` | — | inexistente | consulta sobre `payment_charges`+`payments` | — | Fase 5 | 6 |
| Estados vacío/carga/error | — | `/inicio` (ya tiene `EmptyState`) | parcial | — | — | — | 6 |
| Eliminar "datos de ejemplo" | banner en `app/(app)/layout.tsx` | todas las privadas | visual ficticio | — | — | Cierre de Fase 10 (queda hasta que TODAS las fases estén reales) | 6 (contenido) / 10 (banner) |

---

## Fase 7 — Reportes

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Métricas académicas/asistencia/rendimiento | `useFinancialAnalytics.ts`, `calendarAnalytics.ts` | — | inexistente | consultas sobre `lesson_registration_*` | Portar cálculos puros (`CalendarAnalytics`, etc.) | Fase 4 | 7 |
| Métricas financieras / ingresos / deuda | `PeriodFinancialSummary`, `AnnualActivitySummary` | — | inexistente | consultas sobre `payment_charges`+`payments` | — | Fase 5 | 7 |
| Evolución de alumnos | `StudentYearActivitySummary`, `NewStudentsPerMonthSummary` | — | inexistente | consultas sobre `students`+`lesson_registrations` | — | Fase 2 + 4 | 7 |
| Filtros por período | — | — | inexistente | — | — | Fase 7 (base) | 7 |
| Exportaciones (reportes PDF por alumno) | `reportes/` (`buildDeterministicReportNarrative.ts`, nunca IA en producción) | — | inexistente | `report_records` | PDF → Supabase Storage (reemplaza `permanentPdfUri` local); portar narrativa determinística, nunca agregar costo de IA no pedido | Fase 1 (tabla) + Fase 2/4 | 7 |

---

## Fase 8 — Configuración y cuenta

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Perfil de profesora | `AccountScreen.tsx`, `teacherProfileStore.ts` | `/configuracion` (fusiona 3 conceptos, ver `WEB_VISUAL_STRUCTURE.md` §2.12) | visual ficticio | `teacher_profiles` | — | Fase 1 (tabla) | 8 |
| Preferencias / plan 50-30-20 | `budgetDistributionStore.ts` | — | inexistente | `budget_distribution_settings` | Portar `normalizeBudgetDistribution` (suma exacta 100, redondeo "mayor resto") | Fase 1 (tabla) | 8 |
| Disponibilidad (gestión) | `TeacherAvailabilitySheet.tsx` | — | inexistente | `teacher_availability` | — | Fase 3 | 3 u 8 (se gestiona desde Calendario en el móvil) |
| Niveles personalizados (gestión) | `ManageCustomLevelsSheet.tsx` | — | inexistente | `custom_levels` | — | Fase 2 | 2 u 8 |
| Políticas de cobro (recargos) | `SurchargeSettingsPanel.tsx` | — | inexistente | `surcharge_settings` | — | Fase 1 (tabla) | 8 |
| Copias de seguridad | `BackupScreen.tsx` | tarjeta "Respaldo" (no clicable) | visual ficticio | `cloud_backups` (**ya existe**, gestionada por el móvil) | — | Fase 9 | 8/9 |
| Sesiones | `active_sessions` (**ya existe**, RPC ya reales) | — | inexistente | `active_sessions` (**ya existe**) | Conectar UI a las RPC ya existentes, nunca redefinirlas | ninguna (tabla ya existe) | 8 |
| Cambio/recuperación de contraseña | `NewPasswordScreen.tsx`/`ForgotPasswordScreen.tsx` (**web ya implementado**: `/nueva-contrasena`, `/recuperar-contrasena`) | `/nueva-contrasena`, `/recuperar-contrasena` | completo | — | ya probado (`lib/auth/__tests__/*`) | ninguna | ya cerrado |
| Cierre de sesión | `signOutAction` (**web ya implementado**) | `/configuracion` | completo | — | — | ninguna | ya cerrado |
| Eliminación segura de cuenta | RPC `delete_own_account` (**ya existe**) | — | inexistente | — (cascada ya definida server-side) | Conectar UI a la RPC ya existente | ninguna (RPC ya existe) | 8 |

---

## Fase 9 — Backup e importación

Requiere autorización explícita antes de usar un archivo de backup real — no se toca hasta entonces.

| Función | Estado | Tablas | Dependencias |
|---|---|---|---|
| Analizar backup real sin modificarlo | inexistente | — | Fase 1 (`legacy_mobile_id` en toda tabla) |
| Previsualización antes de importar | inexistente | — | Portar `buildRestorePreview`/`analyzeDataIntegrity` (funciones puras) |
| Validar versión/integridad/relaciones | inexistente | — | Portar `restoreValidation.ts` (schemaVersion 1/2, escaneo de claves peligrosas, validación estructural completa) |
| Importación transaccional e idempotente | inexistente | todas | Usar una transacción Postgres real (`BEGIN`/`COMMIT`) — más simple y más fuerte que el snapshot-manual del móvil (AsyncStorage no tiene transacciones reales; Postgres sí) |
| Nunca duplicar si se importa dos veces | inexistente | — | `legacy_mobile_id` + `ON CONFLICT DO UPDATE` (upsert real) |
| Cancelar antes de confirmar | inexistente | — | — |
| Respaldo previo recuperable | inexistente | — | Snapshot previo a la transacción (pg_dump lógico del subconjunto afectado, o tabla de respaldo temporal) |

---

## Fase 10 — Paridad y publicación

Checklist final — no se completa ninguna fila hasta que las Fases 2-9 estén genuinamente completas (almacenamiento + reglas + interfaz + pruebas).

- [ ] Comparación final función por función (recorrer esta matriz completa, todo en estado `completo`)
- [ ] Eliminar `lib/fixtures.ts` y `lib/calendar-fixtures.ts` por completo
- [ ] Quitar el banner "Vista previa con datos ficticios" de `app/(app)/layout.tsx`
- [ ] Verificar que ninguna ruta privada exponga datos ajenos (repetir `supabase/tests/rls_isolation_test.sql` contra el esquema final completo)
- [ ] Responsive 390/768/1440px sin overflow horizontal de página (el `overflow-x-auto` contenido del Calendario, ya correcto, se mantiene)
- [ ] Accesibilidad por teclado
- [ ] Estados de carga/vacío/error/éxito en cada pantalla
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` — verde
- [ ] Despliegue a Vercel
- [ ] Verificación de rutas públicas y privadas en la URL pública
- [ ] Prueba con dos cuentas independientes reales (no sólo pgTAP — de punta a punta en el navegador)
- [ ] Esta matriz actualizada a `completo` en cada fila

---

## Continuación exacta

**Estado al cerrar esta sesión:** Fase 1, Fase 2, Fase 3 y Fase 4 completas y **verificadas con datos reales** (Fase 4 incluye registro ligado a Calendario, registro ad-hoc, notas por habilidad, y auditoría real de ediciones — idempotencia real por `operation_id`/`edit_operation_id`, atomicidad real de la edición, y endurecimiento de seguridad real verificados contra el proyecto real, no supuestos — ver §Cierre de brechas (rondas 2 y 3) en la sección de Fase 4 para el detalle completo). Árbol de la rama `teacherflow-web` limpio salvo `Claude outputs/` (preexistente, ajeno), commit local exclusivo de este cierre de Fase 4 creado, sin push. **Ocho migraciones aplicadas y verificadas**: las cuatro de Fase 2/3, más `20260921120000_lesson_registration_rpcs.sql` y las tres de esta ronda (`20260922100000_adhoc_registration_and_edit_history.sql`, `20260923100000_revoke_anon_execute_lesson_registration_rpcs.sql`, `20260924100000_fix_json_null_attendance_evaluation.sql`).

**No se declara "web terminada" ni "paridad completa" — Cobros (Fase 5) sigue `inexistente`. Dentro de Fase 4, `Cancelada` (con aviso/tarde) y `Reprogramada` del resultado ad-hoc quedan como dependencia explícita de Fase 5 (exigen campos financieros que todavía no existen) o del reprogramar de Calendario ya construido — no se declaran "hechas" ni se omiten en silencio.**

**Genuinamente pendiente, heredado de Fase 3 y sin cambios de fondo en esta ronda:** RLS con dos sesiones REALMENTE simultáneas (dos navegadores/dispositivos a la vez) y concurrencia real contra la base (dos requests HTTP disparadas al mismo instante) — ambos bloqueados por el mismo motivo de entorno (una sola cuenta de prueba disponible en este navegador controlado, sin Docker/CLI de Supabase para correr pgTAP real). Esta ronda sí ejecutó 17 verificaciones reales equivalentes (RLS/ownership/idempotencia/atomicidad, con `begin`/`rollback` reales contra el proyecto real, nunca simuladas) — ver el detalle exacto en la sección de Fase 4. Las 51 aserciones de `lesson_registration_rpc_ownership_test.sql` siguen escritas y validadas, listas para correr como pgTAP real si se autoriza instalar esa extensión.

**Prompt de continuación exacto para la próxima sesión (Fase 5 — Cobros):**

> Continuá TeacherFlow Web con la Fase 5: Cobros, según el plan en `docs/WEB_PARITY_PLAN.md`. Las Fases 1 a 4 (base de datos, Alumnos, Calendario, Registro de clases/entrenamientos — incluido registro ad-hoc, notas por habilidad y auditoría real de ediciones) ya están completas, committeadas y **verificadas con datos reales** en la rama `teacherflow-web` — NO las repitas, usá su HEAD actual como fuente de verdad (nunca un hash viejo de este documento). Las ocho migraciones ya aplicadas (Fase 2/3: `20260920120000_student_mutation_rpcs.sql`, `20260920130000_calendar_mutation_rpcs.sql`, `20260921100000_rpc_hardening_and_participants_from_date.sql`, `20260921110000_fix_participant_loop_type_bug.sql`; Fase 4: `20260921120000_lesson_registration_rpcs.sql`, `20260922100000_adhoc_registration_and_edit_history.sql`, `20260923100000_revoke_anon_execute_lesson_registration_rpcs.sql`, `20260924100000_fix_json_null_attendance_evaluation.sql`) ya están aplicadas contra el proyecto real — no necesitás re-aplicarlas ni pedir autorización para ellas. Leé como fuente obligatoria el estado real del móvil para cobros (`monthlyChargeGenerationPlan.ts`, `perClassChargeGenerationPlan.ts`, `trainingChargeGenerationPlan.ts`, `TrainingBillingAgreementSheet.tsx`, `buildTrainingBillingConfigurationPlan` — commit `2068b3a` del móvil corrigió un bug real del id de acuerdo de previsualización distinto al real, no reintroducirlo — y el resto de módulos de `src/features/payments/`) usando el HEAD actual del móvil, nunca un hash citado en un documento viejo. Fase 4 ya deja preparados `lesson_registrations`/`lesson_registration_students` (ligados a Calendario Y ad-hoc) con datos reales de clases dictadas — usalos como fuente para generar cargos, nunca inventes datos financieros nuevos; `Cancelada`/`Reprogramada` del registro ad-hoc quedaron pendientes justamente por depender de esta fase — revisalas ahí primero. Seguí el mismo patrón de repositorio + Server Actions + RLS ya establecido en Fases 1-4 (no dupliques lógica, no reescribas motores puros ya portados); para cualquier RPC que mute datos, seguí el patrón ya corregido en esta ronda: idempotencia real por un id generado una sola vez en el cliente y persistido (nunca una protección sólo visual), `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` (nunca `SELECT` antes de decidir), atomicidad real en una sola RPC (nunca dos operaciones separadas del cliente para una misma acción lógica), y revisión explícita de `pg_proc.proacl`/`information_schema.role_table_grants` contra el proyecto real antes de asumir que un `revoke` funcionó — `revoke ... from public` NUNCA alcanza para bloquear `anon`, hace falta `revoke ... from anon` explícito. Si escribís un formulario nuevo con Server Actions, revisá primero cómo `app/(app)/calendario/nueva/new-lesson-form.tsx` resuelve la pérdida de campos tras un error del servidor (eco de valores + `useEffect`, nunca ajuste síncrono durante el render). Antes de dar por buena cualquier corrección, revisá si hay un patrón ya establecido en Fases 1-4 para el mismo tipo de error (por ejemplo: `notFound()` siempre fuera de cualquier try/catch; `nullif(x, 'null'::jsonb)` para distinguir JSON null de SQL NULL en cualquier acceso `->` que se compare con `is not null`) en vez de reinventar la solución. Nunca implementes recargos automáticos (decisión de negocio ya desactivada estructuralmente en el móvil, commit `94ce7be` — portar esa misma decisión, no reactivarla). Nunca modifiques la app móvil. No hagas push ni despliegue. Al terminar, actualizá esta matriz (marcando sólo Fase 5 como completa, nunca fases posteriores), creá un commit local exclusivo de Fase 5, y dejá el prompt de continuación exacto para la Fase 6. No declares "web terminada" ni "paridad completa".
