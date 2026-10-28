# Propuesta: funcionamiento sin conexión (ACC-07) — para decisión de Joaquín

Estado: **propuesta, nada implementado.** La paridad con el original en este punto **sigue abierta**: leer pantallas guardadas no equivale a trabajar sin red como la app original. No se implementa ninguna cola de operaciones (y menos financieras) sin decisión expresa.

## 1. Qué hace hoy el original sin conexión

El original es *local-first*: **toda la información vive en el dispositivo** (almacenamiento local: clases del calendario, alumnos, perfiles, registros pedagógicos, pagos y cobros, biblioteca de materiales, historial de reportes, perfil de la profesora, clase en curso, preferencias) y el respaldo a la nube es automático y posterior. Por eso **todas** sus operaciones funcionan sin red:

| Módulo | Operaciones del original que funcionan sin red |
|---|---|
| Alumnos | Alta, edición, estado, logros de nivel, plan de cobro, eliminación |
| Calendario | Crear clases y series, editar, cancelar, reprogramar, cambiar alumnos, disponibilidad |
| Registro de clase | Asistencia, evaluación, tareas, contenido, adjuntos, «Comenzar/Finalizar clase», puntualidad |
| Pagos | Registrar pago, asignar a cobros, anular, planes, montos, cobros generados |
| Reportes | Armar el reporte, copiar mensaje |
| Cuenta | Perfil, preferencias; sesión por dispositivo con **autorización guardada por hasta 24 h** |

Esto es una propiedad de la arquitectura del original, no una función suelta.

## 2. Por qué la web no puede copiarlo tal cual

La web es **autoritativa en el servidor**: cada operación es una función atómica de la base (idempotente, con permisos por fila) que garantiza que no haya cobros ni pagos duplicados, que un pago no se asigne dos veces y que el historial se conserve. Trabajar sin red obliga a decidir **qué se guarda en el navegador, cómo se reenvía y qué pasa si dos cosas chocan**. Eso es una decisión de producto con riesgo financiero, no un detalle técnico.

## 3. Propuesta por niveles (cada nivel incluye al anterior)

| Nivel | Qué cubre | Operaciones | Riesgo |
|---|---|---|---|
| **A. Lectura guardada** | Instalar como app y ver sin red lo último que se miró (Inicio, Calendario de la semana, ficha de alumno, Cobros) con un aviso «Sin conexión: mostrando lo último guardado» y **todas las acciones de escritura deshabilitadas con explicación** | Sólo lectura | Mostrar datos viejos (se mitiga con la hora de la última actualización a la vista) |
| **B. Escritura pedagógica no financiera** | Guardar sin red: asistencia, notas, contenido y tareas de un registro **ya iniciado**; «Comenzar/Finalizar clase» con la hora tomada en el momento del toque | Borradores por participante (ya idempotentes en la base) | Dos dispositivos editando el mismo registro |
| **C. Escritura financiera** | Registrar un pago sin red | Pagos | **Alto**: duplicados, cobros saldados mientras tanto |
| **D. Estructural** | Altas de alumnos, series, planes | — | **No se propone**: choca con permisos, límites del plan y reglas de la serie |

Recomendación: **A + B**. C solamente con las salvaguardas de la sección 6 y tras una prueba física. D siempre con conexión.

## 4. Cómo se guardaría (niveles B y C)

- **Bandeja de salida local** en el navegador (IndexedDB): una fila por operación con `id` único generado **en el momento del toque**, tipo, datos, hora del toque y versión del dato que se vio.
- Cada operación se reenvía **de a una, en orden**, cuando vuelve la red; sólo se borra de la bandeja cuando el servidor confirma.
- La pantalla muestra siempre «N cambios pendientes de enviar» (con texto, nunca sólo color) y un reintento manual si falla.
- Privacidad: los datos pendientes quedan en el dispositivo hasta enviarse. **En un equipo compartido eso es un riesgo** (ver decisiones, punto 2). No se escriben nombres ni importes en logs.

## 5. Cómo se resolverían los conflictos

- **Registro pedagógico:** cada guardado lleva la versión (`updated_at`) que se vio; si el registro cambió o ya se completó, **no se pisa**: queda en «Revisar» con ambas versiones a la vista. (Ya hoy `finish_live_class` no pisa un registro completado.)
- **Clase cancelada/movida/eliminada mientras tanto:** la operación pendiente se marca «no aplicable» y se explica; nada se aplica a una clase distinta.
- **Nunca «gana el último»** en dinero ni en datos de asistencia: la discrepancia la resuelve la profesora.
- Una sola sesión activa por dispositivo reduce los choques, pero **sin red no se puede comprobar** quién tiene la cuenta; el original lo resuelve con una autorización guardada de 24 h. Se propone el mismo plazo y que, al volver la red, un dispositivo desplazado **descarte su bandeja con aviso** en lugar de enviarla.

## 6. Cómo se impedirían duplicados (qué ya existe y qué faltaría)

| Operación | Protección existente | Faltaría para offline |
|---|---|---|
| Iniciar registro de clase | Índice único por clase (idempotente) | — |
| Guardar participante | `upsert` por participante | Versión esperada |
| Comenzar / finalizar clase | Idempotentes (mismo resultado al repetir) | Recibir la hora del toque en lugar de `now()` del servidor |
| Registrar pago | Columna `operation_id` única | Generar el `operation_id` en el cliente y **rechazar si el cobro ya quedó saldado o anulado** (no reasignar automáticamente a otro) |
| Generar cobro | Claves únicas por alumno/período/tipo | No se genera sin red: es bajo demanda |

Regla para C: **un pago pendiente nunca se redirige solo** a otro cobro; si el destino cambió, queda para revisión manual.

## 7. Decisiones que necesito de Joaquín

1. **Alcance:** ¿A, A+B (recomendado) o A+B+C?
2. **Datos en el equipo:** ¿se acepta guardar datos de alumnos en el navegador? ¿Hay que cifrarlos y/o vaciarlos al cerrar sesión (afecta a equipos compartidos)?
3. **Plazo sin conexión:** ¿24 h como el original?
4. **Prueba:** cualquier nivel se da por cerrado sólo tras una prueba física en modo avión (Android, iPhone instalado, escritorio).

Mientras tanto la web seguirá mostrando un mensaje claro cuando falte la red (`NETWORK_ERROR_MESSAGE`) y **no** se declara equivalente al original en este punto.
