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
| Perfil completo (7 pestañas) | `StudentProfileScreen.tsx` + `tabs/*` | `/alumnos/[id]` | completo (resumen/información/estado/niveles) · pestañas Clases/Tareas/Cobros muestran estado vacío real a la espera de Fase 4/5, nunca datos inventados | `students`, `student_status_history`, `student_level_history`, `student_price_history` | — | Fase 2 (base) + Fase 4 (clases/cobros dentro del perfil) | 2 (resumen/información), 4/5 (pestañas cruzadas) |
| Buscar | `SearchBar.tsx`, `matchesStudentSearch` (motor único de búsqueda) | `/alumnos` | parcial — puerto de `matchesStudentSearch` (normalización, prefijo, multi-palabra) sin la capa de tolerancia a typos (Damerau-Levenshtein) ni iniciales; diferencia conocida, documentada en el commit, no silenciada | — | `lib/students/__tests__/search.test.ts` | — | 2 |
| Filtros y orden | `FiltersPanel.tsx`, `StudentsFilterState` | `/alumnos` | completo | — | `filters.test.ts` (`DEFAULT_FILTER_STATE.status='activo'` confirmado) | — | 2 |
| Estados activo/pausado/inactivo/archivado | `ChangeStatusSheet.tsx`, `applyStatusChange` | `/alumnos/[id]` | completo (cambio de estado + historial) — poda de series futuras al archivar (`removeFromFuture`) queda para cuando exista `recurrence_rules` con datos reales de una profesora, no bloquea el cierre de Fase 2 | `students`, `student_status_history` | — | Fase 3 (recurrencia, para la poda) | 2 (cambio simple), 3 (poda) |
| Niveles estándar y personalizados | `customLevelsCore.ts`, `CreateCustomLevelSheet.tsx` | `/alumnos/[id]`, gestión desde perfil | completo | `custom_levels` | — | Fase 1 (tabla) | 2 |
| Modalidad / información académica | `InformacionTab.tsx` | `/alumnos/[id]` | completo | `students` | — | Fase 2 (base) | 2 |
| Próxima clase | derivado, no almacenado | `/alumnos/[id]` | inexistente — requiere `calendar_lessons` real (Fase 3, ahora disponible) pero la vista SQL/consulta todavía no se conectó al perfil | vista SQL sobre `calendar_lessons` | Consulta, nunca columna (decisión de arquitectura, ver Fase 1) | Fase 3 | 2/3 |
| Historial (clases) | `ClasesTab.tsx`, `buildStudentSessionHistory` | — | inexistente | `lesson_registrations` | — | Fase 4 | 2/4 |
| Tareas y anotaciones | `TareasTab.tsx`, `homeworkPendingDomain.ts` | — | inexistente | `lesson_registration_homework_reviews` | Portar `task_id` estable (`common:<id>`/`individual:<id>:<studentId>`) sin reinventarlo | Fase 4 | 2/4 |
| Estado de pago | derivado (`PaymentStatus`, semáforo 4 colores) | — | inexistente | vista SQL sobre `payment_charges`/`payments` | Portar `calculateChargeState`/etapas de vencimiento sin cambiar los días/porcentajes | Fase 5 | 2/5 |
| Archivar/restaurar/eliminar | `studentArchiveService.ts`, `studentDeletionCascade.ts` (10 colecciones) | `/alumnos/[id]` | parcial — archivar/restaurar reales y probados; la cascada completa de 10 colecciones sólo puede cerrarse cuando existan todas esas tablas con datos (Fases 3-5) | todas las que referencian `student_id` | Cascada completa: portar `studentDeletionCascade.ts` función por función, nunca una reimplementación aproximada | Fase 2-5 (según qué tablas ya existan con datos) | 2 |
| Alumnos inactivos fuera de cobros nuevos | `selectTrainingChargeCandidates`, `isStudentBillableForPeriod` | — | inexistente | `payment_charges` | Ya replicado en el esquema (ver Fase 5); portar la función pura exacta | Fase 5 | 5 |
| Reemplazar `FIXTURE_STUDENTS` | `lib/fixtures.ts` | `/alumnos`, `/inicio`, `/cobros` | `/alumnos` completo — `/inicio` y `/cobros` todavía usan otros fixtures propios (`FIXTURE_TODAY_LESSONS`, `FIXTURE_CHARGES`), pendientes de sus propias fases | `students` | — | Cierre de Fase 2 | 2 |

**Migración aplicada y verificada:** `supabase/migrations/20260920120000_student_mutation_rpcs.sql` (`rename_custom_level`, `change_student_status`) — aplicada por el usuario vía `supabase db push`, confirmada por sondeo real contra PostgREST (las dos RPC existen y responden `403`/`28000` "No hay una sesión autenticada" ante una llamada anónima con payload correctamente formado — antes daban `404 PGRST202`). Auditoría de seguridad posterior encontró que ninguna de las dos tenía `revoke ... from public` (Postgres otorga EXECUTE a PUBLIC por defecto al crear una función) — corregido en `20260921100000_rpc_hardening_and_participants_from_date.sql` (también aplicada y verificada).

**Verificación visual:** completa con sesión real (ver §Verificación real de esta ronda en la sección de Fase 3, más abajo) — listado, crear, editar, perfil, búsqueda, filtros, los 4 estados, niveles personalizados con renombrado en cascada verificado end-to-end, recarga directa, navegación atrás/adelante, ID manipulado, todo probado con datos reales y funcionando. typecheck/lint/tests/build en verde.

---

## Fase 3 — Calendario — **parcial, bloqueada por un bug real de datos hasta aplicar una migración correctiva pendiente** (ver §Verificación real de esta ronda, abajo)

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Vistas semanal/diaria + navegación | `CalendarTabScreen.tsx`, `WeekTimeGrid.tsx` | `/calendario` (semana y día, navegación por query string, zona horaria Argentina real) | completo | `calendar_lessons`, `recurrence_rules`, `recurrence_exceptions` | `lib/calendar/__tests__/timezone.test.ts` (7), `recurrence-engine.test.ts` (9), `occurrences.test.ts` (6) | Fase 1 | 3 |
| Crear clase única | `NewCalendarLessonSheet.tsx` | `/calendario/nueva` | completo y **verificado con datos reales** (creación, conflicto real, clases consecutivas sin falso conflicto, disponibilidad bloqueando/permitiendo) | `calendar_lessons` | RPC `create_calendar_lesson` validada con `libpg-query` y probada end-to-end en el navegador | Fase 1 | 3 |
| Crear serie (ciclos de 1 a 4 semanas) | `NewCalendarLessonSheet.tsx`, `splitRecurrenceFromDate` | `/calendario/nueva` | UI completa (`WeekdayScheduleEditor`, selector de ciclo 1-4 semanas, cada semana con su propio día/horario) pero **rota en runtime** — ver bug real en §Verificación real de esta ronda; nunca se había probado con datos reales hasta esta ronda | `calendar_lessons`, `recurrence_rules`, `recurrence_rule_participants` | `recurrence-engine.test.ts` (lógica pura, sigue verde); RPC `create_recurrence_series` validada sintácticamente con `libpg-query` pero el bug es de tipo en tiempo de ejecución, invisible para el parser | Fase 1 | 3 |
| Individuales/grupales, entrenamientos, participantes múltiples | `AddParticipantsSheet.tsx`, `EditActivityKindSheet.tsx` | `/calendario/nueva` | completo — sólo alumnos ACTIVOS son candidatos nuevos; `activityKindSupportsHomework` portado exacto | `calendar_lesson_participants`, `recurrence_rule_participants` | `lib/calendar/__tests__/mutations.test.ts` | Fase 3 (base) | 3 |
| Disponibilidad | `TeacherAvailabilitySheet.tsx`, `teacherAvailabilityEngine.ts` | `/calendario/disponibilidad` | completo | `teacher_availability` | `lib/calendar/__tests__/availability.test.ts` (8) | Fase 1 (tabla) | 3 |
| Conflictos de horario / consecutivas sin falsa superposición | `calendarConflicts.ts` (puerto: `lib/calendar-conflicts.ts`) | `/calendario/nueva`, Server Action `checkConflictsAndAvailability` | completo — conectado a creación real, `<`/`>` estrictos (clases consecutivas nunca chocan) | — | 7 pruebas previas + reutilizadas sin reescritura | ninguna | 3 |
| Editar una clase / editar toda la serie / "esta y las siguientes" | `EditFutureRecurrenceSheet.tsx`, `applyFuturePatternFromDate`, `planActivityKindThisAndFutureSplit` | `/calendario/series` ("Editar futuras" para el patrón, "Modificar participantes" para el roster) | UI y algoritmo completos (split de patrón con idempotencia relacional real; cambio de participantes vía `apply_recurrence_participants_from_date`, puerto real de `planParticipantsFromDate`, congela el roster viejo antes de cambiar la regla) pero **"editar futuras" está roto en runtime por el mismo bug que crear serie** (afecta a `split_recurrence_this_and_future` cuando hay al menos un participante, que es siempre) — nunca antes probado con datos reales; "modificar participantes" no se pudo verificar en esta ronda porque depende de tener una serie real creada primero | `recurrence_rules`, `recurrence_exceptions`, `calendar_lessons` | `lib/calendar/__tests__/split.test.ts` (9), `lineage.test.ts` (7), `participants-split.test.ts` (4) — lógica pura sigue verde, el bug es de tipo SQL en runtime | Fase 3 (base) | 3 |
| Pausar/reanudar/finalizar series | `RecurrenceRulesSheet.tsx`, `selectManageableRecurrenceSeries` | `/calendario/series` | completo — agrupación por LINAJE real (`supersedesRecurrenceId`), nunca por `studentId` ni por coincidencia de `undefined`; botón "Ir a la última serie" para listas largas | `recurrence_rules` | `lineage.test.ts` (7) | Fase 3 (base) | 3 |
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

**No implementado deliberadamente en esta fase (pertenece a Fase 4/5, nunca simulado):** ningún cargo, cuota, ni registro de clase dictada se genera desde el Calendario. Finalizar una serie detiene sus ocurrencias futuras pero no toca `payment_charges` (no existen filas de calendario ligadas a cobros todavía). `activityKind='training'` puede más adelante enlazarse a `training_billing_agreements` (Fase 5) — el campo existe en el esquema, la web no lo usa todavía.

**Cobertura de pruebas:** 55 pruebas nuevas de lógica pura en `lib/calendar/__tests__/` (timezone 7, recurrence-engine 9, availability 8, lineage 7, split 9, occurrences 6, mutations 5, participants-split 4), sumadas a las 83 de Fase 1/2 → **138 pruebas totales, todas verdes**. Pruebas pgTAP nuevas (`supabase/tests/calendar_rpc_ownership_test.sql`, 12 aserciones) cubriendo específicamente las referencias cruzadas de propietario corregidas en las RPC — escritas y validadas con `libpg-query`, **todavía no ejecutadas** (mismo bloqueo de entorno sin Docker/CLI que `rls_isolation_test.sql` de Fase 1). No hay pruebas de concurrencia real contra la base (dos splits simultáneos, reintento a mitad de operación) — mismo bloqueo, pendiente real.

### Verificación real de esta ronda (sesión de prueba real, datos ficticios "QA")

Primera vez que se prueban Alumnos y Calendario con una sesión real autenticada en el navegador. Resultado: la mayoría de las funciones probadas funcionan correctamente de punta a punta; se encontraron 3 problemas reales, los tres documentados acá, uno de ellos crítico y bloqueante.

**Alumnos — todo lo probado funcionó correctamente:** listado (vacío y con datos), crear, editar, ver perfil, cambiar estado (pausado/archivado/restaurar, incluida la regla de que sólo se puede "restaurar" desde un estado no-activo, nunca saltar directo entre dos estados no-activos), niveles personalizados (crear + **renombrar en cascada verificado end-to-end**: el cambio se reflejó tanto en el selector de filtros como en la ficha del alumno, confirmando que `rename_custom_level` funciona con datos reales), búsqueda, filtros, recarga directa de URL (incluida con `?tab=`), navegación atrás/adelante, ID inexistente/manipulado → 404 genérico. Consola sin errores propios de la app.

**Calendario — funcionó correctamente:** vista semana/día, navegación, "Hoy", crear clase única, disponibilidad (bloqueo semanal creado y **verificado real**: una clase dentro del bloqueo fue rechazada con el motivo correcto, una fuera del bloqueo se permitió), conflicto real detectado (clase superpuesta rechazada), **clases consecutivas sin falso conflicto** (14-15 y 15-16 ambas creadas sin problema), cancelar, reprogramar con vista previa real (horario nuevo mostrado antes de confirmar), reemplazar con otro alumno (la clase cancelada quedó oculta, el reemplazo visible completo — regla de las 4 condiciones confirmada con datos reales), `redirect()` tras crear/reemplazar (ver bug #1 abajo, ya corregido).

**Bug #1 (corregido en esta ronda, ya committeado):** `createSingleLessonAction`/`createRecurrenceSeriesAction` nunca redirigían tras un guardado exitoso — el formulario quedaba abierto sin ninguna confirmación visual, aunque la clase/serie sí se hubiera creado. Encontrado al crear la primera clase de prueba (se creó correctamente pero la pantalla no daba ninguna señal). Corregido agregando `redirect("/calendario")` fuera del `try/catch` en ambas acciones.

**Bug #2 (crítico, migración correctiva escrita y pendiente de autorización/aplicación):** `create_recurrence_series` y `split_recurrence_this_and_future` fallan siempre que `participant_ids` tenga al menos un elemento (es decir, siempre en uso real) con `22P02 invalid input syntax for type json`. Causa: la variable de bucle que recorre `jsonb_array_elements_text(p_payload->'participant_ids')` estaba declarada `jsonb` en vez de `text` — `jsonb_array_elements_text` devuelve texto plano, y asignarlo a una variable `jsonb` fuerza un cast implícito que falla porque un uuid sin comillas no es JSON válido. Este bug ya estaba en la migración original de Fase 3 (nunca antes probada con datos reales) y se heredó sin querer al reescribir esas dos funciones en la migración correctiva de seguridad. Efecto real: **crear una serie y "editar futuras" (esta y las siguientes) no funcionan en producción todavía**, pese a que toda la lógica pura y la UI están completas y probadas por separado. Migración correctiva: `supabase/migrations/20260921110000_fix_participant_loop_type_bug.sql`, validada con `libpg-query`, pendiente de `supabase db push` con autorización explícita del usuario.

**Bug #3 (UX, no bloqueante, documentado sin corregir en esta ronda):** en `/calendario/nueva`, cuando el servidor rechaza el envío (conflicto, disponibilidad, error de datos), el formulario pierde los campos ya completados que son inputs no controlados (fecha, alumno seleccionado) — el usuario tiene que volver a completar todo el formulario, no sólo corregir el campo que causó el error. Encontrado al reintentar un envío tras un rechazo por disponibilidad. No se corrigió en esta ronda (requeriría convertir el formulario a totalmente controlado, cambio de alcance moderado); queda como pendiente real para una próxima fase.

**Hallazgo menor (no corregido, de bajo impacto):** un recurso devuelve `404` y aparece un error cosmético de instrumentación de Turbopack (`Failed to execute 'measure' on 'Performance'`) en la consola del navegador en modo desarrollo — no afecta ninguna funcionalidad observada, probablemente un artefacto del entorno de desarrollo, no del código de la aplicación.

**Datos de prueba creados durante esta verificación:** un alumno ficticio ("QA Alumno Editado", ex "QA Alumno Prueba"), un nivel personalizado ("Grupo QA Renombrado", ex "Grupo QA"), varias clases sueltas de prueba (creadas/canceladas/reprogramadas/reemplazadas) y un bloqueo semanal de disponibilidad (jueves 10:00–12:00, motivo "Trabajo"). La aplicación todavía no tiene un mecanismo de eliminación permanente de alumnos (sólo archivar, ver Fase 2) — no existe una forma segura y probada de borrarlos, así que **quedan identificados por el nombre "QA" y no se eliminaron**, tal como autorizó el pedido de esta ronda ante la falta de ese mecanismo.

**No verificado en esta ronda (pendiente real, no fabricado):**
- Pantalla Series con datos reales (pausar/reanudar/finalizar/editar futuras/modificar participantes/varias series/scroll) — bloqueada por el Bug #2, no se pudo crear ninguna serie real para probarla.
- RLS con dos sesiones reales — sólo había disponible una cuenta de prueba en esta ronda; las pruebas pgTAP (`rls_isolation_test.sql`, `calendar_rpc_ownership_test.sql`) cubren esto de forma automatizada pero siguen sin ejecutarse (sin Docker/CLI en este entorno).
- Concurrencia real contra la base (doble toque simultáneo, dos splits a la vez, interrupción a mitad de operación) — requiere dos requests verdaderamente simultáneas, no reproducible de forma confiable desde una sesión de navegador manual.

**Verificación visual:** bloqueada en esta ronda también — ver nota de bloqueo en el informe de cierre (el navegador controlado por Claude no logró obtener sesión iniciada). typecheck/lint/tests/build sí se verificaron en verde en cada ronda.

---

## Fase 4 — Registro de clases y entrenamientos

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Clases por registrar | `PendingClasses.tsx`, `pendingClasses.ts` | — | inexistente | consulta sobre `calendar_lessons` + `lesson_registrations` | — | Fase 3 | 4 |
| Registro individual/grupal | `NewClassScreen.tsx`, `RegisterPendingClassSheet.tsx` | — | inexistente | `lesson_registrations`, `lesson_registration_students` | — | Fase 3 | 4 |
| Asistencia y resultado por participante | `AttendanceSection.tsx`, `StudentAttendanceEntry` | — | inexistente | `lesson_registration_attendance` | — | Fase 4 (base) | 4 |
| Tareas pendientes | `HomeworkSection.tsx`, `homeworkPendingDomain.ts` | — | inexistente | `lesson_registration_homework_reviews` | Portar el esquema de `task_id` estable, nunca inventar uno nuevo | Fase 4 (base) | 4 |
| Notas / calificación | `EvaluationSection.tsx`, `SkillGradeChips.tsx`, `calculateAverageGrade` | — | inexistente | `lesson_registration_evaluations` | Regla congelada: 0 nunca es nota real (`general_grade`/`skill_grades` NULL, nunca 0 — ya reflejado en el constraint CHECK) | Fase 4 (base) | 4 |
| Duración real | `ChangeLessonDurationSheet.tsx` | — | inexistente | `lesson_registrations` (`actual_started_at`/`actual_ended_at`) | — | Fase 4 (base) | 4 |
| Entrenamientos sin tareas cuando no corresponda | `activityKindSupportsHomework` | — | inexistente | — | Portar la función pura exacta (sólo `'class'` admite tareas) | Fase 4 (base) | 4 |
| Completar participantes de forma independiente | `ParticipantRegistrationBlock.tsx`, `groupProgress` | — | inexistente | `lesson_registration_students`/`attendance`/`evaluations` | — | Fase 4 (base) | 4 |
| Finalizar registro / editar registros | `EditRegisteredLessonSheet.tsx` | — | inexistente | `lesson_registrations` (+ hijas) | — | Fase 4 (base) | 4 |
| Conservar historial académico | — | — | inexistente | mismas tablas (append/update, nunca se borra un registro ya completado) | — | Fase 4 (base) | 4 |

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

**Estado al cerrar esta sesión:** Fase 1, Fase 2 y Fase 3 completas (con las validaciones/gaps documentados en cada sección arriba). Árbol de la rama `teacherflow-web` limpio salvo archivos temporales preexistentes ajenos a esta fase, commits locales creados, sin push. Dos migraciones SQL escritas y con sintaxis validada pero **todavía no aplicadas** contra el proyecto real: `20260920120000_student_mutation_rpcs.sql` (Fase 2) y `20260920130000_calendar_mutation_rpcs.sql` (Fase 3) — ver comandos exactos en §Validación pendiente (Fase 1). Web pública sin desplegar cambios de esta sesión.

**No se declara "web terminada" ni "paridad completa" — Registro de clases (Fase 4) y Cobros (Fase 5) siguen `inexistente`.**

**Prompt de continuación exacto para la próxima sesión (Fase 4 — Registro de clases y entrenamientos):**

> Continuá TeacherFlow Web con la Fase 4: Registro de clases y entrenamientos, según el plan en `docs/WEB_PARITY_PLAN.md`. Las Fases 1, 2 y 3 (base de datos, Alumnos, Calendario) ya están completas y committeadas en la rama `teacherflow-web` — NO las repitas, usá su HEAD actual como fuente de verdad (nunca un hash viejo de este documento). Dos migraciones (`20260920120000_student_mutation_rpcs.sql` y `20260920130000_calendar_mutation_rpcs.sql`) están escritas pero probablemente **todavía no aplicadas** contra el proyecto real — confirmá con el usuario si ya corrió `supabase db push`, y si no, no bloquees el desarrollo por eso (las Server Actions ya están escritas contra esas RPC; sólo fallarán en producción hasta que se apliquen). Leé como fuente obligatoria el estado real del móvil (`NewClassScreen.tsx`, `RegisterPendingClassSheet.tsx`, `AttendanceSection.tsx`, `HomeworkSection.tsx`, `EvaluationSection.tsx`, `ChangeLessonDurationSheet.tsx`, `EditRegisteredLessonSheet.tsx`, `activityKindSupportsHomework`, `homeworkPendingDomain.ts`, `calculateAverageGrade` — usando el HEAD actual del móvil, nunca un hash citado en un documento viejo). Implementá: clases por registrar (derivado de `calendar_lessons` real de Fase 3, ya disponible), registro individual/grupal, asistencia y resultado por participante, tareas pendientes (portando el esquema `task_id` estable sin reinventarlo), notas/calificación (regla: 0 nunca es nota real, ya reflejada en el CHECK de Fase 1), duración real, entrenamientos sin tareas cuando no corresponda, completar participantes de forma independiente, finalizar/editar registros, y preservar historial académico (nunca borrar un registro completado). Seguí el mismo patrón de repositorio + Server Actions + RLS ya establecido en Fases 1-3 (no dupliques lógica, no reescribas motores puros ya portados). No implementes el motor financiero de Fase 5 ni generes cargos desde el registro de clases — sólo preparar los datos que Fase 5 va a necesitar. Nunca modifiques la app móvil. No hagas push ni despliegue. Al terminar, actualizá esta matriz (marcando sólo Fase 4 como completa, nunca Fase 5), creá un commit local exclusivo de Fase 4, y dejá el prompt de continuación exacto para la Fase 5 — Cobros. No declares "web terminada" ni "paridad completa".
