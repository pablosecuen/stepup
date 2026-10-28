# Paridad: alumnos, cobros del alumno y compartir reportes — 31/10/2026

Rama `alumnos-cobros-reportes`, partida del commit `7dde04b` (`parity-codex`). **No publicada y sin integrar**: Codex integra y publica. Una migración nueva, **sin aplicar** en ningún entorno: `supabase/migrations/20261031100000_student_initial_month_and_resume.sql` (no colisiona con `20261030130000_two_web_devices.sql` ni edita ninguna migración ya aplicada).

Método: para cada punto se leyó el original (`NewStudentScreen`, `studentMapper`, `studentValidation`, `initialMonthlyBillingService/Plan`, `CobrosTab`, `PaymentHistorySection`, `studentPaymentHistory`, `StudentsListScreen`, `SwipeableStudentRow`, `ReportesTab`, `reportSharing`) y se comparó campo por campo, con ejecución cruzada de las dos implementaciones donde hay lógica pura.

## Hallazgos que corrigen la auditoría del 28/10

Antes de implementar se verificó en el código del original lo que la auditoría daba por existente. Cuatro afirmaciones no se sostienen y **no se implementaron** (no se inventan campos que el original no tiene):

| Afirmación | Lo que hace el original | Decisión |
|---|---|---|
| El alta ofrece días y horario habituales | `usualDays`/`usualTime` existen en el estado del formulario y en su validación, pero **ninguna pantalla los muestra**, `mapNewStudentForm` **no los guarda** y nada los consume. Sólo llegan desde una copia de seguridad importada. | No se agrega un campo sin efecto. Un alumno importado conserva sus valores (la edición no los toca). Si se quiere capturarlos, es una decisión de producto nueva. |
| El alta ofrece semanal, quincenal, paquete y sin cargo | `BILLING_TYPES` del alta = **Por clase** y **Mensual**. Los demás planes se cambian después en Cobros (`EditBillingPlanSheet`). | La web ya hacía lo mismo; no se cambia. |
| La lista permitía registrar clase/pago, reprogramar, ver reporte y editar | El menú largo de la lista se eliminó el 24/07/2026; el deslizamiento ofrece sólo **Archivar/Restaurar y Eliminar**. El resto vivía en el perfil (`ProfileQuickActions`). | Se ofrece igual el menú completo pedido (superconjunto del original). «Eliminar definitivamente» (ALU-10) no se ofrece. |
| «Corregir situación inicial» es una corrección de la declaración | En el original corrige un **recargo** puesto por error a un mes declarado pago (`initialPaidSurchargeRepair`). Los recargos están desactivados en la web. | Se corrige anulando el pago declarado (queda en el historial; el mes vuelve a pendiente) y con «Cambiar desde cuándo se cobra». No se reactiva ningún recargo. |

## 1. Alta y edición del alumno (ALU-04/05)

- **Nombre y Apellido** separados y obligatorios los dos (como el original); se guardan como «nombre apellido». Al editar se vuelven a separar igual que `splitName`.
- **Edad** (vacía o entero de 3 a 120). Se guarda como fecha de nacimiento estimada (1 de enero); al editar, si la edad escrita coincide con la que surge de la fecha guardada se **conserva** la fecha (regla de `mapEditedStudentForm`). Requirió habilitar `birth_date` en la lista de columnas actualizables.
- **Objetivos** (uno por línea o separados por comas → `current_goals`; se muestran de nuevo uno por línea). «Notas» pasó a llamarse «Observaciones internas», como el original.
- **Forma de cobro y precio** sólo en el alta. **El precio tiene que ser mayor que cero** (validación del cliente, del servidor y de la base). Antes la web aceptaba cero; el original lo rechaza y «Sin cargo» se elige después desde Cobros.
- **¿Desde cuándo querés comenzar a controlar sus pagos?** (sólo mensual): «Desde el próximo mes» (predeterminada), «Este mes ya está pago» (con fecha real, hoy por defecto, nunca futura) y «Este mes está pendiente» (exige marcar una casilla de confirmación equivalente al aviso del original). Todo se aplica **en la misma transacción del alta** (`create_student_with_operation`): si falla, no queda ni el alumno ni el claim ni el pago. Repetir el alta con la misma clave devuelve el mismo alumno sin un segundo cargo ni pago.
- Siguen sin tocarse por «Editar alumno»: plan, importe y situación mensual (circuitos de Cobros).

## 2. Situación mensual inicial y corrección (PAG-05 / ALU-16)

Núcleo único `_apply_first_month_situation` (puerto de `planEnsureMonthlyChargeSituation`), usado por el alta, por «Marcar mes actual como pagado» y por «retomar el cobro». Reglas: nunca una segunda mensualidad del período (se reutiliza la vigente); «pagado» paga sólo el **saldo real** del cargo; un período saldado se rechaza (no duplica); en el alta la fecha de pago se recorta al vencimiento y al marcar el mes pagado **no**; el pago declarado queda con `source = 'initial_student_setup'`, **distinguido** de un pago observado y se muestra «Situación inicial declarada»; se rechaza un período vencido de la pantalla (cambio de mes con la pantalla abierta) y la fecha futura; un cargo anulado del mes no se regenera; no se crea cargo para un alumno no activo. Auditoría en `student_billing_audit`. En Cobros: tarjeta «Mensualidad de <mes>» (estado en texto), **Marcar mes actual como pagado** (confirmación con importe) y **Cambiar desde cuándo se cobra**.

Corrección: no borra pagos ni cobros. Un pago declarado por error se **anula** desde «Pagos registrados» (queda anulado en el historial y el mes vuelve a pendiente); un inicio mal elegido se cambia con «Cambiar desde cuándo se cobra». No cambia acuerdos de entrenamiento ni otros períodos.

## 3. Reactivación (ALU-09)

Al restaurar un alumno **mensual** (el único camino de la web para volver a activo desde pausado, inactivo o archivado; el original lo pregunta sólo al restaurar archivados) el formulario exige elegir «Comenzar el próximo mes» o «Cobrar desde este mes» (nunca preseleccionado). `resume_monthly_billing`: «este mes» mueve el inicio al período vigente y genera su cargo **si no existe**; «próximo mes» mueve el inicio y **conserva** un cargo ya generado. No restaura series antiguas ni duplica deuda. Si el cambio de estado salió bien pero esta decisión fallara, se avisa sin simular éxito (el alumno queda activo) y se puede repetir desde Cobros.

## 4. Historial individual de pagos (PAG-07)

`PaymentHistorySection` del original portada con el motor idéntico (`studentPaymentHistory`, `paymentStats`, `monthlyPeriodStatus`): últimos 12 meses (chip + texto en `aria-label`/`title`, marca «!» en deuda vigente para no depender del color), categoría y puntaje siempre en texto, aviso de **historial insuficiente** (menos de 3 obligaciones resueltas, sin puntaje inventado), pagos en término / fuera de término, deuda actual y racha de meses con deuda. Datos sólo del alumno; recargos desactivados.

## 5. Acciones desde la lista (ALU-03)

Menú «Acciones de <nombre>» por alumno (móvil y escritorio, fuera del enlace del perfil, objetivo táctil de 44 px, Escape/clic afuera para cerrar, se abre hacia arriba si no hay lugar): ver perfil, registrar clase, registrar pago (Cobros del alumno), reprogramar su próxima clase, reporte, editar, archivar/cambiar estado o restaurar. Reutiliza los circuitos existentes (no se tocó calendario ni registro): sólo enlaza a rutas que ya existen, siempre con el id de **esa** fila.

## 6. Compartir reportes (REP-03)

`Compartir` en cada reporte del historial: aviso de privacidad del original (una vez; sólo se guarda que se vio), **selector del sistema con el PDF real** (`navigator.share({ files })`) si el navegador lo admite; si no, se explica y quedan **Descargar PDF**, **Copiar mensaje** y **Abrir WhatsApp Web** (sin contacto ni mensaje). El archivo se pide con el enlace firmado de corta vida que ya existía; no se publica ninguna URL duradera, no se envía nada solo y nunca se afirma que el envío se completó. Diferencia: el original no tiene un mensaje sugerido; el de la web nombra sólo el primer nombre, el título y el período.

## Pruebas realizadas (todas contra la implementación de la web)

- Postgres real aislado, `supabase/tests/postgres/student_initial_month.cjs`: **47/47** (pago único con asignación; reintento con la misma clave; segundo pago con otra clave; saldo parcial previo; período obsoleto; fecha futura; por clase; alumno ajeno / otra cuenta / `anon`; alumno archivado; cargo anulado; retomar cobro este mes / próximo, repetido; **dos llamadas simultáneas** → un solo pago; alta atómica pagado / pendiente / próximo mes / por clase / sin situación; alta inválida sin restos; precio cero, 14/480/correo, edad fuera de rango; edad propia y ajena; auditoría; aislamiento) **más comparación directa con `planEnsureMonthlyChargeSituation` del original** (6 escenarios).
- Regresión de otros circuitos: `billing_plans_amounts.cjs` 60/60.
- `lib/students/__tests__/student-form-fields.test.ts` (8, ejecuta `mapNewStudentForm`/`mapEditedStudentForm`/`mapStudentToEditableForm`/`validateNewStudentForm` del original contra la web), `row-actions.test.ts` (4), `lib/payments/__tests__/student-cobros.test.ts` (7), `lib/reports/__tests__/share-pdf.test.ts` (8, con navegadores simulados).
- Suite completa en copia LF: 5097/5097; `tsc --noEmit` y `eslint .` sin errores; `next build --webpack` correcto (el `build` por defecto no funciona en esta carpeta porque `node_modules` es un enlace a otro worktree).

## Sin verificar (no se declara hecho)

Recorrido autenticado en el navegador (no había sesión de QA), capturas a 375/390/430 px y escritorio, iPhone/Safari físico (selector de compartir de iOS), migración no aplicada ni probada contra la base real, y la comparación campo por campo del resto de los 191 casos de la matriz.

## Para integrar

Archivos nuevos: `components/students/{first-month-fields,row-actions-menu}.tsx`, `components/students/profile/{monthly-status-card,share-report-dialog}.tsx`, `components/payments/student-payment-history.tsx`, `lib/payments/student-cobros.ts`, `lib/reports/share-pdf.ts`, `lib/students/{first-month,row-actions,student-form-fields}.ts` y sus pruebas. Archivos compartidos modificados con cambios pequeños: `lib/actions/{payments,students}.ts`, `lib/repositories/{payments,payments-mapping,students-mapping}.ts`, `lib/students/list-status.ts` (agrega `source` al estado del motor), `components/students/{change-status-form,student-card,student-form-fields}.tsx`, `components/students/profile/{cobros-tab,reportes-tab,student-profile-view}.tsx`. Prueba estructural ajustada por cambios de intención: `block3-students` (campos del formulario), `money-input` (el campo de precio se mudó) y `students-mapping` (precio cero ya no es válido en el alta).
