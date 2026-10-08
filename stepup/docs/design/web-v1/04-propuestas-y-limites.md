# 04 · Propuestas no implementadas y límites del prototipo

## 1. Qué es una «Propuesta»

En el prototipo, una pantalla o función marcada **Propuesta** no existe hoy en el producto. Se dibujó para mostrar una posible mejora, pero **no se implementa** sin una decisión de producto explícita de Joaquín. Cambiar el aspecto de lo que ya existe no la requiere; agregar una función, un dato o un flujo, sí.

## 2. Qué NO se agrega durante el rediseño (salvo decisión expresa)

- Panel nuevo de notificaciones (la campana de Inicio sigue navegando a `/recordatorios`).
- Detalle nuevo de cobro.
- Acciones nuevas en recordatorios.
- Confirmaciones o flujos que hoy no existen (p. ej. confirmar antes de finalizar un registro).
- Información adicional en Inicio que obligue a cambiar consultas o lógica (nombres e importes de cobros, «Esta semana», «Mañana»…).
- En la barra lateral: contadores (Registro, Cobros) y la tarjeta «En curso» (requieren consultas nuevas en el shell).
- En móvil: campana con contador en la barra superior y botón flotante «Nueva clase» (dependen de lo anterior y de cada pantalla).
- Barra de resumen y filtros por estado en Cobros; vista previa «así queda» al dividir una serie; errores por campo en Nuevo alumno.
- Pantalla de «Sin conexión» como ruta (hoy es un mensaje dentro del formulario).

Cuando una de estas se apruebe se implementa como cambio de producto, con sus pruebas, en un bloque propio.

## 3. Qué no pudo representarse el prototipo

### No existe en el producto (representado como propuesta)

- **Sin conexión como pantalla completa.** Hoy es un mensaje dentro del formulario («No se pudo conectar con el servidor…»). Se muestran ambos.
- **Notificaciones abiertas (panel).** La campana navega a /recordatorios. El panel desplegable y la hoja móvil son una propuesta.
- **Detalle del cobro.** No hay pantalla ni panel: el cobro se ve como tarjeta con acciones. Se propone un diálogo.
- **Confirmación antes de guardar el registro.** Hoy «Finalizar registro» guarda directo. Se propone un diálogo de resumen.
- **Errores de campo en Nuevo alumno.** Hoy los valida el servidor con un mensaje general. Se propone señalar cada campo.
- **Barra de resumen y filtros por estado en Cobros.** Se calcula con los mismos datos del Centro de cobros; hoy no se muestra.
- **Acción para resolver cada recordatorio.** Hoy son sólo texto; se propone un botón que lleve a resolverlo.
- **Vista previa «así queda» al dividir una serie.** Hoy sólo se pide la fecha y el patrón; se propone mostrar el resultado.

### No se pudo representar porque el producto no lo tiene

- **Crear respaldo desde la web.** El respaldo lo crea la app móvil y sube solo a la nube; la web sólo lo recupera e importa. Se muestra un aviso informativo, no un botón.
- **Historial de pagos como pantalla global.** Sólo existe como lista «Pagos registrados» dentro de la pestaña Cobros de cada alumno.
- **Recordatorio «completado».** El modelo sólo guarda pendientes: un recordatorio resuelto desaparece. Se muestra el estado «todo al día».
- **Reportes como sección propia.** Los reportes existen sólo en la pestaña Reportes del alumno. El diseño de la plantilla del PDF no se rediseñó.
- **Recargos por atraso.** Están desactivados por decisión de negocio: no se muestra ningún recargo ni configuración.

### Limitaciones técnicas del prototipo

- **Hover, foco y pulsado reales.** Están implementados en CSS y se pueden probar en el prototipo; en las capturas estáticas sólo se ve el foco forzado de algunos casos.
- **Cloudflare Turnstile (CAPTCHA).** Sólo se renderiza con clave de sitio; no se dibuja.
- **Atrapar el foco en diálogos y orden de tabulación.** El prototipo cierra con Escape y enfoca el diálogo, pero no replica el atrapado de foco completo del producto.
- **Modo oscuro.** No se diseñó.
- **Formularios que escriben.** Los campos son maquetas: los botones abren la pantalla, el diálogo o el aviso que representan, sin lógica de negocio.
- **PDF generado y descarga real.** Se representa el estado y el aviso de apertura; el documento PDF no se dibuja.
- **Impresión.** No se diseñó la versión impresa.
- **Calendario semanal en 320 px.** Se resuelve como agenda por día (lista), no como grilla de siete columnas.
