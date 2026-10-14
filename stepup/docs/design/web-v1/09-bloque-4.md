# 09 · Bloque 4 — Calendario y Registro (implementado, en revisión visual)

Misma rama `v1-web`, a continuación de los Bloques 1–3 aprobados. **Sin deploy.** No se tocó la escala de color del calendario, ni la generación de recurrencias, el split, los participantes, la asistencia o el registro; tampoco consultas, RPC, Supabase ni migraciones.

## Alcance

Sólo presentación de `/calendario`, `/calendario/nueva`, `/calendario/series`, `/calendario/disponibilidad`, `/registro`, `/registro/nuevo`, `/registro/[calendarLessonId]` y `/registro/libre/[registrationId]` (y los componentes que usan, incluida la configuración de cuota de entrenamiento de Series). Las páginas siguen resolviendo los datos exactamente igual; las vistas nuevas sólo los dibujan.

| Pieza | Archivo |
|---|---|
| Calendario (encabezado, accesos, barra, aviso de período vacío, grilla/agenda) | `components/calendar/calendar-view.tsx`, `real-calendar-toolbar.tsx`, `real-calendar-grid.tsx` |
| Tarjeta de la grilla y fila de la agenda (misma resolución de color y de estado) | `components/calendar/real-lesson-card.tsx` |
| Detalle de la clase (reprogramar / cancelar, ahora sobre el `Dialog` del sistema) | `components/calendar/real-lesson-detail-modal.tsx` |
| Nueva clase / serie, editor de días y horarios | `app/(app)/calendario/nueva/new-lesson-form.tsx`, `components/calendar/weekday-schedule-editor.tsx` |
| Lista de series, acciones (pausar, editar futuras = dividir, participantes, finalizar) y cuota | `components/calendar/series-list-view.tsx`, `app/(app)/calendario/series/series-status-actions.tsx`, `components/payments/training-billing-config.tsx` |
| Disponibilidad | `app/(app)/calendario/disponibilidad/availability-editor.tsx` |
| Clases por registrar, marco del registro, espacio de trabajo y alta de clase libre | `components/registro/pending-list-view.tsx`, `registro-page-frame.tsx`, `app/(app)/registro/**` |

Nuevo en el sistema: `Dialog` acepta `busy` (`aria-busy`), `FormPage` (marco genérico de formularios de página completa) y las clases `checkClass` / `choiceRowClass` / `choiceGroupClass` (filas de opciones de ≥ 44 px). Las casillas y opciones nativas pasan a tinta (como en el prototipo) y la grilla del calendario usa columnas de 148 px mínimas para que la semana de siete días entre en 1440 px.

## Reglas visuales cumplidas

- **Escala de color congelada:** `lib/calendar-theme.ts` no cambió; las tarjetas (grilla y agenda) la leen con `resolveLessonColors` y ningún archivo define colores propios (prueba nueva).
- **Escritorio:** grilla horaria (96 px por hora). El bloque de color marca la hora de inicio y la duración **exactas** (alto = duración menos una separación fija). La zona interactiva de cada clase —el botón, con su `aria-label`— mide **al menos 44 × 44 px**; si la clase es más corta, la zona se extiende hacia abajo (o hacia arriba pegada al borde inferior de la grilla) y el rótulo baja a esa zona sin afirmar otra duración. Las clases cuyas zonas se tocan (mismo inicio, superpuestas o demasiado seguidas) se reparten en **carriles** paralelos dentro de la columna del día (ver «Carriles» abajo). **320–819 px:** agenda agrupada por día, sin cambios; la grilla nunca se comprime.
- **Estado en texto:** hora, título, modalidad (en la agenda) y estado (*Cancelada, Reprogramada, Reemplazo, En curso, Pasada, Entren.*) se dicen con texto además del color; el `aria-label` suma «en curso», «ya transcurrida», etc. «En curso» es nuevo y se deduce de la hora de inicio/fin ya cargada y el reloj del navegador.
- **Clases cortas:** con 30 min el rótulo se escribe en una o dos líneas dentro del bloque; con 15 min (bloque de ~18 px) baja a la zona de toque, debajo del bloque. El nombre completo, la hora de fin, la modalidad y el estado quedan en el `aria-label` y en el texto emergente (`title`), y en el detalle.
- **Diálogos que nombran la clase y la fecha:** el detalle muestra título + día, hora, duración, modalidad, tipo y estado en todos los pasos, y los pasos se titulan «Reprogramar · …», «Confirmar horario · …» y «Cancelar clase · …». La cuota de entrenamiento nombra la serie.
- **Acciones:** Detalle — «Registrar esta clase» (principal, sólo una clase pasada sin registrar), «Reemplazar con otro alumno», «Reprogramar», «Administrar esta serie» (secundarias) y «Cancelar esta clase» (contorno rojo, separada al final); Series — «Pausar/Reanudar», «Editar futuras» (divide «esta y las siguientes»), «Modificar participantes» (secundarias) y «Finalizar» (texto rojo, al otro extremo); Nueva clase / Editar futuras / Participantes / Registro — una sola acción principal por formulario; «Cancelar» sin borde.
- **Teclado y foco:** el detalle atrapa el foco, Escape lo cierra y devuelve el foco a la tarjeta, el foco acompaña cada paso (reprogramar → fecha, cancelar → «Volver»); objetivos de 44 px en la agenda móvil y en todos los controles de los formularios.

## Estados implementados

- **Calendario:** semana normal / pocas clases / vacía (con aviso «No hay clases esta semana» y acceso a «Programar una clase»), día normal / vacío / muy cargado, clases simultáneas, nombres y títulos largos, cruce de mes y de año, clases individuales, grupales y de series, serie sin alumnos, entrenamiento, pasada, en curso, programada, reemplazo, cancelada y reprogramada; error, carga.
- **Detalle:** individual, de una serie, grupal, en curso, pasada, reemplazo, cancelada, reprogramar (elegir horario y confirmar) y cancelar.
- **Nueva clase / serie:** clase única, serie semanal, ciclo de 2–4 semanas, reemplazo de clase cancelada, sin alumnos activos, alumno principal.
- **Series:** lista (tramos anteriores, «Desde dd/mm», «Sin alumnos asignados»), vacía, nombres largos, dividir, participantes, cuota (configurar/editar, vista previa, error).
- **Disponibilidad:** con datos, vacía, horario inválido (el aviso real del editor).
- **Registro:** lista (corta, larga, vacía, nombres largos, avance de las grupales), registro programado individual y grupal en progreso, con tareas anteriores por revisar, error «falta asistencia», participantes y textos largos, ya completado (edición), clase libre, actividad no dictada, alta de clase no programada (incluido «cancelada tarde» y «feriado»), sin alumnos activos; carga, error y no encontrado.

## Diferencias inevitables frente al prototipo (falta de datos o de funciones)

| Prototipo | Implementado | Motivo |
|---|---|---|
| Leyenda de colores («Online · Presencial · …») bajo el calendario | Sin leyenda | Es contenido nuevo; el estado ya se dice en cada tarjeta con texto. |
| Botón flotante «Nueva clase» y campana con panel en móvil; contadores y tarjeta «En curso» de la barra lateral | «Nueva clase» arriba (como siempre) | Propuestas (`04-propuestas-y-limites.md`). |
| Vista previa «así queda» al dividir una serie | Sin vista previa | Propuesta explícita: no se implementa. |
| Confirmación antes de «Finalizar» una serie | «Finalizar» directo, como siempre | Es un flujo nuevo. |
| Botón «Nueva serie» en la lista de Series | Sin ese botón (el vacío ofrece «Crear una clase») | No existe hoy ese acceso. |
| Diálogo de confirmación antes de guardar el registro y su variante «alumnos omitidos» | «Finalizar registro» guarda directo, como siempre | Pedido expreso: no agregar confirmación previa. |
| Avatares apilados de los participantes de una grupal en la lista de registro | Ícono de grupo | La lista no carga los nombres de los participantes. |
| Hora de fin en la tarjeta de la grilla | Sólo hora de inicio (la agenda móvil muestra inicio–fin) | La tarjeta de la grilla ya tenía ese texto y su alto no alcanza para más. |
| Detalle de cada conflicto al reprogramar (lista de choques) | El mensaje real del servidor | El texto lo devuelve la acción. |
| Estados «Guardando» y «Sin conexión» a pantalla completa | Botones con giro y avisos en línea (lo que ya existía) | Dependen de la red real; se verificaron los avisos de error. |

## Carriles y zonas de toque (corrección posterior a la revisión visual)

Los dos hallazgos que se habían dejado como decisión de producto —clases simultáneas tapadas y objetivos menores de 44 px en la grilla de escritorio— se resolvieron en `lib/calendar/layout.ts` (sólo geometría; datos, consultas, recurrencias y agenda móvil no cambian):

- **Orden estable:** por hora de inicio, hora de fin y, al final, id. Es también el orden de tabulación (el DOM sigue ese orden; no hay `tabindex`).
- **Carriles:** cada clase toma el primer carril libre de su grupo de zonas que se tocan; todas las del grupo comparten el ancho (`laneCount`). Funciona con 2, 3 o más. Un día con muchos carriles ensancha su columna (mínimo 68 px por carril) en vez de comprimir las tarjetas; el contenedor de la grilla ya se desplaza en horizontal si hace falta.
- **Colisiones:** dos zonas que se tocan en altura nunca comparten carril, así que ninguna pisa a otra ni bloquea el acceso a una clase contigua. Dos clases consecutivas de 30 min caben en un solo carril (4 px de aire entre las zonas de 44 px); dos consecutivas de 15 min, cuyas zonas no caben una tras otra, se reparten en carriles.
- **Escala:** la grilla pasó de 80 a 96 px por hora para que dos clases de 30 min seguidas entren en un carril con objetivos de 44 px sin falsear sus duraciones.
- **Fuera del eje 08:00–22:00:** una clase que empieza antes o después del eje se ve pegada al borde (antes quedaba con alto 0); el rótulo y el detalle dicen la hora real.
- Pruebas: `lib/calendar/__tests__/layout-lanes.test.ts` (mismo inicio y fin, superposición parcial, tres y cinco superpuestas, consecutivas, 15/30/45/60 min, dos de 30 y dos de 15 consecutivas, orden estable con entrada desordenada, propiedad sobre 60 conjuntos pseudoaleatorios: nunca desaparece una clase, nunca menos de 44 px, nunca se pisan) y el cableado de la grilla y la tarjeta.

Las pantallas de carga (esqueleto del Bloque 1) son transitorias y se anuncian con `role="status"`; desde el 14/10/2026 cada una nombra su sección (`aria-labelledby`, ver `12-bloque-7.md`).

## Verificación

- Datos ficticios con un arnés local temporal (`zz-demo-b4`, con un reloj simulado: miércoles 14/10/2026, 11:00) sobre los componentes reales; se archivó fuera del repo y se borró antes del commit.
- 1440, 390 y 320 px: sin desborde horizontal en ninguna de las 177 capturas; un solo `<h1>` por pantalla (salvo la carga transitoria); nombres accesibles en todos los controles; objetivos de ≥ 44 px (también en la grilla de escritorio tras la corrección de carriles: comprobado con clases de 15, 30, 45 y 60 min, tres consecutivas de 30 min, simultáneas, tres y cuatro superpuestas; ninguna zona pisa a otra y el centro de cada una recibe el toque de su propia clase).
- Teclado del detalle de la clase en los tres anchos: foco inicial en el diálogo, Tab/Shift+Tab atrapado (Cerrar → Alumno → Reprogramar → Cancelar → Cerrar), paso «Reprogramar» con el foco en la fecha, Escape cierra y devuelve el foco a la tarjeta.
- División e idempotencia: cubiertas por las pruebas existentes (`new-lesson`, recurrencias, split, registro) y por pruebas de fuente nuevas (`lib/ui/__tests__/block4-calendar-registro.test.ts`). Se actualizaron las pruebas que fijaban dónde estaba el marcado (`b4-states`, `b7-consistency`, `b8-accessibility`, `date-format-ranges`, `occurrence-student-label`, `calendar-civil-dates-guard`) sin relajar lo que verifican; los formateadores de fecha siguen siendo los únicos y la zona America/Argentina/Buenos_Aires no cambió.
- `typecheck`, `lint`, `build` y la suite completa sobre copia LF.
