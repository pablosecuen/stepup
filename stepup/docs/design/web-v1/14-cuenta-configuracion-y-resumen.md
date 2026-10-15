# Cuenta, Configuración, Resumen financiero y anchos generales (14/10/2026)

Bloque aprobado sobre `398150b`. Sin migraciones, sin cambios de base ni de reglas contables, sin tocar billing ni Mobbex.

## 1. Sesión y navegación de cuenta

- **«Cerrar sesión»** (`components/nav/sign-out-button.tsx`) es el único control de sesión: arriba a la derecha del área principal en TODAS las rutas privadas. En escritorio es una fila propia del layout privado (`--tf-shell-top`, 3,25 rem) antes del contenido de cada pantalla, así que nunca se superpone con títulos, la campana de Recordatorios ni las acciones de cada pantalla; en móvil vive en el encabezado fijo (debajo de 380 px sin ícono, sólo texto). Contiene únicamente «Cerrar sesión» (sin Configuración), es un botón nativo (mouse, Enter y Espacio), mide 44 px de alto y tiene anillo de foco visible. Reusa la acción existente (`signOutAction` vía `requestSignOut` y `guardNetwork`); no pedía confirmación antes y no la pide ahora.
- **Configuración** es un enlace directo (no un menú) abajo a la izquierda de la barra lateral, separado de la navegación principal por una línea. En móvil es un enlace propio (ícono de engranaje, «Configuración») en el encabezado, al lado del botón de sesión. Se eliminó el bloque de cuenta con el correo truncado y el desplegable (`account-menu.tsx`, `menu-keyboard.ts`, `menu-styles.ts`, `account-identity.ts`, `load-account-identity.ts`): el shell ya no lee el perfil, una consulta menos por navegación. Con la facturación encendida la barra lateral ofrece además «Facturación» (apagada, es exactamente la de siempre).
- Las pantallas que miden `100dvh` (Calendario) descuentan esa fila (`calc(100dvh - var(--tf-shell-top))`).

## 2. Configuración

Cabecera «Configuración» / «Tu cuenta, preferencias y datos.», contenedor ancho (`PAGE_WIDTH.wide`) con el índice a la izquierda y las tarjetas en dos o tres columnas (una en móvil). Secciones: **Cuenta** (perfil + nombre visible, correo de acceso + contraseña), **Preferencias** (Disponibilidad, Niveles personalizados, Políticas de cobro; sin cambios de reglas ni acciones) y **Acciones sensibles** (eliminar cuenta). Ya no contiene: la distribución 50/30/20 (vive en Resumen financiero), «Respaldo», «Dispositivo autorizado» ni «Cerrar la sesión del dispositivo autorizado».

### Sesiones abiertas — decisión: opción B (no se muestra nada)

Auditoría: `active_sessions` guarda UNA sola fila por profesora (`user_id` único, con `device_id` y `generation`), es el mecanismo de «un solo dispositivo autorizado» de la app anterior y la web nunca participa de él (`lib/repositories/active-sessions.ts` no reclama ni renueva la sesión). La autenticación web usa las sesiones de Supabase Auth (cookies) y la base no registra ni distingue sesiones por navegador o dispositivo, ni se pueden listar ni cerrar de a una desde la interfaz. Por lo tanto la interfaz NO afirma controlar sesiones de Chrome, Safari o un celular: se retiró «Dispositivo autorizado» y su cierre remoto y no se inventó ninguna lista.

**Pendiente de una implementación real («Sesiones abiertas»):** registrar sesiones web (navegador, última actividad, fecha aproximada, marca de «Esta sesión»), poder cerrar las otras con confirmación y no exponer tokens, ids ni IP completa. Requiere diseño de base y revocación de refresh tokens: queda para un bloque propio.

## 3. Copia de seguridad fuera de la interfaz

Se retiró la tarjeta «Respaldo» de Configuración y todo texto que presentaba una app móvil como producto existente (asistente de importación, historial y mensajes de error de `lib/backup/import-copy.ts`, ahora neutros: «copia de seguridad guardada en la nube», «Versión X»). **Backend sin uso, pendiente de una limpieza separada:** la ruta `/configuracion/respaldo` (sin enlaces desde la interfaz, alcanzable sólo por URL), `components/backup/*`, `lib/backup/*`, `lib/repositories/backup-import.ts`, `lib/actions/backup.ts`, las tablas y RPC `cloud_backups`/`import_runs`, las migraciones y los respaldos existentes, además de `active_sessions`, `endActiveSessionAction`, `lib/repositories/active-sessions.ts` y las RPC `transfer/touch/end_active_session`. Nada de eso se borró.

## 4. Resumen financiero

Cabecera «Resumen financiero» / «Tus cobros, actividad y una guía para organizar lo ingresado.»; se conservan los cinco períodos, las cuatro métricas (sin cambios de reglas contables) y «Actividad del período» (separada de lo financiero). Nuevas secciones, entre las cifras y la actividad:

- **Evolución de cobros** (`collected-evolution-chart.tsx`): barras VERDES con el dinero efectivamente cobrado de cada mes, cronológico, importes con `formatMoney`. **Fuente:** los pagos, asignaciones y cargos que el cargador (`load-financial-overview.ts`) ya leía para «Cobrado», agrupados por `paidAt` real en la zona de Argentina (`lib/reports/monthly-collected.ts`; sólo pagos y cargos no anulados). Sin consultas nuevas ni por elemento. Meses: los del período (3 y 6 meses exactos; año actual hasta el mes en curso; año anterior completo) y, para «Mes actual», los últimos 6 meses para dar contexto. Sin datos: estado vacío compacto, sin barras ficticias. Accesible: una parada de Tab, flechas/Inicio/Fin, tooltip (`role="tooltip"`, Escape) con período e importe, y una tabla alternativa («Ver datos en tabla»).
- **Distribución sugerida** (`budget-suggestion.tsx`): aclaración «Proyección orientativa sobre lo cobrado; no representa tus gastos ni tu ahorro real.», dona, barra apilada y, para Necesidades (azul), Gustos (violeta) y Ahorro (verde), porcentaje e importe con suma visible de 100 %. **Base: sólo `summary.collected`** del período (nunca prevista, pendiente ni vencida); el reparto es en centavos por resto mayor (`lib/payments/budget-suggestion.ts`) y siempre suma exacto; con cero cobrado muestra $ 0 y un aviso. **«Ajustar porcentajes»** abre un diálogo compacto (`Dialog`: foco atrapado, Escape sin guardar, foco devuelto) con los motores de siempre y la suma en vivo; guarda con la acción existente `saveBudgetDistributionAction`, que ahora VALIDA antes de escribir (tres enteros de 0 a 100 con suma exacta 100; un valor parcial o inválido se rechaza entero) y guarda con un único `upsert` por propietaria (atómico e idempotente: reintentar tras una respuesta perdida deja el mismo resultado).

## 5. Anchos — inventario de rutas

Primitiva única: `PAGE_WIDTH` (`components/ui/page-header.tsx`): `wide` 1180 px, `medium` 960 px, `narrow` 760 px; ya no se repiten clases de ancho pantalla por pantalla (Inicio y su error usaban copias). Menos relleno superior en escritorio porque la fila de sesión ya separa el contenido del borde. `EmptyState` pasó a ser compacto (≤ 560 px, a la izquierda).

| Ruta | Antes | Ahora |
|---|---|---|
| `/configuracion` | medium | **wide** |
| `/calendario/series` (y su error) | medium | **wide** |
| `/registro` (lista de clases por registrar, y su error) | medium | **wide** |
| `/recordatorios` (y su error) | medium | **wide** |
| `/inicio` (y su error) | clase repetida | `wide` / `medium` de la primitiva (mismo ancho) |
| `/calendario`, `/calendario/disponibilidad`, `/alumnos`, `/cobros`, `/resumen-financiero` | wide | wide (sin cambios) |
| `/alumnos/[id]`, `/registro/[id]`, `/registro/libre/[id]`, `/facturacion/*` | medium | medium (a propósito: ficha o formulario de lectura continua; facturación está apagada) |
| `/alumnos/nuevo`, `/alumnos/[id]/editar`, `/calendario/nueva`, `/registro/nuevo`, `/facturacion/resultado` | narrow | narrow (a propósito: formularios breves y confirmaciones, no se estiran) |
| login, crear cuenta, recuperación, iniciando sesión, diálogos | angosto | sin cambios (no se ensanchan) |

## 6. Pruebas

`lib/reports/__tests__/monthly-collected.test.ts` (meses, límites de mes y de año en Argentina, anulados, centavos, coincidencia con «Cobrado»), `lib/payments/__tests__/budget-suggestion.test.ts` (0, enteros, centavos, valores grandes, edición válida, inválida, parcial, repetida), `lib/ui/__tests__/account-finance-screens.test.ts` (Resumen, gráfico, distribución, diálogo, acción, inventario de anchos, estados vacíos, un solo `<main>`), `lib/nav/__tests__/shell-wiring.test.ts` y `b9-settings.test.ts` actualizadas.

## 7. Ajuste posterior (15/10/2026): textos, Configuración mínima e Inicio

- **Sin referencias a «app» en la interfaz.** Ningún texto visible habla de «la app», «app móvil», una aplicación o un celular (p. ej. «Tus datos de acceso y cómo aparecés en TeacherFlow.», «Organizá cómo funciona TeacherFlow.»). Lo impide `lib/copy/__tests__/no-app-references.test.ts`, que recorre el texto visible de `app/`, `components/` y `lib/` (los nombres técnicos, rutas y comentarios no cuentan).
- **Configuración** queda con Cuenta (nombre visible), Contraseña, Políticas de cobro y Acciones sensibles (Eliminar cuenta). Se retiraron Disponibilidad (se administra desde Calendario) y Niveles personalizados (desde Alumnos): sus rutas y lógica no se tocaron. Sin índice lateral (con tres secciones cortas no aporta); Cuenta y Contraseña en dos tarjetas, y Políticas de cobro (~480 px) y Acciones sensibles (~560 px) con ancho proporcionado a su contenido.
- **Inicio.** Los tres indicadores son una franja compacta (≈ 73 px de alto en escritorio, filas de 44 px en móvil). «Clases de hoy» es el contenido principal y muestra el DÍA COMPLETO: `buildTodayAgenda` (`lib/dashboard/today-agenda.ts`) toma lo que el cargador ya compone para el día civil de Argentina con UNA lectura acotada al día (sin una consulta por clase), conserva la agenda válida del Calendario (una cancelada se ve cancelada salvo que un reemplazo activo ocupe su lugar), filtra por la fecha civil del inicio de cada clase, ordena por inicio, fin e id y no tiene límite ni «Ver todas». Cada fila (hora inicio–fin, alumno o título, modalidad y estado real: Cancelada, Reprogramada, Completada, En curso, Sigue, Pasada) es un botón que abre el detalle existente del Calendario. Debajo, Cobros y Recordatorios (compactos, lado a lado); Clases por registrar queda en la columna derecha. En móvil el orden es indicadores → Clases de hoy → Cobros → Recordatorios → Clases por registrar.
