# TeacherFlow Web — Estructura visual y funcional (auditoría estructural)

> **Documento histórico (nota de B11).** Es la auditoría estructural inicial, de cuando la web era una vista previa con datos ficticios («Fase A»). Hoy la web usa datos reales de Supabase; el estado vigente, por bloque y por fase, está en `docs/WEB_PARITY_PLAN.md`. No se actualizó su contenido por precisión histórica.

**Alcance de este documento.** Describe qué existe hoy, con qué nombre, en qué archivo y con qué comportamiento — sin proponer estética ni tocar código. Es la base para que un futuro trabajo de diseño no invente pantallas, no elimine funciones y no altere reglas de negocio.

**Fuentes auditadas y cómo leer las etiquetas.** Cada afirmación de este documento lleva una etiqueta de origen, en el mismo espíritu que ya usa `docs/AI_CONTEXT/00_LEER_PRIMERO.md` del proyecto móvil ("Implementado y verificado en código" vs. "Diseñado, no implementado"):

- **[WEB]** — leído directamente del código de `stepup/stepup` (este repo). 100% del código fuente de la app (todo `app/`, `components/`, `lib/`, configuración) fue leído para este documento.
- **[MÓVIL·CÓDIGO]** — leído directamente del código de la app de referencia (`TeacherFlow` React Native/Expo): navegación real (`RootNavigator.tsx`), tipos/enums de dominio (`features/*/types`) e inventario de archivos de cada pantalla/componente. Es la fuente más confiable para "qué pantallas y estados existen", pero no se releyó línea por línea el contenido completo de cada componente (algunos superan las 50–180 KB); donde hace falta ese nivel de detalle se indica el archivo exacto a abrir.
- **[MÓVIL·DOC]** — proviene de `docs/AI_CONTEXT/*.md` del proyecto móvil. Esa documentación está fechada 2026-07-13 y el propio proyecto la marca como más lenta que el código real (hay cambios posteriores verificados en tipos, p. ej. "entrenamientos", "scoring", paquetes de clases). Se usa solo para arquitectura general y advertencias de consistencia de datos, nunca como fuente de un estado semántico si el código dice otra cosa.
- **[ESPECIFICACIÓN]** — reglas de negocio confirmadas directamente por la profesora en conversación, para la parte de cobros/alumnos que todavía no tiene equivalente visual en la web.
- **[PENDIENTE DE DEFINIR]** — el punto no está resuelto en ningún lado (ni web, ni móvil, ni especificación) y se marca así explícitamente en vez de inventarse.

**Regla de precedencia ante contradicción:** código real de cada proyecto > tipos/dominio del móvil > especificación de la profesora > documentación `AI_CONTEXT` (fechada). Ninguna contradicción encontrada se resolvió en silencio; están señaladas donde aparecen.

---

## 0. Resumen ejecutivo (para pegar como contexto de un futuro prompt de diseño)

TeacherFlow Web es un Next.js 16 (App Router) + TypeScript + Tailwind, hoy en **"Fase A": pantallas de vista previa con datos ficticios, sin conexión real a Supabase ni backend**. Existen 10 rutas reales: landing (`/`), 4 pantallas de autenticación (`/login`, `/crear-cuenta`, `/recuperar-contrasena`, `/nueva-contrasena`) + 2 rutas técnicas de auth (`/auth/callback`, `/auth/error`), y 5 pantallas privadas (`/inicio`, `/alumnos`, `/calendario`, `/cobros`, `/configuracion`). La paleta, radios, sombras y tipografía YA están definidos en `tailwind.config.ts`, copiados 1:1 de la app móvil — es decir, **ya existe un sistema visual congelado que cualquier rediseño debe decidir si conserva, ajusta o reemplaza**, no un lienzo en blanco.

La app móvil de referencia (React Native/Expo, mismo producto, mucho más avanzada) define el modelo de negocio completo: 4 estados de alumno (activo/pausado/inactivo/archivado), semáforo de pago de 4 colores (verde/amarillo/naranja/rojo) con 4 etapas de vencimiento, clases individuales/grupales con distinción clase/entrenamiento, series recurrentes con estado activa/pausada/finalizada, 6 planes de facturación (por clase, semanal, quincenal, mensual, paquete de clases, cortesía), un motor de cobros con cargos/pagos/asignaciones/ajustes separados, disponibilidad semanal + excepciones de la profesora, y un sistema de scoring de alumnos. Todo esto vive en pantallas y componentes reales del móvil (ver §2 y §3) que la web todavía no replica funcionalmente — la web de hoy solo replica la paleta visual y la grilla semanal de calendario (de solo lectura, con datos de ejemplo).

Ningún nombre, monto, alumno ni fecha en la web (ni en el móvil, en sus fixtures) es real: son datos de ejemplo declarados como tales en el propio código.

---

## 1. Arquitectura general

### 1.1 Mapa completo de rutas — Web [WEB]

**Públicas (sin sesión):**

| Ruta | Archivo | Descripción |
|---|---|---|
| `/` | `app/page.tsx` | Landing. |
| `/login` | `app/login/page.tsx` + `login-form.tsx` | Inicio de sesión. |
| `/crear-cuenta` | `app/crear-cuenta/page.tsx` + `signup-form.tsx` + `resend-confirmation-form.tsx` | Alta de cuenta. |
| `/recuperar-contrasena` | `app/recuperar-contrasena/page.tsx` + `forgot-password-form.tsx` | Pedido de recuperación de contraseña. |
| `/nueva-contrasena` | `app/nueva-contrasena/page.tsx` + `new-password-form.tsx` | Alta de nueva contraseña (requiere sesión de recuperación activa). |
| `/auth/callback` | `app/auth/callback/route.ts` | Route Handler — intercambio de código PKCE de Supabase. No renderiza UI. |
| `/auth/error` | `app/auth/error/page.tsx` | Pantalla de error de verificación de cuenta. |

**Privadas (grupo `(app)`, protegidas por `app/(app)/layout.tsx`):**

| Ruta | Archivo | Descripción |
|---|---|---|
| `/inicio` | `app/(app)/inicio/page.tsx` | Home — clases del día. |
| `/alumnos` | `app/(app)/alumnos/page.tsx` | Lista de alumnos. |
| `/calendario` | `app/(app)/calendario/page.tsx` | Grilla semanal. |
| `/cobros` | `app/(app)/cobros/page.tsx` | Lista de cobros. |
| `/configuracion` | `app/(app)/configuracion/page.tsx` | Cuenta + accesos a secciones futuras. |

**No existen hoy como ruta web** (aunque las pide la auditoría — ver §9 y la matriz de §10 para el detalle de cuáles ya tienen equivalente funcional en el móvil y cuáles no existen en ningún lado todavía): Nuevo alumno, Perfil del alumno, Edición del alumno, Crear clase, Crear serie, Detalle de clase, Registro de clase, Series, Disponibilidad, Registrar pago, Historial financiero, Reportes, Perfil de profesora, Backup e importación. Ninguna de estas se documenta en la web porque **no existe código web que describir**; su especificación funcional para esta auditoría proviene del equivalente móvil (§1.2) y se referencia, nunca se inventa.

### 1.2 Mapa de navegación — Móvil de referencia [MÓVIL·CÓDIGO] (`src/navigation/RootNavigator.tsx`)

```text
RootStack (stack raíz, sin header)
├── Tabs (barra inferior — Home / Alumnos / Calendario)
│   ├── Home       → HomeStack → HomeScreen (features/dashboard)
│   ├── Alumnos    → AlumnosStack
│   │                 ├── AlumnosList     → StudentsListScreen (features/students)
│   │                 └── StudentProfile  → StudentProfileScreen (features/student-profile)
│   └── Calendario → CalendarTabScreen (features/calendar)
│
└── Grupo modal (presentation: 'modal', se abre encima de Tabs)
    ├── NewClass            → NewClassScreen (features/new-class) — "registro pedagógico" de una clase
    ├── NewStudent          → NewStudentScreen (features/new-student) — alta Y edición de alumno
    ├── DataBackup          → BackupScreen (features/backup)
    ├── CollectionsCenter   → CollectionsCenterScreen (features/payments) — "Cobros"
    ├── PendingClassesList  → PendingClassesScreen (features/dashboard)
    ├── Account             → AccountScreen (features/account) — "Perfil de profesora" / sesión
    ├── FinancialOverview   → FinancialOverviewScreen (features/dashboard)
    ├── RemindersCenter     → RemindersCenterScreen (features/dashboard)
    ├── PaymentBehavior     → MonthlyPaymentBehaviorScreen (features/dashboard)
    ├── Info                → InfoScreen (features/calendar) — leyenda de colores/estados
    ├── Settings            → SettingsScreen (features/dashboard)
    └── Tutorial            → OnboardingTutorialScreen (features/account/screens)
```

Puntos importantes para un futuro diseño web:

- **"Nuevo alumno" y "Editar alumno" son la misma pantalla** (`NewStudentScreen`, con `studentId` opcional) — no dos pantallas distintas. Un rediseño no debería separarlas sin motivo.
- **"Crear clase" (`NewClass`) es el registro pedagógico de una clase ya dictada/a dictar** (asistencia, evaluación, tarea, cobro), **distinto de "agendar un horario en el calendario"**, que ocurre dentro de `CalendarTabScreen` mediante un sheet (`NewCalendarLessonSheet`, ver §1.2.1) — no una pantalla propia. Esta distinción (reserva de horario vs. registro pedagógico) es una regla de datos explícita [MÓVIL·DOC], no un detalle visual.
- **No existe una ruta de nivel raíz llamada "Series" ni "Disponibilidad" ni "Detalle de clase"**: viven como *sheets* (paneles modales) dentro de Calendario (ver §1.2.1). Documentarlas como "páginas" en un futuro diseño sería inventar una jerarquía que hoy no existe; deben tratarse como paneles/superposiciones sobre el Calendario, salvo que el rediseño decida explícitamente promoverlas a rutas propias (decisión de producto, no de estética — ver §9).
- **"Reportes" no es una pantalla única**: hoy son tres rutas separadas e independientes — `FinancialOverview` (resumen financiero), `RemindersCenter` (recordatorios) y `PaymentBehavior` (comportamiento de pago mensual) — más una pestaña "Reportes" dentro del propio Perfil del alumno (`ReportesTab.tsx`, 39 KB, ver §2). Un comentario del propio código marca que unificarlas en una sola pantalla fue un bug corregido: *"Recordatorios" abría la misma pantalla que "Resumen financiero" — ahora tiene ruta propia e independiente* [MÓVIL·CÓDIGO]. No deben re-fusionarse sin que sea una decisión de producto explícita.
- **"Perfil de profesora" y "Configuración" son pantallas distintas** en el móvil (`Account` vs. `Settings`), mientras que en la web ambas conviven hoy dentro de una sola ruta `/configuracion` (ver §2, página Configuración).

#### 1.2.1 Paneles/sheets relevantes dentro de Calendario [MÓVIL·CÓDIGO] (`src/features/calendar/components/`)

No son rutas; son superposiciones modales sobre `CalendarTabScreen`. Se listan porque cubren funciones pedidas explícitamente por la auditoría (Crear serie, Disponibilidad, Detalle de clase, Reprogramar, Reemplazo):

`NewCalendarLessonSheet` (agendar horario — el más grande, 89 944 bytes), `CalendarLessonActionsSheet` (acciones sobre una clase existente — "Detalle de clase", 51 688 bytes), `RecurrenceRulesSheet` (gestión de series — "Series"), `RecurrenceOptions` (configuración de recurrencia al crear), `EditFutureRecurrenceSheet`, `SelectLessonToRescheduleSheet` + `RescheduleMonthCalendar` + `RescheduleTimeSlotGrid` + `TimeSlotQuickPickSheet` (flujo de reprogramar), `TeacherAvailabilitySheet` (40 684 bytes — "Disponibilidad"), `AddParticipantsSheet` (agregar participantes a clase grupal/entrenamiento), `EditActivityKindSheet` (cambiar clase↔entrenamiento), `EditClassTitleSheet`, `ChangeLessonDurationSheet`, `TrainingBillingAgreementSheet` (cuota de entrenamiento), `FirstMonthProrationSheet` (primer mes proporcional), `LateCancellationPolicySheet`.

### 1.3 Navegación principal — Web [WEB]

Un único componente, `components/nav/primary-nav.tsx`, con **dos variantes responsive de la misma barra** (nunca dos sistemas de navegación distintos):

- **Barra inferior fija** (`< md`, breakpoint Tailwind 768px): 5 ítems (Inicio, Alumnos, Calendario, Cobros, Configuración), iconos Heroicons outline/solid según activo, fija con `fixed inset-x-0 bottom-0`, fondo semitransparente con blur.
- **Barra lateral fija** (`≥ md`): mismo array de 5 ítems, `fixed inset-y-0 left-0`, ancho 224px (`w-56`), siempre visible.

El layout `app/(app)/layout.tsx` reserva `md:pl-56` en el contenido para no quedar debajo de la barra lateral, y `pb-20` en el `<main>` para no quedar debajo de la barra inferior en móvil.

### 1.4 Navegación móvil — App de referencia [MÓVIL·CÓDIGO]

Barra de tabs inferior real (no una adaptación de sidebar): Home / Alumnos / Calendario, con la particularidad de que puede ocultarse (`tabBarStyle: { display: 'none' }`) cuando `useNavigationLocation()` devuelve `'menu'` — patrón "menú de logo" (`LogoMenuSheet`, en `features/dashboard/components/`) que reemplaza visualmente la tab bar sin dejar de usar el mismo navegador. Cobros, Backup, Cuenta, Resumen financiero, Recordatorios, Comportamiento de pago, Info, Configuración y Tutorial no tienen ítem propio en la tab bar: se llega a ellas desde ese menú del logo o desde accesos dentro de otras pantallas (p. ej. un recordatorio de cobro vencido en Home lleva directo al Perfil del alumno, pestaña Cobros).

### 1.5 Jerarquía entre áreas

```text
Área pública (marketing/auth) — Web: /, /login, /crear-cuenta, /recuperar-contrasena, /nueva-contrasena
   └── no comparte layout con el área privada; cada auth screen usa su propio AuthShell

Área privada (operación diaria de la profesora)
   ├── Inicio      — punto de entrada, resumen del día
   ├── Alumnos     — entidad principal (contiene Perfil, que a su vez contiene Clases/Progreso/Tareas/Cobros/Reportes/Información del alumno)
   ├── Calendario  — segunda entidad principal (agenda visual de Alumnos)
   ├── Cobros      — vista transversal de la misma información financiera que ya vive dentro de cada Perfil de alumno
   └── Configuración — cuenta, ajustes, accesos a Backup/Perfil de profesora
```

Alumnos y Calendario son las dos jerarquías centrales del producto y se referencian mutuamente en todo momento (crear alumno desde un horario vacío, reprogramar desde el perfil, etc. — ver flujos en §4). Cobros es una vista agregada de datos que "viven" en el Perfil del alumno, no una entidad independiente.

### 1.6 Qué páginas comparten layout

- **Web:** las 5 páginas privadas comparten exactamente `app/(app)/layout.tsx` (nav + banner de vista previa + `<main>`). Las 4 páginas de autenticación comparten `AuthShell` (`components/auth/auth-shell.tsx`): icono + título + subtítulo centrados sobre una tarjeta. La landing (`/`) y `/auth/error` no comparten layout con nada; son autocontenidas.
- **Móvil:** Home/Alumnos/Calendario comparten la tab bar (`MainTabs`); el resto de las pantallas son modales de pantalla completa sin barra.

### 1.7 Elementos persistentes

- **Web:** dentro del área privada, persistentes en las 5 páginas: la barra de navegación (`PrimaryNav`) y el banner superior de "Vista previa con datos ficticios" (`app/(app)/layout.tsx`, línea con `bg-brandBlue/5`). Ninguna otra pieza de UI persiste entre páginas hoy (no hay header con buscador global, ni breadcrumbs, ni notificaciones).
- **Móvil:** tab bar persistente en Home/Alumnos/Calendario (excepto cuando `navigationLocation === 'menu'`, ver §1.4); no hay banner de vista previa (la app móvil ya maneja datos reales persistidos en `AsyncStorage`, a diferencia de la web).

---

## 2. Inventario de páginas

Formato por página: **Objetivo · Usuario · Información mostrada · Acciones · Secciones y orden · Dependencias · Estados · Diferencias responsive**. Las páginas marcadas [WEB] tienen todos los campos verificados en código; las marcadas [MÓVIL] usan el equivalente funcional del móvil como referencia obligatoria para no inventar contenido, con advertencia expresa donde el nivel de detalle no fue releído componente por componente.

### 2.1 Landing — `/` [WEB]

- **Objetivo:** presentar el producto y dirigir a iniciar sesión.
- **Usuario:** visitante sin cuenta (o con cuenta, no se verifica sesión acá).
- **Información mostrada:** logo + nombre, titular ("Todo tu trabajo docente, ordenado."), bajada, 3 tarjetas de features (Alumnos / Calendario / Cobros, con descripción de una línea cada una), footer.
- **Acciones:** "Iniciar sesión" (header, esquina superior derecha) y "Empezar" (hero) — ambas van a `/login`. No hay acción secundaria ni CTA de registro directo en la landing (crear cuenta se ofrece recién dentro de `/login`).
- **Secciones y orden:** header (logo + botón) → hero (titular + bajada + CTA) → grid de 3 features → footer ("TeacherFlow — versión web en construcción.").
- **Dependencias:** ninguna (no lee sesión, no llama a Supabase).
- **Estados:** única variante; no tiene carga/error/vacío (contenido estático).
- **Responsive:** grid de features `grid-cols-1` en móvil → `sm:grid-cols-3` en desktop. Header y hero usan `flex-col`/`text-center` en todos los anchos, con tamaños de texto escalonados (`text-3xl` → `sm:text-5xl` en el titular).

### 2.2 Login — `/login` [WEB]

- **Objetivo:** autenticar a la profesora.
- **Usuario:** profesora con cuenta existente.
- **Información mostrada:** título "Iniciar sesión", subtítulo, formulario (correo, contraseña).
- **Acciones principales:** enviar formulario ("Iniciar sesión"). **Secundarias:** "Olvidé mi contraseña" (→ `/recuperar-contrasena`), "Crear cuenta" (→ `/crear-cuenta`, aparece dos veces: como hint contextual si el error es "no tenés cuenta con este correo", y siempre al pie del formulario), "Volver al inicio" (→ `/`).
- **Secciones y orden:** icono+título+subtítulo (AuthShell) → formulario → link "Olvidé mi contraseña" → botón submit → hint de error → link a crear cuenta → "Volver al inicio".
- **Dependencias:** `lib/auth/actions.ts` (`signInAction`), `lib/auth/config.ts` (si Supabase no está configurado, la página entera se reemplaza por `AuthNotConfigured`), redirección post-login sujeta a `next` saneado por `lib/auth/safe-redirect.ts`.
- **Estados:**
  - *Vacío inicial:* formulario en blanco.
  - *Carga:* botón "Iniciar sesión" pasa a spinner + `disabled`, `aria-busy="true"` (`useFormStatus`).
  - *Error:* caja roja bajo el formulario con mensaje textual (nunca solo color) — mensajes exactos en `lib/auth/error-messages.ts` (ver §6).
  - *Éxito:* redirección server-side, no hay pantalla de éxito propia.
  - *Sin permisos / no configurado:* pantalla completa `AuthNotConfigured` ("Sincronización no configurada").
  - *Ya autenticado:* redirect automático a `next` (o `/inicio`), sin mostrar el formulario.
- **Responsive:** una sola columna centrada (`max-w-sm`) en todos los anchos; no hay variante de escritorio distinta.

### 2.3 Crear cuenta — `/crear-cuenta` [WEB]

- **Objetivo:** alta de cuenta nueva.
- **Usuario:** profesora sin cuenta.
- **Información mostrada:** título "Crear cuenta", subtítulo ("Esta cuenta todavía no sincroniza datos — sólo prepara el acceso."), formulario (correo, contraseña, repetir contraseña).
- **Acciones principales:** enviar formulario. **Secundarias:** "Iniciar sesión" (hint si el correo ya existe, y al pie), reenviar enlace de confirmación (una vez enviado el alta), "Volver al inicio".
- **Secciones y orden:** AuthShell → formulario (3 campos) → validación de coincidencia de contraseña en vivo → submit →, tras éxito, cambia a vista "revisá tu correo" con botón "Reenviar enlace" (cooldown de 30s) en vez de navegar a otra ruta.
- **Dependencias:** `lib/auth/actions.ts` (`signUpAction`, `resendConfirmationAction`), `lib/auth/validation.ts` (mínimo 8 caracteres, sin otras reglas de complejidad — copiado tal cual del móvil).
- **Estados:**
  - *Formulario:* igual patrón que Login (spinner en botón, `aria-busy`).
  - *Error de coincidencia de contraseña:* mensaje inline bajo "Repetir contraseña", borde rojo (`statusRojo`), sin bloquear el tipeo.
  - *Error de envío:* caja roja con mensaje, con hint a "Iniciar sesión" si el error es "correo ya existe".
  - *Necesita confirmación de correo:* pantalla de espera con cooldown de reenvío (30s) y mensaje de confirmación tras reenviar ("Te enviamos un nuevo enlace.").
  - *Ya autenticado:* redirect automático, no muestra el formulario.
- **Responsive:** igual patrón de columna única que Login.

### 2.4 Recuperar contraseña — `/recuperar-contrasena` [WEB]

- **Objetivo:** disparar el email de recuperación.
- **Usuario:** profesora que olvidó su contraseña.
- **Información mostrada:** título, subtítulo, formulario de un solo campo (correo).
- **Acciones:** enviar formulario; volver a iniciar sesión.
- **Secciones y orden:** AuthShell → formulario → tras enviar, mensaje de confirmación **deliberadamente ambiguo** sobre si la cuenta existe (anti-enumeración, copiado tal cual del móvil) → link a login.
- **Dependencias:** `requestPasswordResetAction`.
- **Estados:** formulario / cargando / error / enviado. Igual que arriba, el estado "enviado" no revela si el correo existe.
- **Responsive:** columna única, sin variante de escritorio.

### 2.5 Nueva contraseña — `/nueva-contrasena` [WEB]

- **Objetivo:** definir una contraseña nueva tras click en el enlace de recuperación.
- **Usuario:** profesora que ya pasó por el enlace de email (requiere sesión de recuperación activa; si no hay sesión, redirige a `/login`).
- **Información mostrada:** título, subtítulo ("Después de guardarla, vas a iniciar sesión de nuevo con ella."), formulario (contraseña nueva + repetir).
- **Acciones:** guardar contraseña.
- **Dependencias:** `updatePasswordAction` — al confirmar, cierra la sesión y redirige a `/login` (decisión deliberada: "nunca un atajo para saltarse el inicio de sesión manual").
- **Estados:** formulario / validación de coincidencia en vivo / cargando / error. No hay estado de "éxito" visible (redirige directo).
- **Responsive:** columna única.

### 2.6 Error de verificación de cuenta — `/auth/error` [WEB]

- **Objetivo:** informar por qué falló un enlace de confirmación/recuperación.
- **Usuario:** cualquiera que llegó desde un enlace de email vencido/inválido/ya usado.
- **Información mostrada:** icono + "No pudimos verificar tu cuenta" + mensaje específico según `type` (querystring): enlace vencido, ya usado, inválido, sin conexión, servidor no disponible, u "otro" (mensajes exactos en §6).
- **Acciones:** "Reintentar" (→ `/login`), "Volver al inicio".
- **Dependencias:** `lib/auth/error-messages.ts` (`classifyCallbackUrlError`).
- **Estados:** una sola vista, varía solo el texto del mensaje según `type`.
- **Responsive:** columna única (`max-w-sm`).

### 2.7 Callback de autenticación — `/auth/callback` [WEB]

Route Handler puro (sin JSX): intercambia el código PKCE de Supabase por sesión y redirige a `next` (saneado) o a `/auth/error?type=...`. Equivalente web del deep link `teacherflow://auth-confirmed` / `teacherflow://reset-password` del móvil. No es "una página" en sentido visual — se documenta porque es parte del flujo de autenticación.

### 2.8 Inicio — `/inicio` [WEB]

- **Objetivo:** mostrar de un vistazo las clases del día.
- **Usuario:** profesora, uso diario.
- **Información mostrada:** título "Inicio", aviso de datos de ejemplo, sección "Clases de hoy" con tarjetas (nombre de alumno, modalidad, hora).
- **Acciones:** ninguna interactiva hoy (las tarjetas no son clicables — a diferencia del móvil, donde Home sí es accionable, ver abajo).
- **Secciones y orden:** encabezado → "Clases de hoy" (grid de tarjetas o estado vacío).
- **Dependencias:** `lib/fixtures.ts` (`FIXTURE_TODAY_LESSONS`).
- **Estados:** *con clases* (grid `sm:grid-cols-2`) / *vacío* (`EmptyState`: "No hay clases agendadas para hoy.").
- **Responsive:** grid de 1 columna en móvil, 2 en `sm+`.
- **Brecha funcional frente al móvil [MÓVIL·CÓDIGO]:** `HomeScreen` del móvil (25 447 bytes) es sustancialmente más rico — incluye próxima clase destacada (`NextClassCard`), clase activa en curso (`ActiveClassCard`, con seguimiento en vivo — `LiveClassTrackingSwitch`), resumen financiero, recordatorios, acciones rápidas (`QuickActions`), estadísticas, aviso de modo offline (`OfflineProtectionBanner`), notificaciones (`NotificationBell`), menú de logo (`LogoMenuSheet`) y lista de "Clases pendientes de registrar" (`PendingClasses` → pantalla completa `PendingClassesScreen`). Ninguna de estas piezas existe todavía en la web; no deben inventarse visualmente sin decidir primero, por producto, cuáles se traen a esta fase.

### 2.9 Alumnos — `/alumnos` [WEB]

- **Objetivo:** listar alumnos con su estado.
- **Usuario:** profesora.
- **Información mostrada:** título, aviso de datos de ejemplo, grid de tarjetas con nombre, nivel y una `StatusPill` de estado de pago.
- **Acciones:** ninguna interactiva hoy (sin buscador, filtros, ni botón "Nuevo alumno" — todos pendientes frente al móvil).
- **Secciones y orden:** encabezado → grid de tarjetas o estado vacío.
- **Dependencias:** `lib/fixtures.ts` (`FIXTURE_STUDENTS`).
- **Estados:** *con alumnos* / *vacío* (`EmptyState`: "Todavía no hay alumnos cargados.").
- **Responsive:** grid 1 → 2 columnas en `sm+`.
- **Brecha funcional frente al móvil [MÓVIL·CÓDIGO], `StudentsListScreen.tsx` (20 266 bytes) + su carpeta `components/` (16 archivos):** buscador en tiempo real (`SearchBar`), panel de filtros por nivel/modalidad/estado de pago/estado de alumno (`FiltersPanel`), orden por nombre/próxima clase/último pago (`SortOption`), tarjeta con más información y badges (`StudentCard` + `StudentBadges`: destacado, nuevo, pago vencido, reporte pendiente, tarea pendiente), fila con gestos de swipe (`SwipeableStudentRow`, `SwipeActionButton`), botón flotante "Nuevo alumno" (`NewStudentButton`), diálogos de archivar/eliminar (`ArchiveStudentDialog`, `DeleteStudentDialog`), gestión de niveles personalizados (`CreateCustomLevelSheet`, `ManageCustomLevelsSheet`, `LevelPicker`, `ChipGroup`), estado vacío y skeleton propios (`StudentsEmptyState`, `SkeletonCard`), estado de error (`ErrorState`). La web de hoy no tiene ninguno de estos elementos: es una lista de solo lectura.
- **Filtro por defecto verificado en móvil [MÓVIL·CÓDIGO]:** `DEFAULT_FILTER_STATE` muestra `status: 'activo'` — la lista no muestra pausados/inactivos/archivados salvo que se cambie el filtro explícitamente. La web hoy no filtra (muestra las 4 fixtures sin distinguir estado).

### 2.10 Calendario — `/calendario` [WEB]

- **Objetivo:** ver la agenda semanal.
- **Usuario:** profesora.
- **Información mostrada:** título, aviso, toolbar (semana anterior/siguiente/hoy + rango de fechas), grilla de 7 días × horas 08:00–21:00, tarjetas de clase por franja horaria, línea de "ahora" en el día actual.
- **Acciones:** navegar semana (anterior/siguiente/hoy), tocar una clase → abre `LessonDetailModal` (ver §3) con acciones deshabilitadas marcadas "Demo" (no persiste nada real — es explícitamente de solo lectura).
- **Secciones y orden:** encabezado → `CalendarToolbar` → grilla (`WeekCalendar`) → modal de detalle (condicional).
- **Dependencias:** `lib/calendar-fixtures.ts` (14 clases de ejemplo, cuidadosamente diseñadas para cubrir casos límite: consecutivas sin superposición, cancelada con reemplazo activo, cancelada sin reemplazo, nombre largo aislado), `lib/calendar-layout.ts` (posicionamiento), `lib/calendar-theme.ts` (colores — paleta **congelada**, copiada tal cual del móvil, ver §6), `lib/calendar-conflicts.ts` (función pura de detección de solapamiento, **preparada pero no conectada a ninguna UI todavía** — comentario explícito en el código: "esa fase no está autorizada").
- **Estados:**
  - *Cargando:* "Cargando calendario…" (mientras se resuelve la fecha/hora real en el cliente, para evitar desajuste de hidratación servidor/cliente).
  - *Clase cancelada:* texto tachado, color ámbar fijo, siempre gana sobre cualquier otro color.
  - *Clase transcurrida:* gris fijo, prioridad sobre modalidad y sobre reemplazo activo.
  - *Reemplazo activo de una cancelada:* color coral exclusivo.
  - *Regla de visibilidad no destructiva:* una clase cancelada con reemplazo activo apuntándole se oculta de la grilla (nunca se borra el dato — sigue existiendo para resolver colores).
  - *Modal de detalle:* header + chips de metadatos (fecha, hora, duración, modalidad, recurrente/suelta, estado, entrenamiento) + lista de alumnos + banner "Vista previa — estas acciones todavía no guardan cambios reales" + 4 acciones deshabilitadas con badge "Demo".
- **Responsive:** la grilla tiene un ancho mínimo (`TIME_COLUMN_WIDTH_PX` 48 + 7 × `DAY_COLUMN_MIN_WIDTH_PX` 168 = 1224px) y **scroll horizontal contenido dentro de su propio contenedor** (`overflow-x-auto`) — la página en sí nunca desborda de costado. El modal de detalle es hoja inferior (`items-end`) en móvil y centrado en `sm+`.
- **Brecha funcional frente al móvil [MÓVIL·CÓDIGO], `CalendarTabScreen.tsx` (179 815 bytes — la pantalla más grande de todo el proyecto móvil):** agendar horario real (`NewCalendarLessonSheet`), gestión de series/recurrencia (`RecurrenceRulesSheet`, `RecurrenceOptions`), reprogramar (`SelectLessonToRescheduleSheet` + calendario mensual + grilla de horarios), agregar participantes a clase grupal (`AddParticipantsSheet`), distinguir clase/entrenamiento (`EditActivityKindSheet`), disponibilidad de la profesora con bloqueos semanales y excepciones (`TeacherAvailabilitySheet`), cuota de entrenamiento (`TrainingBillingAgreementSheet`), primer mes proporcional (`FirstMonthProrationSheet`), política de cancelación tardía (`LateCancellationPolicySheet`), control de modo de vista (`CalendarViewModeControl`). Ninguna de estas funciones existe en la web hoy.

### 2.11 Cobros — `/cobros` [WEB]

- **Objetivo:** listar cobros pendientes.
- **Usuario:** profesora.
- **Información mostrada:** título, aviso, grid de tarjetas (nombre de alumno, monto en formato `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`, `StatusPill` de estado).
- **Acciones:** ninguna interactiva hoy.
- **Secciones y orden:** encabezado → grid o estado vacío.
- **Dependencias:** `lib/fixtures.ts` (`FIXTURE_CHARGES`, solo 2 registros de ejemplo).
- **Estados:** *con cobros* / *vacío* (`EmptyState`: "No hay cobros pendientes.").
- **Responsive:** grid 1 → 2 columnas.
- **Brecha funcional frente al móvil [MÓVIL·CÓDIGO], `CollectionsCenterScreen.tsx` (13 201 bytes) + `features/payments/components/` (8 archivos):** registrar pago (`RegisterPaymentSheet`), pago parcial (mismo sheet, permite monto menor al adeudado — ver `PaymentAllocation` en §6), anular pago (`VoidPaymentDialog`), corregir monto mensual con auditoría (`EditMonthlyAmountSheet`), condonar recargo (`SurchargeSettingsPanel`), historial de pagos por alumno (`PaymentHistorySection`), prompt de cobro al finalizar una clase suelta (`ClassPaymentPromptModal`), estado de error de hidratación propio (`PaymentsHydrationErrorScreen`), input de moneda formateado (`CurrencyInput`). La web de hoy es de solo lectura y no tiene ningún flujo de cobro real. Esta pantalla es además donde vive, en el móvil, el panel "Revisar primer mes proporcional" (acción rápida `quickAction: 'revisar_primer_mes'` que abre directo el Perfil del alumno).

### 2.12 Configuración — `/configuracion` [WEB]

- **Objetivo:** accesos a cuenta y secciones de configuración.
- **Usuario:** profesora.
- **Información mostrada:** título, aviso, tarjeta "Cuenta" (con el correo si hay sesión y botón "Cerrar sesión" sin confirmación — igual que móvil; o solo texto descriptivo si no hay sesión), tarjetas "Perfil de la profesora" y "Respaldo" (descriptivas, no clicables todavía).
- **Acciones:** "Cerrar sesión" (si hay sesión). El resto son placeholders de texto, sin acción.
- **Secciones y orden:** encabezado → grid de tarjetas (Cuenta siempre primera, ocupa las 2 columnas si hay sesión).
- **Dependencias:** `lib/auth/config.ts`, `lib/auth/supabase-auth-adapter.ts`, `lib/auth/actions.ts` (`signOutAction`).
- **Estados:** *con sesión* (muestra correo + botón) / *sin sesión o Supabase no configurado* (tarjeta descriptiva sin acción).
- **Responsive:** grid 1 → 2 columnas.
- **Nota de alcance:** esta única página web concentra lo que en el móvil son **dos pantallas separadas** — `Account` (Perfil de profesora/sesión) y `Settings` (configuración general) — más los accesos a `DataBackup` ("Respaldo"). Un rediseño debe decidir explícitamente si mantiene la fusión actual o separa las tres, no asumir ninguna de las dos opciones por defecto.

### 2.13 Páginas requeridas por la auditoría sin equivalente en la web — mapeo a su referencia funcional

| Página pedida | ¿Existe en la web? | Referencia funcional en el móvil [MÓVIL·CÓDIGO] |
|---|---|---|
| Nuevo alumno | No | `NewStudentScreen.tsx` (34 455 bytes), sin `studentId` |
| Perfil del alumno | No | `StudentProfileScreen.tsx` (27 221 bytes) + 7 pestañas (`components/tabs/`, ver §2.14) |
| Edición del alumno | No | `NewStudentScreen.tsx`, misma pantalla, con `studentId` |
| Calendario (avanzado) | Parcial (solo lectura) | `CalendarTabScreen.tsx` (ver §2.10) |
| Crear clase (registro pedagógico) | No | `NewClassScreen.tsx` (35 051 bytes) |
| Crear serie | No | `RecurrenceOptions.tsx` + `RecurrenceRulesSheet.tsx` (sheets dentro de Calendario, no ruta propia) |
| Detalle de clase | Parcial (modal demo, sin acciones reales) | `CalendarLessonActionsSheet.tsx` (51 688 bytes) |
| Registro de clase | No | Mismo que "Crear clase" — `NewClassScreen.tsx`; también `EditRegisteredLessonSheet.tsx` y `RegisterPendingClassSheet.tsx` (72 562 bytes, el sheet más grande de `new-class/components/`) para registrar una clase ya pasada |
| Series | No | `RecurrenceRulesSheet.tsx` (sheet, no ruta) |
| Disponibilidad | No | `TeacherAvailabilitySheet.tsx` (40 684 bytes, sheet, no ruta) |
| Cobros (avanzado) | Parcial (solo lectura) | `CollectionsCenterScreen.tsx` (ver §2.11) |
| Registrar pago | No | `RegisterPaymentSheet.tsx` (sheet dentro de Cobros/Perfil) |
| Historial financiero | No | `PaymentHistorySection.tsx` (sección dentro del Perfil, pestaña Cobros) + `FinancialOverviewScreen.tsx` (ruta propia, agregada) |
| Reportes | No | Tres rutas independientes (`FinancialOverview`, `RemindersCenter`, `PaymentBehavior`) + pestaña `ReportesTab.tsx` (39 112 bytes) dentro del Perfil del alumno |
| Configuración (avanzada) | Parcial (fusiona 3 conceptos) | `SettingsScreen.tsx` (7 959 bytes) |
| Perfil de profesora | No (fusionado en Configuración) | `AccountScreen.tsx` (2 747 bytes) + flujo `features/account/screens/` (16 archivos: sign in/up, confirmación, onboarding de nombre, transferencia de dispositivo, etc.) |
| Backup e importación | No | `BackupScreen.tsx` (28 276 bytes) + `CloudBackupRecoveryGate.tsx` (14 952 bytes) + `screens/RecoveryStatusScreen.tsx` |

### 2.14 Detalle: pestañas del Perfil del alumno [MÓVIL·CÓDIGO] (`src/features/student-profile/components/tabs/`)

Esta es la pantalla individualmente más importante que falta en la web, así que se detalla su estructura interna aunque no exista todavía:

| Pestaña (`ProfileTabKey`) | Archivo | Tamaño | Contenido (según nombre de archivo y tipos de dominio — no releído línea a línea) |
|---|---|---|---|
| `resumen` | `ResumenTab.tsx` | 4 845 B | Resumen rápido: promedio, clases del mes, asistencia, próxima/última clase, tareas pendientes, alertas, objetivos, fortalezas, a mejorar (campos de `StudentProfile`, ver §6). |
| `clases` | `ClasesTab.tsx` | 11 741 B | Historial de clases dictadas. |
| `progreso` | `ProgresoTab.tsx` | 8 181 B | Evolución de nivel (`LevelHistoryEntry`) y notas por habilidad. |
| `tareas` | `TareasTab.tsx` | 3 182 B | Tareas asignadas/pendientes. |
| `cobros` | `CobrosTab.tsx` | 44 795 B | La pestaña más grande — motor de cobro completo del alumno (cargos, pagos, plan de facturación, correcciones). |
| `reportes` | `ReportesTab.tsx` | 39 112 B | Generación de reportes/PDF del alumno. |
| `información` | `InformacionTab.tsx` | 6 264 B | Datos de contacto, nivel inicial, modalidad, categoría, fecha de alta. |

Componentes compartidos del perfil (no por pestaña): `ProfileHeader`, `ProfileQuickActions` (acciones rápidas: registrar clase, registrar pago, reprogramar, generar PDF, editar alumno — `ProfileQuickAction`), `StatusSection` + `ChangeStatusSheet` (cambiar/reactivar estado), `EditBillingPlanSheet`, `LevelAchievementSheet`, `ManualSessionCorrectionSheet`, `HistorySummary`, `QuickSummary`, `PunctualitySection`, `SegmentedTabs` (el selector de pestañas en sí — confirma que son **pestañas horizontales con indicador**, no un menú vertical ni acordeón), `ProfileEmptyState`, `ProfileErrorState`, `ProfileSkeleton`, `RescheduleCancellationNoticeBanner`.

---

## 3. Inventario de componentes

### 3.1 Web [WEB] — inventario completo (11 componentes, todo el código fue leído)

| Componente | Archivo | Función | Variantes/estados | Páginas donde aparece |
|---|---|---|---|---|
| `AuthShell` | `components/auth/auth-shell.tsx` | Envoltorio visual de las 4 pantallas de auth: icono + título + subtítulo + tarjeta + "Volver al inicio". | — | Login, Crear cuenta, Recuperar contraseña, Nueva contraseña |
| `AuthNotConfigured` | `components/auth/auth-not-configured.tsx` | Pantalla que reemplaza cualquier flujo de auth si Supabase no está configurado. | — | Login, Crear cuenta, Recuperar contraseña, Nueva contraseña |
| `FormErrorBox` / `FormInfoBox` | `components/auth/form-boxes.tsx` | Mensaje inline de error (rojo, `role="alert"`) o info (neutro) bajo un campo/botón — nunca un toast. | error / info | Los 4 formularios de auth |
| `PrimaryNav` | `components/nav/primary-nav.tsx` | Navegación principal, 2 layouts responsive (ver §1.3). | activo/inactivo por ítem | Las 5 páginas privadas |
| `LoadingState` | `components/ui/states.tsx` | Spinner + texto, `role="status" aria-live="polite"`. | — | Declarado pero **no usado hoy** en ninguna página (páginas privadas usan su propio `<div>` de carga inline, p. ej. Calendario) |
| `ErrorState` | `components/ui/states.tsx` | Caja roja de error, `role="alert"`. | — | Declarado, no consumido hoy en ninguna página |
| `EmptyState` | `components/ui/states.tsx` | Caja con borde punteado + mensaje centrado. | mensaje configurable | Inicio, Alumnos, Cobros |
| `StatusPill` | `components/ui/status-pill.tsx` | Pastilla de estado de pago, texto + color (nunca solo color). | Pagado / Pago pendiente / Vence pronto / Vence hoy / Pago vencido | Alumnos, Cobros |
| `CalendarToolbar` | `components/calendar/calendar-toolbar.tsx` | Navegación de semana (◀ ▶ Hoy) + rango de fechas. | — | Calendario |
| `WeekCalendar` | `components/calendar/week-calendar.tsx` | Grilla semanal completa (orquesta toolbar + columnas + tarjetas + modal). | cargando / con datos | Calendario |
| `LessonCard` | `components/calendar/lesson-card.tsx` | Tarjeta de una clase dentro de la grilla. | según color/estado (ver §6) | Calendario |
| `LessonDetailModal` | `components/calendar/lesson-detail-modal.tsx` | Hoja/modal de detalle al tocar una clase. | — (todas sus acciones están deshabilitadas, marcadas "Demo") | Calendario |
| `BarbellIcon` | `components/calendar/barbell-icon.tsx` | Ícono de mancuerna para actividades de tipo "entrenamiento". | — | Calendario (dentro de `LessonCard`) |

No hay en la web: tablas, buscadores, filtros, selectores, formularios más allá de los de auth, paneles laterales, confirmaciones, menús, gráficos, skeletons ni toasts. Estos existen únicamente en el móvil (§3.2) y su ausencia en la web es la brecha funcional documentada por página en §2.

### 3.2 Móvil de referencia [MÓVIL·CÓDIGO] — inventario por carpeta de `components/` (nombres de archivo reales; función inferida del nombre y del dominio de tipos, no releída línea a línea salvo excepción indicada)

**`features/calendar/components/` (21 archivos):** `AddParticipantsSheet`, `CalendarLessonActionsSheet`, `CalendarLessonCard`, `CalendarToolbar`, `CalendarViewModeControl`, `ChangeLessonDurationSheet`, `EditActivityKindSheet`, `EditClassTitleSheet`, `EditFutureRecurrenceSheet`, `FirstMonthProrationSheet`, `NewCalendarLessonSheet`, `RecurrenceOptions`, `RecurrenceRulesSheet`, `RescheduleMonthCalendar`, `RescheduleTimeSlotGrid`, `SelectLessonToRescheduleSheet`, `TeacherAvailabilitySheet`, `TimeSlotQuickPickSheet`, `TrainingBillingAgreementSheet`, `WeekHeader`, `WeekTimeGrid`.

**`features/student-profile/components/` (15 archivos + subcarpeta `tabs/`):** `ChangeStatusSheet`, `EditBillingPlanSheet`, `HistorySummary`, `LevelAchievementSheet`, `ManualSessionCorrectionSheet`, `ProfileEmptyState`, `ProfileErrorState`, `ProfileHeader`, `ProfileQuickActions`, `ProfileSkeleton`, `PunctualitySection`, `QuickSummary`, `RescheduleCancellationNoticeBanner`, `SegmentedTabs`, `StatusSection` (+ 7 pestañas, ver §2.14).

**`features/payments/components/` (8 archivos):** `ClassPaymentPromptModal`, `CurrencyInput`, `EditMonthlyAmountSheet`, `PaymentHistorySection`, `PaymentsHydrationErrorScreen`, `RegisterPaymentSheet`, `SurchargeSettingsPanel`, `VoidPaymentDialog`.

**`features/students/components/` (16 archivos):** `ArchiveStudentDialog`, `ChipGroup`, `CreateCustomLevelSheet`, `DeleteStudentDialog`, `ErrorState`, `FiltersPanel`, `LevelPicker`, `ManageCustomLevelsSheet`, `NewStudentButton`, `SearchBar`, `SkeletonCard`, `StudentBadges`, `StudentCard`, `StudentsEmptyState`, `SwipeableStudentRow`, `SwipeActionButton`.

**`features/new-class/components/` (23 archivos):** `AttachmentList`, `AttendanceRow`, `AttendanceSection`, `BillingSection`, `ChipTextList`, `CollapsibleSection`, `DateTimeField`, `DurationField`, `EditRegisteredLessonSheet`, `EvaluationSection`, `HomeworkSection`, `LateCancellationPolicySheet`, `LessonOutcomeField`, `MaterialLibraryPicker`, `ParticipantRegistrationBlock`, `PedagogicalContentSection`, `PendingClassOutcomeSelector`, `PendingHomeworkCard`, `PendingHomeworkSection`, `RegisterPendingClassSheet`, `SkillGradeChips`, `SkillGradeInput`, `StudentOrGroupPicker`, `TopicChecklist`.

**`features/new-student/components/` (7 archivos, TODOS de 0 bytes):** `StudentAcademicSection`, `StudentBasicInfoSection`, `StudentBillingSection`, `StudentContactSection`, `StudentFormFooter`, `StudentNotesSection`, `StudentScheduleSection`. **Nota importante:** estos archivos existen pero están vacíos — es una subdivisión planeada que nunca se ejecutó; la pantalla real (`NewStudentScreen.tsx`, 34 455 bytes) es monolítica hoy. Un futuro diseño no debe asumir que estas secciones ya están separadas visualmente; hay que abrir `NewStudentScreen.tsx` para ver su estructura real.

**`features/dashboard/components/` (24 archivos):** `ActiveClassCard`, `AnnualBudgetChart`, `BudgetDistributionCard`, `CollectionsCenterSummaryCard`, `DailyCollectionsNoticeBanner`, `DayAgenda`, `EmptyClassesNotice`, `EmptyState`, `FinancialAnalyticsSections`, `FinancialOverviewTabs`, `FinancialSummary`, `Header`, `LiveClassTrackingSwitch`, `LogoMenuSheet`, `MonthlyPaymentBehaviorChart`, `NextClassCard`, `NotificationBell`, `OfflineProtectionBanner`, `PendingClasses`, `QuickActions`, `RestoredActiveSessionNotice`, `SavingsGoalControl`, `ScheduleAdjustSheet`, `StartClassPunctualityDialog`, `StatsRow`.

**`features/account/` :** `AuthGate` (portero de sesión), `AuthSessionContext`, `OnboardingTutorialGate`, `TeacherProfileGate`, `components/LiveClassTrackingSection`, y en `screens/` (16 archivos): `AccountConfirmedScreen`, `AccountConnectedScreen`, `accountStyles.ts` (define el patrón `errorBox`/`infoBox` que la web ya replica), `AuthEmailConfirmationScreen`, `AuthEntryFlow`, `AuthErrorScreen`, `ConfirmDeviceTransferScreen`, `ForgotPasswordScreen`, `NewPasswordScreen`, `OfflineUnavailableScreen`, `OnboardingTutorialScreen`, `SignedOutElsewhereScreen`, `SignInScreen`, `SignUpScreen`, `SupabaseNotConfiguredScreen`, `TeacherNameOnboardingScreen`.

**`features/backup/`:** `BackupScreen`, `CloudBackupRecoveryGate`, `CloudBackupSyncContext`, `screens/RecoveryStatusScreen`.

Gráficos existentes solo en el móvil (no hay ninguno en la web hoy): `AnnualBudgetChart`, `BudgetDistributionCard`, `MonthlyPaymentBehaviorChart`, `FinancialAnalyticsSections`.

---

## 4. Flujos completos

Los flujos marcados [MÓVIL·CÓDIGO/DOC] describen el comportamiento de referencia; ninguno de ellos está implementado hoy en la web (que es de solo lectura), por lo que se documentan como especificación funcional a preservar, no como algo que rediseñar visualmente todavía.

**Registro e ingreso [WEB, implementado]:** `/crear-cuenta` (o `/login`) → completar formulario → `signUpAction`/`signInAction` (Server Action) → si alta: Supabase exige confirmación por email → pantalla "revisá tu correo" con reenvío (cooldown 30s) → click en el email → `/auth/callback` intercambia el código PKCE → redirige a `next` saneado (nunca a un dominio externo) o a `/auth/error` si el enlace falló/venció/ya fue usado.

**Crear alumno [MÓVIL·CÓDIGO]:** desde Alumnos (`NewStudentButton`) o desde un slot vacío del Calendario → `NewStudentScreen` (sin `studentId`) → al guardar, escribe simultáneamente en dos fuentes (`studentStore` para la lista y `profileStore` para el perfil — **duplicación de datos conocida y documentada**, no una decisión de diseño) → si vino desde un slot del Calendario, vuelve a Calendario con el alumno recién creado para completar la reserva; si vino desde Alumnos, siempre vuelve a la lista de Alumnos y resalta brevemente la tarjeta nueva (nunca abre Calendario ni "Nueva clase" — regla de producto explícita).

**Editar estado de alumno [MÓVIL·CÓDIGO/ESPECIFICACIÓN]:** desde el Perfil (`StatusSection` → `ChangeStatusSheet`) → elegir Pausar/Dar de baja/Archivar/Reactivar → si pausa/baja/archiva: pide fecha, motivo opcional, observación interna; conserva todo el historial de clases/pagos/notas/tareas/reportes (nunca se borra) → si reactiva: pide nueva fecha de inicio y permite actualizar nivel, modalidad, frecuencia semanal, duración, precio, horarios y objetivos; nunca modifica la inversión histórica ya registrada.

**Crear clase única / Crear serie [MÓVIL·CÓDIGO]:** tocar un slot vacío en Calendario → `NewCalendarLessonSheet` → elegir alumno existente o "crear alumno" (ver flujo de arriba) → elegir modalidad, duración, y si es única o recurrente (`RecurrenceOptions`: patrón semanal o personalizado, largo de ciclo 1/2/3/4 semanas) → al guardar una serie se crea una `RecurrenceRule` (estado `active`); las clases visibles en la grilla son ocurrencias generadas/materializadas de esa regla, nunca copias independientes.

**Agregar participantes [MÓVIL·CÓDIGO]:** desde una clase existente → `AddParticipantsSheet` → convierte una clase individual en grupal (`CalendarLessonType: 'group'`) o suma alumnos a una ya grupal — afecta a toda la serie si la clase es recurrente, con las mismas salvedades de "esta clase / esta y las siguientes" que reprogramar (ver abajo).

**Configurar cuota de entrenamiento [MÓVIL·CÓDIGO, muy reciente — 2026-09-13]:** desde una serie con `activityKind: 'training'` → `TrainingBillingAgreementSheet` → define `monthlyFee` (cuota mensual), que es **siempre independiente y nunca se fusiona** con la mensualidad de clases del mismo alumno, aunque sea el mismo alumno y la misma serie de origen — identidad propia (`trainingBillingAgreementId`) que sobrevive a splits de la serie.

**Registrar una clase (registro pedagógico) [MÓVIL·CÓDIGO]:** desde el Perfil, desde Calendario (clase ya transcurrida) o desde "Clases pendientes de registrar" en Home → `NewClassScreen` (o `RegisterPendingClassSheet` para una ya pasada) → asistencia, tema planificado/visto, evaluación por habilidad (`SkillGradeInput`/`SkillGradeChips`), fortalezas/a mejorar, tarea y fecha de entrega, adjuntos (`AttachmentList`, `MaterialLibraryPicker`), estado de cobro → al guardar, aplica resultados agregados al perfil del alumno (promedio, clases del mes, etc.) — el propio código de arquitectura [MÓVIL·DOC] advierte que **no está verificada una transacción única que actualice también la reserva de Calendario**: son dos escrituras separadas.

**Registrar entrenamiento grupal:** mismo flujo que "Registrar una clase", con `activityKind: 'training'` y `ParticipantRegistrationBlock` para asistencia/evaluación por participante en vez de un único alumno.

**Cancelar [MÓVIL·CÓDIGO]:** desde `CalendarLessonActionsSheet` → cancelar "con aviso" o "tarde" (dos categorías distintas, con posible política de cargo — `LateCancellationPolicySheet`) → la clase pasa a `status: 'cancelled'`; puede opcionalmente liberar su horario para una clase sustituta ("Usar este horario para otra clase", `freedByLessonId`).

**Reprogramar [MÓVIL·CÓDIGO]:** desde el Perfil ("Reprogramar" sin clase puntual preseleccionada — el propio Calendario muestra todas las clases futuras del alumno para elegir) o desde Calendario directamente sobre una clase → `SelectLessonToRescheduleSheet` → elegir nueva fecha (`RescheduleMonthCalendar`) y horario (`RescheduleTimeSlotGrid` / `TimeSlotQuickPickSheet`) → la clase pasa a `status: 'rescheduled'`, conservando identidad de serie si corresponde. **Regla explícita:** este flujo nunca reimplementa el motor de recurrencias; siempre reutiliza el mismo Calendario real.

**Crear reemplazo:** consecuencia del flujo "Cancelar" (ver arriba) — una clase nueva con `freedByLessonId` apuntando a la cancelada; se muestra con color coral exclusivo mientras el reemplazo esté vigente y en el futuro (ver §6); si el horario ya pasó, pasa a gris de "transcurrida" igual que cualquier otra.

**Registrar pago [MÓVIL·CÓDIGO/ESPECIFICACIÓN]:** desde Cobros (Centro de cobros) o desde el Perfil (pestaña Cobros, o acción rápida "Registrar pago") → `RegisterPaymentSheet` → monto, método (efectivo/transferencia/otro), fecha real de pago → el pago se asigna (`PaymentAllocation`) a una o varias obligaciones (`PaymentCharge`) pendientes; el recargo compuesto sigue el ciclo [ESPECIFICACIÓN]: días 1–10 a tiempo, 11–18 primer atraso +10% sobre el monto original, 19–26 segundo atraso +5% adicional sobre el monto ya recargado, 27–fin de mes tercer atraso +5% adicional otra vez — encadenado (compuesto) sobre el monto mensual individual del alumno, nunca sobre un total global. Semáforo: Verde = a tiempo, Amarillo = primer vencimiento, Naranja = segundo, Rojo = último.

**Pago parcial [MÓVIL·CÓDIGO]:** mismo `RegisterPaymentSheet`, monto menor al total adeudado → se crea igual el `Payment`, con una `PaymentAllocation` menor al `balance` de la obligación — la obligación queda con saldo pendiente (no "pagada"), y puede recibir aportes de más de un pago.

**Anular o corregir pago [MÓVIL·CÓDIGO]:** un pago **nunca se borra** — se anula (`voidedAt`/`voidReason` en `Payment`) y, si corresponde, se registra un pago nuevo que referencia al anulado (`replacesPaymentId`); mismo criterio para corregir un monto mensual mal cargado (`EditMonthlyAmountSheet` → `MonthlyAmountCorrectionEntry`, con auditoría de importe anterior/nuevo/fecha/motivo, sin borrar historial) — este es exactamente el flujo que ya se usó para corregir el bug real de Rocío Spitale mencionado en la especificación del producto.

**Revisar reportes:** entrar a `FinancialOverview` / `RemindersCenter` / `PaymentBehavior` (rutas independientes, ver §1.2) o a la pestaña `ReportesTab` dentro de un Perfil de alumno puntual — no hay un flujo único, son 4 puntos de entrada distintos a información de reporte.

**Importar backup [MÓVIL·CÓDIGO]:** `BackupScreen` (28 276 bytes) — el propio `docs/AI_CONTEXT/07_REGLAS_PARA_IA.md` exige verificar la estructura de cualquier ZIP antes de instalarlo y rechazar entregas con rutas cruzadas o nombres distintos del manifiesto; existe además `CloudBackupRecoveryGate` (14 952 bytes) para recuperación desde la nube y una pantalla de estado propia (`RecoveryStatusScreen`). El detalle paso a paso de la UI de importación no fue releído línea por línea (ver nota de alcance al inicio de §3.2) — antes de diseñar esta pantalla hay que abrir `BackupScreen.tsx` completo.

---

## 5. Información y densidad

**Datos imprescindibles en cada tarjeta de alumno [MÓVIL·CÓDIGO, `StudentListItem`]:** nombre, niveles (puede ser más de uno, combinando estándar y personalizados), modalidad, estado, próxima clase, estado de pago (semáforo), promedio, clases del mes. La web hoy solo muestra nombre + nivel + estado de pago (subconjunto).

**Datos secundarios:** último pago, si es destacado/nuevo, texto específico de deuda vencida (p. ej. "Julio vencido" en vez de un genérico "Pago vencido" — decisión explícita para que la profesora note que debe un período distinto al que acaba de pagar).

**Datos ocultables / en menús, no en la tarjeta:** reporte pendiente, tarea pendiente (badges, no texto libre — ver `StudentBadgeKind` en §6).

**Acciones que deben permanecer visibles (verificado en móvil):** ver perfil (la tarjeta entera es tocable). El resto (registrar clase, registrar pago, reprogramar, enviar PDF, editar, archivar/eliminar/restaurar) viven en swipe o mantener presionado — **no todas visibles a la vez**, ver `StudentCardAction` en §6.

**Casos con nombres largos [WEB, verificado y con comentario explícito en código]:** `lesson-card.tsx` documenta que el nombre completo de una clase **siempre queda visible, con wrap normal — nunca `truncate` ni corte de palabra**, y que el alto de la tarjeta se ajusta al hueco real disponible hasta la próxima clase para no invadirla. El fixture `demo-do-nombre-largo` ("Alumna Rodríguez Fernández de la Torre") existe específicamente para probar este caso, aislado en un día sin otra actividad.

**Listas extensas [MÓVIL·DOC]:** la arquitectura documentada exige que la lista de alumnos esté optimizada para cientos de registros (virtualización tipo `FlatList` — terminología nativa; en web equivaldría a virtualización de lista o paginación, decisión pendiente de diseño).

**Formularios extensos:** `NewStudentScreen` (34 455 bytes) y `NewClassScreen`/`RegisterPendingClassSheet` (35 051 y 72 562 bytes) son los formularios más grandes del producto — múltiples secciones (contacto, académico, facturación, horario, notas). En el móvil existen componentes ya nombrados para dividir el primero en secciones (`StudentContactSection`, `StudentAcademicSection`, etc.) pero **están vacíos y sin usar** (ver §3.2) — la única fuente real de su estructura hoy es el archivo monolítico.

**Tablas con muchas columnas:** no hay tablas HTML en la web (todo es grid de tarjetas). El equivalente móvil más denso en columnas de datos es el motor de cobro (`CobrosTab.tsx`, 44 795 bytes) y los paneles de analítica financiera (`FinancialAnalyticsSections.tsx`, 21 871 bytes).

**Calendario con alta densidad [WEB, verificado]:** la grilla ya resuelve el caso de alta densidad con una regla explícita — el alto de cada tarjeta de clase nunca excede el hueco real hasta el inicio de la próxima clase del mismo día (o el final de la grilla), así que una tarjeta nunca invade a la siguiente aunque su contenido sea largo; el ancho es siempre el 100% de la columna del día (un diseño anterior de "carriles paralelos" para clases superpuestas fue eliminado explícitamente el 2026-09-10 por cortar nombres palabra por palabra).

---

## 6. Estados semánticos

Todos los valores siguientes son literales de tipo verificados en código — no aproximaciones.

**Alumno (`StudentStatus`) [WEB + MÓVIL·CÓDIGO, coinciden]:** `activo` · `pausado` · `inactivo` · `archivado`. (Aclaración de dominio [MÓVIL·CÓDIGO]: un alumno nunca se borra por cambio de estado — existe además una operación real y aparte, `deleteStudentPermanently`, que si se ejecuta sí es irreversible sobre 6 colecciones pedagógicas/de calendario y 4 financieras. Son dos caminos distintos, no deben confundirse en el diseño de las acciones "Archivar" vs. "Eliminar".)

**Pago — semáforo (`PaymentStatus`) [MÓVIL·CÓDIGO]:** `verde` · `amarillo` · `naranja` · `rojo`. En la web, el fixture usa además etiquetas de texto ya resueltas (no el código crudo): `Pagado`, `Pago pendiente`, `Vence pronto`, `Vence hoy`, `Pago vencido` — 5 etiquetas de texto sobre 4 colores de semáforo (verde cubre tanto "sin obligación" como "a tiempo", a propósito). Etapa de vencimiento subyacente (`PaymentDueStage`) [MÓVIL·CÓDIGO]: `on_time` · `first_late` · `second_late` · `last_late` — corresponde 1 a 1 con el ciclo de recargos [ESPECIFICACIÓN] (días 1–10 / 11–18 +10% / 19–26 +5% adicional / 27–fin +5% adicional, compuesto sobre el monto individual del alumno).

**Clase (`CalendarLessonStatus`) [WEB + MÓVIL·CÓDIGO, coinciden]:** `scheduled` (Programada) · `completed` (Completada) · `cancelled` (Cancelada) · `rescheduled` (Reprogramada). Prioridad de color verificada en `lib/calendar-theme.ts` (idéntica a móvil): 1) cancelada siempre gana; 2) si no está cancelada y ya transcurrió, gris fijo (incluso sobre un reemplazo activo vencido); 3) si no, reemplazo activo → coral; si no, color de modalidad. "Completada"/"Reprogramada" **nunca tienen color propio** — conservan el color de su modalidad real y se distinguen solo por la etiqueta de texto (regla congelada).

**Clase y entrenamiento (`ActivityKind`) [MÓVIL·CÓDIGO, muy reciente]:** `class` · `training`. `'class'` es el default histórico — cualquier registro anterior a esta fase sin el campo se interpreta como clase.

**Individual y grupal (`CalendarLessonType`) [MÓVIL·CÓDIGO]:** `individual` · `group`.

**Serie (`RecurrenceRuleStatus`) [MÓVIL·CÓDIGO]:** `active` · `paused` · `ended`.

**Guardando/sincronizando/sin conexión/error:** en la web hoy no existe ninguno de estos 4 estados como tal — la app es "Fase A" sin backend conectado (`lib/auth/config.ts`: si Supabase no está configurado, la app nunca lo trata como error, muestra un estado controlado propio, `AuthNotConfigured`). El único estado de carga real y verificado es el spinner en los botones de los 4 formularios de auth (`useFormStatus`) y el "Cargando calendario…" mientras se resuelve la fecha en cliente. El móvil sí modela estos 4 estados de forma explícita: hidratación (`isHydrated` antes de aceptar mutaciones), `OfflineProtectionBanner`, `PaymentsHydrationErrorScreen`, `ProfileErrorState`/`ProfileSkeleton`.

**Acción destructiva [MÓVIL·CÓDIGO]:** dos niveles distintos y no intercambiables — cambio de estado (pausar/dar de baja/archivar: reversible, conserva historial, tiene su propio diálogo `ChangeStatusSheet`) vs. eliminación permanente (`deleteStudentPermanently`, con sus propios diálogos `ArchiveStudentDialog`/`DeleteStudentDialog`, irreversible). En Cobros, la acción destructiva equivalente es anular un pago (`VoidPaymentDialog`) — nunca borrar.

**Información pendiente de revisión [MÓVIL·CÓDIGO]:** modelada como badges explícitos, no como un estado global — `reporte_pendiente`, `tarea_pendiente` (`StudentBadgeKind`), y en cobros el panel "Revisar primer mes proporcional" (`FirstMonthProrationSheet`, acción rápida `revisar_primer_mes`).

**Paleta cruda usada por el estado semántico del calendario [WEB, `lib/calendar-theme.ts` — congelada, copiada del móvil, se documenta aquí como dato de dominio, no como propuesta estética]:**

| Estado/color | Fondo | Borde | Texto |
|---|---|---|---|
| Cancelada | `#FFF1B8` | `#D99100` | `#7A4B00` / `#9A6200` |
| Transcurrida | `#D1D5DB` | `#4B5563` | `#374151` / `#4B5563` |
| Reemplazo activo | `#FCE8E6` | `#D96C68` | — |
| Modalidad presencial | `#FCE4D2` | `#A85A2A` | — |
| Modalidad online | `#DDEEFF` | `#2D6F91` | — |
| Modalidad mixta | `#E9DDFC` | `#67458F` | — |
| Línea de "ahora" | — | `#E53935` | — |

Y la paleta de marca/semáforo general (`tailwind.config.ts`): `brandBlue #168CF4` / `brandBlueDark #0060DF`, `statusVerde #2FB350`, `statusAmarillo #E8B400`, `statusNaranja #F07C1D`, `statusRojo #E0362B`, `statusPendiente #4361B8`, `statusSinDatos #9499A1`, sobre fondo `background #FAFAF8` / `surface #FFFFFF` / `border #E3E5E8`, texto `textPrimary #080808` / `textSecondary #5D6168` / `textMuted #9499A1`.

---

## 7. Responsive

**390 px (móvil) [WEB, verificado]:** `PrimaryNav` como barra inferior fija (5 ítems); todo el contenido en una columna (`grid-cols-1`); la grilla de Calendario mantiene su ancho mínimo de 1224px y scrolea horizontalmente **dentro de su propio contenedor**, nunca la página entera; `LessonDetailModal` se ancla abajo (`items-end`, esquinas superiores redondeadas tipo hoja); formularios de auth ya diseñados a `max-w-sm`, sin cambios entre anchos chicos.

**768 px (tablet, breakpoint `sm`) [WEB, verificado]:** las grillas de tarjetas (Inicio, Alumnos, Cobros) pasan de 1 a 2 columnas (`sm:grid-cols-2`); el modal de detalle de clase pasa a centrado (`sm:items-center`) con esquinas redondeadas en las 4 puntas; paddings horizontales/verticales aumentan (`px-4 sm:px-8`, `py-8 sm:py-10`).

**768 px es también el breakpoint de navegación (`md`, 768px en Tailwind por defecto) [WEB, verificado]:** por debajo, barra inferior; en/por encima, sidebar. **Punto de atención:** el breakpoint de la grilla de tarjetas (`sm`, 640px) y el de la navegación (`md`, 768px) no coinciden — entre 640 y 768px conviven grillas de 2 columnas con la barra de navegación todavía inferior; verificar visualmente ese rango antes de cualquier cambio de layout.

**1440 px (escritorio) [WEB, verificado]:** sidebar fija de 224px a la izquierda, contenido con `md:pl-56`; grillas de contenido siguen limitadas a `max-w-4xl` (alumnos/cobros/inicio/configuración) — es decir, **no aprovechan el ancho completo de una pantalla grande**, quedan centradas con margen amplio a los costados; el Calendario es la única página sin `max-w`, ocupa el ancho disponible.

**Transformación de tablas:** no aplica — no hay tablas HTML en la web hoy (todo es grid de tarjetas). Si un futuro rediseño introduce tablas (p. ej. para Historial financiero o Cobros avanzado), deberá definir su propio comportamiento responsive — no hay precedente que preservar.

**Comportamiento del calendario en cada ancho:** el mismo en los 3 anchos — nunca comprime columnas ni corta texto; a menor ancho, más scroll horizontal contenido. Esto es una decisión explícita y documentada en el propio código (corrección 2026-09-10, eliminó un diseño anterior de carriles paralelos por este motivo).

**Modales/paneles:** un solo modal implementado hoy en la web (`LessonDetailModal`), con el comportamiento descrito arriba (hoja inferior en móvil, centrado desde `sm`). El móvil usa profusamente el patrón de *sheet* (bottom sheet) para casi cualquier acción secundaria — 21 sheets solo en Calendario (§3.2) — patrón a decidir si se preserva en web (¿modal centrado siempre, o también hoja inferior en anchos chicos?), sin precedente propio más allá de este único modal.

**Formularios:** una sola columna en los 3 anchos para los 4 formularios de auth existentes (no hay formularios de datos de negocio en la web todavía que evaluar en distintos anchos).

**Acciones fijas:** la navegación principal es lo único "fijo" verificado (`fixed`) en los 3 anchos. No hay ninguna barra de acciones fija sobre contenido (del tipo "guardar" pegado abajo) en ninguna página web hoy.

**Scroll:** la página en sí nunca scrollea horizontalmente en ningún ancho (regla ya cumplida: overflow contenido en `body` vía `max-w-screen overflow-x-hidden` en `app/layout.tsx`, y contenedores `overflow-x-auto` puntuales solo en Calendario).

**Zonas que nunca deben desbordarse [WEB, regla explícita en código]:** el nombre de una clase en `LessonCard` (nunca `truncate`, siempre wrap); el contenedor de la grilla de Calendario (su overflow horizontal está contenido a propósito, nunca se propaga a la página); el `<body>` global (`overflow-x-hidden` explícito).

---

## 8. Accesibilidad

Todo lo siguiente es lo que la web ya implementa hoy [WEB, verificado línea por línea] — un futuro rediseño debe igualar o mejorar esta base, nunca perder alguno de estos puntos sin que sea una decisión consciente:

- **Roles ARIA usados:** `role="alert"` en toda caja de error (`FormErrorBox`, `ErrorState`), `role="status" aria-live="polite"` en `LoadingState`, `role="dialog" aria-modal="true" aria-labelledby="lesson-detail-title"` en el modal de calendario, `role="presentation"` en el overlay de fondo del modal.
- **Labels:** todo `<input>` de los 4 formularios de auth tiene `<label htmlFor>` asociado explícitamente por `id` (nunca solo `placeholder` como label).
- **Mensajes de error:** siempre texto explícito junto al campo o botón correspondiente, nunca solo color — verificado en `StatusPill` (comentario explícito: "un estado importante nunca se comunica sólo por color — siempre va acompañado de texto") y en los mensajes de `error-messages.ts`.
- **Estados de carga anunciados:** `aria-busy="true"` en los 4 botones de submit mientras están pendientes (`useFormStatus`); ícono de spinner marcado `aria-hidden` (el texto del botón, no el spinner, es lo que un lector de pantalla anuncia).
- **Foco visible:** todos los elementos interactivos (inputs, botones, links, ítems de navegación) tienen `focus-visible:ring-2 focus-visible:ring-brandBlue` explícito — verificado en absolutamente todos los componentes interactivos revisados.
- **Áreas táctiles:** botones de navegación de calendario e ítems de tab bar usan alturas ≥ 36–44px (`h-9 w-9` en flechas de semana, `py-2.5` en ítems de nav).
- **Reducción de movimiento:** `@media (prefers-reduced-motion: reduce)` en `globals.css` fuerza `animation-duration`/`transition-duration` a `0.001ms` en todo el sitio (`*, *::before, *::after`) — regla global, no por componente.
- **Lectores de pantalla — texto accesible dedicado:** `aria-label` descriptivo y específico en botones icon-only (p. ej. `aria-label="Semana anterior"`, `aria-label="Cerrar detalle de la clase"`) y en la tarjeta de clase (`aria-label` compone título + hora + duración + "cancelada" si aplica, en una sola frase).
- **Orden de foco / navegación por teclado:** no hay evidencia en el código de manejo custom de foco (trampas de foco en modal, `tabIndex` manual) más allá de lo que da el DOM/React por default — **no verificado explícitamente**, marcar como pendiente de revisión antes de certificar accesibilidad completa del modal de calendario.

**Móvil [MÓVIL·CÓDIGO/DOC]:** la propia "definición de terminado" del proyecto móvil (`07_REGLAS_PARA_IA.md`) exige "accesibilidad básica" como criterio de aceptación de cualquier función, y la mejora UX ya aprobada para Alumnos exige explícitamente "íconos siempre con texto" — mismo criterio que la web ya aplica en `StatusPill`. No se releyó accesibilidad componente por componente en el móvil (fuera del alcance práctico de esta auditoría); se recomienda una pasada dedicada si el rediseño la va a heredar 1:1.

---

## 9. Límites del futuro rediseño

### INVARIABLE (no debe tocarse por una decisión estética)

- **Reglas de negocio de cobro** [ESPECIFICACIÓN]: ciclo de recargos compuesto (10/11–18/19–26/27–fin, +10%/+5%/+5% encadenados sobre el monto individual del alumno, nunca sobre un total global); moneda base ARS con conversión opcional a USD por cotización (oficial/MEP/blue/personalizada), guardando la cotización histórica usada por mes; días de gracia de clases sueltas (3 días).
- **Rutas y su significado** — en web: las 12 rutas de §1.1 tal como están definidas (paths exactos, no solo el contenido de la página). En móvil: los nombres de pantalla del `RootNavigator` y los parámetros que viajan entre ellas (p. ej. `quickAction`, `focusOccurrence`, `pendingLessonDraft`) son contrato de navegación, no detalle visual.
- **Permisos:** la verificación de sesión en dos capas del área privada web (`proxy.ts` + `app/(app)/layout.tsx`, cada una corre la misma función pura `resolvePrivateAreaAccess` de forma independiente, "nunca depende únicamente de proxy.ts") — un rediseño no debe eliminar ninguna de las dos capas ni fusionarlas en una sola verificación.
- **Textos legales/de seguridad exactos:** todos los mensajes de `lib/auth/error-messages.ts` están copiados literal del móvil a propósito ("Ningún otro texto ni regla se modifica ni se inventa" — comentario explícito en el código), incluyendo la ambigüedad deliberada anti-enumeración de "Recuperar contraseña" y el hecho de que un mismo código de Supabase (`invalid_credentials`) nunca debe distinguir "no existe la cuenta" de "contraseña incorrecta".
- **Identidad de los estados** de §6 (los valores literales en sí — `activo/pausado/inactivo/archivado`, `verde/amarillo/naranja/rojo`, `scheduled/completed/cancelled/rescheduled`, etc.) y sus reglas de prioridad de color (cancelada > transcurrida > reemplazo activo > modalidad).
- **Orden necesario de formularios / validaciones:** longitud mínima de contraseña (8, sin otras reglas), normalización de email (trim + lowercase) antes de cualquier llamada de auth, saneamiento de `next` contra rutas internas permitidas únicamente (nunca un dominio externo — protección anti open-redirect).
- **Acciones destructivas y su distinción:** cambio de estado (reversible, con historial) vs. eliminación permanente (irreversible) deben seguir siendo dos caminos separados, con confirmación explícita.
- **Cálculos:** posicionamiento de tarjetas de calendario (el alto nunca invade la siguiente clase), cómputo de recargos, resolución de color por prioridad — son funciones puras y ya probadas (`lib/calendar-conflicts.ts` tiene test unitario, `npm run test:calendar-conflicts`).
- **Comportamiento responsive indispensable:** overflow horizontal del calendario contenido en su propio contenedor (nunca en la página); nombres de clase sin truncar; navegación inferior/lateral según ancho.

### MODIFICABLE ESTÉTICAMENTE (terreno legítimo del futuro rediseño)

Colores (incluida la paleta de marca hoy congelada — puede reemplazarse siempre que se preserve qué información comunica cada estado semántico, no necesariamente los hex exactos), tipografía (hoy sin fuente custom, fuente de sistema, decisión explícita tanto en móvil como en web — "se apoya en la fuente de sistema" — puede cambiarse), sombras, radios (`sm/md/lg/xl/pill` ya definidos en Tailwind), espaciado, iconografía (hoy Heroicons; el móvil usa Ionicons — no hay un sistema de íconos "correcto" fijado entre ambos), densidad visual, composición/layout de página, animaciones (hoy mínimas: `modal-in` keyframe y transiciones de hover/active con timing `ease-premium` propio — pueden rediseñarse respetando `prefers-reduced-motion`), jerarquía visual, estilo de tarjetas, apariencia de tablas y gráficos (a crear desde cero, no hay tablas hoy en la web).

---

## 10. Entregable final

### 10.1 Sitemap textual

```text
/ (landing)
/login
/crear-cuenta
/recuperar-contrasena
/nueva-contrasena
/auth/callback (técnica, sin UI)
/auth/error
/inicio            (privada)
/alumnos           (privada)
  → [no existe como ruta] Nuevo alumno / Perfil del alumno / Editar alumno — ref. móvil: NewStudent, StudentProfile
/calendario        (privada)
  → [no existe como ruta] Crear clase / Crear serie / Detalle de clase / Registro de clase / Series / Disponibilidad — ref. móvil: sheets de CalendarTabScreen
/cobros            (privada)
  → [no existe como ruta] Registrar pago / Historial financiero — ref. móvil: sheets de CollectionsCenterScreen + PaymentHistorySection
/configuracion     (privada, fusiona Cuenta + Perfil de profesora + acceso a Respaldo)
  → [no existe como ruta] Perfil de profesora separado / Backup e importación — ref. móvil: AccountScreen, BackupScreen
  → [no existe como ruta] Reportes — ref. móvil: FinancialOverview, RemindersCenter, PaymentBehavior (3 rutas independientes) + ReportesTab
```

### 10.2 Matriz página × componente (web)

| Página | AuthShell | AuthNotConfigured | FormBoxes | PrimaryNav | EmptyState | StatusPill | CalendarToolbar | WeekCalendar | LessonCard | LessonDetailModal |
|---|---|---|---|---|---|---|---|---|---|---|
| Landing | | | | | | | | | | |
| Login | ✓ | ✓ | ✓ | | | | | | | |
| Crear cuenta | ✓ | ✓ | ✓ | | | | | | | |
| Recuperar contraseña | ✓ | ✓ | ✓ | | | | | | | |
| Nueva contraseña | ✓ | ✓ | ✓ | | | | | | | |
| Auth error | | | | | | | | | | |
| Inicio | | | | ✓ | ✓ | | | | | |
| Alumnos | | | | ✓ | ✓ | ✓ | | | | |
| Calendario | | | | ✓ | | | ✓ | ✓ | ✓ | ✓ |
| Cobros | | | | ✓ | ✓ | ✓ | | | | |
| Configuración | | | | ✓ | | | | | | |

### 10.3 Matriz estado × representación (semáforo de pago, el único con representación visual verificada hoy)

| Estado | Color de fondo/texto (`STATUS_STYLES`) | Etiqueta de texto | Dónde aparece |
|---|---|---|---|
| Pagado | `statusVerde` | "Pagado" | Alumnos, Cobros |
| Pago pendiente | `statusPendiente` | "Pago pendiente" | Alumnos, Cobros |
| Vence pronto | `statusAmarillo` | "Vence pronto" | Alumnos, Cobros |
| Vence hoy | `statusNaranja` | "Vence hoy" | Alumnos, Cobros |
| Pago vencido | `statusRojo` | "Pago vencido" | Alumnos, Cobros |

(Para el resto de los estados de §6 —alumno, clase, serie— la única representación visual verificada hoy es la del Calendario, ya tabulada en §6; Alumnos y Cobros en la web todavía no distinguen visualmente esos otros estados.)

### 10.4 Decisiones que deberá tomar el futuro diseño (no resueltas por esta auditoría a propósito)

1. ¿Se promueven Series y Disponibilidad a rutas propias en la web, o se preservan como paneles/sheets sobre Calendario?
2. ¿Se separa Configuración en sus 3 conceptos móviles (Cuenta / Perfil de profesora / Respaldo) o se mantiene fusionada?
3. ¿Se unifican los 4 puntos de entrada a "reportes" (3 rutas + 1 pestaña de perfil) en una sola experiencia web, o se preservan separados como en el móvil?
4. Patrón de modal/panel a estandarizar en web: ¿hoja inferior en móvil + centrado en desktop (como ya hace `LessonDetailModal`) para todos los futuros sheets, o un patrón distinto?
5. ¿La lista de Alumnos en web necesita virtualización/paginación desde el día uno (dado el requisito móvil de "cientos de alumnos"), o se pospone?
6. Tratamiento de tablas: no hay precedente en la web hoy; Historial financiero y el detalle de Cobros probablemente lo requieran.
7. Sistema de iconografía a adoptar (Heroicons ya en web, Ionicons en móvil, o uno nuevo).

### 10.5 Riesgos visuales identificados

- **Breakpoints no coincidentes:** grillas de tarjetas cambian en 640px (`sm`) pero la navegación cambia en 768px (`md`) — rango de 640–768px con combinación no probada visualmente.
- **Contenido centrado con `max-w-4xl` en pantallas grandes:** Inicio/Alumnos/Cobros/Configuración dejan mucho espacio vacío a los costados en escritorios anchos (>1440px) — a definir si es intencional o placeholder de Fase A.
- **Duplicación de fuente de verdad en móvil** (`studentStore` vs. `profileStore`, documentada en `02_ARQUITECTURA.md`): un futuro diseño de UI que muestre el mismo dato (p. ej. próxima clase) en dos lugares distintos de la pantalla debe saber que hoy pueden divergir — no es solo un tema de layout, es un riesgo de datos que la UI podría estar exponiendo sin querer.
- **Componentes "fantasma"** (`new-student/components/`, 7 archivos de 0 bytes): riesgo de que un futuro diseño asuma una subdivisión de formulario que nunca se construyó.
- **Archivo monolítico gigante** (`CalendarTabScreen.tsx`, 179 815 bytes): cualquier cambio de estructura visual profunda en Calendario va a tocar un archivo muy grande con mucha lógica de negocio entrelazada — mayor riesgo de regresión que en cualquier otra pantalla.

### 10.6 Checklist para comprobar que un futuro diseño no omitió ninguna función

- [ ] Las 12 rutas web de §1.1 siguen existiendo con el mismo path.
- [ ] Los 5 ítems de navegación (Inicio/Alumnos/Calendario/Cobros/Configuración) siguen presentes, con las 2 variantes responsive (barra inferior + sidebar).
- [ ] El banner de "vista previa con datos ficticios" (o su reemplazo real una vez conectado Supabase) sigue comunicando ese estado.
- [ ] Todo estado de pago sigue comunicándose con texto además de color.
- [ ] El nombre de una clase/alumno largo nunca se corta ni se trunca en ninguna tarjeta.
- [ ] El Calendario nunca provoca scroll horizontal de la página completa (solo de su propio contenedor).
- [ ] Los 4 formularios de auth conservan sus mensajes de error exactos y el criterio anti-enumeración de "Recuperar contraseña".
- [ ] `prefers-reduced-motion` se sigue respetando globalmente.
- [ ] Todo botón icon-only conserva un `aria-label` descriptivo.
- [ ] Ninguna de las funciones listadas como "brecha frente al móvil" en §2 fue descartada silenciosamente — si el rediseño decide no incluir alguna, debe ser una decisión de producto explícita, no un olvido.
- [ ] La distinción cambio-de-estado (reversible) vs. eliminación-permanente (irreversible) de un alumno sigue siendo visualmente inequívoca.

### 10.7 Resumen para pegar como contexto en un futuro prompt de diseño

> TeacherFlow Web es un Next.js 16 + Tailwind en Fase A (datos de ejemplo, sin backend conectado), con 12 rutas: landing, 4 pantallas de auth + 2 técnicas, y 5 páginas privadas (Inicio, Alumnos, Calendario, Cobros, Configuración) detrás de una navegación de 5 ítems (barra inferior en móvil, sidebar en desktop ≥768px). Ya existe una paleta, tipografía de sistema, radios y sombras congeladas en `tailwind.config.ts`, copiadas de la app móvil de referencia (React Native/Expo), que es mucho más completa funcionalmente: modela alumnos (4 estados), semáforo de pago (4 colores/4 etapas de vencimiento con recargo compuesto), clases y entrenamientos (individuales/grupales, con series recurrentes de estado activa/pausada/finalizada), un motor de cobros completo (cargos/pagos/asignaciones/ajustes, 6 tipos de plan de facturación, pagos parciales, anulaciones auditables), disponibilidad de la profesora (bloqueos semanales + excepciones) y un perfil de alumno con 7 pestañas (resumen, clases, progreso, tareas, cobros, reportes, información). Ninguna de esas funciones existe todavía en la web, que hoy es de solo lectura sobre datos ficticios declarados como tales. El diseño debe: (1) no inventar pantallas que no tengan referencia en este documento o en el móvil citado, (2) preservar los estados semánticos y reglas de negocio de la sección "INVARIABLE", (3) tratar como terreno libre todo lo listado en "MODIFICABLE ESTÉTICAMENTE", y (4) resolver explícitamente las 7 decisiones de producto abiertas en §10.4 antes de dar por completo el nuevo sistema visual.
