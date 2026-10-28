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
| ACC-02 | Cerrar sesión; sesión única por dispositivo («Tu cuenta se abrió en otro dispositivo») | `SignedOutElsewhereScreen`, `activeSessionService` | `endActiveSessionAction`; decisión B documentada (`docs/design/web-v1/14`) | AUT: la web no limita la sesión a un dispositivo (decisión del bloque de cuenta) |
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
| INI-03 | Indicadores rápidos: horas enseñadas este mes, promedio de evaluaciones | `StatsRow` | — | FALTA (confirmar fórmula en `buildDashboardData.ts`) |
| INI-04 | Resumen financiero del mes en Inicio (prevista, cobrada, pendiente en término, vencida) | `FinancialSummary`, `buildHomeFinancialSummary` | Inicio muestra cobros de hoy; Resumen financiero aparte | VERIF |
| INI-05 | Aviso diario de cobros «Recordarme mañana» | `DailyCollectionsNoticeBanner`, `dailyCollectionsNotice.ts` | — | FALTA |
| INI-06 | Campana de notificaciones con cantidad | `NotificationBell`, `notificationBell.ts` | `home-view.tsx` (aria «N recordatorios pendientes») | VERIF |
| INI-07 | Comenzar clase / Finalizar clase / puntualidad del alumno / Ajustar horario / Corregir hora de inicio / aviso de clase en curso restaurada | `ActiveClassCard`, `StartClassPunctualityDialog`, `ScheduleAdjustSheet`, `activeClassSessionStore`, `RestoredActiveSessionNotice`, `manualSessionCorrectionService` | — (sólo lectura de «clase en curso») | FALTA (requiere esquema para guardar sesión activa y puntualidad) |
| INI-08 | Pantalla «Clases por registrar» completa | `PendingClassesScreen`, `pendingClasses.ts` | `/registro` | VERIF |
| INI-09 | Centro de recordatorios | `RemindersCenterScreen`, `remindersCenter.ts` | `/recordatorios` | EQ (§21) |
| INI-10 | Distribución 50/30/20 y proyección anual | `BudgetDistributionCard`, `AnnualBudgetChart` | `budget-suggestion.tsx`, `/resumen-financiero` | VERIF |
| INI-11 | Meta/objetivo de ahorro (monto + fecha + sugerencia) | `SavingsGoalControl` | — | FALTA |
| INI-12 | Comportamiento de pago mensual (12 meses) | `MonthlyPaymentBehaviorScreen/Chart` | — | FALTA |
| INI-13 | Analíticas: facturación/demanda/horas dictadas, reprogramadas y canceladas, alumnos nuevos | `FinancialAnalyticsSections`, `calendarDemandSummary` | `financial-overview-view.tsx` (§22 de TRASLADO) | VERIF |
| INI-14 | Navegación: ubicación de la barra (abajo/menú del logo), Configuración | `SettingsScreen`, `LogoMenuSheet`, `navigationPreferenceStore` | navegación propia de la web | AUT: mecánica nativa |
| INI-15 | Datos de ejemplo (crear/eliminar) | `HomeScreen` «Eliminar datos de ejemplo» | `/configuracion/datos-de-prueba` | VERIF |

## 3. Alumnos

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| ALU-01 | Lista con búsqueda tolerante, filtros (nivel, modalidad, estado, **estado de pago**), orden (nombre, **próxima clase**, **último pago**) | `StudentsListScreen`, `useFilteredStudents`, `FiltersPanel` | `lib/students/filters.ts` (sólo nombre; comentario «pendiente») | FALTA: filtro de pago y órdenes por próxima clase/último pago |
| ALU-02 | Tarjeta con badges: estado, Destacado, Nuevo, **Pago vencido con el período** («Julio vencido»), **Reporte pendiente**, **Tarea pendiente**, próxima clase, clases del mes, promedio, último pago | `StudentCard`, `StudentBadges`, `buildStudentListItem` | `student-card.tsx` (nombre, nivel, modalidad, estado) | FALTA |
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
| CAL-06 | **Editar nombre de la clase** (sólo esta / esta y siguientes) | `EditClassTitleSheet` | — | FALTA (la tabla permite UPDATE por RLS; sin RPC) |
| CAL-07 | **Cambiar duración** (sólo esta / esta y siguientes; nunca clases pasadas) | `ChangeLessonDurationSheet`, `calendarDurationEdit` | — | FALTA |
| CAL-08 | **Cambiar tipo de actividad** Clase ↔ Entrenamiento (+ cuota de entrenamiento) | `EditActivityKindSheet` | — | FALTA |
| CAL-09 | **Agregar/quitar alumnos** de una clase o desde una fecha, con «Crear alumno nuevo» | `AddParticipantsSheet`, `calendarParticipantsFromDate` | `changeParticipantsAction` (sólo series) | FALTA parcial (clases sueltas) |
| CAL-10 | **Eliminar clase** (sólo esta / desde esta fecha) | `CalendarLessonActionsSheet` | sólo cancelar | FALTA |
| CAL-11 | Cancelar con/sin aviso, **restaurar** clase cancelada, **reemplazar** una cancelación con otra clase en ese horario | `CalendarLessonActionsSheet`, `cancelledSlotReuse` | `cancelOccurrenceAction`; reemplazo por regla de tarjetas | VERIF (falta «restaurar» explícito) |
| CAL-12 | Series: crear con patrón semanal, ciclos de 2–4 semanas, varios días/horarios, fecha de fin, pendiente de asignar | `RecurrenceOptions`, `calendarRecurrenceEngine` | `/calendario/nueva`, `weekday-schedule-editor.tsx` | VERIF |
| CAL-13 | Series: pausar, reanudar, finalizar, editar futuras (versiones), cambiar participantes desde una fecha, intercambiar horarios | `RecurrenceRulesSheet`, `EditFutureRecurrenceSheet`, `calendarRecurrenceSplit` | `/calendario/series[/id]`, `editFutureRecurrenceAction`, `changeParticipantsAction`, `swapSeriesAction` | VERIF |
| CAL-14 | Acuerdo de cobro de entrenamiento (cuota, mes de inicio, vista previa de cargos) y su edición | `TrainingBillingAgreementSheet` | `training-billing-config.tsx` | VERIF |
| CAL-15 | Primer mes proporcional (usar proporcional / mes completo / otro importe / no cobrar) | `FirstMonthProrationSheet` | `proration.ts` + flujo | VERIF |
| CAL-16 | Conflictos de horario (permitir superposición explícita) | `calendarConflicts.ts` | `calendar-conflicts.ts` | VERIF |

## 5. Registro, contenido pedagógico, tareas y evidencias

| ID | Función | Original | Web | Estado / diferencia |
|---|---|---|---|---|
| REG-01 | Registro individual/grupal: asistencia por alumno, duración, evaluación, contenido, observaciones, tarea, guardar progreso, finalizar | `NewClassScreen`, `RegisterPendingClassSheet`, `ParticipantRegistrationBlock` | `registration-workspace.tsx` | VERIF (P0 registro 21/10) |
| REG-02 | **Marcar todos presentes / Limpiar asistencia** (con confirmación de reemplazo/borrado) | `NewClassScreen`, `useNewClassForm` | — | FALTA |
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
| PAG-01 | Generación de cargos por plan: por clase, mensual, **semanal, quincenal, paquete**, sin cargo | `monthlyChargeGenerationPlan`, `weeklyCharge…`, `packagePurchaseService` | por clase y mensual (`billing-plan.ts` documenta semanal/quincenal/paquete como pendientes) | FALTA (afecta dinero si hay alumnos con esos planes; **comprobar en la cuenta real qué planes existen**) |
| PAG-02 | Registrar pago: clase/semana/quincena/mes/paquete/entrenamiento, completo/parcial/previo, asignación al cargo más antiguo | `RegisterPaymentSheet`, `registerPaymentService` | `ChargeActions`, `register_payment` | VERIF |
| PAG-03 | Anular pago y anular cobro erróneo (con motivo) | `VoidPaymentDialog`, `VoidChargeDialog` | `charge-actions.tsx` | VERIF |
| PAG-04 | Modificar monto mensual (desde este mes / próximo mes, con recálculo del saldo) | `EditMonthlyAmountSheet`, `monthlyAmountCorrectionService` | — (sólo `edit_training_billing_fee` para entrenamiento) | FALTA |
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
| CFG-02 | Revisar consistencia y reparar problemas seguros | `BackupScreen` | restricciones en base; `/configuracion/respaldo` | AUT/VERIF |
| CFG-03 | Importación/exportación y compatibilidad con datos anteriores | `transfer/*` | importador (R6/R6.1) | EQ (probado, ver TRASLADO) |
| CFG-04 | Datos de prueba: exclusión reversible | — | `/configuracion/datos-de-prueba` | función propia de la web |

## 9. Uso móvil y escritorio

| ID | Función | Estado |
|---|---|---|
| UX-01 | Controles ≥ 44 px, letra ≥ 16 px en campos, sin desbordes a 375/390/430 px | VERIF por pantalla (aviso de pago: comprobado en emulación 375/390/430 y altura de teclado; **Safari/teclado/modo anclado de iPhone: prueba física pendiente**) |
| UX-02 | Diálogo compacto y centrado; cierre controlado | EQ para el aviso de pago (`Dialog placement="center"`, `onBeforeClose`); resto de diálogos siguen como hoja inferior en móvil |

## Pendientes que requieren decisión de Joaquín

1. **ALU-10 Eliminar definitivamente un alumno.** El original borra en cascada su historial financiero, reportes y clases; la web conserva historial. ¿Se implementa igual que el original (con resumen del impacto y copia de seguridad previa), sólo para alumnos sin cobros ni pagos, o no se implementa?

## Registro de cambios de esta matriz

- 27/10/2026: creada con el primer inventario basado en código. REG-05 cerrado en lógica y estructura (commit `de55143` publicado en Production); su verificación en navegador queda pendiente de sesión de QA.
