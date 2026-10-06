# R2 — Inventario de consultas (disponibilidad e integridad con grandes volúmenes)

Alcance: toda lectura PostgREST de la web (`lib/repositories/*`, Server Actions, páginas, cargadores) y las RPC. Todo el acceso a
datos pasa por los repositorios (ningún componente ni página llama a `supabase.from` directamente: lo verifica una guarda).

**`max_rows`.** El valor *declarado localmente* es `max_rows = 1000` (`supabase/config.toml`). El valor *remoto* es **desconocido**
(no se leyó el panel de Supabase): ningún código de R2 lo asume — la lectura completa funciona igual con cualquier tope, incluso uno
menor que el tamaño de página (probado con topes de 7, 100, 250 y 333).

## Cómo se leyó antes y cómo se lee ahora

| Antes (hasta `c010627`) | Ahora |
|---|---|
| 50 `select("*")` y sólo 2 `.limit(1)`: cualquier lista se cortaba **en silencio** al llegar a `max_rows` | `readTable`/`readRpc` (`lib/db/read.ts`): página de 500, con recuento exacto y paginación **por clave** (orden estable con `id` como desempate). Error visible si cualquier página falla. |
| 17 `.in(<ids>)` sin límite (con ~210 uuid la URL supera los ~8 KB del gateway y falla) | `readTableByIds`: lotes de ≤ 100 ids y ≤ 4.500 caracteres, sin repetidos; cada lote paginado; un fallo en cualquier lote falla toda la lectura. Quedan 1 `.in("status", ["active","paused"])` constante. |
| Totales/saldos calculados sobre listas posiblemente truncadas | Listas completas (o saldos abiertos calculados en la base por `list_open_charge_balances`) |
| 4 pantallas escribían al renderizarse | Ninguna lectura escribe (ver "GET que escribían") |

Cuenta chica (≤ 500 filas): **una sola petición**, con el mismo orden de la consulta original y el mismo resultado de antes.
Cuenta grande: 501 filas → 4 peticiones, 1.500 → 5, 3.000 → 8 (1 de descarte + páginas + 1 vacía de cierre); antes 1 petición que devolvía
sólo 1.000 filas desde la fila 1.001.

## Clasificación y estrategia por consulta

Categorías: **L** lista paginable para la interfaz · **C** conjunto completo necesario para un cálculo · **F** limitada por fecha ·
**A** agregación que debe ejecutarse en SQL · **I** consulta por lista de ids · **U** una sola fila (sin riesgo de truncado).

| Archivo · función | Cat. | Estrategia |
|---|---|---|
| `students.ts` · `listStudents` | C/L | lectura completa por páginas, orden (nombre, id). Alumnos la muestra completa (filtros del cliente) |
| `students.ts` · `getStudent`, alta/edición/estado | U / escritura | sin cambios |
| `calendar-lessons.ts` · `listCalendarLessonsInRange` | F | ventana `start_at` en la base + páginas |
| `calendar-lessons.ts` · `listCalendarLessonsForRecurrence` | C | páginas (una serie puede superar 1.000 ocurrencias materializadas) |
| `calendar-lessons.ts` · `attachParticipants`, `listLessonParticipantRows` | I | lotes de 100 ids + páginas por lote |
| `calendar-lessons.ts` · `listLooseFutureScheduledLessonsForStudent` | C + I | páginas (primario y participaciones) + lotes de ids |
| `calendar-lessons.ts` · `hasAnyCalendarLesson` | U | `limit(1)` (ya acotada) |
| `recurrence-rules.ts` · `listRecurrenceRules`, `listActiveRecurrenceRulesForStudent` | C | páginas |
| `recurrence-rules.ts` · `attachParticipants`, `listRuleParticipantsWithCreatedAt` | I | lotes |
| `recurrence-exceptions.ts` · `listRecurrenceExceptionsForRules` | I | lotes de ids de series (con muchas series la URL fallaba) |
| `payments.ts` · `listAllCharges`, `listAllPayments`, `listAllAllocations`, `listTrainingBillingAgreements` | C | páginas (orden vencimiento / más reciente primero) — base de Resumen financiero |
| `payments.ts` · `listChargesForStudent/PaymentsForStudent/AllocationsForStudent` | L | páginas (pestaña Cobros del alumno) |
| `payments.ts` · `listTrainingAgreementCharges` (nuevo, privado) | C | sólo cargos de entrenamiento con acuerdo (antes bajaba **todos** los cargos para filtrarlos en TypeScript) |
| `payments.ts` · `listOpenChargeBalances` → RPC `list_open_charge_balances` | **A** | saldos abiertos y pagado por cargo calculados en SQL; reemplaza la descarga de cargos + asignaciones + pagos en Inicio, Cobros y Recordatorios |
| `lesson-registrations.ts` · `listRegistrationProgressForCalendarLessonIds` | I | lotes (90 días de clases superaban la URL) |
| `lesson-registrations.ts` · `listLessonRegistrationsForStudent` | C + I | páginas del roster + lotes; orden global en TypeScript (más reciente primero, sin horario al final) |
| `lesson-registrations.ts` · `listPendingHomeworkTasksForStudent`, `listEvaluationsForStudent`, `listCompletedRegistrationsForStudentReport`, `listRosterForRegistrationIds` | I | lotes (los ids de tarea `individual:<uuid>:<uuid>` achican el lote por el presupuesto de caracteres) |
| `lesson-registrations.ts` · `listLessonRegistrationsInRange` | F | **ventana aplicada en la base**: programado ∈ [inicio, fin] ó (sin horario y alta ∈ [inicio, fin]); antes bajaba todo desde el inicio (hasta el futuro) y filtraba en la web |
| `lesson-registrations.ts` · `fetchDetail` (4 tablas hijas de un registro) | U | por un solo registro (decenas de filas como máximo) |
| `student-history.ts` (estado/nivel/precio), `custom-levels.ts`, `reports.ts` · `listReportRecordsForStudent`, `backup-import.ts` · `listImportRuns`, `fetchStudentsSummaryByIds` | L / I | páginas (reportes e importaciones con páginas chicas: cada fila trae jsonb) / lotes |
| `teacher-profile`, `teacher-availability`, `budget-distribution`, `active-sessions` | U | una fila por propietaria |
| `lib/calendar/view.ts` · `loadCalendarViewForRange` | F | reglas (C), excepciones (I), alumnos (C), clases en ventana (F) — todas con las funciones de arriba |
| `lib/dashboard/load-home-data.ts` (Inicio/Recordatorios) | F + A | hoy, 90 días atrás y el horizonte de series; cobros por RPC |
| `lib/dashboard/load-financial-overview.ts` (Resumen financiero) | C + F | listas completas (cálculo de períodos con reglas de vencimiento en TypeScript) y ventanas de registros por período |

## Pantallas que podían mostrar datos incompletos al superar `max_rows` (antes de R2)

Alumnos (> 1.000 alumnos), Calendario / Inicio / Recordatorios / Registro (> 1.000 clases materializadas en una ventana o > 1.000
registros), Cobros e Inicio (> 1.000 cargos, pagos o asignaciones: deuda y vencidos calculados sobre una parte), Resumen financiero
(ingresos, vencidos y actividad), ficha del alumno (historial, tareas, progreso, reportes), Series y su generación periódica de
cuotas de entrenamiento, y la importación de respaldos (historial). Con listas de > ~210 ids también **fallaban** (URL demasiado larga).

## GET que escribían (investigación de `GET /cobros` y `GET /recordatorios`)

Ver la sección R2 de `docs/WEB_PARITY_PLAN.md`. Resumen: `/inicio`, `/cobros`, `/recordatorios` y la pestaña Cobros del alumno
llamaban a `ensure_monthly_charges`/`ensure_training_charges` **al renderizarse**, y la pestaña Reportes del alumno barría (borraba)
PDFs de Storage. Ahora esas escrituras son Server Actions (POST) disparadas desde el cliente al mostrarse la pantalla.
