# 03 · Mapa de pantallas del prototipo y relación con las rutas reales

El prototipo tiene **59 pantallas**, **148 variantes** y **47 diálogos, menús y hojas** (254 estados). Este documento es el índice durable; el prototipo navegable está en `C:\Users\joaqu\tf-design\prototipo-web-v1\dist\index.html` (ver `README.md`).

Los identificadores de pantalla (`landing`, `login`, `home.active`…) son los del prototipo; `?v=` es una variante y `?o=` un diálogo, menú u hoja inferior.

## 1. Mapa de pantallas por sección

### Públicas y autenticación

- **Landing** — ruta real: `/`
- **Iniciar sesión** — ruta real: `/login`
  - variante: Con error de credenciales
  - variante: Procesando
  - variante: Sin conexión (error de red)
  - variante: Demasiados intentos
- **Crear cuenta** — ruta real: `/crear-cuenta`
  - variante: Contraseñas que no coinciden
  - variante: Contraseña débil
  - variante: Ya existe una cuenta
  - variante: Procesando
  - variante: Enlace enviado (confirmar correo)
- **Confirmar cuenta / enlace del correo** — ruta real: `/auth/confirm`
  - variante: Confirmar correo (alta)
  - variante: Elegir contraseña (recuperación)
- **Enlace confirmado** — ruta real: `/auth/confirmado`
- **Enlace vencido o inválido** — ruta real: `/auth/error?type=…`
  - variante: Vencido o ya usado
  - variante: Otro dispositivo
  - variante: Ya fue usado
  - variante: No válido
  - variante: Sin conexión
  - variante: Servidor no disponible
- **Recuperar contraseña** — ruta real: `/recuperar-contrasena`
  - variante: Enlace enviado + código
  - variante: Procesando
  - variante: Demasiados intentos
- **Elegir contraseña nueva** — ruta real: `/nueva-contrasena`
  - variante: No coinciden
  - variante: Guardando
  - variante: Contraseña débil
- **Sin conexión** — ruta real: `(no existe como ruta: hoy es un mensaje dentro del formulario)` · _propuesta: no existe hoy_
- **Error general** — ruta real: `app/error.tsx · app/global-error.tsx`
  - variante: Último recurso (global-error)
- **Página no encontrada** — ruta real: `app/not-found.tsx`
- **Iniciando sesión (recuperación)** — ruta real: `/iniciando-sesion`
  - variante: Esperando
  - variante: Agotado: no se pudo cargar Inicio

### Estructura general

- **Estado de carga (esqueletos)** — ruta real: `loading.tsx de cada sección`
  - variante: Lista (Alumnos, Cobros…)
  - variante: Panel (Inicio)
  - variante: Calendario
  - variante: Formulario
- **Navegación de escritorio y móvil** — ruta real: `components/nav/primary-nav.tsx`
  - variante: Con la sección Registro activa
  - diálogo/menú: Menú de cuenta abierto
  - diálogo/menú: Menú: cerrando sesión
  - diálogo/menú: Menú: error al cerrar
  - diálogo/menú: Notificaciones abiertas
  - diálogo/menú: Notificaciones sin pendientes
- **Estado vacío** — ruta real: `components/ui/states.tsx (EmptyState)`
  - variante: Sin acción
- **Estado de error** — ruta real: `components/ui/states.tsx (ErrorState) · route-error.tsx`
  - variante: Error persistente (vista completa)
  - variante: Sesión vencida
- **Página no encontrada (dentro de la app)** — ruta real: `app/(app)/not-found.tsx · alumnos/registro not-found`
  - variante: Alumno inexistente
  - variante: Registro inexistente

### Inicio

- **Inicio · cuenta activa con agenda completa** — ruta real: `/inicio`
  - diálogo/menú: Menú de cuenta
  - diálogo/menú: Recordatorios abiertos
- **Inicio · cuenta nueva y vacía (primeros pasos)** — ruta real: `/inicio (stage empty)`
- **Inicio · con alumnos pero sin clases** — ruta real: `/inicio (stage students-only)`
- **Inicio · contenido mínimo** — ruta real: `/inicio`
- **Inicio · contenido largo** — ruta real: `/inicio`
- **Inicio · error de carga** — ruta real: `/inicio (ErrorState)`
  - variante: Sesión todavía no reconocida
- **Inicio · cargando** — ruta real: `(Suspense)`

### Alumnos

- **Alumnos · lista completa** — ruta real: `/alumnos`
  - variante: Búsqueda con resultados
  - variante: Filtro por modalidad
  - variante: Incluye pausados/inactivos/archivados
  - variante: Resultado vacío
  - variante: Sin alumnos (vacío con acción)
  - variante: Niveles personalizados: renombrando
  - diálogo/menú: Filtros (hoja inferior)
- **Alumnos · cargando** — ruta real: `alumnos/loading.tsx`
- **Alumnos · error de carga** — ruta real: `/alumnos (ErrorState)`
- **Alumnos · nuevo alumno** — ruta real: `/alumnos/nuevo`
  - variante: Con errores de campos (propuesta)
  - variante: Posible duplicado
  - variante: Duplicados cambiaron
  - variante: Guardando
  - variante: Error del servidor
  - variante: Sin conexión
- **Alumnos · editar alumno** — ruta real: `/alumnos/[id]/editar`
  - variante: Guardando
  - variante: Error

### Perfil del alumno

- **Perfil · Resumen** — ruta real: `/alumnos/[id]?tab=resumen`
  - variante: Estado vacío (sin clases dictadas)
  - variante: Alumno pausado
  - variante: Archivar: elegir agenda futura
  - variante: Archivar: quitando agenda
  - variante: Nombre muy largo
  - diálogo/menú: Cambiar estado: confirmar archivado
- **Perfil · Clases** — ruta real: `/alumnos/[id]?tab=clases`
  - variante: Estado vacío
- **Perfil · Progreso** — ruta real: `/alumnos/[id]?tab=progreso`
  - variante: Estado vacío
- **Perfil · Tareas** — ruta real: `/alumnos/[id]?tab=tareas`
  - variante: Estado vacío (sin acción)
- **Perfil · Información** — ruta real: `/alumnos/[id]?tab=informacion`
  - variante: Estado con datos mínimos
  - variante: Alumno archivado
- **Perfil · Cobros (obligaciones y pagos)** — ruta real: `/alumnos/[id]?tab=cobros`
  - variante: Estado vacío
  - variante: Muchas obligaciones
  - variante: Nombres e importes largos
  - diálogo/menú: Registrar pago
  - diálogo/menú: Anular cobro
  - diálogo/menú: Anular pago

### Reportes

- **Perfil · Reportes (período, vista previa, PDF, historial)** — ruta real: `/alumnos/[id]?tab=reportes`
  - variante: Selección de período
  - variante: Vista previa con datos
  - variante: Generando PDF
  - variante: Reporte generado
  - variante: Error al generar
  - variante: Advertencia: reporte anterior
  - variante: Confirmar eliminación
  - variante: Sin clases dictadas (vacío)
  - variante: Historial vacío

### Cobros

- **Cobros · Centro de cobros** — ruta real: `/cobros`
  - variante: Sólo vencidos
  - variante: Sólo vencen hoy
  - variante: Muchas obligaciones
  - variante: Nombres e importes largos
  - variante: Sin cobros (vacío)
  - variante: Error de carga
  - diálogo/menú: Registrar pago
  - diálogo/menú: Pago parcial
  - diálogo/menú: Anular cobro
  - diálogo/menú: Detalle del cobro
- **Cobros · cargando** — ruta real: `cobros/loading.tsx`

### Calendario

- **Calendario · vista semanal** — ruta real: `/calendario`
  - variante: Semana con pocas clases
  - variante: Semana cargada
  - variante: Semana vacía
  - variante: Error de carga
  - diálogo/menú: Clase individual
  - diálogo/menú: Clase de una serie
  - diálogo/menú: Clase en curso
  - diálogo/menú: Clase pasada
  - diálogo/menú: Clase de reemplazo
  - diálogo/menú: Clase cancelada
  - diálogo/menú: Reprogramar: elegir horario
  - diálogo/menú: Reprogramar: confirmar
  - diálogo/menú: Reprogramar: error de conflicto
  - diálogo/menú: Cancelar: confirmación
- **Calendario · vista diaria** — ruta real: `/calendario?view=day`
  - variante: Día sin clases
  - diálogo/menú: Clase en curso
  - diálogo/menú: Clase individual
- **Calendario · cargando** — ruta real: `calendario/loading.tsx`
- **Calendario · nueva clase** — ruta real: `/calendario/nueva`
  - variante: Nueva serie semanal
  - variante: Reemplazo de clase cancelada
  - variante: Conflicto de horario
  - variante: Cae en un bloqueo de disponibilidad
  - variante: Guardando
  - variante: Sin alumnos activos
  - variante: Sin conexión
- **Calendario · lista de series (editar, dividir)** — ruta real: `/calendario/series`
  - variante: Editar serie: dividir «esta y las siguientes»
  - variante: Modificar participantes
  - variante: Sin series (vacío)
  - variante: Error de carga
  - diálogo/menú: Finalizar serie: confirmación
  - diálogo/menú: Configurar cuota de entrenamiento
  - diálogo/menú: Cuota: vista previa de obligaciones
- **Calendario · disponibilidad y excepciones** — ruta real: `/calendario/disponibilidad`
  - variante: Guardado
  - variante: Sin bloqueos ni excepciones
  - variante: Error al guardar
  - variante: Horario inválido

### Registro

- **Registro · clases por registrar** — ruta real: `/registro`
  - variante: Lista larga (8)
  - variante: Estado vacío (al día)
  - variante: Error de carga
- **Registro · cargando** — ruta real: `registro/loading.tsx`
- **Registro · registro programado (asistencia, tareas, observaciones)** — ruta real: `/registro/[calendarLessonId]`
  - variante: Asistencia: tarde con minutos
  - variante: Tareas anteriores a revisar
  - variante: Notas y observaciones
  - variante: Grupal en progreso
  - variante: Todos completos (listo para finalizar)
  - variante: Registro ya completado (edición)
  - variante: Error: falta asistencia
  - variante: Guardando
  - variante: Actividad no dictada (profesora ausente)
  - variante: Sin conexión
  - diálogo/menú: Confirmación antes de guardar
  - diálogo/menú: Confirmación con aviso (alumnos omitidos)
- **Registro · clase no programada (detalle)** — ruta real: `/registro/libre/[registrationId]`
- **Registro · estado completado (éxito)** — ruta real: `/registro (tras finalizar)`
- **Registro · registrar clase libre (no programada)** — ruta real: `/registro/nuevo`
  - variante: Resultado: cancelada tarde (política)
  - variante: Resultado: feriado con excepción
  - variante: Con errores
  - variante: Guardando
  - variante: Sin alumnos activos

### Recordatorios

- **Recordatorios · lista completa por categorías** — ruta real: `/recordatorios`
  - variante: Sin recordatorios (vacío)
  - variante: Error de carga
  - diálogo/menú: Recordatorios en panel
- **Recordatorios · cargando** — ruta real: `recordatorios/loading.tsx`

### Resumen financiero

- **Resumen financiero · mes actual** — ruta real: `/resumen-financiero`
  - variante: Cambio de período: últimos 3 meses
  - variante: Año anterior
  - variante: Sin información (vacío)
  - variante: Error de carga
- **Resumen financiero · cargando** — ruta real: `resumen-financiero/loading.tsx`

### Configuración

- **Configuración · vista principal reorganizada** — ruta real: `/configuracion`
  - variante: Perfil y cuenta: nombre guardado
  - variante: Perfil: guardando
  - variante: Perfil: error al guardar
  - variante: Contraseña: enlace enviado
  - variante: Sin dispositivo autorizado
  - variante: Cuenta sin conexión (no disponible)
  - diálogo/menú: Cerrar sesión de un dispositivo
  - diálogo/menú: Cerrar sesión: error
  - diálogo/menú: Eliminar cuenta: confirmación vacía
  - diálogo/menú: Eliminar cuenta: lista para confirmar
  - diálogo/menú: Eliminar cuenta: error de contraseña
  - diálogo/menú: Eliminar cuenta: eliminando
- **Configuración · cargando** — ruta real: `configuracion/loading.tsx`
- **Configuración · Respaldo (importación y historial)** — ruta real: `/configuracion/respaldo`
  - variante: Asistente · analizando
  - variante: Revisar y decidir (sin diferencias)
  - variante: Revisar: alumno con diferencias y duplicado
  - variante: Revisar: niveles duplicados
  - variante: Revisar: presupuesto + confirmación fuerte
  - variante: Revisar: revisión vencida (error)
  - variante: Importando
  - variante: Resultado: completada
  - variante: Resultado: ya aplicada antes
  - variante: Resultado: deshecha
  - variante: Resultado: opción de deshacer quitada
  - variante: Resultado: error al deshacer
  - variante: Error: no hay copia en la nube
  - variante: Error: copia demasiado grande
  - variante: Sin conexión
  - variante: Historial vacío
  - variante: Historial cargando
  - variante: Historial con error
  - diálogo/menú: Deshacer: revisión segura
  - diálogo/menú: Deshacer: bloqueado
  - diálogo/menú: Quitar la opción de deshacer

### Estados transversales

- **Estados transversales (galería)** — ruta real: `components/ui/states.tsx · lib/ui/*`
  - variante: Anchos 320 · 390 · 1440
  - diálogo/menú: Modal / hoja inferior
  - diálogo/menú: Hoja inferior móvil (forzada)
  - diálogo/menú: Menú desplegable
  - diálogo/menú: Confirmación

### Sistema de diseño

- **Sistema de diseño (tipografía, color, espacio, componentes)** — ruta real: `(decisiones globales)`

## 2. Flujos principales

- **Primer acceso:** Landing → Crear cuenta → Enlace enviado → Confirmar correo → Cuenta confirmada → Iniciar sesión → Inicio (cuenta nueva)
- **Acceso y recuperación:** Iniciar sesión → Olvidé mi contraseña → Enlace enviado + código → Elegir contraseña nueva → Nueva contraseña → Iniciar sesión
- **Enlace con problema:** Abrir enlace → Vencido / otro dispositivo / usado → Pedir enlace nuevo
- **Empezar a trabajar:** Inicio (cuenta nueva) → Nuevo alumno → Perfil del alumno → Inicio (con alumnos) → Nueva clase → Calendario
- **Alta de alumno con duplicado:** Nuevo alumno → Posible duplicado → Revisar alumno existente → Es otra persona → creado
- **Una clase, de la agenda al cobro:** Inicio: agenda de hoy → Calendario → Detalle de clase → Registrar esta clase → Confirmar y finalizar → Cobros del alumno → Registrar pago
- **Cambios en el calendario:** Calendario → Reprogramar → Confirmar horario → Cancelar → Reemplazar con otro alumno
- **Series: editar y dividir:** Series → Editar futuras (dividir) → Modificar participantes → Finalizar serie → Cuota de entrenamiento
- **Registro de una clase:** Clases por registrar → Registro programado → Asistencia → Tareas anteriores → Notas y observaciones → Finalizar → Registro finalizado
- **Clase no programada:** Clases por registrar → Registrar clase no programada → Detalle del registro libre
- **Cobrar:** Centro de cobros → Registrar pago → Pago parcial → Detalle del cobro → Anular cobro / pago → Resumen financiero
- **Reporte de un alumno:** Perfil · Reportes → Elegir meses → Vista previa → Generar PDF → Reporte listo
- **Importar un respaldo:** Configuración → Respaldo → Analizando → Revisar y decidir → Confirmación fuerte → Importando → Resultado → Deshacer
- **Cuenta y cierre:** Menú de cuenta → Configuración → Cerrar sesión de otro dispositivo → Eliminar cuenta → Landing

## 3. Rutas reales ↔ pantallas del prototipo

| Ruta o componente real | Archivo | Pantallas del prototipo | Notas |
|---|---|---|---|
| `/` | `app/page.tsx` | `landing` |  |
| `/login` | `app/login/page.tsx` | `login`, `login?v=error`, `login?v=busy`, `login?v=offline` | Con CAPTCHA (Turnstile) sólo si hay clave de sitio: no se representa. |
| `/crear-cuenta` | `app/crear-cuenta/page.tsx` | `signup`, `signup?v=mismatch`, `signup?v=weak`, `signup?v=exists`, `signup?v=sent` |  |
| `/auth/confirm` | `app/auth/confirm/page.tsx` | `confirm?type=signup`, `confirm?type=recovery` | El GET no consume el enlace; el botón sí. |
| `/auth/confirmado` | `app/auth/confirmado/page.tsx` | `confirmed` |  |
| `/auth/error?type=…` | `app/auth/error/page.tsx` | `linkerr?type=link_expired`, `linkerr?type=link_other_device`, `linkerr?type=link_already_used`, `linkerr?type=link_invalid`, `linkerr?type=no_connection`, `linkerr?type=server_error` | Seis categorías de texto real. |
| `/auth/callback` | `app/auth/callback/route.ts` | — | Route handler sin interfaz (canje de código). |
| `/recuperar-contrasena` | `app/recuperar-contrasena/page.tsx` | `recover`, `recover?v=sent`, `recover?v=rate` |  |
| `/nueva-contrasena` | `app/nueva-contrasena/page.tsx` | `newpass`, `newpass?v=mismatch`, `newpass?v=busy` |  |
| `/iniciando-sesion` | `app/iniciando-sesion/page.tsx` | `session.recovery`, `session.recovery?v=exhausted` | Pantalla transitoria de recuperación de sesión. |
| `404 público` | `app/not-found.tsx` | `error.notfound` |  |
| `Error público / global` | `app/error.tsx · global-error.tsx` | `error.general`, `error.general?v=global` |  |
| `Sin conexión` | `(no existe como ruta)` | `offline` | PROPUESTA. Hoy es un mensaje dentro del formulario (network-guard); se rediseña también como pantalla. |
| `/inicio` | `app/(app)/inicio/page.tsx` | `home.active`, `home.new`, `home.students`, `home.min`, `home.long`, `home.error` | Cuenta nueva, con alumnos, activa, mínima y larga. |
| `/alumnos` | `app/(app)/alumnos/page.tsx` | `students.list`, `students.list?q=Mar`, `students.list?v=empty&q=zzz`, `students.list?v=none`, `students.list?lv=edit` | Incluye niveles personalizados y paginación. |
| `/alumnos/nuevo` | `app/(app)/alumnos/nuevo/page.tsx` | `students.new`, `students.new?v=dup`, `students.new?v=errors` | Errores de campo: propuesta (hoy los valida el servidor). |
| `/alumnos/[id]` | `app/(app)/alumnos/[id]/page.tsx` | `profile.resumen`, `profile.clases`, `profile.progreso`, `profile.tareas`, `profile.informacion`, `profile.cobros`, `profile.reportes` | Siete pestañas, cada una con estado vacío. |
| `/alumnos/[id]/editar` | `app/(app)/alumnos/[id]/editar/page.tsx` | `students.edit` |  |
| `/calendario` | `app/(app)/calendario/page.tsx` | `cal.week`, `cal.week?v=sparse`, `cal.week?v=busy`, `cal.day` | Escala de color sin cambios. |
| `/calendario/nueva` | `app/(app)/calendario/nueva/page.tsx` | `cal.new`, `cal.new?v=series`, `cal.new?v=repl` | Clase única, serie y reemplazo. |
| `/calendario/series` | `app/(app)/calendario/series/page.tsx` | `cal.series`, `cal.series?v=split`, `cal.series?v=participants` | «Dividir esta y las siguientes» = «Editar futuras». |
| `/calendario/disponibilidad` | `app/(app)/calendario/disponibilidad/page.tsx` | `cal.availability`, `cal.availability?v=empty` | Bloqueos semanales y excepciones. |
| `/registro` | `app/(app)/registro/page.tsx` | `reg.list`, `reg.list?v=empty` |  |
| `/registro/[calendarLessonId]` | `app/(app)/registro/[calendarLessonId]/page.tsx` | `reg.work`, `reg.work?v=group`, `reg.work?v=done` | Asistencia, tareas, observaciones y estado completado. |
| `/registro/libre/[registrationId]` | `app/(app)/registro/libre/[registrationId]/page.tsx` | `reg.free-detail` |  |
| `/registro/nuevo` | `app/(app)/registro/nuevo/page.tsx` | `reg.free-new`, `reg.free-new?v=late` |  |
| `/cobros` | `app/(app)/cobros/page.tsx` | `pay.center`, `pay.center?f=vencido`, `pay.center?v=long` | Sin recargos por atraso. |
| `/recordatorios` | `app/(app)/recordatorios/page.tsx` | `reminders.list`, `reminders.list?v=empty` | Cuatro categorías reales. |
| `/resumen-financiero` | `app/(app)/resumen-financiero/page.tsx` | `fin.summary`, `fin.summary?v=empty` | Cinco períodos. |
| `/configuracion` | `app/(app)/configuracion/page.tsx` | `set.main`, `set.main?v=nosession` | Cuenta, preferencias, sesión y acciones sensibles. |
| `/configuracion/respaldo` | `app/(app)/configuracion/respaldo/page.tsx` | `set.backup`, `set.backup?w=preview&pv=dups`, `set.backup?w=result` | Asistente de tres pasos e historial. |
| `loading.tsx (siete secciones)` | `app/(app)/*/loading.tsx` | `shell.loading`, `home.loading`, `students.loading`, `cal.loading`, `reg.loading`, `pay.loading`, `reminders.loading`, `fin.loading`, `set.loading` | Esqueletos dentro del shell. |
| `error.tsx del área privada` | `app/(app)/error.tsx` | `shell.error?v=route` |  |
| `not-found del área privada` | `app/(app)/not-found.tsx · alumnos · registro` | `shell.notfound`, `shell.notfound?v=student`, `shell.notfound?v=reg` |  |
| `Menú de cuenta` | `components/nav/account-menu.tsx` | `shell.nav?o=account` | Configuración y Cerrar sesión. |
| `Navegación principal` | `components/nav/primary-nav.tsx` | `shell.nav` | Los mismos cinco destinos en escritorio y móvil. |
| `Campana → Recordatorios` | `components/dashboard/home-view.tsx` | `shell.nav?o=notif`, `reminders.list` | El panel desplegable es PROPUESTA; hoy la campana navega a /recordatorios. |
| `Estados (EmptyState, ErrorState, LoadingState)` | `components/ui/states.tsx` | `states.gallery`, `shell.empty`, `shell.error` |  |
