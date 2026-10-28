# Matriz única de equivalencia: aplicación original ↔ web

Estado vivo. Fuente de verdad del cierre de la migración funcional. **La migración NO está cerrada** mientras exista alguna fila en «falta implementar» o «falta verificar».

- Original (sólo lectura): `C:\Users\joaqu\Downloads\aca va tdo\TeacherFlow_NuevaClase\TeacherFlow\src` (`features/*`, 12 módulos, ~420 archivos fuente).
- Web: `stepup/` (rama de publicación `teacherflow-web`).
- Prioridad ante contradicciones: 1) decisiones explícitas más recientes de Joaquín, 2) código del original, 3) documentación contrastada con el código.
- Estados: **EQ** equivalente comprobado · **AUT** diferencia autorizada/inevitable (con alternativa) · **FALTA** falta implementar (ausencia comprobada con búsqueda de todos los puntos de entrada) · **VERIF** existe pero falta verificar de punta a punta.
- Método del inventario: (1) recorrido de archivos del original por módulo; (2) cruce automático de los textos de interfaz del original contra el código web (candidatos), seguido de lectura del código de cada candidato; (3) búsqueda en la web de todos los consumidores y de la función equivalente. Un botón de nombre parecido NO cuenta como equivalente.
- Pruebas: «lógica» = pruebas automáticas (`node --test`); «navegador» = QA real sobre la versión publicada (requiere la sesión de QA); «dispositivo» = prueba física en iPhone/Android (sólo la hace Joaquín; emular tamaño no la sustituye).

## Decisiones vigentes que NO se revierten (resumen)

Sin Planificado/Visto en temas · edición de listas sin borrar · tareas en entrenamientos · calificaciones accesibles (barra 1–10) · importes con interpretación estricta y centavos exactos · cobros separados por actividad/acuerdo/período · operaciones atómicas e idempotentes · historial preservado · recargos automáticos desactivados (decisión de negocio ya tomada en el original, commit `94ce7be` del móvil).

## 1. Acceso y cuenta

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| ACC-01 | Inicio de sesión, crear cuenta, confirmar correo, recuperar y cambiar contraseña | `account/screens/SignIn,SignUp,AuthEmailConfirmation,ForgotPassword,NewPassword` | `/login`, `/crear-cuenta`, `/auth/confirm`, `/recuperar-contrasena`, `/nueva-contrasena` | VERIF (código de confirmación por enlace en lugar de código; mismo resultado) |
| ACC-02 | Cerrar sesión; sesión única por dispositivo («Tu cuenta se abrió en otro dispositivo») | `SignedOutElsewhereScreen`, `ConfirmDeviceTransferScreen`, `activeSessionService` | `/dispositivo`, `lib/auth/device-session/*`, `lib/actions/device-session.ts`, `DeviceSessionWatcher`, control en `requireAuthenticatedDbContext`, layout privado y `proxy.ts` | **IMPLEMENTADO** (commit local; no publicado). Mismas tres funciones de la base que usa el original (`transfer/touch/end_active_session`) y su motor de decisión copiado idéntico (16 pruebas originales pasan). Circuito web probado con un modelo fiel de la base: primer ingreso sin preguntar, confirmación al haber otro dispositivo, cierre del otro, vencimiento 24 h con renovación, liberación al cerrar sesión, cookie alterada. Verificación en navegador y en dos dispositivos reales: pendiente. |
| ACC-03 | Nombre de la profesora (alta y edición) y saludo en Inicio | `TeacherNameOnboardingScreen`, `SettingsScreen` | `saveTeacherProfileAction`, Configuración | VERIF |
| ACC-04 | Tutorial de bienvenida salteable y «Ver tutorial» | `OnboardingTutorialScreen` | `components/dashboard/first-steps.tsx` (primeros pasos) | AUT parcial: otra forma de guiar; falta «volver a verlo» → VERIF |
| ACC-05 | Eliminar cuenta | `accountDeletionService` | `deleteOwnAccountAction` | VERIF |
| ACC-06 | Seguimiento de clases en vivo (interruptor) | `LiveClassTrackingSection` | — | FALTA (ver INI-07) |
| ACC-07 | Autorización local 24 h sin conexión, almacenamiento seguro, deep links, transferencia de dispositivo | `authorizationCacheStore`, `chunkedSecureStore`, `deepLinkAuth`, `ConfirmDeviceTransferScreen` | — | AUT: mecánicas nativas; en la web la sesión la maneja Supabase + cookies; la transferencia ya la cubre el módulo de traslado |

## 2. Inicio

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| INI-01 | Agenda del día, próxima clase (en curso/por empezar/terminó), clases por registrar, recordatorios, cobros de hoy | `HomeScreen`, `DayAgenda`, `NextClassCard`, `PendingClasses` | `home-view.tsx`, `today-agenda.ts` | EQ en lo cubierto por §21 de TRASLADO (agenda y Recordatorios); VERIF resto |
| INI-02 | «Clases sin alumnos» | `EmptyClassesNotice`, `emptyClasses.ts` | `empty-classes.ts`, `home-view.tsx` | VERIF |
| INI-03 | Indicadores rápidos: alumnos activos, clases de la semana, horas enseñadas este mes, promedio de evaluaciones | `StatsRow`, `buildDashboardData.ts` | `home-view.tsx`, `lib/dashboard/home-stats.ts`, `lib/repositories/home-stats-inputs.ts` | **IMPLEMENTADO** (no publicado hasta cerrar el gate). Fórmulas del original: semana lunes–domingo sin canceladas; horas = suma de la duración real de las clases dictadas del mes (1 decimal); promedio = todas las notas reales (un 0 nunca cuenta). 5 pruebas del circuito. Diferencia: la semana usa los días civiles de Argentina. |
| INI-04 | Resumen financiero del mes en Inicio (prevista, cobrada, pendiente en término, vencida) | `FinancialSummary`, `buildHomeFinancialSummary` | Inicio muestra cobros de hoy; Resumen financiero aparte | VERIF |
| INI-05 | Aviso diario de cobros «Recordarme mañana» | `DailyCollectionsNoticeBanner`, `dailyCollectionsNotice.ts` | `components/dashboard/daily-collections-notice.tsx`, `lib/dashboard/daily-collections-notice.ts` (reglas del original, copia idéntica) | **IMPLEMENTADO**. Se guarda en el propio dispositivo (como el original). La web no distingue etapas de mora (recargos desactivados): toda deuda vencida es el rango más grave; vuelve antes de mañana sólo si pasa de «vence hoy» a vencido. 4 pruebas. |
| INI-06 | Campana de notificaciones con cantidad | `NotificationBell`, `notificationBell.ts` | `home-view.tsx` (aria «N recordatorios pendientes») | VERIF |
| INI-07 | Comenzar clase / Finalizar clase / puntualidad del alumno / Ajustar horario / Corregir hora de inicio / aviso de clase en curso restaurada | `ActiveClassCard`, `StartClassPunctualityDialog`, `ScheduleAdjustSheet`, `activeClassSessionStore`, `RestoredActiveSessionNotice`, `manualSessionCorrectionService` | — (sólo lectura de «clase en curso») | FALTA (requiere esquema para guardar sesión activa y puntualidad) |
| INI-08 | Pantalla «Clases por registrar» completa | `PendingClassesScreen`, `pendingClasses.ts` | `/registro` | VERIF |
| INI-09 | Centro de recordatorios | `RemindersCenterScreen`, `remindersCenter.ts` | `/recordatorios` | EQ (§21) |
| INI-10 | Distribución 50/30/20 y proyección anual | `BudgetDistributionCard`, `AnnualBudgetChart` | `annual-budget-plan.ts` (13 pruebas originales portadas), `annual-projection.tsx`, tarjeta de distribución con «Restablecer 50/30/20» | Implementado (28/10), **sin publicar**; VERIF en navegador |
| INI-11 | Meta/objetivo de ahorro (monto + fecha + sugerencia) | `SavingsGoalControl` | `savings-goal.ts`, `savings-goal-form.tsx`, `saveSavingsGoalAction`, `applyBudgetPresetAction` | Implementado (28/10), **sin publicar**; VERIF en navegador. **Defecto de datos corregido:** ajustar los porcentajes borraba el objetivo de ahorro importado |
| INI-12 | Comportamiento de pago mensual (12 meses) | `MonthlyPaymentBehaviorScreen/Chart` | `/resumen-financiero/comportamiento-de-pago`, `lib/payments/payment-behavior.ts` (motor del original) | **IMPLEMENTADO**. Alumnos únicos por mes en su peor categoría; los números van en texto además del color. 6 pruebas del circuito. Verificación en navegador pendiente. |
| INI-13 | Analíticas: facturación/demanda/horas dictadas, reprogramadas y canceladas, alumnos nuevos | `FinancialAnalyticsSections`, `calendarDemandSummary` | `financial-overview-view.tsx` (§22 de TRASLADO) | VERIF |
| INI-14 | Navegación: ubicación de la barra (abajo/menú del logo), Configuración | `SettingsScreen`, `LogoMenuSheet`, `navigationPreferenceStore` | navegación propia de la web | AUT: mecánica nativa |
| INI-15 | Datos de ejemplo (crear/eliminar) | `HomeScreen` «Eliminar datos de ejemplo» | `/configuracion/datos-de-prueba` | VERIF |

## 3. Alumnos

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| ALU-01 | Lista con búsqueda tolerante, filtros (nivel, modalidad, estado, **estado de pago**), orden (nombre, **próxima clase**, **último pago**) | `StudentsListScreen`, `useFilteredStudents`, `FiltersPanel` | `app/(app)/alumnos/page.tsx`, `lib/students/list-filters.ts`, `students-filters-form.tsx` | **IMPLEMENTADO** (commit local; no publicado). Pruebas del circuito web: `student-list-circuit.test.ts` (filtros, orden, parámetros inválidos). Verificación en navegador pendiente. |
| ALU-02 | Tarjeta con badges: estado, Destacado, Nuevo, **Pago vencido con el período** («Julio vencido»), **Reporte pendiente**, **Tarea pendiente**, próxima clase, clases del mes, promedio, último pago | `StudentCard`, `StudentBadges`, `buildStudent…` | `student-card.tsx`, `student-list-parts.tsx`, `lib/students/list-status.ts` (motor del original, copia idéntica en `lib/payments/engine`) | **IMPLEMENTADO** salvo «Reporte pendiente»: en el original ningún flujo real lo activa (siempre `false`; comprobado por búsqueda de escritores), así que no se muestra. El «último pago» se usa para ordenar y filtrar, como en el original (la tarjeta del original no lo muestra). |
| ALU-03 | Acciones rápidas por alumno (registrar clase, registrar pago, reprogramar, ver perfil, enviar PDF, editar, archivar, eliminar, restaurar) | `SwipeableStudentRow`, `StudentCardAction` | perfil + editar | AUT parcial (el deslizamiento es nativo); acciones faltantes → FALTA |
| ALU-04 | Alta y edición con validaciones (nombre, apellido, edad 3–120, email, precio > 0, duración ≤ 480, frecuencia ≤ 14, horarios habituales) | `NewStudentScreen`, `studentValidation.ts` | `student-form-page.tsx`, `createStudentAction`/`updateStudentAction` | VERIF (contrastar cada regla) |
| ALU-05 | Forma de cobro en el alta: por clase, mensual (+ «Este mes está pendiente/ya está pago»), paquete, semanal, quincenal, sin cargo | `NewStudentScreen`, `EditBillingPlanSheet`, `studentBillingPlan.ts` | sólo por clase y mensual (`BILLING_TYPE_OPTIONS`) | FALTA (planes semanal/quincenal/paquete/sin cargo y su generación de cargos; ver PAG-01) |
| ALU-06 | Niveles A1–C2 + niveles propios: crear, **renombrar, quitar** | `CreateCustomLevelSheet`, `ManageCustomLevelsSheet` | `createLevelAction`, `renameLevelAction`, `deleteLevelAction`, `manage-levels-section.tsx` | VERIF (existe; falta recorrido) |
| ALU-07 | Cambiar estado (activo/pausado/inactivo/archivado) con motivo y notas | `ChangeStatusSheet`, `StatusSection` | `change-status-form.tsx`, `changeStudentStatusAction` | VERIF |
| ALU-08 | Archivar: quitar o conservar la agenda futura | `ArchiveStudentDialog`, `studentArchiveService` | `archive_student_and_prune_future`, `archive-prune-plan.ts` | VERIF |
| ALU-09 | Reactivar con decisión «Retomar el cobro mensual: comenzar el próximo mes / cobrar desde este mes» | `StudentsListScreen`, `initialMonthlyBillingService` | — | FALTA |
| ALU-10 | **Eliminar definitivamente** con resumen real del impacto (perfil, clases futuras, registros, referencias de calendario, reportes, cobros, pagos) y cascada atómica | `DeleteStudentDialog`, `studentDeletionImpact.ts`, `studentDeletionCascade.ts`, `studentDeletionService` | — | FALTA, **requiere decisión de Joaquín** (la cascada original borra también el historial financiero del alumno; choca con «preservar historial»). No se implementa hasta que lo decida |
| ALU-11 | Perfil con 7 pestañas: Resumen, Clases, Cobros, Progreso, Reportes, Tareas, Información | `StudentProfileScreen`, `tabs/*` | `student-profile-view.tsx`, `profile-tabs-nav.tsx` | VERIF por pestaña (ver ALU-12 a ALU-17) |
| ALU-12 | Resumen: clases del mes/totales, próxima clase, historial (clases totales, promedio histórico, horas tomadas, **inversión histórica**) | `QuickSummary`, `HistorySummary`, `ProfileQuickActions` | `resumen-tab.tsx`, `profile-overview.ts` | FALTA «Inversión histórica» y acciones rápidas; resto VERIF |
| ALU-13 | Puntualidad del alumno (evolución mensual, clases evaluadas, dentro de tolerancia, demora promedio) | `PunctualitySection`, `punctualityScoring.ts` | — (sólo texto en reportes) | FALTA (depende de INI-07) |
| ALU-14 | Registrar cambio de nivel («logro de nivel»: nuevo nivel, fecha, nota, salto, corrección, tiempo que llevó) | `LevelAchievementSheet`, `levelAchievementRules.ts` | historial de niveles importado, sin hoja de alta | FALTA |
| ALU-15 | Corrección manual de sesión (hora real de inicio/fin y puntualidad) desde la pestaña Clases | `ManualSessionCorrectionSheet` | — | FALTA (depende de INI-07) |
| ALU-16 | Cobros del alumno: obligaciones, pagos, **editar plan de cobro**, **modificar monto mensual** (desde este mes / próximo mes), **marcar mes actual pagado**, situación inicial declarada y su corrección, revisar primer mes proporcional, anular cobro/pago, registrar pago de clase/semana/quincena/mes/paquete | `CobrosTab`, `EditBillingPlanSheet`, `EditMonthlyAmountSheet`, `RegisterPaymentSheet`, `initialMonthlyBillingPlan.ts` | `cobros-tab.tsx` (Obligaciones y Pagos; registrar/anular por cargo) | FALTA parcial (ver PAG-xx) |
| ALU-17 | Aviso «clase cancelada por reprogramación» con «Entendido, ya avisé» / «Eliminar y reemplazar» | `RescheduleCancellationNoticeBanner`, `rescheduleCancellationNoticeStore` | — | FALTA |
| ALU-18 | Tareas del alumno, reportes del alumno (generar/ver/descargar) | `TareasTab`, `ReportesTab` | `tareas-tab.tsx`, `reportes-tab.tsx` | VERIF (§25 de TRASLADO; falta recorrido en pantalla) |

## 4. Calendario y series

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| CAL-01 | Vistas Semana/Día, densidades, navegación temporal, hoy, escala de colores congelada | `CalendarTabScreen`, `WeekTimeGrid`, `calendarVisualLegend` | `real-calendar-grid.tsx`, `calendar-density-picker.tsx` | VERIF visual (pendiente de tu comprobación según §27) |
| CAL-02 | Crear clase desde un espacio libre, clase única, grupo, entrenamiento | `NewCalendarLessonSheet`, `TimeSlotQuickPickSheet` | `/calendario/nueva` | VERIF |
| CAL-03 | «Buscar horario libre» y disponibilidad en el selector de horario (libres en blanco / ocupados en gris, mantener presionado para sumar 15 min) | `NewCalendarLessonSheet`, `RescheduleTimeSlotGrid` | — | FALTA |
| CAL-04 | Vacaciones y bloqueos (Mi disponibilidad) con aviso al agendar encima y «Agendar igualmente» | `TeacherAvailabilitySheet`, `teacherAvailabilityEngine` | `/calendario/disponibilidad` | VERIF (falta el aviso al agendar encima de un bloqueo) |
| CAL-05 | Acciones de una clase: reprogramar con calendario mensual de disponibilidad (verde/amarillo/rojo) y grilla de horarios | `CalendarLessonActionsSheet`, `RescheduleMonthCalendar` | `real-lesson-detail-modal.tsx` (fecha y hora libres) | FALTA parcial (sin disponibilidad visual) |
| CAL-06 | **Editar nombre de la clase** (sólo esta / esta y siguientes) | `EditClassTitleSheet` | `edit_calendar_lesson`, `edit_recurrence_class_title`, `editLessonTitleAction` (`lesson-edit-dialog.tsx`) | Implementado en código y base (51 comprobaciones en Postgres real); **migración 20261027100000 sin aplicar en Production** (bloqueada por el clasificador); VERIF en navegador |
| CAL-07 | **Cambiar duración** (sólo esta / esta y siguientes; nunca clases pasadas) | `ChangeLessonDurationSheet`, `calendarDurationEdit` | `changeLessonDurationAction`: sólo esta clase (`edit_calendar_lesson`) o esta y las siguientes (corte de serie con el patrón del tramo vigente); valida choques y bloqueos | Implementado en código y base; migración sin aplicar; VERIF en navegador |
| CAL-08 | **Cambiar tipo de actividad** Clase ↔ Entrenamiento (+ cuota de entrenamiento) | `EditActivityKindSheet` | — | FALTA |
| CAL-09 | **Agregar/quitar alumnos** de una clase o desde una fecha, con «Crear alumno nuevo» | `AddParticipantsSheet`, `calendarParticipantsFromDate` | `changeParticipantsAction` (sólo series) | FALTA parcial (clases sueltas) |
| CAL-10 | **Eliminar clase** (sólo esta / desde esta fecha) | `CalendarLessonActionsSheet` | `deleteCancelledLessonAction` (cancelada: tarjeta eliminada + fecha excluida de la serie) y `deleteSeriesFromOccurrenceAction` (esta y las siguientes). Diferencia: no se elimina una cancelada con registro o cobro (se conserva el historial) | Implementado; diferencia autorizada por la regla de historial; migración sin aplicar; VERIF en navegador |
| CAL-11 | Cancelar con/sin aviso, **restaurar** clase cancelada, **reemplazar** una cancelación con otra clase en ese horario | `CalendarLessonActionsSheet`, `cancelledSlotReuse` | `restoreOccurrenceAction` / `restore_calendar_occurrence` (vuelve a la fecha original; avisa si está bloqueada y permite «Restaurar igual»; nunca con registro o cobro); reemplazar ya existía | Implementado; migración sin aplicar; VERIF en navegador |
| CAL-12 | Series: crear con patrón semanal, ciclos de 2–4 semanas, varios días/horarios, fecha de fin, pendiente de asignar | `RecurrenceOptions`, `calendarRecurrenceEngine` | `/calendario/nueva`, `weekday-schedule-editor.tsx` | VERIF |
| CAL-13 | Series: pausar, reanudar, finalizar, editar futuras (versiones), cambiar participantes desde una fecha, intercambiar horarios | `RecurrenceRulesSheet`, `EditFutureRecurrenceSheet`, `calendarRecurrenceSplit` | `/calendario/series[/id]`, `editFutureRecurrenceAction`, `changeParticipantsAction`, `swapSeriesAction` | VERIF |
| CAL-14 | Acuerdo de cobro de entrenamiento (cuota, mes de inicio, vista previa de cargos) y su edición | `TrainingBillingAgreementSheet` | `training-billing-config.tsx` | VERIF |
| CAL-15 | Primer mes proporcional (usar proporcional / mes completo / otro importe / no cobrar) | `FirstMonthProrationSheet` | `proration.ts` + flujo | VERIF |
| CAL-16 | Conflictos de horario (permitir superposición explícita) | `calendarConflicts.ts` | `calendar-conflicts.ts` | VERIF |

## 5. Registro, contenido pedagógico, tareas y evidencias

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| REG-01 | Registro individual/grupal: asistencia por alumno, duración, evaluación, contenido, observaciones, tarea, guardar progreso, finalizar | `NewClassScreen`, `RegisterPendingClassSheet`, `ParticipantRegistrationBlock` | `registration-workspace.tsx` | VERIF (P0 registro 21/10) |
| REG-02 | **Marcar todos presentes / Limpiar asistencia** (con confirmación de reemplazo/borrado) | `NewClassScreen`, `useNewClassForm` | `planBulkAttendance` + botones en `registration-workspace.tsx` (sólo alumnos no completados; confirma antes de reemplazar o borrar) | Implementado y probado en lógica (commit local `95e56b4`); VERIF en navegador |
| REG-03 | Resultado de la clase (realizada, profesora ausente, alumno ausente con/sin aviso, cancelada con aviso, cancelada tarde con política, reprogramada, feriado + excepción) | `PendingClassOutcomeSelector`, `LessonOutcomeField`, `LateCancellationPolicySheet` | `registration-outcome-field.tsx`, `change_lesson_registration_outcome` | VERIF; política «descontar del paquete» y «excepción: no genera cobro» → VERIF |
| REG-04 | ¿Es cobrable? / ¿Consume una clase de la cuota mensual? (sólo alumnos por clase) | `BillingSection` | — (no hay interruptores) | FALTA |
| REG-05 | Cobro de la clase al finalizar: aviso con cinco respuestas | `ClassPaymentPromptModal` | `class-payment-prompt.tsx` | **EQ en lógica y estructura, publicado** (commit `de55143`); VERIF en navegador (QA) y dispositivo |
| REG-06 | Editar un registro ya finalizado, con confirmación al salir sin guardar | `EditRegisteredLessonSheet` | `editCompletedRegistrationAction`; falta confirmar «salir sin guardar» | VERIF |
| REG-07 | Temas (sin Planificado/Visto), objetivos, actividades, notas, fortalezas, a mejorar, observaciones individuales/internas | `PedagogicalContentSection`, `TopicChecklist`, `ChipTextList` | `pedagogical-content-editor.tsx` | EQ por decisión (§25); VERIF recorrido |
| REG-08 | Calificaciones por área (1–10, «sin calificar», mostrar/ocultar control por área) | `SkillGradeChips` | `registration-form-parts.tsx` (barra 48 px) | EQ por decisión; «ocultar control por área» → VERIF |
| REG-09 | Tareas: comunes y personalizadas, historial, revisión posterior (cumplida/parcial/no cumplida), **fecha de entrega elegida entre las próximas clases reales** | `HomeworkSection`, `PendingHomeworkSection`, `upcomingHomeworkOccurrences` | `registration-form-parts.tsx` | VERIF (fecha de entrega) |
| REG-10 | Evidencias y materiales: cámara, galería, HEIC, PDF, miniaturas, abrir, leyenda, alcance por participante, quitar, reutilizar material | `AttachmentList`, `MaterialLibraryPicker`, `lessonAttachments.ts` | `lesson-files-editor.tsx`, adjuntos y materiales (§25) | VERIF (falta recorrido real; cámara = prueba en dispositivo) |
| REG-11 | Ciclo real de la clase: horario efectivo, finalización real, minutos de demora computables | `NewClassScreen` | — | FALTA (depende de INI-07) |
| REG-12 | Borradores: guardar progreso y recuperar al reabrir/recargar | `useSaveGroupDraft`, `useActiveFieldVisibility` | `useDraftOperationId`, borradores en servidor | VERIF |
| REG-13 | Resumen «Revisá estos datos» antes de guardar | `NewClassScreen` | validaciones en línea | VERIF |

## 6. Finanzas

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| PAG-01 | Generación de cargos por plan: por clase, mensual, **semanal, quincenal, paquete**, sin cargo | `monthlyChargeGenerationPlan`, `periodicChargeGenerationService`, `packagePurchaseService` | por clase y mensual ya existían; semanal y quincenal implementados (`ensure_periodic_charges`, `periodic-charge-candidates.ts`, commit local `0ec6faf`) | **IMPLEMENTADO Y PUBLICADO** (`718d455`, despliegue `9thqrxhtn`); verificación en navegador PENDIENTE de sesión de QA. Evidencia: 45/45 comprobaciones en Postgres real (idempotencia, dos conexiones a la vez, alumno ajeno, importe 0) y prueba diferencial de semana ISO/bloque quincenal contra el núcleo original en 2300 días. **Paquete:** la búsqueda de llamadores en el original no encuentra NINGUNO fuera de sus propios archivos y pruebas para `registerPackagePurchase`, `planPackageCreditConsumption`, `findActivePackage` ni `computePackageCreditsSummary`: el original tiene el motor pero ninguna pantalla ni flujo lo invoca (no genera cargo de paquete ni consume créditos al dictar). La paridad exacta es entonces: plan «Paquete de clases» editable, sin cargo automático (igual en la web). |
| PAG-02 | Registrar pago: clase/semana/quincena/mes/paquete/entrenamiento, completo/parcial/previo, asignación al cargo más antiguo | `RegisterPaymentSheet`, `registerPaymentService` | `ChargeActions`, `register_payment` | VERIF |
| PAG-03 | Anular pago y anular cobro erróneo (con motivo) | `VoidPaymentDialog`, `VoidChargeDialog` | `charge-actions.tsx` | VERIF |
| PAG-04 | Modificar monto mensual (desde este mes / próximo mes, con recálculo del saldo) | `EditMonthlyAmountSheet`, `monthlyAmountCorrectionService` | «Modificar monto mensual» en la pestaña Cobros (`billing-plan-card.tsx`, RPC `change_student_monthly_amount`) | **IMPLEMENTADO Y PUBLICADO** (verificación en navegador pendiente de sesión de QA): cargo del mes y plan se corrigen en una sola transacción; período saldado o importe menor a lo ya pagado se rechazan; «próximo mes» no toca el cargo; auditoría; sin divergencia plan/cargo con dos cambios simultáneos (comprobado). Misma regla de «editar plan» (el monto de un plan YA mensual sólo por acá). Verificación en navegador pendiente de aplicar migración y de sesión de QA. |
| PAG-05 | Situación inicial del alumno mensual («este mes está pago/pendiente») y su corrección | `initialMonthlyBillingService`, `initialPaidSurchargeRepairService` | — | FALTA |
| PAG-06 | Recargos automáticos y su configuración | `SurchargeSettingsPanel`, `surchargeSettingsService` | apagado estructuralmente | AUT (decisión de negocio ya tomada: sin recargos automáticos) |
| PAG-07 | Historial y riesgo de deuda por alumno (evolución 12 meses, racha, en término/fuera de término) | `PaymentHistorySection` | — | FALTA |
| PAG-08 | Centro de cobros (semáforo, vencimientos, «Revisar primer mes proporcional») | `CollectionsCenterScreen`, `collectionsCenter.ts` | `/cobros`, `collections-center.ts` | VERIF |
| PAG-09 | Reconciliación financiera automática (duplicados técnicos, cargos incompatibles, pagos huérfanos) | `financialReconciliation*` | restricciones y RPC atómicos en base | AUT: la web evita crear el estado inconsistente en la base; auditoría de datos importados en `docs/P0_REGISTRO` |
| PAG-10 | Pago vencido/«X vencido» coherente en toda la app | `summarizeOverdueDebt` | `reminders-center.ts`, `collections-urgency.ts` | VERIF |

## 7. Reportes y progreso

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| REP-01 | Selección del período (meses/rango), contenido, observaciones opcionales, privacidad, evidencias elegidas | `ReportesTab`, `reportPeriods.ts` | `reportes-tab.tsx` | VERIF (§25, falta recorrido real) |
| REP-02 | Generar, historial, abrir y descargar PDF; eliminar | `reportHistoryStore`, `reportPdfStorage` | `lib/reports/pdf.tsx`, `delete_report_record` | VERIF (PDF real inspeccionado en §25 con datos de QA) |
| REP-03 | Compartir: WhatsApp, otra aplicación, copiar mensaje | `reportSharing.ts` | — | AUT parcial (la web descarga el PDF); «copiar mensaje»/enlace WhatsApp → FALTA menor |
| REP-04 | Narrativa determinística del reporte | `buildDeterministicReportNarrative` | `lib/reports` | VERIF |

## 8. Configuración, respaldos y datos

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| CFG-01 | Respaldo en la nube automático, recuperación en dispositivo nuevo («la nube siempre gana») | `backup/*`, `CloudBackupRecoveryGate` | la base ES la nube; módulo de importación/traslado | AUT (arquitectura distinta: sin respaldo local) |
| CFG-02 | Revisar consistencia y reparar problemas seguros | `BackupScreen`, `dataIntegrity*`, `financialReconciliation` | `/configuracion/consistencia`, `lib/payments/consistency.ts` | **PARCIAL**: detección de sólo lectura con las 13 categorías del analizador del original (8 pruebas); las reparaciones («Limpiar registros huérfanos», «Eliminar reservas sin alumno», «Reparar problemas seguros») NO se implementan hasta que haya un caso concreto con evidencia (política D.2). |
| CFG-03 | Importación/exportación y compatibilidad con datos anteriores | `transfer/*` | importador (R6/R6.1) | EQ (probado, ver TRASLADO) |
| CFG-04 | Datos de prueba: exclusión reversible | — | `/configuracion/datos-de-prueba` | función propia de la web |

## 9. Uso móvil y escritorio

| ID | Función | Estado |
|---|---|---|
| UX-01 | Controles ≥ 44 px, letra ≥ 16 px en campos, sin desbordes a 375/390/430 px | VERIF por pantalla (aviso de pago: comprobado en emulación 375/390/430 y altura de teclado; **Safari/teclado/modo anclado de iPhone: prueba física pendiente**) |
| UX-02 | Diálogo compacto y centrado; cierre controlado | EQ para el aviso de pago (`Dialog placement="center"`, `onBeforeClose`); resto de diálogos siguen como hoja inferior en móvil |

## Bloqueos de herramientas (acciones concretas)

- **`20261027100000_calendar_lesson_actions.sql`:** APLICADA en Production (autorizada por el mecanismo normal de aprobación) y publicada con `84b34a0`.
- **`20261028100000_billing_plans_and_amounts.sql`:** APLICADA en Production el 28/10/2026 con la autorización expresa de Joaquín, por el mecanismo normal de aprobación (primer intento denegado por el clasificador como «Production Deploy»; el segundo, autorizado, se aplicó). Antes se reconfirmó que era la única pendiente y se ensayó la versión final con `BEGIN … RAISE EXCEPTION` (revertida). Verificado después: `db push --dry-run` → `upToDate: true`; las tres funciones existen, sin permiso para `anon` y con permiso para `authenticated`.

## Pendientes que requieren decisión de Joaquín

1. **ALU-10 Eliminar definitivamente un alumno.** El original borra en cascada su historial financiero, reportes y clases; la web conserva historial. ¿Se implementa igual que el original (con resumen del impacto y copia de seguridad previa), sólo para alumnos sin cobros ni pagos, o no se implementa?

## Registro de cambios de esta matriz

- 28/10/2026 (3): lista de Alumnos con estado de pago del mes, próxima clase, promedio, clases del mes, avisos, filtro por estado de pago y orden (motor de pagos del original promovido a producción como copia idéntica, con guarda byte a byte); sesión única por dispositivo implementada. Estado: comparado ✔ · implementado ✔ · publicado ✘ (en proceso) · verificado en producción ✘.

- 28/10/2026 (2): migración aplicada y bloque «planes y montos» publicado (`718d455`). Antes de publicar se corrió el gate completo sobre el código final: suite completa 4982/4982 (copia LF), `tsc` sin errores, `eslint` sin errores ni advertencias, `next build` correcto. Endurecimiento previo a aplicar la migración (misma migración, aún no aplicada): transiciones entre planes con confirmación obligatoria cuando el mes ya tiene cobros de otro tipo de plan, «la mensualidad empieza el mes próximo» (`startPeriod`, que la generación mensual ahora respeta, igual que el original), y «Modificar monto mensual» sobre una mensualidad que todavía no empezó. Estado: inventariado ✔ · comparado ✔ · implementado ✔ · publicado ✔ · verificado en producción ✘ (falta sesión de QA).

- 28/10/2026: circuito «planes y montos» implementado en local: plan de cobro editable (semanal, quincenal, mensual, paquete, por clase, sin cargo), «Modificar monto mensual», generación de cargos semanales/quincenales, «Editar alumno» ya no cambia precio ni tipo de facturación (regla del original del 10/08/2026) y la ficha muestra el plan vigente. 45/45 en Postgres real + pruebas de lógica/cableado + diferencial contra el núcleo original (`lib/original-core`, 2864 pruebas originales). Estado: inventariado ✔ · comparado ✔ · implementado ✔ (commits locales `faa940a`, `0ec6faf`) · publicado ✘ (migración bloqueada) · verificado en producción ✘.

- 27/10/2026 (2): acciones de clase del calendario (CAL-06/07/10/11) implementadas en código y base con 51 comprobaciones en Postgres real y 6 pruebas de lógica/cableado; «Marcar todos presentes» (REG-02) revisado e integrado. Quedan FALTA: cambiar tipo de actividad (CAL-08: implica acuerdo de cobro de entrenamiento) y agregar/quitar alumnos de una clase (CAL-09).

- 27/10/2026: creada con el primer inventario basado en código. REG-05 cerrado en lógica y estructura (commit `de55143` publicado en Production); su verificación en navegador queda pendiente de sesión de QA.


## Parte C — Clasificación justificada de las 91 diferencias «AUT» (28/10/2026)

Regla: una diferencia sólo es **AUT-INSTRUCCIÓN** si cito la instrucción que la autoriza; **AUT-TÉCNICA** si demuestro que la función se conserva con otro mecanismo; si no puedo hacer ninguna de las dos queda **PENDIENTE** y vuelve a la lista de trabajo. Nada se llama «inevitable» sin demostrarlo. Cuentas: 23 + 43 + 25 = 91.

### C.1 AUT-INSTRUCCIÓN (23 archivos)

| Archivos | Instrucción que lo autoriza | Alcance de la autorización / lo que NO cubre |
|---|---:|---|
| REG-07/08: `ChipTextList`, `EvaluationSection`, `PedagogicalContentSection`, `SkillGradeChips`, `SkillGradeInput`, `TopicChecklist`, `skillGradeDomain`, `textItemEditDomain`, `TextItemEditSheet` (9) | Joaquín, 27/10/2026 («Decisiones vigentes»): sin Planificado/Visto en temas · edición de listas sin borrar · calificaciones accesibles (barra 1–10, botones − y +) | Sólo esas tres decisiones. Las demás funciones de cada archivo (agregar/quitar ítems, destacar, mínimos de evaluación, etc.) siguen en **VERIF** (comparación campo por campo pendiente). |
| PAG-02: `CurrencyInput`, `currencyAmountInput` (2) | Joaquín: «importes con interpretación estricta y centavos exactos» | El original sólo admitía pesos enteros y formateaba al escribir. La web interpreta con reglas estrictas (`parseMoneyInput`, 40+ casos de prueba). |
| PAG-06: `SurchargeSettingsPanel`, `surchargeSettingsService`, `surchargeSettingsStore`, `useSurchargeSettings`, `surchargeSettings` (5) | Decisión de negocio vigente «recargos automáticos desactivados» (CLAUDE.md del original; commit `94ce7be` del móvil) | Sin recargos no hay nada que configurar. Los pagos por encima del importe base se informan como «por encima del importe base» (`excess.ts`). |
| UX-02: `BrandedScreenHeader`, `HighlightPulse`, `PastelScreenBackground`, `accountStyles`, `brand`, `colors`, `typography` (7) | Joaquín: la web conserva su estética actual; escala visual del calendario congelada (CLAUDE.md) | Sólo la presentación. `HighlightPulse` (resaltar lo recién creado) es retroalimentación: su equivalente se revisa en **VERIF**. |

### C.2 AUT-TÉCNICA con función conservada (43 archivos)

| Archivos | Demostración | Riesgo residual |
|---|---|---|
| ACC-07 (7): `chunkedSecureStore`, `secureStorageAdapter`, `supabaseClient`, `supabaseConfig`, `deepLinkAuth`, `AuthSessionContext`, `SupabaseNotConfiguredScreen` | Almacenamiento seguro y cliente de sesión nativos: en la web la sesión vive en cookies de Supabase Auth (`proxy.ts`, `lib/auth/*`). Los enlaces de recuperación/confirmación llegan a `/nueva-contrasena` y `/recuperar-contrasena`. | Ninguno conocido; recorrido de recuperación de contraseña a verificar con QA. |
| CFG-01 respaldo y recuperación **automáticos** (18): `CloudBackupRecoveryGate`, `CloudBackupSyncContext`, `cloudRecoveryOfferStore`, `postRestoreActiveSessionWarningStore`, `useCloudBackupSync`, `useLastCloudBackupDate`, `RecoveryStatusScreen`, `OfflineProtectionBanner`, `cloud/*` (6), `localRevisionStore`, `backupStorage`, `backupKeys`, `backupTypes` | En el original el respaldo es 100 % automático y sin controles manuales (regla del CLAUDE.md del móvil). En la web los datos **ya están** en la base: todo navegador lee lo mismo, no existe un almacenamiento local vacío que pueda pisar una copia válida («la nube siempre gana» se cumple por construcción). | No hay «fecha del último respaldo» visible; no afecta a datos. |
| CFG-01 archivo de respaldo/restauración (9): `backupFile`, `buildBackup`, `buildBackupV2`, `runBackup`, `restoreFile`, `restoreService`, `restoreExecutor`, `restorePreview`, `restoreValidation` | La entrada de datos del móvil a la web la cubre el importador de copias (`lib/backup/*`, R6/R6.1: validación, vista previa, importación atómica y deshacer), con sus propias pruebas. La creación de copias no es una función visible del original. | El traslado web→móvil no existe (no pedido). |
| UX-01 (7): `DismissKeyboardView`, `KeyboardDismissScrollView`, `useActiveFieldVisibility`, `activeFieldVisibility`, `attendanceScrollTarget`, `savedLessonsStore`, `savedLessonLinkageDiagnostics` | Teclado nativo: el navegador desplaza el campo enfocado; los diálogos tienen scroll propio y los campos ≥ 16 px. Almacén local y diagnóstico de vínculos: la integridad la garantizan claves foráneas (`payment_charges_saved_lesson_fk` … `on delete restrict`). | **Prueba física en iPhone pendiente** (la emulación de tamaño no la sustituye). |
| PLAT-02 `teacherFlowStorage` (1) | AsyncStorage → base de datos. | — |
| CAL-01 `CalendarScreen` (1) | Reexporta la pantalla (1 línea): no tiene lógica. | — |

### C.3 PENDIENTES: no se pueden clasificar como autorizadas ni demostradas como inevitables (25 archivos)

| Archivos | Por qué no es AUT | Qué falta | Estado nuevo |
|---|---|---|---|
| ACC-02: `AccountScreen`, `AccountConnectedScreen` (2) | Son pantallas equivalentes, no una diferencia. | Comparar campo por campo con `/configuracion`. | **VERIF** |
| ACC-07 sesión única por dispositivo: `deviceId`, `activeSessionService`, `SignedOutElsewhereScreen`, `ConfirmDeviceTransferScreen` (4) | Es una función de seguridad que la web no tiene. `docs/design/web-v1/14` (opción B) sólo decidió no *mostrar* nada; deja «Sesiones abiertas» como pendiente de implementación real. No hay instrucción de Joaquín que la descarte. | Decisión de Joaquín: implementar sesiones web con cierre remoto, o aceptar que la web no limita dispositivos. | **PENDIENTE (decisión)** |
| ACC-07 uso sin conexión: `authorizationCacheStore`, `sessionAuthorization`, `OfflineUnavailableScreen` (3) | El original abre 24 h sin conexión; la web exige conexión. Una web instalable con caché es técnicamente posible, así que no es «inevitable». | Decisión de Joaquín: ¿hace falta modo sin conexión en la web? | **PENDIENTE (decisión)** |
| ACC-07 mixtos: `AuthGate`, `useAuthSession`, `authSessionReducer` (3) | Mezclan sesión (equivalente) con sesión única/sin conexión. | Separar y comparar por función. | **VERIF** |
| INI-14: `LogoMenuSheet`, `SettingsScreen`, `navigationPreferenceStore`, `useNavigationLocation` (4) | La preferencia «barra abajo / menú del logo» deja de existir (la web adapta la barra al ancho). No hay instrucción que la descarte. | Decidir si se ofrece la preferencia; comparar el resto del menú. | **PARCIAL** |
| PLAT-03 `RootNavigator` (1) | Navegación nativa (equivalente) pero incluye la entrada «Ver tutorial», que la web no tiene (ACC-04). | Implementar «volver a ver el tutorial». | **PARCIAL** |
| INI-07 `classSessionNotification` (1) | Notificación persistente de Android durante la clase en curso. La API de notificaciones web existe: no es inevitable. | Decisión de Joaquín (notificaciones web). | **PENDIENTE (decisión)** |
| CFG-02: `BackupScreen`, `dataIntegrity`, `dataIntegrityService` (3) | Funciones visibles del original: «Revisar consistencia», «Limpiar registros huérfanos», «Eliminar reservas sin alumno», «Reparar problemas seguros». La web no tiene una pantalla equivalente. | Implementar el análisis de sólo lectura y las reparaciones seguras, o demostrar caso por caso que la base los impide. | **PARCIAL** |
| PAG-09: `financialReconciliation`, `financialReconciliationService`, `paymentsStore`, `types/index` (4) | La afirmación «la web evita el estado inconsistente» se verifica por categoría en C.4: 11 de 13 están impedidas o cubiertas; 2 no. | Detección de sólo lectura para las 2 restantes. | **PARCIAL** |

### C.4 Reconciliación financiera: las 13 categorías del original contra la web

| Categoría del original | En la web | Evidencia |
|---|---|---|
| duplicate_monthly_charge | Impedida | índice único `payment_charges_mensual_unique` (también semanal/quincenal/por clase/entrenamiento) |
| charge_without_billing_period | Impedida | check `payment_charges_billing_period_required` |
| charge_without_student / payment_without_student | Impedida | `student_id not null references students on delete restrict` |
| allocation_without_payment / allocation_without_charge | Impedida | claves foráneas no nulas en `payment_allocations` |
| negative_balance | Impedida | `register_payment` rechaza superar el saldo («Todavía no se admite saldo a favor»); «Modificar monto mensual» rechaza bajar de lo ya pagado (prueba de Postgres) |
| settled_charge_with_residual_balance | No aplica | importes `numeric(12,2)` exactos; sin redondeo flotante |
| voided_charge_with_active_allocations | Impedida | `void_charge` se rechaza si tiene pagos vigentes |
| voided_payment_with_active_allocations | Equivalente | las asignaciones de un pago anulado se excluyen del cálculo (`paymentVoidedAt`) |
| per_class_charge_incompatible_with_monthly_plan | Cubierta desde hoy | un plan mensual no genera cobros por clase; al cambiar de plan con cobros del mes se exige confirmación y nada se borra (prueba de Postgres, 60 comprobaciones) |
| **plan_amount_diverges_from_charge** | **No detectada** | el flujo nuevo es atómico, pero un cargo importado o anterior puede divergir; falta detección de sólo lectura |
| **monthly_student_without_current_charge** | **No detectada** | la generación ocurre al visitar; una cuenta sin visitas en el mes no recibe su cargo hasta la próxima visita |
| (reparaciones: primer mes proporcional, vencimientos, alumno inactivo, recargo fantasma) | Parcial | primer mes proporcional existe (PAG-05/08 en VERIF); el resto no se mide |

### C.5 Cuentas
- AUT-INSTRUCCIÓN 23 · AUT-TÉCNICA 43 · PENDIENTES 25 (VERIF 5 · PARCIAL 12 · PENDIENTE de decisión 8 — dentro de estos, 4 de sesión única, 3 sin conexión y 1 notificación).
- Resultado: sólo **66 de 91** quedan como diferencias legítimas; 25 vuelven a la lista de trabajo. La Parte B (generada) sigue mostrando la clasificación anterior de los archivos; esta Parte C la corrige para esos 25.


## Parte D — Limitaciones compartidas, política de datos y qué prueba cada cosa (28/10/2026)

### D.1 Generación de cobros bajo demanda: limitación COMPARTIDA con el original
Los cobros mensuales, semanales, quincenales y de entrenamiento se generan **al abrir** Inicio, Cobros, Recordatorios o la ficha del alumno (`ChargeGenerationTrigger` → `ensureCurrentChargesAction`), sólo para el período vigente y con la fecha de Buenos Aires calculada en el servidor. El original hace lo mismo (`runMonthlyChargeGeneration` / `runPeriodicChargeGeneration` al iniciar la aplicación). Consecuencias idénticas en ambos: si no se abre la aplicación durante un período, ese período no se genera hasta la próxima visita, y los períodos salteados **no se rellenan**. Decisión vigente de Joaquín (28/10/2026): no agregar cobros retroactivos ni procesos automáticos que cambien esa regla. La categoría `monthly_student_without_current_charge` del analizador de consistencia lo muestra como aviso, sin generar nada.

### D.2 Importe del plan frente a cargos anteriores: política
- Un cargo ya emitido **nunca** se ajusta con el precio actual. Cada cargo conserva el importe con el que se emitió; el historial de precios (`student_price_history`), las decisiones de primer mes proporcional y la auditoría de cambios de monto (`student_billing_audit`) explican por qué dos meses distintos tienen importes distintos.
- El analizador de consistencia del original (`analyzeFinancialConsistency`) sólo compara el plan con el cargo del **período vigente** y excusa los primeros meses con decisión propia: no mira meses anteriores. La web usa ese mismo analizador (copia idéntica) y mantiene esa regla.
- No se repara ningún dato sin evidencia: la detección es de sólo lectura y las reparaciones del original quedan pendientes hasta que haya un caso concreto con respaldo.

### D.3 Qué pruebas comprueban la implementación web y cuáles son de referencia
| Tipo | Qué prueba | Acredita paridad de la web |
|---|---|---|
| **Referencia** (`lib/original-core`, 2864 pruebas originales) | Que el núcleo copiado del original conserva sus reglas | **No por sí solas**: ejecutan el código del original, no el circuito web |
| **Original sobre copia idéntica en producción** (`lib/payments/engine`, `lib/auth/device-session/sessionAuthorization.ts`, `annual-budget-plan`) | Pruebas originales corriendo contra el código que sí se despliega + guarda byte a byte contra el núcleo | **Sí para esas reglas**, no para la pantalla ni la base |
| **Circuito web** (`student-list-circuit`, `device-circuit`, `plan-form`, `periodic-charge-candidates`) | Registros con la forma de la base → resultado visible, con filtros, orden, persistencia y efectos | **Sí** |
| **Postgres real** (`supabase/tests/postgres/*.cjs`, fuera de la suite de `node --test`) | RPC y restricciones reales: concurrencia, aislamiento entre cuentas, sin duplicados | **Sí** para integridad de datos |
| **Navegador sobre Production** | Recorridos reales con la cuenta de QA | Pendiente (sesión de QA vencida) |
| **Dispositivo físico** | iPhone/Android | Sólo la hace Joaquín |

### D.4 Evidencia de las 43 diferencias técnicas (Parte C.2)
| Grupo | Función que debe conservarse | Evidencia ejecutada | Falta |
|---|---|---|---|
| Sesión y almacenamiento seguro (7) | Sesión persistente y protegida; recuperación de contraseña | Sesión en cookies `HttpOnly`/`Secure`/`SameSite=Lax` (`cookie-options.test`); recuperación por enlace y código (`recovery-session.test`, `login-stale-cookies.test`) | Recorrido de recuperación en navegador (QA) |
| Respaldo y recuperación automáticos (18) | Los datos sobreviven a un cambio de dispositivo y ningún dispositivo vacío pisa datos válidos | Los datos viven en la base: escrituras por RPC atómicas e idempotentes (Postgres real: `billing_plans_amounts`, `calendar_lesson_actions`, `end_series_atomic`); aislamiento entre cuentas (RLS, pruebas de cada RPC); no existe almacenamiento local que pueda sobrescribir | Fecha del último respaldo no se muestra (no hay respaldo que fechar) |
| Archivo de respaldo/restauración (9) | Entrar datos de una copia | Importador `lib/backup/*` (validación, vista previa, importación atómica y deshacer; pruebas `r61_import*`, `transfer-compare`) | Traslado web→móvil: no existe y no se pidió |
| Teclado y almacenes locales (7) | Escribir en un campo nunca queda tapado; integridad de vínculos | Campos ≥ 16 px y diálogos con scroll (guardas de interfaz); claves foráneas `on delete restrict` (migraciones) | **Prueba física en iPhone** |
| Almacenamiento (1) y reexportación (1) | Persistencia / sin lógica | Base de datos; archivo de una línea | — |

Las diferencias de sesión única por dispositivo, que figuraban como pendientes, se **implementaron** (ver ACC-02). Siguen como requisitos por implementar: uso sin conexión (ACC-07) y aviso de clase en curso (INI-07); ver el informe de incompatibilidades.

<!-- INICIO INVENTARIO ARCHIVOS -->

# Parte B — Inventario exhaustivo archivo por archivo (28/10/2026)

<!-- GENERADO por scratchpad/build-matrix.mjs a partir de las reglas de clasificación; no editar a mano: corregir la regla y regenerar. -->

## Resumen del inventario archivo por archivo (473 archivos fuente del original + 295 archivos de prueba)

| Estado | Archivos | Significado |
|---|---:|---|
| EQ | 18 | Equivalente comprobado (con la evidencia citada) |
| VERIF | 206 | Existe un equivalente en la web, falta la comparación campo por campo y el recorrido |
| PARCIAL | 54 | Existe, con diferencias conocidas |
| FALTA | 92 | Falta implementar |
| AUT | 91 | Diferencia inevitable o autorizada, con alternativa |
| N/A | 12 | No aplica (herramienta de QA/prueba del móvil) |

| Módulo | Archivos | EQ | VERIF | PARCIAL | FALTA | AUT | N/A |
|---|---:|---:|---:|---:|---:|---:|---:|
| features/account | 44 | 0 | 21 | 2 | 1 | 20 | 0 |
| features/backup | 8 | 0 | 0 | 0 | 0 | 8 | 0 |
| features/calendar | 72 | 1 | 41 | 16 | 13 | 1 | 0 |
| features/dashboard | 54 | 2 | 26 | 3 | 18 | 5 | 0 |
| features/new-class | 56 | 0 | 20 | 15 | 8 | 13 | 0 |
| features/new-student | 12 | 0 | 12 | 0 | 0 | 0 | 0 |
| features/payments | 88 | 3 | 42 | 6 | 26 | 11 | 0 |
| features/reportes | 15 | 0 | 15 | 0 | 0 | 0 | 0 |
| features/student-profile | 32 | 0 | 17 | 5 | 10 | 0 | 0 |
| features/students | 35 | 1 | 12 | 7 | 15 | 0 | 0 |
| features/transfer | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| navigation | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| qa | 12 | 0 | 0 | 0 | 0 | 0 | 12 |
| shared | 35 | 5 | 0 | 0 | 1 | 29 | 0 |
| theme | 3 | 0 | 0 | 0 | 0 | 3 | 0 |

### features/account

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `AccountScreen.tsx` | 75 | AUT | `/configuracion` | ACC-02 | Pantalla de cuenta conectada. |
| `AuthGate.tsx` | 142 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `AuthSessionContext.tsx` | 29 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `OnboardingTutorialGate.tsx` | 48 | PARCIAL | `components/dashboard/first-steps.tsx` | ACC-04 | Guía de primeros pasos distinta del tutorial salteable de 6 pasos del original; «volver a verlo» no existe. |
| `TeacherProfileGate.tsx` | 75 | VERIF | `components/account/teacher-profile-form.tsx`, `lib/repositories/teacher-profile.ts`, `saveTeacherProfileAction` | ACC-03 |  |
| `components/LiveClassTrackingSection.tsx` | 81 | FALTA | — | INI-07 | Interruptor «Seguimiento de clases». |
| `hooks/teacherProfileStore.ts` | 168 | VERIF | `components/account/teacher-profile-form.tsx`, `lib/repositories/teacher-profile.ts`, `saveTeacherProfileAction` | ACC-03 |  |
| `hooks/useAuthSession.ts` | 843 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `hooks/useTeacherProfile.ts` | 44 | VERIF | `components/account/teacher-profile-form.tsx`, `lib/repositories/teacher-profile.ts`, `saveTeacherProfileAction` | ACC-03 |  |
| `lib/authorizationCacheStore.ts` | 45 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `lib/chunkedSecureStore.ts` | 236 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `lib/deepLinkAuth.ts` | 86 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `lib/deviceId.ts` | 38 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `lib/pendingEmailConfirmationStore.ts` | 47 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `lib/secureStorageAdapter.ts` | 22 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `lib/supabaseClient.ts` | 75 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `lib/supabaseConfig.ts` | 75 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `screens/AccountConfirmedScreen.tsx` | 28 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/AccountConnectedScreen.tsx` | 100 | AUT | `/configuracion` | ACC-02 | Pantalla de cuenta conectada. |
| `screens/AuthEmailConfirmationScreen.tsx` | 185 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/AuthEntryFlow.tsx` | 44 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/AuthErrorScreen.tsx` | 33 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/ConfirmDeviceTransferScreen.tsx` | 120 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `screens/ForgotPasswordScreen.tsx` | 97 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/NewPasswordScreen.tsx` | 105 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/OfflineUnavailableScreen.tsx` | 45 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `screens/OnboardingTutorialScreen.tsx` | 651 | PARCIAL | `components/dashboard/first-steps.tsx` | ACC-04 | Guía de primeros pasos distinta del tutorial salteable de 6 pasos del original; «volver a verlo» no existe. |
| `screens/SignInScreen.tsx` | 126 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/SignUpScreen.tsx` | 158 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `screens/SignedOutElsewhereScreen.tsx` | 48 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `screens/SupabaseNotConfiguredScreen.tsx` | 33 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `screens/TeacherNameOnboardingScreen.tsx` | 166 | VERIF | `components/account/teacher-profile-form.tsx`, `lib/repositories/teacher-profile.ts`, `saveTeacherProfileAction` | ACC-03 |  |
| `screens/accountStyles.ts` | 151 | AUT | Tailwind (`components/auth/*`) | UX-02 | Estilos nativos compartidos. |
| `services/accountDeletionService.ts` | 20 | VERIF | `deleteOwnAccountAction`, `lib/repositories/account-deletion.ts` | ACC-05 |  |
| `services/activeSessionService.ts` | 157 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `utils/authSessionReducer.ts` | 184 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `utils/emailConfirmationCode.ts` | 23 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `utils/maskEmail.ts` | 18 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `utils/normalizeEmail.ts` | 15 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `utils/otpConfirmationError.ts` | 66 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `utils/sanitizeAuthErrorForLog.ts` | 26 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |
| `utils/sessionAuthorization.ts` | 132 | AUT | Sesión de Supabase en cookies (`proxy.ts`, `lib/auth/*`), `endActiveSessionAction` | ACC-07 | Sesión única por dispositivo, almacenamiento seguro, enlaces profundos, modo sin conexión de 24 h: mecánicas nativas (decisión B documentada en `docs/design/web-v1/14`). |
| `utils/teacherName.ts` | 30 | VERIF | `components/account/teacher-profile-form.tsx`, `lib/repositories/teacher-profile.ts`, `saveTeacherProfileAction` | ACC-03 |  |
| `utils/translateAuthError.ts` | 55 | VERIF | `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/recuperar-contrasena`, `app/nueva-contrasena`, `lib/auth/*` | ACC-01 | Comparar campos, validaciones y mensajes de cada pantalla de acceso. |

### features/backup

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `BackupScreen.tsx` | 636 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |
| `CloudBackupRecoveryGate.tsx` | 313 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |
| `CloudBackupSyncContext.tsx` | 37 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |
| `hooks/cloudRecoveryOfferStore.ts` | 35 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |
| `hooks/postRestoreActiveSessionWarningStore.ts` | 43 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |
| `hooks/useCloudBackupSync.ts` | 257 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |
| `hooks/useLastCloudBackupDate.ts` | 58 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |
| `screens/RecoveryStatusScreen.tsx` | 46 | AUT | `/configuracion/respaldo`, `lib/actions/backup.ts` | CFG-01 | Pantallas de respaldo/recuperación en dispositivo nuevo («la nube siempre gana»): la web arranca siempre desde la base. |

### features/calendar

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `CalendarScreen.tsx` | 1 | AUT | `app/(app)/calendario/page.tsx` | CAL-01 | Reexporta la pantalla (1 línea). |
| `CalendarTabScreen.tsx` | 4394 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `InfoScreen.tsx` | 390 | FALTA | — | CAL-17 | Pantalla «Información» del calendario (significado de colores, modalidades y etiquetas). |
| `components/AddParticipantsSheet.tsx` | 803 | PARCIAL | `changeParticipantsAction` (series), `lib/calendar/participants-split.ts` | CAL-09 | Falta agregar/quitar alumnos de una clase suelta/ocurrencia y «Crear alumno nuevo» desde el selector. |
| `components/CalendarLessonActionsSheet.tsx` | 1116 | PARCIAL | `real-lesson-detail-modal.tsx`, `lesson-edit-dialog.tsx` | CAL-05/06/07/08/09/10/11 | Faltan: tipo de actividad, agregar alumnos, reprogramar con disponibilidad visual, acceso a «Editar futuras» desde la clase. |
| `components/CalendarLessonCard.tsx` | 583 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `components/CalendarToolbar.tsx` | 232 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `components/CalendarViewModeControl.tsx` | 176 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `components/ChangeLessonDurationSheet.tsx` | 221 | PARCIAL | `lesson-edit-dialog.tsx`, `lib/calendar/lesson-edit.ts`, migración `20261027100000` (sin aplicar) | CAL-06/07 | Implementado en código y base; pendiente de aplicar la migración y verificar en navegador. |
| `components/EditActivityKindSheet.tsx` | 279 | FALTA | — | CAL-08 | Cambiar Clase ↔ Entrenamiento (con cuota de entrenamiento). |
| `components/EditClassTitleSheet.tsx` | 203 | PARCIAL | `lesson-edit-dialog.tsx`, `lib/calendar/lesson-edit.ts`, migración `20261027100000` (sin aplicar) | CAL-06/07 | Implementado en código y base; pendiente de aplicar la migración y verificar en navegador. |
| `components/EditFutureRecurrenceSheet.tsx` | 207 | VERIF | `/calendario/series[/id]`, `lib/calendar/{recurrence-engine,split,lineage,swap}.ts`, RPC de series | CAL-12/13 | Series: pausar, reanudar, finalizar, editar futuras, versiones, intercambio. |
| `components/FirstMonthProrationSheet.tsx` | 310 | VERIF | `lib/payments/proration.ts`, flujo en `new-lesson-form.tsx`/series | CAL-15 | Primer mes proporcional al sumar un alumno a una serie. |
| `components/NewCalendarLessonSheet.tsx` | 2672 | PARCIAL | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `weekday-schedule-editor.tsx`, `createSingleLessonAction`, `createRecurrenceSeriesAction` | CAL-02/03/12 | Comparar: continuar sin alumno, serie pendiente de asignar, grupo, superposición permitida, buscar horario libre, cuota de entrenamiento al crear, ciclos de 2–4 semanas. |
| `components/RecurrenceOptions.tsx` | 763 | PARCIAL | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `weekday-schedule-editor.tsx`, `createSingleLessonAction`, `createRecurrenceSeriesAction` | CAL-02/03/12 | Comparar: continuar sin alumno, serie pendiente de asignar, grupo, superposición permitida, buscar horario libre, cuota de entrenamiento al crear, ciclos de 2–4 semanas. |
| `components/RecurrenceRulesSheet.tsx` | 275 | VERIF | `/calendario/series[/id]`, `lib/calendar/{recurrence-engine,split,lineage,swap}.ts`, RPC de series | CAL-12/13 | Series: pausar, reanudar, finalizar, editar futuras, versiones, intercambio. |
| `components/RescheduleMonthCalendar.tsx` | 239 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `components/RescheduleTimeSlotGrid.tsx` | 123 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `components/SelectLessonToRescheduleSheet.tsx` | 139 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `components/TeacherAvailabilitySheet.tsx` | 1178 | VERIF | `app/(app)/calendario/disponibilidad/*`, `lib/calendar/availability.ts` | CAL-04 | Comparar vacaciones, bloqueos semanales y excepciones con motivo; aviso al agendar encima. |
| `components/TimeSlotQuickPickSheet.tsx` | 135 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `components/TrainingBillingAgreementSheet.tsx` | 375 | VERIF | `components/payments/training-billing-config.tsx` | CAL-14 |  |
| `components/WeekHeader.tsx` | 143 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `components/WeekTimeGrid.tsx` | 501 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `hooks/calendarExternalSyncEvents.ts` | 32 | VERIF | `lib/repositories/calendar-lessons.ts`, `lib/calendar/timezone.ts`, `lib/calendar/types.ts` | CAL-01 | Modelo, huso y repositorio de clases. |
| `hooks/calendarStore.ts` | 217 | VERIF | `lib/repositories/calendar-lessons.ts`, `lib/calendar/timezone.ts`, `lib/calendar/types.ts` | CAL-01 | Modelo, huso y repositorio de clases. |
| `hooks/recurrenceMutationQueue.ts` | 373 | PARCIAL | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `weekday-schedule-editor.tsx`, `createSingleLessonAction`, `createRecurrenceSeriesAction` | CAL-02/03/12 | Comparar: continuar sin alumno, serie pendiente de asignar, grupo, superposición permitida, buscar horario libre, cuota de entrenamiento al crear, ciclos de 2–4 semanas. |
| `hooks/teacherAvailabilityStore.ts` | 95 | VERIF | `app/(app)/calendario/disponibilidad/*`, `lib/calendar/availability.ts` | CAL-04 | Comparar vacaciones, bloqueos semanales y excepciones con motivo; aviso al agendar encima. |
| `hooks/useFirstMonthProrationFlow.ts` | 155 | VERIF | `lib/payments/proration.ts`, flujo en `new-lesson-form.tsx`/series | CAL-15 | Primer mes proporcional al sumar un alumno a una serie. |
| `hooks/useTeacherAvailability.ts` | 97 | VERIF | `app/(app)/calendario/disponibilidad/*`, `lib/calendar/availability.ts` | CAL-04 | Comparar vacaciones, bloqueos semanales y excepciones con motivo; aviso al agendar encima. |
| `hooks/useTimeSlotQuickPick.ts` | 53 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `hooks/useWeeklyCalendar.ts` | 1437 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `services/completeCalendarLessonService.ts` | 193 | VERIF | `lib/calendar/mutations.ts`, `lib/calendar/occurrences.ts`, `canReuseSlot` | CAL-11 | Reemplazo de cancelaciones y regla de tarjetas visibles. |
| `services/scheduleAdjustmentService.ts` | 188 | FALTA | — | INI-07 | Ajustar horario (atrasar/adelantar sólo esa ocurrencia) desde Inicio. |
| `types/index.ts` | 306 | VERIF | `lib/repositories/calendar-lessons.ts`, `lib/calendar/timezone.ts`, `lib/calendar/types.ts` | CAL-01 | Modelo, huso y repositorio de clases. |
| `types/teacherAvailability.ts` | 69 | VERIF | `app/(app)/calendario/disponibilidad/*`, `lib/calendar/availability.ts` | CAL-04 | Comparar vacaciones, bloqueos semanales y excepciones con motivo; aviso al agendar encima. |
| `utils/calendarActivityKind.ts` | 74 | EQ | `lib/calendar/activity-kind.ts` | CAL-08 | Tipo de actividad (rótulos, tareas). |
| `utils/calendarAnalytics.ts` | 298 | VERIF | `lib/reports/demand.ts`, `lib/dashboard/load-financial-overview.ts` | INI-13 | Demanda semanal/horaria. |
| `utils/calendarClassTitle.ts` | 44 | PARCIAL | `lesson-edit-dialog.tsx`, `lib/calendar/lesson-edit.ts`, migración `20261027100000` (sin aplicar) | CAL-06/07 | Implementado en código y base; pendiente de aplicar la migración y verificar en navegador. |
| `utils/calendarClassTitleFromDate.ts` | 110 | PARCIAL | `lesson-edit-dialog.tsx`, `lib/calendar/lesson-edit.ts`, migración `20261027100000` (sin aplicar) | CAL-06/07 | Implementado en código y base; pendiente de aplicar la migración y verificar en navegador. |
| `utils/calendarConflicts.ts` | 183 | VERIF | `lib/calendar-conflicts.ts`, `lib/calendar/future-conflicts.ts` | CAL-16 |  |
| `utils/calendarDailyDemand.ts` | 150 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `utils/calendarDates.ts` | 14 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `utils/calendarDayGridLayout.ts` | 217 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `utils/calendarDayIso.ts` | 27 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `utils/calendarDemandSummary.ts` | 174 | VERIF | `lib/reports/demand.ts`, `lib/dashboard/load-financial-overview.ts` | INI-13 | Demanda semanal/horaria. |
| `utils/calendarDurationEdit.ts` | 112 | PARCIAL | `lesson-edit-dialog.tsx`, `lib/calendar/lesson-edit.ts`, migración `20261027100000` (sin aplicar) | CAL-06/07 | Implementado en código y base; pendiente de aplicar la migración y verificar en navegador. |
| `utils/calendarLessonLayout.ts` | 96 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `utils/calendarMonthGrid.ts` | 45 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `utils/calendarNextClassAt.ts` | 311 | VERIF | `lib/calendar/next-class.ts` | INI-01 | El campo derivado `nextClassAt` del móvil no existe: la web lo calcula al leer. |
| `utils/calendarNextClassAtSync.ts` | 92 | VERIF | `lib/calendar/next-class.ts` | INI-01 | El campo derivado `nextClassAt` del móvil no existe: la web lo calcula al leer. |
| `utils/calendarOccurrenceCounting.ts` | 303 | VERIF | `/calendario/series[/id]`, `lib/calendar/{recurrence-engine,split,lineage,swap}.ts`, RPC de series | CAL-12/13 | Series: pausar, reanudar, finalizar, editar futuras, versiones, intercambio. |
| `utils/calendarOccurrenceIntegrityAudit.ts` | 117 | VERIF | `/calendario/series[/id]`, `lib/calendar/{recurrence-engine,split,lineage,swap}.ts`, RPC de series | CAL-12/13 | Series: pausar, reanudar, finalizar, editar futuras, versiones, intercambio. |
| `utils/calendarParticipants.ts` | 152 | PARCIAL | `changeParticipantsAction` (series), `lib/calendar/participants-split.ts` | CAL-09 | Falta agregar/quitar alumnos de una clase suelta/ocurrencia y «Crear alumno nuevo» desde el selector. |
| `utils/calendarParticipantsFromDate.ts` | 189 | PARCIAL | `changeParticipantsAction` (series), `lib/calendar/participants-split.ts` | CAL-09 | Falta agregar/quitar alumnos de una clase suelta/ocurrencia y «Crear alumno nuevo» desde el selector. |
| `utils/calendarPendingRecurrence.ts` | 65 | PARCIAL | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `weekday-schedule-editor.tsx`, `createSingleLessonAction`, `createRecurrenceSeriesAction` | CAL-02/03/12 | Comparar: continuar sin alumno, serie pendiente de asignar, grupo, superposición permitida, buscar horario libre, cuota de entrenamiento al crear, ciclos de 2–4 semanas. |
| `utils/calendarRecurrenceDraftValidation.ts` | 51 | PARCIAL | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `weekday-schedule-editor.tsx`, `createSingleLessonAction`, `createRecurrenceSeriesAction` | CAL-02/03/12 | Comparar: continuar sin alumno, serie pendiente de asignar, grupo, superposición permitida, buscar horario libre, cuota de entrenamiento al crear, ciclos de 2–4 semanas. |
| `utils/calendarRecurrenceEngine.ts` | 349 | VERIF | `/calendario/series[/id]`, `lib/calendar/{recurrence-engine,split,lineage,swap}.ts`, RPC de series | CAL-12/13 | Series: pausar, reanudar, finalizar, editar futuras, versiones, intercambio. |
| `utils/calendarRecurrenceMutations.ts` | 310 | VERIF | `/calendario/series[/id]`, `lib/calendar/{recurrence-engine,split,lineage,swap}.ts`, RPC de series | CAL-12/13 | Series: pausar, reanudar, finalizar, editar futuras, versiones, intercambio. |
| `utils/calendarRecurrenceSplit.ts` | 1001 | VERIF | `/calendario/series[/id]`, `lib/calendar/{recurrence-engine,split,lineage,swap}.ts`, RPC de series | CAL-12/13 | Series: pausar, reanudar, finalizar, editar futuras, versiones, intercambio. |
| `utils/calendarRecurrenceTemplateEditing.ts` | 111 | PARCIAL | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `weekday-schedule-editor.tsx`, `createSingleLessonAction`, `createRecurrenceSeriesAction` | CAL-02/03/12 | Comparar: continuar sin alumno, serie pendiente de asignar, grupo, superposición permitida, buscar horario libre, cuota de entrenamiento al crear, ciclos de 2–4 semanas. |
| `utils/calendarStudentIntegrity.ts` | 190 | VERIF | `lib/repositories/calendar-lessons.ts`, `lib/calendar/timezone.ts`, `lib/calendar/types.ts` | CAL-01 | Modelo, huso y repositorio de clases. |
| `utils/calendarTimeSlots.ts` | 39 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |
| `utils/calendarTimezone.ts` | 180 | VERIF | `lib/repositories/calendar-lessons.ts`, `lib/calendar/timezone.ts`, `lib/calendar/types.ts` | CAL-01 | Modelo, huso y repositorio de clases. |
| `utils/calendarVisualLegend.ts` | 301 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `utils/calendarWeekday.ts` | 18 | VERIF | `components/calendar/real-calendar-grid.tsx`, `real-lesson-card.tsx`, `lib/calendar/{layout,view,occurrences}.ts`, `lib/calendar-theme.ts` | CAL-01 | Grilla Semana/Día, densidades, escala fija (pendiente de tu comprobación física). |
| `utils/cancelledSlotReuse.ts` | 234 | VERIF | `lib/calendar/mutations.ts`, `lib/calendar/occurrences.ts`, `canReuseSlot` | CAL-11 | Reemplazo de cancelaciones y regla de tarjetas visibles. |
| `utils/firstMonthProrationCandidates.ts` | 69 | VERIF | `lib/payments/proration.ts`, flujo en `new-lesson-form.tsx`/series | CAL-15 | Primer mes proporcional al sumar un alumno a una serie. |
| `utils/pendingStudentSelection.ts` | 82 | PARCIAL | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `weekday-schedule-editor.tsx`, `createSingleLessonAction`, `createRecurrenceSeriesAction` | CAL-02/03/12 | Comparar: continuar sin alumno, serie pendiente de asignar, grupo, superposición permitida, buscar horario libre, cuota de entrenamiento al crear, ciclos de 2–4 semanas. |
| `utils/scheduleAdjustment.ts` | 111 | FALTA | — | INI-07 | Ajustar horario (atrasar/adelantar sólo esa ocurrencia) desde Inicio. |
| `utils/teacherAvailabilityEngine.ts` | 198 | VERIF | `app/(app)/calendario/disponibilidad/*`, `lib/calendar/availability.ts` | CAL-04 | Comparar vacaciones, bloqueos semanales y excepciones con motivo; aviso al agendar encima. |
| `utils/timeSlotQuickPick.ts` | 82 | FALTA | — (la web pide fecha y hora con campos nativos) | CAL-03/05 | Calendario mensual con color de demanda, grilla de horarios libres/ocupados y selección de 15 min. |

### features/dashboard

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `FinancialOverviewScreen.tsx` | 141 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `HomeScreen.tsx` | 528 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `MonthlyPaymentBehaviorScreen.tsx` | 47 | FALTA | — | INI-12 | Comportamiento de pago, últimos 12 meses. |
| `PendingClassesScreen.tsx` | 154 | VERIF | `/registro`, `lib/lessons/pending.ts` | INI-08 | Regla «por registrar sólo después de finalizar». |
| `RemindersCenterScreen.tsx` | 284 | EQ | `/recordatorios`, `lib/dashboard/reminders-center.ts` | INI-09 | Cerrado en §21 de TRASLADO. |
| `SettingsScreen.tsx` | 229 | AUT | `/configuracion`, `components/nav/primary-nav.tsx` | INI-14 | Ubicación de la navegación y menú del logo: navegación propia de la web. |
| `components/ActiveClassCard.tsx` | 342 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `components/AnnualBudgetChart.tsx` | 430 | PARCIAL | `components/finance/annual-projection.tsx` | INI-10 | Implementado el 28/10/2026: lógica portada con las 13 pruebas originales (`annual-budget-plan.test.ts`) y 7 propias; pantalla `components/finance/annual-projection.tsx`. **Sin publicar**; falta verificar en navegador con QA. |
| `components/BudgetDistributionCard.tsx` | 249 | PARCIAL | `components/finance/budget-suggestion.tsx`, `budget-adjust-dialog.tsx`, `lib/payments/budget-distribution.ts`, `saveBudgetDistributionAction` | INI-10 | Tres barras 50/30/20 sobre lo cobrado, ajuste y «Restablecer 50/30/20» (agregado el 28/10, sin publicar). **Defecto corregido: guardar los porcentajes ya no borra el objetivo de ahorro.** |
| `components/CollectionsCenterSummaryCard.tsx` | 111 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/DailyCollectionsNoticeBanner.tsx` | 160 | FALTA | — | INI-05 | Aviso diario de cobros con «Recordarme mañana». |
| `components/DayAgenda.tsx` | 141 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/EmptyClassesNotice.tsx` | 144 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/EmptyState.tsx` | 66 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/FinancialAnalyticsSections.tsx` | 558 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `components/FinancialOverviewTabs.tsx` | 83 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `components/FinancialSummary.tsx` | 124 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `components/Header.tsx` | 118 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/LiveClassTrackingSwitch.tsx` | 68 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `components/LogoMenuSheet.tsx` | 410 | AUT | `/configuracion`, `components/nav/primary-nav.tsx` | INI-14 | Ubicación de la navegación y menú del logo: navegación propia de la web. |
| `components/MonthlyPaymentBehaviorChart.tsx` | 207 | FALTA | — | INI-12 | Comportamiento de pago, últimos 12 meses. |
| `components/NextClassCard.tsx` | 282 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `components/NotificationBell.tsx` | 74 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/OfflineProtectionBanner.tsx` | 63 | AUT | — | CFG-01 | Aviso de protección sin conexión del respaldo local. |
| `components/PendingClasses.tsx` | 171 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/QuickActions.tsx` | 58 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `components/RestoredActiveSessionNotice.tsx` | 113 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `components/SavingsGoalControl.tsx` | 251 | PARCIAL | `components/finance/savings-goal-form.tsx`, `lib/payments/savings-goal.ts`, `saveSavingsGoalAction`, `applyBudgetPresetAction` | INI-11 | Implementado el 28/10/2026 (progreso, reserva mensual, % sugerido, aplicar sugerencia; monto con interpretación estricta). **Sin publicar**; falta verificar en navegador. Además se corrigió la pérdida de datos: ajustar porcentajes ya no borra el objetivo importado. |
| `components/ScheduleAdjustSheet.tsx` | 248 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `components/StartClassPunctualityDialog.tsx` | 254 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `components/StatsRow.tsx` | 73 | FALTA | — | INI-03 | Horas enseñadas del mes y promedio de evaluaciones (fórmula en `buildDashboardData.ts`). |
| `hooks/activeClassSessionStore.ts` | 94 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `hooks/liveClassTrackingStore.ts` | 42 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `hooks/navigationPreferenceStore.ts` | 68 | AUT | `/configuracion`, `components/nav/primary-nav.tsx` | INI-14 | Ubicación de la navegación y menú del logo: navegación propia de la web. |
| `hooks/useActiveClassSession.ts` | 110 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `hooks/useDashboardData.ts` | 105 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `hooks/useFinancialAnalytics.ts` | 289 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `hooks/useHomeFinancialSummary.ts` | 73 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `hooks/useLiveClassTracking.ts` | 45 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `hooks/useMonthlyPaymentBehavior.ts` | 39 | FALTA | — | INI-12 | Comportamiento de pago, últimos 12 meses. |
| `hooks/useNavigationLocation.ts` | 37 | AUT | `/configuracion`, `components/nav/primary-nav.tsx` | INI-14 | Ubicación de la navegación y menú del logo: navegación propia de la web. |
| `hooks/usePostRestoreActiveSessionWarning.ts` | 35 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `types/index.ts` | 189 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `utils/activeClassTiming.ts` | 58 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `utils/annualActivitySummary.ts` | 200 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `utils/buildDashboardData.ts` | 165 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `utils/buildFinishClassNavigationParams.ts` | 48 | FALTA | — (la web sólo muestra «clase en curso» como lectura en `home-view.tsx`) | INI-07 | Comenzar clase, contador, puntualidad, ajustar horario, finalizar, aviso de sesión restaurada. |
| `utils/calendarOccurrenceRange.ts` | 53 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `utils/emptyClasses.ts` | 140 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `utils/formatCurrency.ts` | 8 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `utils/notificationBell.ts` | 29 | VERIF | `components/dashboard/home-view.tsx`, `lib/dashboard/load-home-data.ts`, `lib/calendar/empty-classes.ts` | INI-01 | Agenda, próxima clase, sin alumnos, campana, accesos (§21 de TRASLADO). |
| `utils/pendingClasses.ts` | 206 | VERIF | `/registro`, `lib/lessons/pending.ts` | INI-08 | Regla «por registrar sólo después de finalizar». |
| `utils/programmedHourlyRateSummary.ts` | 391 | VERIF | `components/finance/financial-overview-view.tsx`, `lib/dashboard/load-financial-overview.ts`, `lib/reports/*` (§22 de TRASLADO: cifras reproducidas) | INI-13 | Comparar secciones y definiciones («Cómo se calcula»). |
| `utils/remindersCenter.ts` | 141 | EQ | `/recordatorios`, `lib/dashboard/reminders-center.ts` | INI-09 | Cerrado en §21 de TRASLADO. |

### features/new-class

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `NewClassScreen.tsx` | 825 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `components/AttachmentList.tsx` | 306 | VERIF | `lesson-files-editor.tsx`, `lib/lessons/attachments.ts`, `lib/repositories/lesson-files-write.ts` | REG-10 | Fotos, HEIC, PDF, leyendas, alcance, biblioteca (§25). Cámara = prueba en dispositivo. |
| `components/AttendanceRow.tsx` | 145 | PARCIAL | `registration-workspace.tsx` (+ «Marcar todos presentes» `95e56b4`) | REG-01/02 | Asistencia por alumno y resumen; resumen «Revisá estos datos» → VERIF. |
| `components/AttendanceSection.tsx` | 143 | PARCIAL | `registration-workspace.tsx` (+ «Marcar todos presentes» `95e56b4`) | REG-01/02 | Asistencia por alumno y resumen; resumen «Revisá estos datos» → VERIF. |
| `components/BillingSection.tsx` | 206 | FALTA | — | REG-04 | ¿Es cobrable? / ¿Consume una clase de la cuota mensual? + política de cancelación tardía (sólo alumnos por clase). |
| `components/ChipTextList.tsx` | 194 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `components/CollapsibleSection.tsx` | 130 | PARCIAL | `registration-workspace.tsx` (+ «Marcar todos presentes» `95e56b4`) | REG-01/02 | Asistencia por alumno y resumen; resumen «Revisá estos datos» → VERIF. |
| `components/DateTimeField.tsx` | 274 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `components/DurationField.tsx` | 74 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `components/EditRegisteredLessonSheet.tsx` | 692 | VERIF | `editCompletedRegistrationAction`, `/registro/[id]` en edición | REG-06 | Editar registro finalizado; cambiar el resultado de una clase ya finalizada → comprobar. |
| `components/EvaluationSection.tsx` | 312 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `components/HomeworkSection.tsx` | 410 | VERIF | `registration-form-parts.tsx`, `lib/lessons/homework*.ts` | REG-09 | Tareas comunes/personalizadas, revisión posterior y fecha de entrega entre las próximas clases reales. |
| `components/LateCancellationPolicySheet.tsx` | 227 | VERIF | `registration-outcome-field.tsx`, `lib/lessons/registration-outcome.ts` | REG-03 | Resultados y política de cancelación tardía. |
| `components/LessonOutcomeField.tsx` | 170 | VERIF | `registration-outcome-field.tsx`, `lib/lessons/registration-outcome.ts` | REG-03 | Resultados y política de cancelación tardía. |
| `components/MaterialLibraryPicker.tsx` | 360 | VERIF | `lesson-files-editor.tsx`, `lib/lessons/attachments.ts`, `lib/repositories/lesson-files-write.ts` | REG-10 | Fotos, HEIC, PDF, leyendas, alcance, biblioteca (§25). Cámara = prueba en dispositivo. |
| `components/ParticipantRegistrationBlock.tsx` | 358 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `components/PedagogicalContentSection.tsx` | 138 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `components/PendingClassOutcomeSelector.tsx` | 146 | VERIF | `registration-outcome-field.tsx`, `lib/lessons/registration-outcome.ts` | REG-03 | Resultados y política de cancelación tardía. |
| `components/PendingHomeworkCard.tsx` | 170 | VERIF | `registration-form-parts.tsx`, `lib/lessons/homework*.ts` | REG-09 | Tareas comunes/personalizadas, revisión posterior y fecha de entrega entre las próximas clases reales. |
| `components/PendingHomeworkSection.tsx` | 53 | VERIF | `registration-form-parts.tsx`, `lib/lessons/homework*.ts` | REG-09 | Tareas comunes/personalizadas, revisión posterior y fecha de entrega entre las próximas clases reales. |
| `components/RegisterPendingClassSheet.tsx` | 1459 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `components/SkillGradeChips.tsx` | 231 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `components/SkillGradeInput.tsx` | 75 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `components/StudentOrGroupPicker.tsx` | 204 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `components/TopicChecklist.tsx` | 271 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `hooks/materialsLibraryStore.ts` | 36 | VERIF | `lesson-files-editor.tsx`, `lib/lessons/attachments.ts`, `lib/repositories/lesson-files-write.ts` | REG-10 | Fotos, HEIC, PDF, leyendas, alcance, biblioteca (§25). Cámara = prueba en dispositivo. |
| `hooks/savedLessonsStore.ts` | 39 | AUT | Base de datos / navegador | UX-01 | Almacén local, diagnóstico de vínculos (la web usa claves foráneas) y seguimiento de campo con teclado nativo. |
| `hooks/useActiveFieldVisibility.ts` | 316 | AUT | Base de datos / navegador | UX-01 | Almacén local, diagnóstico de vínculos (la web usa claves foráneas) y seguimiento de campo con teclado nativo. |
| `hooks/useEditRegisteredLesson.ts` | 184 | VERIF | `editCompletedRegistrationAction`, `/registro/[id]` en edición | REG-06 | Editar registro finalizado; cambiar el resultado de una clase ya finalizada → comprobar. |
| `hooks/useMaterialsLibrary.ts` | 42 | VERIF | `lesson-files-editor.tsx`, `lib/lessons/attachments.ts`, `lib/repositories/lesson-files-write.ts` | REG-10 | Fotos, HEIC, PDF, leyendas, alcance, biblioteca (§25). Cámara = prueba en dispositivo. |
| `hooks/useNewClassForm.ts` | 184 | PARCIAL | `registration-workspace.tsx` (+ «Marcar todos presentes» `95e56b4`) | REG-01/02 | Asistencia por alumno y resumen; resumen «Revisá estos datos» → VERIF. |
| `hooks/usePendingHomeworkTasks.ts` | 43 | VERIF | `registration-form-parts.tsx`, `lib/lessons/homework*.ts` | REG-09 | Tareas comunes/personalizadas, revisión posterior y fecha de entrega entre las próximas clases reales. |
| `hooks/useSaveClass.ts` | 229 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `hooks/useSaveGroupDraft.ts` | 113 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `hooks/useUpcomingOccurrenceOptions.ts` | 71 | VERIF | `registration-form-parts.tsx`, `lib/lessons/homework*.ts` | REG-09 | Tareas comunes/personalizadas, revisión posterior y fecha de entrega entre las próximas clases reales. |
| `services/manualSessionCorrectionService.ts` | 34 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `types/index.ts` | 472 | VERIF | `lib/repositories/lesson-registrations-mapping.ts`, `lib/lessons/*` | REG-01 | Modelo de clase guardada. |
| `utils/activeFieldVisibility.ts` | 307 | AUT | Base de datos / navegador | UX-01 | Almacén local, diagnóstico de vínculos (la web usa claves foráneas) y seguimiento de campo con teclado nativo. |
| `utils/attachmentKind.ts` | 17 | VERIF | `lesson-files-editor.tsx`, `lib/lessons/attachments.ts`, `lib/repositories/lesson-files-write.ts` | REG-10 | Fotos, HEIC, PDF, leyendas, alcance, biblioteca (§25). Cámara = prueba en dispositivo. |
| `utils/attendanceScrollTarget.ts` | 24 | AUT | Base de datos / navegador | UX-01 | Almacén local, diagnóstico de vínculos (la web usa claves foráneas) y seguimiento de campo con teclado nativo. |
| `utils/editRegisteredLessonDomain.ts` | 285 | VERIF | `editCompletedRegistrationAction`, `/registro/[id]` en edición | REG-06 | Editar registro finalizado; cambiar el resultado de una clase ya finalizada → comprobar. |
| `utils/groupRegistrationDomain.ts` | 179 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `utils/homeworkPendingDomain.ts` | 312 | VERIF | `registration-form-parts.tsx`, `lib/lessons/homework*.ts` | REG-09 | Tareas comunes/personalizadas, revisión posterior y fecha de entrega entre las próximas clases reales. |
| `utils/lessonAttachments.ts` | 257 | VERIF | `lesson-files-editor.tsx`, `lib/lessons/attachments.ts`, `lib/repositories/lesson-files-write.ts` | REG-10 | Fotos, HEIC, PDF, leyendas, alcance, biblioteca (§25). Cámara = prueba en dispositivo. |
| `utils/lessonRegistrationDomain.ts` | 283 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |
| `utils/manualSessionCorrection.ts` | 61 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `utils/punctualityClassification.ts` | 61 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `utils/punctualityScoreEntries.ts` | 25 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `utils/punctualityScoring.ts` | 140 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `utils/punctualityStats.ts` | 10 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `utils/savedLessonLinkageDiagnostics.ts` | 228 | AUT | Base de datos / navegador | UX-01 | Almacén local, diagnóstico de vínculos (la web usa claves foráneas) y seguimiento de campo con teclado nativo. |
| `utils/skillGradeDomain.ts` | 64 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `utils/studentSessionHistory.ts` | 47 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `utils/textItemEditDomain.ts` | 19 | AUT | `registration-form-parts.tsx` (barra 1–10), `pedagogical-content-editor.tsx`, `editable-text-list.tsx` | REG-07/08 | Diferencia autorizada por decisiones de Joaquín: sin Planificado/Visto, listas editables sin borrar, calificaciones accesibles (barra, botones − y +). El resto del contenido (temas, objetivos, actividades, notas, observaciones) → VERIF. |
| `utils/upcomingHomeworkOccurrences.ts` | 99 | VERIF | `registration-form-parts.tsx`, `lib/lessons/homework*.ts` | REG-09 | Tareas comunes/personalizadas, revisión posterior y fecha de entrega entre las próximas clases reales. |
| `utils/validation.ts` | 123 | PARCIAL | `registration-workspace.tsx`, `/registro/nuevo`, `lib/lessons/registration-form.ts` | REG-01/11/12/13 | Falta el «ciclo real» (horario efectivo, finalización real, demora computable); aviso de vacaciones en la fecha. |

### features/new-student

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `NewStudentScreen.tsx` | 988 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `components/StudentAcademicSection.tsx` | 1 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `components/StudentBasicInfoSection.tsx` | 1 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `components/StudentBillingSection.tsx` | 1 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `components/StudentContactSection.tsx` | 1 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `components/StudentFormFooter.tsx` | 1 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `components/StudentNotesSection.tsx` | 1 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `components/StudentScheduleSection.tsx` | 1 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `hooks/useNewStudentForm.ts` | 85 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `types/index.ts` | 68 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `utils/studentMapper.ts` | 258 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |
| `utils/studentValidation.ts` | 111 | VERIF | `student-form-page.tsx`, `student-form-fields.tsx`, `createStudentAction`/`updateStudentAction` | ALU-04/05 | Campos y validaciones; faltan planes semanal/quincenal/paquete/sin cargo y «Situación del primer mes» (ALU-05). |

### features/payments

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `CollectionsCenterScreen.tsx` | 345 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `components/ClassPaymentPromptModal.tsx` | 654 | EQ | `components/registro/class-payment-prompt.tsx`, `lib/payments/registration-payment-prompt.ts` | REG-05 | Estructura y reglas recuperadas (`de55143`); verificación en navegador y dispositivo pendientes. |
| `components/CurrencyInput.tsx` | 102 | AUT | `lib/format/money-input.ts` (interpretación estricta, centavos exactos) | PAG-02 | Diferencia autorizada: el original aceptaba sólo pesos enteros y formateaba al escribir; la web interpreta con reglas estrictas (decisión vigente). |
| `components/EditMonthlyAmountSheet.tsx` | 327 | FALTA | — | PAG-04 | Modificar monto mensual (desde este mes / próximo mes) con recálculo del saldo. |
| `components/PaymentHistorySection.tsx` | 292 | FALTA | — | PAG-07 | Historial y riesgo de deuda por alumno (12 meses, racha, en término/fuera de término). |
| `components/PaymentsHydrationErrorScreen.tsx` | 104 | VERIF | `lib/dashboard/load-financial-overview.ts`, `lib/reports/financial-summary.ts` | INI-04 | Resúmenes por período. |
| `components/RegisterPaymentSheet.tsx` | 575 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `components/SurchargeSettingsPanel.tsx` | 566 | AUT | Recargos apagados estructuralmente (`lib/payments/due-stage.ts`) | PAG-06 | Decisión de negocio confirmada: sin recargos automáticos. |
| `components/VoidChargeDialog.tsx` | 239 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `components/VoidPaymentDialog.tsx` | 186 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `hooks/budgetDistributionStore.ts` | 245 | PARCIAL | `components/finance/budget-suggestion.tsx`, `budget-adjust-dialog.tsx`, `lib/payments/budget-distribution.ts`, `saveBudgetDistributionAction` | INI-10 | Tres barras 50/30/20 sobre lo cobrado, ajuste y «Restablecer 50/30/20» (agregado el 28/10, sin publicar). **Defecto corregido: guardar los porcentajes ya no borra el objetivo de ahorro.** |
| `hooks/dailyCollectionsNoticeStore.ts` | 54 | FALTA | — | INI-05 | Aviso diario. |
| `hooks/firstMonthProrationDecisionStore.ts` | 220 | VERIF | `lib/payments/proration.ts`, `lib/payments/training-charge-plan.ts` | CAL-15 | Primer mes proporcional y primer vencimiento. |
| `hooks/initialPaidSurchargeCorrectionLogStore.ts` | 86 | FALTA | — | PAG-05 | Situación inicial del alumno mensual, «marcar mes actual pagado» y retomar el cobro al reactivar. |
| `hooks/monthlyAmountCorrectionLogStore.ts` | 77 | FALTA | — | PAG-04 | Modificar monto mensual (desde este mes / próximo mes) con recálculo del saldo. |
| `hooks/packagesStore.ts` | 196 | FALTA | — | PAG-01 | Paquetes de clases (compra, créditos, consumo) y cargos semanales/quincenales. |
| `hooks/paymentsStore.ts` | 271 | AUT | Restricciones y RPC atómicos en base; `docs/P0_REGISTRO_20261021.md` | PAG-09 | Reconciliación automática del almacén local: la web evita el estado inconsistente en la base. |
| `hooks/pendingTrainingBillingOperationsStore.ts` | 305 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |
| `hooks/surchargeSettingsStore.ts` | 255 | AUT | Recargos apagados estructuralmente (`lib/payments/due-stage.ts`) | PAG-06 | Decisión de negocio confirmada: sin recargos automáticos. |
| `hooks/trainingBillingAgreementsStore.ts` | 265 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |
| `hooks/useAnnualBudgetPlan.ts` | 65 | PARCIAL | `lib/payments/annual-budget-plan.ts`, `lib/dashboard/load-financial-overview.ts` (`annual`) | INI-10 | Implementado el 28/10/2026: lógica portada con las 13 pruebas originales (`annual-budget-plan.test.ts`) y 7 propias; pantalla `components/finance/annual-projection.tsx`. **Sin publicar**; falta verificar en navegador con QA. |
| `hooks/useBudgetDistribution.ts` | 111 | PARCIAL | `components/finance/budget-suggestion.tsx`, `budget-adjust-dialog.tsx`, `lib/payments/budget-distribution.ts`, `saveBudgetDistributionAction` | INI-10 | Tres barras 50/30/20 sobre lo cobrado, ajuste y «Restablecer 50/30/20» (agregado el 28/10, sin publicar). **Defecto corregido: guardar los porcentajes ya no borra el objetivo de ahorro.** |
| `hooks/useCollectionsCenter.ts` | 70 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `hooks/useDailyCollectionsNotice.ts` | 77 | FALTA | — | INI-05 | Aviso diario. |
| `hooks/useStudentPaymentHistory.ts` | 49 | FALTA | — (hay `due-stage.ts` y urgencias, sin semáforo ni estado del período) | ALU-02/PAG-10 | Semáforo de cobro y estado del período mensual para chips de Alumnos y perfil. |
| `hooks/useStudentPayments.ts` | 55 | FALTA | — (hay `due-stage.ts` y urgencias, sin semáforo ni estado del período) | ALU-02/PAG-10 | Semáforo de cobro y estado del período mensual para chips de Alumnos y perfil. |
| `hooks/useSurchargeSettings.ts` | 36 | AUT | Recargos apagados estructuralmente (`lib/payments/due-stage.ts`) | PAG-06 | Decisión de negocio confirmada: sin recargos automáticos. |
| `hooks/useTodayDateKey.ts` | 53 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `services/financialReconciliationService.ts` | 422 | AUT | Restricciones y RPC atómicos en base; `docs/P0_REGISTRO_20261021.md` | PAG-09 | Reconciliación automática del almacén local: la web evita el estado inconsistente en la base. |
| `services/firstMonthProrationRepairService.ts` | 112 | VERIF | `lib/payments/proration.ts`, `lib/payments/training-charge-plan.ts` | CAL-15 | Primer mes proporcional y primer vencimiento. |
| `services/firstMonthProrationReviewService.ts` | 86 | VERIF | `lib/payments/proration.ts`, `lib/payments/training-charge-plan.ts` | CAL-15 | Primer mes proporcional y primer vencimiento. |
| `services/firstMonthProrationService.ts` | 550 | VERIF | `lib/payments/proration.ts`, `lib/payments/training-charge-plan.ts` | CAL-15 | Primer mes proporcional y primer vencimiento. |
| `services/initialMonthlyBillingService.ts` | 254 | FALTA | — | PAG-05 | Situación inicial del alumno mensual, «marcar mes actual pagado» y retomar el cobro al reactivar. |
| `services/initialPaidSurchargeRepairService.ts` | 215 | FALTA | — | PAG-05 | Situación inicial del alumno mensual, «marcar mes actual pagado» y retomar el cobro al reactivar. |
| `services/monthlyAmountCorrectionService.ts` | 223 | FALTA | — | PAG-04 | Modificar monto mensual (desde este mes / próximo mes) con recálculo del saldo. |
| `services/monthlyChargeGenerationService.ts` | 105 | VERIF | `lib/payments/monthly-charge-plan.ts`, `ensure_monthly_charges`, `sync_per_class_charge` | PAG-01 | Generación mensual y por clase; semanal/quincenal/paquete: FALTA. |
| `services/packagePurchaseService.ts` | 142 | FALTA | — | PAG-01 | Paquetes de clases (compra, créditos, consumo) y cargos semanales/quincenales. |
| `services/perClassChargeAmountCorrectionService.ts` | 84 | VERIF | `lib/payments/monthly-charge-plan.ts`, `ensure_monthly_charges`, `sync_per_class_charge` | PAG-01 | Generación mensual y por clase; semanal/quincenal/paquete: FALTA. |
| `services/perClassChargeReconciliationService.ts` | 87 | VERIF | `lib/payments/monthly-charge-plan.ts`, `ensure_monthly_charges`, `sync_per_class_charge` | PAG-01 | Generación mensual y por clase; semanal/quincenal/paquete: FALTA. |
| `services/periodicChargeGenerationService.ts` | 120 | FALTA | — | PAG-01 | Paquetes de clases (compra, créditos, consumo) y cargos semanales/quincenales. |
| `services/registerClassPaymentService.ts` | 75 | EQ | `components/registro/class-payment-prompt.tsx`, `lib/payments/registration-payment-prompt.ts` | REG-05 | Estructura y reglas recuperadas (`de55143`); verificación en navegador y dispositivo pendientes. |
| `services/registerPaymentService.ts` | 125 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `services/surchargeSettingsService.ts` | 152 | AUT | Recargos apagados estructuralmente (`lib/payments/due-stage.ts`) | PAG-06 | Decisión de negocio confirmada: sin recargos automáticos. |
| `services/trainingBillingConfigurationCoordinator.ts` | 283 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |
| `services/trainingBillingOperationReconciliationService.ts` | 301 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |
| `services/trainingChargeGenerationService.ts` | 178 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |
| `services/trainingFirstPeriodRepairService.ts` | 195 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |
| `services/voidChargeService.ts` | 65 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `services/voidPaymentService.ts` | 49 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `types/index.ts` | 449 | AUT | Restricciones y RPC atómicos en base; `docs/P0_REGISTRO_20261021.md` | PAG-09 | Reconciliación automática del almacén local: la web evita el estado inconsistente en la base. |
| `utils/annualBudgetProjection.ts` | 196 | PARCIAL | `lib/payments/annual-budget-plan.ts`, `lib/dashboard/load-financial-overview.ts` (`annual`) | INI-10 | Implementado el 28/10/2026: lógica portada con las 13 pruebas originales (`annual-budget-plan.test.ts`) y 7 propias; pantalla `components/finance/annual-projection.tsx`. **Sin publicar**; falta verificar en navegador con QA. |
| `utils/budgetDistribution.ts` | 245 | PARCIAL | `components/finance/budget-suggestion.tsx`, `budget-adjust-dialog.tsx`, `lib/payments/budget-distribution.ts`, `saveBudgetDistributionAction` | INI-10 | Tres barras 50/30/20 sobre lo cobrado, ajuste y «Restablecer 50/30/20» (agregado el 28/10, sin publicar). **Defecto corregido: guardar los porcentajes ya no borra el objetivo de ahorro.** |
| `utils/buildClassPaymentPromptQueue.ts` | 58 | EQ | `components/registro/class-payment-prompt.tsx`, `lib/payments/registration-payment-prompt.ts` | REG-05 | Estructura y reglas recuperadas (`de55143`); verificación en navegador y dispositivo pendientes. |
| `utils/buildHomeFinancialSummary.ts` | 209 | VERIF | `lib/dashboard/load-financial-overview.ts`, `lib/reports/financial-summary.ts` | INI-04 | Resúmenes por período. |
| `utils/collectionsCenter.ts` | 334 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `utils/currencyAmountInput.ts` | 60 | AUT | `lib/format/money-input.ts` (interpretación estricta, centavos exactos) | PAG-02 | Diferencia autorizada: el original aceptaba sólo pesos enteros y formateaba al escribir; la web interpreta con reglas estrictas (decisión vigente). |
| `utils/dailyCollectionsNotice.ts` | 70 | FALTA | — | INI-05 | Aviso diario. |
| `utils/financialReconciliation.ts` | 1218 | AUT | Restricciones y RPC atómicos en base; `docs/P0_REGISTRO_20261021.md` | PAG-09 | Reconciliación automática del almacén local: la web evita el estado inconsistente en la base. |
| `utils/firstMonthProration.ts` | 366 | VERIF | `lib/payments/proration.ts`, `lib/payments/training-charge-plan.ts` | CAL-15 | Primer mes proporcional y primer vencimiento. |
| `utils/firstPeriodDueDate.ts` | 53 | VERIF | `lib/payments/proration.ts`, `lib/payments/training-charge-plan.ts` | CAL-15 | Primer mes proporcional y primer vencimiento. |
| `utils/initialMonthlyBillingPlan.ts` | 231 | FALTA | — | PAG-05 | Situación inicial del alumno mensual, «marcar mes actual pagado» y retomar el cobro al reactivar. |
| `utils/initialPaidSurchargeRepair.ts` | 250 | FALTA | — | PAG-05 | Situación inicial del alumno mensual, «marcar mes actual pagado» y retomar el cobro al reactivar. |
| `utils/monthlyAmountCorrection.ts` | 206 | FALTA | — | PAG-04 | Modificar monto mensual (desde este mes / próximo mes) con recálculo del saldo. |
| `utils/monthlyChargeGenerationPlan.ts` | 162 | VERIF | `lib/payments/monthly-charge-plan.ts`, `ensure_monthly_charges`, `sync_per_class_charge` | PAG-01 | Generación mensual y por clase; semanal/quincenal/paquete: FALTA. |
| `utils/monthlyCollectedSeries.ts` | 36 | PARCIAL | `components/finance/budget-suggestion.tsx`, `budget-adjust-dialog.tsx`, `lib/payments/budget-distribution.ts`, `saveBudgetDistributionAction` | INI-10 | Tres barras 50/30/20 sobre lo cobrado, ajuste y «Restablecer 50/30/20» (agregado el 28/10, sin publicar). **Defecto corregido: guardar los porcentajes ya no borra el objetivo de ahorro.** |
| `utils/monthlyPeriodStatus.ts` | 639 | FALTA | — (hay `due-stage.ts` y urgencias, sin semáforo ni estado del período) | ALU-02/PAG-10 | Semáforo de cobro y estado del período mensual para chips de Alumnos y perfil. |
| `utils/packageCredits.ts` | 102 | FALTA | — | PAG-01 | Paquetes de clases (compra, créditos, consumo) y cargos semanales/quincenales. |
| `utils/paymentCalculations.ts` | 337 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `utils/paymentDates.ts` | 278 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `utils/paymentDueStage.ts` | 224 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `utils/paymentFormat.ts` | 117 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `utils/paymentIdempotency.ts` | 125 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `utils/paymentMutations.ts` | 639 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `utils/paymentScoring.ts` | 100 | FALTA | — | PAG-07 | Historial y riesgo de deuda por alumno (12 meses, racha, en término/fuera de término). |
| `utils/paymentStats.ts` | 217 | VERIF | `lib/dashboard/load-financial-overview.ts`, `lib/reports/financial-summary.ts` | INI-04 | Resúmenes por período. |
| `utils/paymentTrafficLight.ts` | 55 | FALTA | — (hay `due-stage.ts` y urgencias, sin semáforo ni estado del período) | ALU-02/PAG-10 | Semáforo de cobro y estado del período mensual para chips de Alumnos y perfil. |
| `utils/perClassChargeGenerationPlan.ts` | 163 | VERIF | `lib/payments/monthly-charge-plan.ts`, `ensure_monthly_charges`, `sync_per_class_charge` | PAG-01 | Generación mensual y por clase; semanal/quincenal/paquete: FALTA. |
| `utils/periodFinancialSummary.ts` | 234 | VERIF | `lib/dashboard/load-financial-overview.ts`, `lib/reports/financial-summary.ts` | INI-04 | Resúmenes por período. |
| `utils/periodicChargeGenerationPlan.ts` | 72 | FALTA | — | PAG-01 | Paquetes de clases (compra, créditos, consumo) y cargos semanales/quincenales. |
| `utils/registerPaymentPlan.ts` | 239 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `utils/registerPaymentSubmission.ts` | 76 | VERIF | `charge-actions.tsx`, `lib/payments/register-payment-plan.ts`, RPC `register_payment`/`void_*` | PAG-02/03 | Pagos completos/parciales/previos, asignación, anulaciones. |
| `utils/studentCollectionEligibility.ts` | 33 | VERIF | `/cobros`, `lib/payments/{collections-center,collections-urgency,due-stage,dates}.ts` | PAG-08 | Centro de cobros. |
| `utils/studentListPaymentProjection.ts` | 103 | FALTA | — (hay `due-stage.ts` y urgencias, sin semáforo ni estado del período) | ALU-02/PAG-10 | Semáforo de cobro y estado del período mensual para chips de Alumnos y perfil. |
| `utils/studentPaymentHistory.ts` | 136 | FALTA | — | PAG-07 | Historial y riesgo de deuda por alumno (12 meses, racha, en término/fuera de término). |
| `utils/studentPaymentsSummary.ts` | 131 | FALTA | — (hay `due-stage.ts` y urgencias, sin semáforo ni estado del período) | ALU-02/PAG-10 | Semáforo de cobro y estado del período mensual para chips de Alumnos y perfil. |
| `utils/surchargeSettings.ts` | 214 | AUT | Recargos apagados estructuralmente (`lib/payments/due-stage.ts`) | PAG-06 | Decisión de negocio confirmada: sin recargos automáticos. |
| `utils/trainingBilling.ts` | 109 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |
| `utils/trainingChargeGenerationPlan.ts` | 681 | VERIF | `lib/payments/training-*.ts`, `configure_training_billing`, `training-billing-config.tsx` | CAL-14 | Acuerdos de entrenamiento (operaciones atómicas en base reemplazan la cola de reconciliación del móvil). |

### features/reportes

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `hooks/useReportHistory.ts` | 61 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `services/generateReportNarrative.ts` | 35 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `services/generateReportPdf.ts` | 23 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `services/reportHistoryCore.ts` | 31 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `services/reportHistoryStore.ts` | 59 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `services/reportPdfStorage.ts` | 57 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `services/reportSharePrivacyNotice.ts` | 25 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `services/reportSharing.ts` | 87 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `types/index.ts` | 162 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `utils/buildDeterministicReportNarrative.ts` | 87 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `utils/buildReportHtml.ts` | 151 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `utils/buildReportPrompt.ts` | 44 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `utils/buildStudentReportData.ts` | 184 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `utils/reportMonths.ts` | 162 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `utils/reportPeriods.ts` | 78 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |

### features/student-profile

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `StudentProfileScreen.tsx` | 810 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/ChangeStatusSheet.tsx` | 390 | VERIF | `components/students/change-status-form.tsx`, `changeStudentStatusAction` | ALU-07 | Comparar campos de reactivación (horarios, duración, precio) y motivo/nota. |
| `components/EditBillingPlanSheet.tsx` | 465 | FALTA | `lib/payments/billing-plan.ts` (tipos; sin edición ni generación semanal/quincenal/paquete) | ALU-05/PAG-01 | Editar plan de cobro y planes semanal, quincenal, paquete y sin cargo. |
| `components/HistorySummary.tsx` | 90 | PARCIAL | `resumen-tab.tsx`, `profile-header.tsx`, `change-status-form.tsx` | ALU-12 | Falta «Inversión histórica», «Horas tomadas» y las acciones rápidas del perfil. |
| `components/LevelAchievementSheet.tsx` | 355 | FALTA | — | ALU-14 | Registrar logro de nivel (nuevo nivel, fecha, nota, salto, corrección, tiempo que llevó). |
| `components/ManualSessionCorrectionSheet.tsx` | 276 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `components/ProfileEmptyState.tsx` | 79 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/ProfileErrorState.tsx` | 107 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/ProfileHeader.tsx` | 171 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/ProfileQuickActions.tsx` | 111 | PARCIAL | `resumen-tab.tsx`, `profile-header.tsx`, `change-status-form.tsx` | ALU-12 | Falta «Inversión histórica», «Horas tomadas» y las acciones rápidas del perfil. |
| `components/ProfileSkeleton.tsx` | 90 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/PunctualitySection.tsx` | 145 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `components/QuickSummary.tsx` | 151 | PARCIAL | `resumen-tab.tsx`, `profile-header.tsx`, `change-status-form.tsx` | ALU-12 | Falta «Inversión histórica», «Horas tomadas» y las acciones rápidas del perfil. |
| `components/RescheduleCancellationNoticeBanner.tsx` | 82 | FALTA | — | ALU-17 |  |
| `components/SegmentedTabs.tsx` | 148 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/StatusSection.tsx` | 171 | PARCIAL | `resumen-tab.tsx`, `profile-header.tsx`, `change-status-form.tsx` | ALU-12 | Falta «Inversión histórica», «Horas tomadas» y las acciones rápidas del perfil. |
| `components/tabs/ClasesTab.tsx` | 307 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/tabs/CobrosTab.tsx` | 1134 | PARCIAL | `components/students/profile/cobros-tab.tsx` | ALU-16 | Hay obligaciones y pagos con registrar/anular; faltan editar plan, modificar monto mensual, marcar mes pagado, situación inicial, historial/riesgo, registrar pago por período. |
| `components/tabs/InformacionTab.tsx` | 209 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/tabs/ProgresoTab.tsx` | 255 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/tabs/ReportesTab.tsx` | 1140 | VERIF | `components/students/profile/reportes-tab.tsx`, `lib/reports/*`, `lib/actions/reports.ts` | REP-01/02 | Generación, historial y descarga del PDF verificados con QA el 21/10 (§25); compartir por WhatsApp/otra app/copiar mensaje: AUT parcial (REP-03). |
| `components/tabs/ResumenTab.tsx` | 197 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `components/tabs/TareasTab.tsx` | 102 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `hooks/useStudentProfile.ts` | 940 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `hooks/useStudentPunctuality.ts` | 42 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `hooks/useStudentSessionHistory.ts` | 44 | FALTA | — (sólo hay texto de puntualidad en el reporte) | ALU-13/15 | Puntualidad del alumno (clasificación, puntaje, evolución) y corrección manual de la sesión; depende de la clase en vivo (INI-07). |
| `types/index.ts` | 275 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `utils/cefrLevel.ts` | 92 | FALTA | — | ALU-14 | Registrar logro de nivel (nuevo nivel, fecha, nota, salto, corrección, tiempo que llevó). |
| `utils/format.ts` | 59 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `utils/levelAchievementRules.ts` | 152 | FALTA | — | ALU-14 | Registrar logro de nivel (nuevo nivel, fecha, nota, salto, corrección, tiempo que llevó). |
| `utils/profileLessonOutcome.ts` | 64 | VERIF | `components/students/profile/*`, `lib/students/profile-overview.ts` | ALU-11 | Pestañas del perfil. |
| `utils/studentBillingPlan.ts` | 138 | FALTA | `lib/payments/billing-plan.ts` (tipos; sin edición ni generación semanal/quincenal/paquete) | ALU-05/PAG-01 | Editar plan de cobro y planes semanal, quincenal, paquete y sin cargo. |

### features/students

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `StudentsListScreen.tsx` | 531 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `components/ArchiveStudentDialog.tsx` | 201 | VERIF | `change-status-form.tsx`, `archive_student_and_prune_future`, `lib/students/archive-prune-plan.ts` | ALU-08 |  |
| `components/ChipGroup.tsx` | 85 | PARCIAL | `students-filters-form.tsx`, `app/(app)/alumnos/page.tsx` | ALU-01 | Estados vacíos y texto de «limpiar búsqueda» distintos; «Ordenar por» ausente. |
| `components/CreateCustomLevelSheet.tsx` | 199 | VERIF | `level-picker.tsx`, `manage-levels-section.tsx`, `createLevelAction`/`renameLevelAction`/`deleteLevelAction` | ALU-06 |  |
| `components/DeleteStudentDialog.tsx` | 187 | FALTA | — (se conserva el comportamiento actual) | ALU-10 | **Decisión de Joaquín (28/10/2026): queda pendiente; no se implementa el borrado en cascada.** Diferencia documentada. |
| `components/ErrorState.tsx` | 75 | PARCIAL | `students-filters-form.tsx`, `app/(app)/alumnos/page.tsx` | ALU-01 | Estados vacíos y texto de «limpiar búsqueda» distintos; «Ordenar por» ausente. |
| `components/FiltersPanel.tsx` | 204 | PARCIAL | `students-filters-form.tsx`, `app/(app)/alumnos/page.tsx` | ALU-01 | Estados vacíos y texto de «limpiar búsqueda» distintos; «Ordenar por» ausente. |
| `components/LevelPicker.tsx` | 217 | VERIF | `level-picker.tsx`, `manage-levels-section.tsx`, `createLevelAction`/`renameLevelAction`/`deleteLevelAction` | ALU-06 |  |
| `components/ManageCustomLevelsSheet.tsx` | 185 | VERIF | `level-picker.tsx`, `manage-levels-section.tsx`, `createLevelAction`/`renameLevelAction`/`deleteLevelAction` | ALU-06 |  |
| `components/NewStudentButton.tsx` | 50 | PARCIAL | `students-filters-form.tsx`, `app/(app)/alumnos/page.tsx` | ALU-01 | Estados vacíos y texto de «limpiar búsqueda» distintos; «Ordenar por» ausente. |
| `components/SearchBar.tsx` | 69 | PARCIAL | `students-filters-form.tsx`, `app/(app)/alumnos/page.tsx` | ALU-01 | Estados vacíos y texto de «limpiar búsqueda» distintos; «Ordenar por» ausente. |
| `components/SkeletonCard.tsx` | 88 | PARCIAL | `students-filters-form.tsx`, `app/(app)/alumnos/page.tsx` | ALU-01 | Estados vacíos y texto de «limpiar búsqueda» distintos; «Ordenar por» ausente. |
| `components/StudentBadges.tsx` | 109 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `components/StudentCard.tsx` | 248 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `components/StudentsEmptyState.tsx` | 62 | PARCIAL | `students-filters-form.tsx`, `app/(app)/alumnos/page.tsx` | ALU-01 | Estados vacíos y texto de «limpiar búsqueda» distintos; «Ordenar por» ausente. |
| `components/SwipeActionButton.tsx` | 79 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `components/SwipeableStudentRow.tsx` | 165 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `hooks/customLevelsStore.ts` | 142 | VERIF | `level-picker.tsx`, `manage-levels-section.tsx`, `createLevelAction`/`renameLevelAction`/`deleteLevelAction` | ALU-06 |  |
| `hooks/rescheduleCancellationNoticeStore.ts` | 101 | FALTA | — | ALU-17 | Aviso «clase cancelada por reprogramación» con «Entendido»/«Eliminar y reemplazar». |
| `hooks/studentArchiveService.ts` | 214 | VERIF | `change-status-form.tsx`, `archive_student_and_prune_future`, `lib/students/archive-prune-plan.ts` | ALU-08 |  |
| `hooks/studentDeletionEvents.ts` | 27 | FALTA | — (se conserva el comportamiento actual) | ALU-10 | **Decisión de Joaquín (28/10/2026): queda pendiente; no se implementa el borrado en cascada.** Diferencia documentada. |
| `hooks/studentDeletionService.ts` | 153 | FALTA | — (se conserva el comportamiento actual) | ALU-10 | **Decisión de Joaquín (28/10/2026): queda pendiente; no se implementa el borrado en cascada.** Diferencia documentada. |
| `hooks/studentStore.ts` | 371 | VERIF | `lib/repositories/students.ts`, `lib/actions/students.ts` | ALU-04 | Modelo y mutaciones de alumnos. |
| `hooks/useCustomLevels.ts` | 56 | VERIF | `level-picker.tsx`, `manage-levels-section.tsx`, `createLevelAction`/`renameLevelAction`/`deleteLevelAction` | ALU-06 |  |
| `hooks/useFilteredStudents.ts` | 93 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `hooks/useRescheduleCancellationNotices.ts` | 50 | FALTA | — | ALU-17 | Aviso «clase cancelada por reprogramación» con «Entendido»/«Eliminar y reemplazar». |
| `hooks/useStudentsList.ts` | 107 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `types/index.ts` | 175 | VERIF | `lib/repositories/students.ts`, `lib/actions/students.ts` | ALU-04 | Modelo y mutaciones de alumnos. |
| `utils/customLevelsCore.ts` | 55 | VERIF | `level-picker.tsx`, `manage-levels-section.tsx`, `createLevelAction`/`renameLevelAction`/`deleteLevelAction` | ALU-06 |  |
| `utils/format.ts` | 65 | FALTA | `students-list-view.tsx`, `student-card.tsx`, `lib/students/filters.ts` (sólo nombre/estado/nivel/modalidad) | ALU-01/02/03 | Falta: filtro por estado de pago, orden por próxima clase/último pago, chips de pago/reporte/tarea, próxima clase, promedio y clases del mes, acciones rápidas. |
| `utils/studentDeletionCascade.ts` | 256 | FALTA | — (se conserva el comportamiento actual) | ALU-10 | **Decisión de Joaquín (28/10/2026): queda pendiente; no se implementa el borrado en cascada.** Diferencia documentada. |
| `utils/studentDeletionImpact.ts` | 72 | FALTA | — (se conserva el comportamiento actual) | ALU-10 | **Decisión de Joaquín (28/10/2026): queda pendiente; no se implementa el borrado en cascada.** Diferencia documentada. |
| `utils/studentLevelsCore.ts` | 77 | VERIF | `level-picker.tsx`, `manage-levels-section.tsx`, `createLevelAction`/`renameLevelAction`/`deleteLevelAction` | ALU-06 |  |
| `utils/studentYearSummary.ts` | 127 | EQ | `lib/reports/student-year-summary.ts` | INI-13 |  |
| `utils/updateStudentRecords.ts` | 26 | VERIF | `lib/repositories/students.ts`, `lib/actions/students.ts` | ALU-04 | Modelo y mutaciones de alumnos. |

### features/transfer

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `PhoneTransferEntry.tsx` | 176 | EQ | `lib/phone-extraction/*`, `lib/transfer/*` (portado y ensayado; ver TRASLADO §17–19) | CFG-03 | Módulo del traslado (lado teléfono, agregado al móvil para extraer archivos); el lado web está en `lib/phone-extraction` y `lib/transfer`. |
| `phoneExtraction/plan.ts` | 170 | EQ | `lib/phone-extraction/*`, `lib/transfer/*` (portado y ensayado; ver TRASLADO §17–19) | CFG-03 | Módulo del traslado (lado teléfono, agregado al móvil para extraer archivos); el lado web está en `lib/phone-extraction` y `lib/transfer`. |
| `phoneExtraction/runner.ts` | 309 | EQ | `lib/phone-extraction/*`, `lib/transfer/*` (portado y ensayado; ver TRASLADO §17–19) | CFG-03 | Módulo del traslado (lado teléfono, agregado al móvil para extraer archivos); el lado web está en `lib/phone-extraction` y `lib/transfer`. |
| `phoneExtraction/sniff.ts` | 41 | EQ | `lib/phone-extraction/*`, `lib/transfer/*` (portado y ensayado; ver TRASLADO §17–19) | CFG-03 | Módulo del traslado (lado teléfono, agregado al móvil para extraer archivos); el lado web está en `lib/phone-extraction` y `lib/transfer`. |
| `phoneExtraction/supabase-deps.ts` | 40 | EQ | `lib/phone-extraction/*`, `lib/transfer/*` (portado y ensayado; ver TRASLADO §17–19) | CFG-03 | Módulo del traslado (lado teléfono, agregado al móvil para extraer archivos); el lado web está en `lib/phone-extraction` y `lib/transfer`. |
| `phoneExtractionDeps.ts` | 47 | EQ | `lib/phone-extraction/*`, `lib/transfer/*` (portado y ensayado; ver TRASLADO §17–19) | CFG-03 | Módulo del traslado (lado teléfono, agregado al móvil para extraer archivos); el lado web está en `lib/phone-extraction` y `lib/transfer`. |

### navigation

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `RootNavigator.tsx` | 832 | AUT | `app/(app)/layout.tsx`, `components/nav/*` | PLAT-03 | Navegación nativa; la web usa barra inferior móvil y lateral en escritorio. Incluye la entrada «Ver tutorial». |

### qa

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `simulation/actionEngine.ts` | 704 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/backupRoundTrip.ts` | 194 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/clock.ts` | 68 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/errorCollector.ts` | 59 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/fixtures/names.ts` | 36 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/invariants.ts` | 135 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/rng.ts` | 54 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/runSimulation.ts` | 95 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/safetyGuards.ts` | 127 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/scheduleGenerator.ts` | 103 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/studentGenerator.ts` | 274 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |
| `simulation/world.ts` | 109 | N/A | pruebas automáticas (`lib/**/__tests__`, Postgres real en `supabase/tests/postgres`) | PLAT-01 | Simulación de 12 meses sobre AsyncStorage: herramienta de QA del móvil. |

### shared

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `backup/backupFile.ts` | 61 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/backupKeys.ts` | 215 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/backupStorage.ts` | 160 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/backupTypes.ts` | 205 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/buildBackup.ts` | 141 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/buildBackupV2.ts` | 198 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/cloud/autoBackupDebounce.ts` | 18 | AUT | Base de datos autoritativa (sin respaldo cliente) | CFG-01 | Respaldo automático a la nube del dispositivo; no existe en una web sin almacenamiento local. |
| `backup/cloud/cloudBackupService.ts` | 143 | AUT | Base de datos autoritativa (sin respaldo cliente) | CFG-01 | Respaldo automático a la nube del dispositivo; no existe en una web sin almacenamiento local. |
| `backup/cloud/cloudBackupTypes.ts` | 93 | AUT | Base de datos autoritativa (sin respaldo cliente) | CFG-01 | Respaldo automático a la nube del dispositivo; no existe en una web sin almacenamiento local. |
| `backup/cloud/cloudRecoveryDecision.ts` | 58 | AUT | Base de datos autoritativa (sin respaldo cliente) | CFG-01 | Respaldo automático a la nube del dispositivo; no existe en una web sin almacenamiento local. |
| `backup/cloud/retryBackoff.ts` | 33 | AUT | Base de datos autoritativa (sin respaldo cliente) | CFG-01 | Respaldo automático a la nube del dispositivo; no existe en una web sin almacenamiento local. |
| `backup/cloud/supabaseCloudBackupAdapter.ts` | 139 | AUT | Base de datos autoritativa (sin respaldo cliente) | CFG-01 | Respaldo automático a la nube del dispositivo; no existe en una web sin almacenamiento local. |
| `backup/dataIntegrity.ts` | 541 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/dataIntegrityService.ts` | 445 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/localRevisionStore.ts` | 146 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/restoreExecutor.ts` | 203 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/restoreFile.ts` | 66 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/restorePreview.ts` | 68 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/restoreService.ts` | 496 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/restoreValidation.ts` | 1699 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `backup/runBackup.ts` | 61 | AUT | Importador de copias (`lib/backup/*`, R6/R6.1) + base como fuente de verdad | CFG-01 | Respaldo/restauración local (AsyncStorage): en la web la base ES la nube; la copia del móvil se importa. |
| `components/BrandedScreenHeader.tsx` | 98 | AUT | `components/ui/page-header.tsx`, tema propio | UX-02 | Presentación nativa; la web conserva su estética. |
| `components/DismissKeyboardView.tsx` | 45 | AUT | `lib/ui/*`, navegador | UX-01 | Manejo de teclado nativo; en la web lo resuelve el navegador (regla de letra ≥ 16 px y diálogo con scroll). |
| `components/HighlightPulse.tsx` | 77 | AUT | `components/ui/page-header.tsx`, tema propio | UX-02 | Presentación nativa; la web conserva su estética. |
| `components/KeyboardDismissScrollView.tsx` | 45 | AUT | `lib/ui/*`, navegador | UX-01 | Manejo de teclado nativo; en la web lo resuelve el navegador (regla de letra ≥ 16 px y diálogo con scroll). |
| `components/ModalCloseButton.tsx` | 58 | EQ | `components/ui/dialog.tsx` (botón «Cerrar» de 44 px) | UX-02 |  |
| `components/PastelScreenBackground.tsx` | 22 | AUT | `components/ui/page-header.tsx`, tema propio | UX-02 | Presentación nativa; la web conserva su estética. |
| `components/SuccessToast.tsx` | 72 | FALTA | — | ALU-20 | Confirmación breve «alumno creado» tras el alta (flujo clases→alumnos). |
| `components/TextItemEditSheet.tsx` | 499 | AUT | `components/registro/editable-text-list.tsx` | REG-07 | Edición de elementos de lista sin borrar (decisión vigente); el panel nativo con teclado propio no aplica. |
| `hooks/useReduceMotion.ts` | 30 | EQ | `prefers-reduced-motion` en `components/ui/dialog.tsx`, `app/globals.css` | UX-01 |  |
| `notifications/classSessionNotification.ts` | 111 | AUT | — | INI-07 | Notificación persistente de Android durante la clase en curso (depende del seguimiento en vivo). |
| `storage/teacherFlowStorage.ts` | 293 | AUT | Base de datos (Supabase) | PLAT-02 | AsyncStorage del móvil. |
| `types.ts` | 38 | EQ | `lib/db/database.types.ts`, `lib/students/constants.ts` | ALU-04 |  |
| `utils/gradeAverage.ts` | 30 | EQ | `lib/lessons/grades.ts` (`calculateAverageGrade`) | REG-08 | Promedios reales (sin 0 ni vacíos). |
| `utils/studentSearch.ts` | 544 | EQ | `lib/students/search.ts` (motor portado con 56 pruebas originales) | ALU-01 |  |

### theme

| Archivo del original | LOC | Estado | Equivalente en la web | Ref. | Nota |
|---|---:|---|---|---|---|
| `brand.tsx` | 63 | AUT | `tailwind.config.ts`, `components/ui/brand.tsx`, `lib/calendar-theme.ts` | UX-02 | Estética propia de la web (se conserva); escala de calendario congelada. |
| `colors.ts` | 170 | AUT | `tailwind.config.ts`, `components/ui/brand.tsx`, `lib/calendar-theme.ts` | UX-02 | Estética propia de la web (se conserva); escala de calendario congelada. |
| `typography.ts` | 51 | AUT | `tailwind.config.ts`, `components/ui/brand.tsx`, `lib/calendar-theme.ts` | UX-02 | Estética propia de la web (se conserva); escala de calendario congelada. |

### Pruebas del original (295 archivos)

Las pruebas del original describen reglas de negocio que la web debe cumplir. Estado: las reglas puras portadas tienen su prueba equivalente en `lib/**/__tests__`; las que corresponden a funciones FALTA/PARCIAL se portan junto con la función. Archivos:

- **features/account** (23): `accountConfirmationFlow.test.ts`, `accountDeletionFlow.test.ts`, `architectureGuards.test.ts`, `emailConfirmationCodeFlow.test.ts`, `emailConfirmationCorrection.test.ts`, `keyboardDismiss.test.ts`, `onboardingTutorial.test.ts`, `passwordRecoveryFlow.test.ts`, `signInFlow.test.ts`, `teacherProfile.test.ts`, `chunkedSecureStore.test.ts`, `deepLinkAuth.test.ts`, `supabaseConfig.test.ts`, `activeSessionService.test.ts`, `authSessionReducer.test.ts`, `emailConfirmationCode.test.ts`, `maskEmail.test.ts`, `normalizeEmail.test.ts`, `otpConfirmationError.test.ts`, `runAccountTests.ts`, `sanitizeAuthErrorForLog.test.ts`, `sessionAuthorization.test.ts`, `translateAuthError.test.ts`
- **features/calendar** (62): `recurrenceMutationQueue.test.ts`, `trainingBillingCriticalFlows.test.ts`, `addParticipantsSheetHeightFix.test.ts`, `addParticipantsSheetScroll.test.ts`, `calendarActivityKind.test.ts`, `calendarActivityKindWiring.test.ts`, `calendarClassTitle.test.ts`, `calendarClassTitleFromDate.test.ts`, `calendarConflicts.test.ts`, `calendarDailyDemand.test.ts`, `calendarDayGridLayout.test.ts`, `calendarDayIso.test.ts`, `calendarDemandSummary.test.ts`, `calendarDurationEdit.test.ts`, `calendarDurationEditWiring.test.ts`, `calendarHydrationNonDestructive.test.ts`, `calendarLessonActionsSheetCancelledRedesign.test.ts`, `calendarLessonActionsSheetDoubleTapGuard.test.ts`, `calendarLessonLayout.test.ts`, `calendarNewLessonAvailabilitySharing.test.ts`, `calendarNextClassAt.test.ts`, `calendarOccurrenceCounting.test.ts`, `calendarOccurrencePersistenceAudit.test.ts`, `calendarParticipantsFromDate.test.ts`, `calendarPendingRecurrence.test.ts`, `calendarRecurrenceEngine.test.ts`, `calendarRecurrenceHourSync.test.ts`, `calendarRecurrenceMutations.test.ts`, `calendarRecurrenceQuarterHour.test.ts`, `calendarRecurrenceSeriesDeletion.test.ts`, `calendarRecurrenceSplit.test.ts`, `calendarRecurrenceTemplateEditing.test.ts`, `calendarSheetsBackdropClose.test.ts`, `calendarStudentSearchParity.test.ts`, `calendarTimezone.test.ts`, `calendarVisualLegend.test.ts`, `calendarWeekday.test.ts`, `calendarWeeklyGridBoundaryMatrix.test.ts`, `calendarWeeklyOccurrenceVisibility.test.ts`, `cancelledSlotReuse.test.ts`, `cancelledSlotReuseIntegration.test.ts`, `cancelledSlotReuseWiring.test.ts`, `classDuration75Minutes.test.ts`, `firstMonthProrationCandidates.test.ts`, `firstMonthProrationTriggerWiring.test.ts`, `modalCloseButtonUnification.test.ts`, `newCalendarLessonSheetHeightFix.test.ts`, `newCalendarLessonSheetScroll.test.ts`, `nextClassAtRepairWiring.test.ts`, `pendingStudentSelection.test.ts`, `recurrenceOptionsScrollFix.test.ts`, `recurrenceRulesSheetModalCoordinator.test.ts`, `recurringSeriesMultiParticipant.test.ts`, `rescheduleStandaloneLessonWiring.test.ts`, `runRecurrenceTests.ts`, `scheduleAdjustment.test.ts`, `scheduleAdjustmentServiceStructure.test.ts`, `teacherAvailabilityEngine.test.ts`, `testHarness.ts`, `timeSlotQuickPick.test.ts`, `timeSlotQuickPickWiring.test.ts`, `weeklyRecurrenceHorizon.test.ts`
- **features/dashboard** (19): `activeClassTiming.test.ts`, `annualActivitySummary.test.ts`, `budgetDistributionUi.test.ts`, `buildDashboardData.test.ts`, `buildFinishClassNavigationParams.test.ts`, `classSessionNotification.test.ts`, `emptyClasses.test.ts`, `financialOverviewTabsWiring.test.ts`, `liveClassTrackingConnected.test.ts`, `nativeSliderRestored.test.ts`, `notificationBell.test.ts`, `notificationBellConnected.test.ts`, `pendingClasses.test.ts`, `pendingClassesFullListNavigation.test.ts`, `programmedHourlyRateSummary.test.ts`, `registerPendingClassSheetSessionLifecycle.test.ts`, `remindersCenter.test.ts`, `runDashboardTests.ts`, `studentSearch.test.ts`
- **features/integration-tests** (1): `teacherFlowLifecycle.test.ts`
- **features/new-class** (41): `useNewClassFormEvaluation.test.ts`, `activeFieldVisibility.test.ts`, `activeFieldVisibilityKeyboardScreenY.test.ts`, `activeFieldVisibilityWiring.test.ts`, `attendanceMeasureLayoutFix.test.ts`, `attendancePerParticipant.test.ts`, `editRegisteredLesson.test.ts`, `editRegisteredLessonSheet.test.ts`, `editRegisteredLessonSheetRemount.test.ts`, `gradeAverageCore.test.ts`, `groupRegistrationDomain.test.ts`, `groupRegistrationPersistence.test.ts`, `homeworkLabelsClarity.test.ts`, `homeworkOptionalDueDate.test.ts`, `homeworkPendingDomain.test.ts`, `homeworkPendingReviewWiring.test.ts`, `homeworkReviewSaveGateWiring.test.ts`, `keyboardArchitectureGuard.test.ts`, `keyboardDismissDoubleAdjustment.test.ts`, `keyboardFocusController.test.ts`, `keyboardScrollBehavior.test.ts`, `lessonAttachments.test.ts`, `lessonRegistrationPersistence.test.ts`, `manualSessionCorrection.test.ts`, `newClassScreenScrollKeyboard.test.ts`, `punctualityClassification.test.ts`, `punctualityScoring.test.ts`, `registerPendingClassP0Correction.test.ts`, `registerPendingClassSheet.test.ts`, `registerPendingClassSheetGroupFlow.test.ts`, `registerPendingClassSheetPaymentModalDismiss.test.ts`, `savedLessonLinkageDiagnostics.test.ts`, `sessionCycleConnected.test.ts`, `skillGradeDomain.test.ts`, `studentSessionHistory.test.ts`, `textItemEditDomain.test.ts`, `textItemEditKeyboardConflict.test.ts`, `textItemEditWiring.test.ts`, `trainingGroupCompletionRegression.test.ts`, `upcomingHomeworkOccurrences.test.ts`, `viewRegisterEndToEnd.test.ts`
- **features/new-student** (2): `optionalFields.test.ts`, `studentEditBillingSync.test.ts`
- **features/payments** (87): `budgetDistributionStore.test.ts`, `dailyCollectionsNoticeStore.test.ts`, `firstMonthProrationDecisionStore.test.ts`, `monthlyAmountCorrectionLogStore.test.ts`, `paymentsStore.test.ts`, `surchargeSettingsStore.test.ts`, `trainingBillingAgreementsStore.test.ts`, `billingPlanTypeChangeAmountUnification.test.ts`, `chargeGenerationConcurrency.test.ts`, `dueDateRepairSequence.test.ts`, `ensureFirstMonthProrationDecision.test.ts`, `firstMonthProrationService.test.ts`, `initialMonthlyBillingService.test.ts`, `initialPaidSurchargeRepairService.test.ts`, `monthlyAmountCorrectionService.test.ts`, `monthlyAmountLegacyIdCorrection.test.ts`, `monthlyAmountMatrix.test.ts`, `monthlyAmountScenariosAndE2E.test.ts`, `monthlyAmountVigencia.test.ts`, `monthlyVsPerClassBillingSource.test.ts`, `overdueClearsAfterFullPayment.test.ts`, `studentEditFinancialSync.test.ts`, `surchargeSettingsService.test.ts`, `trainingBillingConfigurationCoordinator.test.ts`, `trainingFirstPeriodRepairService.test.ts`, `voidChargeService.test.ts`, `accessibilityBackdropAndMoraLabel.test.ts`, `annualBudgetProjection.test.ts`, `budgetDistribution.test.ts`, `buildClassPaymentPromptQueue.test.ts`, `buildHomeFinancialSummary.test.ts`, `collectionsCenter.test.ts`, `collectionsCenterTrainingConcept.test.ts`, `currencyAmountInput.test.ts`, `currencyInputWiring.test.ts`, `dailyCollectionsNotice.test.ts`, `financialReconciliation.test.ts`, `financialVigenciaWiring.test.ts`, `firstMonthProration.test.ts`, `firstMonthProrationJoinDate.test.ts`, `firstMonthProrationReconciliationProtection.test.ts`, `firstMonthProrationReviewActionWiring.test.ts`, `firstMonthProrationReviewNeeds.test.ts`, `firstPeriodDueDateAndOverdueLabel.test.ts`, `inactiveStudentIneligibleChargeRepair.test.ts`, `incompatiblePerClassChargeRepair.test.ts`, `incompatiblePerClassChargeRepairMatrix.test.ts`, `initialMonthlyBillingPlan.test.ts`, `initialPaidSurchargeRepair.test.ts`, `keyboardScrollWiring.test.ts`, `monthlyAmountCorrection.test.ts`, `monthlyBillingPlanDueDayNormalization.test.ts`, `monthlyCardStatusWiring.test.ts`, `monthlyChargeGenerationPlan.test.ts`, `monthlyCollectedSeries.test.ts`, `monthlyDueDateAndInactiveStudentBilling.test.ts`, `monthlyPeriodStatus.test.ts`, `newStudentFirstMonthSituationUi.test.ts`, `paymentCalculations.test.ts`, `paymentDates.test.ts`, `paymentDueStage.test.ts`, `paymentFormat.test.ts`, `paymentIdempotency.test.ts`, `paymentMutations.test.ts`, `paymentScoring.test.ts`, `paymentStats.test.ts`, `paymentTrafficLight.test.ts`, `perClassChargeGenerationPlan.test.ts`, `periodFinancialSummary.test.ts`, `phantomSurchargeAllocationRepair.test.ts`, `registerPaymentPlan.test.ts`, `registerPaymentSheetWiring.test.ts`, `registerPaymentSubmission.test.ts`, `resolveStudentMonthlyCardStatus.test.ts`, `runPaymentsTests.ts`, `studentCardCompactPaymentStatus.test.ts`, `studentCollectionEligibility.test.ts`, `studentListPaymentProjection.test.ts`, `studentPaymentHistory.test.ts`, `studentPaymentsSummary.test.ts`, `summarizeOverdueDebt.test.ts`, `surchargeDisableRestoresBaseAmounts.test.ts`, `surchargeSettingsDomain.test.ts`, `surchargeWaiverRepairForDisabledPolicy.test.ts`, `trainingBilling.test.ts`, `trainingChargeGenerationPlan.test.ts`, `trainingFirstPeriodProration.test.ts`
- **features/reportes** (11): `reportHistoryStore.test.ts`, `buildDeterministicReportNarrative.test.ts`, `buildReportHtml.test.ts`, `buildReportPrompt.test.ts`, `buildStudentReportData.test.ts`, `qaToolsRemoved.test.ts`, `reportMonths.test.ts`, `reportPeriods.test.ts`, `reportSharingConnected.test.ts`, `reportesConnected.test.ts`, `runReportesTests.ts`
- **features/student-profile** (2): `levelAchievement.test.ts`, `levelAchievementPersistence.test.ts`
- **features/students** (14): `archiveAndDeleteFlow.test.ts`, `customLevelsStore.test.ts`, `customLevelsCore.test.ts`, `fase6cAccessibility.test.ts`, `fase6cDeadControls.test.ts`, `fase6cRecurrenceEngineUntouched.test.ts`, `fase6cRegisterPaymentNavigation.test.ts`, `fase6cRescheduleSafety.test.ts`, `runFase6cTests.ts`, `studentDeletionCascade.test.ts`, `studentDeletionGroupCascade.test.ts`, `studentDeletionPaymentsCascade.test.ts`, `studentLevelsCore.test.ts`, `studentYearSummary.test.ts`
- **navigation** (2): `rootNavigatorNewClassWiring.test.ts`, `rootNavigatorNewStudentWiring.test.ts`
- **shared** (31): `backupScreenNoManualControls.test.ts`, `budgetDistributionBackup.test.ts`, `buildBackup.test.ts`, `buildBackupV2.test.ts`, `cloudBackupAmbiguousColumnFix.test.ts`, `cloudBackupDigestSchema.test.ts`, `cloudBackupMigration.test.ts`, `cloudBackupMigrationFix.test.ts`, `cloudBackupProviderArchitecture.test.ts`, `cloudRecoveryEmptyDeviceBug.test.ts`, `dataIntegrity.test.ts`, `dataIntegritySuccessorSessionGap.test.ts`, `firstMonthProrationBackup.test.ts`, `localRevisionStore.test.ts`, `localRevisionWiring.test.ts`, `materialsLibraryBackupExclusion.test.ts`, `orphanCalendarLessons.test.ts`, `reportRecordsRestore.test.ts`, `rescheduledStandaloneLessonBackup.test.ts`, `restoreExecutor.test.ts`, `restorePreview.test.ts`, `restoreValidation.test.ts`, `runBackupTests.ts`, `sensitiveDebugLogGuard.test.ts`, `trainingBillingAgreementsBackup.test.ts`, `useCloudBackupSyncStructure.test.ts`, `autoBackupDebounce.test.ts`, `cloudBackupService.test.ts`, `cloudRecoveryDecision.test.ts`, `retryBackoff.test.ts`, `supabaseCloudBackupAdapter.test.ts`


## Sólo en la web (sin equivalente en el original): contradicciones y regresiones a vigilar

Revisado el árbol de la web (`app/`, `components/`, `lib/`, `supabase/`, 936 archivos de código). Lo que no tiene origen en el original, por área, y qué se revisó:

| Área de la web | Archivos | Qué es | Contradicción / riesgo revisado |
|---|---:|---|---|
| `lib/billing/*`, `components/billing/*`, `app/(app)/facturacion/*`, `app/api/billing/*` | ~50 | Suscripciones y cobros de la propia TeacherFlow (Mobbex). **Es otro dominio**: no tiene que ver con los cobros a alumnos del original. | Separado por tablas, RPC y rutas propias de los cobros a alumnos. Sin contradicción conocida; la monetización sigue como bloque aparte (sin cobros reales activados). |
| `lib/backup/*`, `components/backup/*`, `lib/transfer/*`, `lib/phone-extraction/*`, `lib/secure-copy/*`, `app/(app)/configuracion/respaldo` | ~35 | Importador de copias del móvil, traslado y extracción de archivos (R6/R6.1/R10–R16). | Es el reemplazo del respaldo del original (CFG-01/03). Regresión posible: campos del original que el importador no conserva → cubierto por `lib/backup/transfer-compare.ts` y 2688 combinaciones financieras (§27 de TRASLADO). |
| `lib/data-exclusion/*`, `app/(app)/configuracion/datos-de-prueba` | 3 | Exclusión reversible de datos de prueba (R16). | Propio de la web; no altera datos. |
| `lib/auth/*`, `components/auth/*`, `app/login`, `app/crear-cuenta`, `app/auth/*`, `app/nueva-contrasena`, `app/recuperar-contrasena`, `app/iniciando-sesion` | ~45 | Autenticación web con Supabase (CAPTCHA, reautenticación, recuperación). | Equivalente funcional de `features/account` (ACC-01). Diferencia: confirmación por enlace/código según plantilla; sin sesión única por dispositivo (ACC-02, decisión B). |
| `components/landing/*`, `lib/landing/*`, `app/page.tsx` | ~12 | Portada pública de marketing. | Propia de la web. La propuesta violeta está en commits locales sin publicar. |
| `lib/security/*`, `lib/deploy/*`, `lib/errors/*`, `lib/supabase/*`, `proxy.ts` | ~15 | Endurecimiento, cuotas, errores genéricos, cookies. | Propio de la web (R1–R8). |
| `lib/reports/pdf.tsx`, `lib/reports/*` | 19 | Generación del PDF en servidor (en el original: `expo-print` + HTML). | Equivalente funcional (REP-01/02). Diferencia: el original ofrecía narrativa por IA opcional (`generateReportNarrative`/`buildReportPrompt`); la web usa el borrador determinístico → VERIF. |
| `components/ui/*`, `lib/ui/*`, `lib/nav/*`, `components/nav/*` | ~40 | Sistema de diseño y navegación de la web. | Propio; conserva estética y reglas de accesibilidad (B8). |
| `supabase/migrations/*` (73 archivos) | 73 | Esquema, RLS, RPC atómicas (el original usa AsyncStorage). | Equivalente del modelo de datos; la integridad que el original reconstruía con servicios de reconciliación la dan restricciones y RPC. |

**Contradicciones concretas encontradas al revisar la web contra sí misma:**

1. `lib/students/filters.ts` (comentario de cabecera) declara «pendientes» el filtro de pago y los órdenes por próxima clase/último pago porque «no existen calendar_lessons/payment_charges todavía». Esa premisa está **desactualizada** (ya existen): confirma ALU-01 como faltante real, no como limitación de datos.
2. `lib/payments/billing-plan.ts` documenta semanal/quincenal/paquete como «no están en el alcance pedido»: contradice el pedido actual de equivalencia completa (PAG-01).
3. `docs/TRASLADO_EXPO_GO_A_WEB.md` §25/§26 listaba «sigue faltando…»: varias entradas deben recomprobarse (niveles personalizados: ya existen `renameLevelAction`/`deleteLevelAction`; resultado de una clase finalizada: existe `changeRegistrationOutcomeAction`, falta confirmar si admite registros ya finalizados) y otras siguen siendo ciertas; esta matriz reemplaza esa lista como fuente de verdad.
4. `lib/payments/due-stage.ts` conserva umbrales de «vencimiento 1/2/último» sólo para la etapa visual (sin recargos): consistente con la decisión de negocio; no se toca.
