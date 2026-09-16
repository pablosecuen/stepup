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

## Fase 2 — Alumnos

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Listado real con estado | `StudentsListScreen.tsx`, `studentStore.ts` | `/alumnos` (hoy `FIXTURE_STUDENTS`) | visual ficticio | `students` | Repositorio: filtros/orden puros + integración con Supabase (adaptador falso) | Fase 1 (esquema) | 2 |
| Crear alumno | `NewStudentScreen.tsx` (sin `studentId`), `studentMapper.ts` | nueva ruta `/alumnos/nuevo` | inexistente | `students` | Validación (`validateNewStudentInput`, ya escrita y probada), integración real de `createStudent` | Fase 1 (repositorio ya escrito) | 2 |
| Editar alumno | `NewStudentScreen.tsx` (con `studentId`) | nueva ruta `/alumnos/[id]/editar` | inexistente | `students` | `updateStudent` (repositorio ya escrito), UI | Fase 1 | 2 |
| Perfil completo (7 pestañas) | `StudentProfileScreen.tsx` + `tabs/*` | nueva ruta `/alumnos/[id]` | inexistente | `students`, `student_status_history`, `student_level_history`, `student_price_history` | Por pestaña — ver `docs/WEB_VISUAL_STRUCTURE.md` §2.14 | Fase 2 (base) + Fase 4 (clases/cobros dentro del perfil) | 2 (resumen/información), 4/5 (pestañas cruzadas) |
| Buscar | `SearchBar.tsx`, `matchesStudentSearch` (motor único de búsqueda) | — | inexistente | — | Portar función pura `matchesStudentSearch` sin reescribirla | — | 2 |
| Filtros y orden | `FiltersPanel.tsx`, `StudentsFilterState` | — | inexistente | — | Portar filtros puros; `DEFAULT_FILTER_STATE.status = 'activo'` (regla confirmada, no inventar) | — | 2 |
| Estados activo/pausado/inactivo/archivado | `ChangeStatusSheet.tsx`, `applyStatusChange` | — | inexistente | `students`, `student_status_history` | `changeStudentStatus` (repositorio ya escrito) — falta poda de series futuras al archivar con `removeFromFuture` | Fase 3 (recurrencia, para la poda) | 2 (cambio simple), 3 (poda) |
| Niveles estándar y personalizados | `customLevelsCore.ts`, `CreateCustomLevelSheet.tsx` | — | inexistente | `custom_levels` | Duplicado insensible a mayúsculas (constraint ya escrito) + cascada de renombrado (`renameStudentsLevel`, lógica de repositorio) | Fase 1 (tabla) | 2 |
| Modalidad / información académica | `InformacionTab.tsx` | — | inexistente | `students` | — | Fase 2 (base) | 2 |
| Próxima clase | derivado, no almacenado | — | inexistente | vista SQL sobre `calendar_lessons` | Consulta, nunca columna (decisión de arquitectura, ver Fase 1) | Fase 3 | 2/3 |
| Historial (clases) | `ClasesTab.tsx`, `buildStudentSessionHistory` | — | inexistente | `lesson_registrations` | — | Fase 4 | 2/4 |
| Tareas y anotaciones | `TareasTab.tsx`, `homeworkPendingDomain.ts` | — | inexistente | `lesson_registration_homework_reviews` | Portar `task_id` estable (`common:<id>`/`individual:<id>:<studentId>`) sin reinventarlo | Fase 4 | 2/4 |
| Estado de pago | derivado (`PaymentStatus`, semáforo 4 colores) | — | inexistente | vista SQL sobre `payment_charges`/`payments` | Portar `calculateChargeState`/etapas de vencimiento sin cambiar los días/porcentajes | Fase 5 | 2/5 |
| Archivar/restaurar/eliminar | `studentArchiveService.ts`, `studentDeletionCascade.ts` (10 colecciones) | — | inexistente | todas las que referencian `student_id` | Cascada completa: portar `studentDeletionCascade.ts` función por función, nunca una reimplementación aproximada | Fase 2-5 (según qué tablas ya existan con datos) | 2 |
| Alumnos inactivos fuera de cobros nuevos | `selectTrainingChargeCandidates`, `isStudentBillableForPeriod` | — | inexistente | `payment_charges` | Ya replicado en el esquema (ver Fase 5); portar la función pura exacta | Fase 5 | 5 |
| Reemplazar `FIXTURE_STUDENTS` | `lib/fixtures.ts` | `/alumnos`, `/inicio`, `/cobros` | visual ficticio | `students` | — | Cierre de Fase 2 | 2 |

---

## Fase 3 — Calendario

| Función móvil | Archivo/módulo móvil | Ruta/componente web | Estado | Tablas | Pruebas | Dependencias | Fase |
|---|---|---|---|---|---|---|---|
| Vistas semanal/diaria + navegación | `CalendarTabScreen.tsx`, `WeekTimeGrid.tsx` | `/calendario` (hoy `CALENDAR_FIXTURE_LESSONS`, sólo semanal) | visual ficticio | `calendar_lessons` | — | Fase 1 | 3 |
| Crear clase única / serie | `NewCalendarLessonSheet.tsx`, `splitRecurrenceFromDate` | — | inexistente | `calendar_lessons`, `recurrence_rules`, `recurrence_rule_participants` | Portar `calendarRecurrenceEngine.ts`/`calendarRecurrenceSplit.ts` SIN reescribir el algoritmo — motor puro, mismo criterio en toda la app | Fase 1 | 3 |
| Individuales/grupales, entrenamientos, participantes múltiples | `AddParticipantsSheet.tsx`, `EditActivityKindSheet.tsx` | — | inexistente | `calendar_lesson_participants`, `recurrence_rule_participants` | — | Fase 3 (base) | 3 |
| Disponibilidad | `TeacherAvailabilitySheet.tsx`, `teacherAvailabilityEngine.ts` | — | inexistente | `teacher_availability` | Portar el motor puro de disponibilidad tal cual (jsonb ya espeja la forma exacta) | Fase 1 (tabla) | 3 |
| Conflictos de horario / consecutivas sin falsa superposición | `calendarConflicts.ts` (**web ya tiene un puerto**: `lib/calendar-conflicts.ts`, probado, "preparado pero no conectado") | `/calendario` | parcial (función lista, sin conectar) | — | Ya hay 7 pruebas reales (`lib/__tests__/calendar-conflicts.test.ts`) — conectar, no reescribir | ninguna | 3 |
| Editar una clase / editar toda la serie / "esta y las siguientes" | `EditFutureRecurrenceSheet.tsx`, `applyFuturePatternFromDate`, `planActivityKindThisAndFutureSplit` | — | inexistente | `recurrence_rules`, `recurrence_exceptions` | Portar sin cambiar el algoritmo de split (8 pasos documentados en el móvil, ver commits `896d64a…`/`0119963…` de esta misma sesión) | Fase 3 (base) | 3 |
| Pausar/reanudar/finalizar series | `RecurrenceRulesSheet.tsx`, `selectManageableRecurrenceSeries` | — | inexistente | `recurrence_rules` | Portar `selectManageableRecurrenceSeries` (agrupación por LINAJE, nunca por `studentId` — bug ya corregido en el móvil, commit `9a22cea`) | Fase 3 (base) | 3 |
| Cancelar / reprogramar / reemplazar | `CalendarLessonActionsSheet.tsx`, `SelectLessonToRescheduleSheet.tsx` | `/calendario` (modal "Demo", sin persistencia) | visual ficticio | `calendar_lessons`, `recurrence_exceptions` | Reglas de reemplazo (`freedByLessonId`, 4 condiciones — ver `CLAUDE.md` móvil) portadas EXACTAS | Fase 3 (base) | 3 |
| Estados completada/pendiente/cancelada/reprogramada + historial | `CalendarLessonStatus` | `/calendario` | visual ficticio | `calendar_lessons`, `recurrence_exceptions` | — | Fase 3 (base) | 3 |
| Escala de colores congelada | `calendarVisualLegend.ts` (**web ya tiene un puerto**: `lib/calendar-theme.ts`) | `/calendario` | completo (visual) | — | — | ninguna | ya cerrado |
| Reemplazar `CALENDAR_FIXTURE_LESSONS` | `lib/calendar-fixtures.ts` | `/calendario`, `/inicio` | visual ficticio | `calendar_lessons` | — | Cierre de Fase 3 | 3 |

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

**Estado al cerrar esta sesión:** Fase 1 completa (con la validación pendiente documentada arriba). Árbol de la rama `teacherflow-web` limpio, commit local creado, sin push. Web pública (`https://teacherflow-web.vercel.app`) sin cambios de este trabajo todavía (Fase 1 es sólo esquema/repositorios, sin UI nueva que desplegar).

**Prompt de continuación exacto para la próxima sesión (Fase 2 — Alumnos):**

> Continuá TeacherFlow Web desde la Fase 2 (Alumnos) del plan en `docs/WEB_PARITY_PLAN.md`. La Fase 1 (base de datos y arquitectura) ya está completa en el commit `<HASH_DEL_COMMIT_DE_ESTA_SESIÓN>` de la rama `teacherflow-web` — NO la repitas. Las migraciones de `supabase/migrations/` están escritas y con sintaxis validada pero **nunca se aplicaron contra una base real** (sin Docker/Supabase CLI en el entorno anterior) — antes de escribir código que dependa de datos reales, confirmá con el usuario si ya aplicó `supabase db push` él mismo, o si necesitás pedirle que lo haga (nunca lo hagas vos con credenciales que no tenés). Implementá la Fase 2 completa: listado real, crear/editar alumno, perfil completo, buscar, filtros/orden, los 4 estados con historial, niveles estándar/personalizados, y reemplazá `FIXTURE_STUDENTS` por completo — reutilizando el patrón de repositorio ya escrito en `lib/repositories/students.ts`/`students-mapping.ts` (no dupliques esa lógica). Seguí todas las reglas generales del pedido original (aislamiento por usuario, RLS, sin datos ficticios después de conectar, sin rediseño visual, commits locales por fase, sin push). Al terminar, informá igual que en esta fase y dejá el prompt de continuación exacto para la Fase 3.
