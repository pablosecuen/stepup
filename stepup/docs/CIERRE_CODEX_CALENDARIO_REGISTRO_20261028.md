# Cierre del bloque Codex — calendario, clase en vivo y registro

Fecha: 28/10/2026. Código base del bloque: d8c25a0; mejora de rendimiento y evidencia en 78e0271. Proyecto existente teacherflow-web; dominio teacherflowapp.com. La app original no se modificó.

## Entregado

- Dos sesiones web simultáneas (publicadas anteriormente en 7dde04b).
- Preferencia persistente de seguimiento en vivo y validación del servidor; avisos globales y aviso de sesión recuperada.
- Ajustar horario de una clase con dirección, minutos y motivo; conserva duración y el inicio programado para la puntualidad.
- Selector mensual y horarios de 15 minutos con ocupación y disponibilidad reales; ampliación de duración por pulsación prolongada o botón.
- Confirmación explícita para agendar en bloqueos. Reprogramación y reemplazo con avisos por alumno, transacción y clave de reintento.
- Conversión Clase/Entrenamiento con acuerdo y cargo inicial coordinados; corte de serie y control de versión. Las clases anteriores, cobros y pagos se conservan. La confirmación se vincula a la vista previa: si cambian cuota, fecha, participantes o versión, debe revisarse de nuevo. El reemplazo también exige confirmar el mismo conjunto de clases.
- Alta de alumno integrada en participantes, sin pestaña nueva.
- Corrección de inicio, fin y puntualidad de registros guardados desde Clases, sin escritura financiera.
- Protección al abandonar cambios sin guardar; mostrar/ocultar áreas sin borrar las notas; fechas de tareas desde próximas clases reales.
- Flags de facturación conservados y cobertura explícita por acuerdo para entrenamientos sueltos convertidos.

## Correcciones de la auditoría anterior

REG-13: el original usa «Revisá estos datos» como aviso de validación, no como paso de confirmación previo al guardado. Se preserva guardar directamente y el aviso de errores de la web.

REG-04: consumeMonthlyPackage se guarda en el original, pero no tiene consumidor financiero fuera de formulario/almacenamiento/pruebas. No se implementó un motor automático inexistente en la interfaz original.

## Verificación automática

- 5076/5076 pruebas, tipos, lint y build correctos.
- 34 comprobaciones en Postgres local aislado: control de cuenta, RLS, actualización concurrente, reintentos, dos operaciones concurrentes, fallos con reversión, conversión suelta/de serie, avisos y preservación financiera.
- Migraciones 20261031100000 y 20261031110000 aplicadas antes de publicar.
- Reprogramación: el origen libera su espacio; el destino sigue ocupado. Una serie creada no choca consigo misma al reintentar.
- Rendimiento del calendario: reutilización acotada de los formateadores de zona y hora, sin modificar conversiones ni reglas de disponibilidad; resultados cubiertos por la suite original y la web.

## Verificado con sesión autenticada en producción

Cuenta de QA matias; no se usaron datos de la cuenta real.

1. Seguimiento en vivo: desactivar, recargar, confirmar persistencia y restaurar activado.
2. Crear QA Paridad Codex desde jueves 29/10 08:00: selector visual, ampliar 60 a 75 minutos y elegir 09:15 dentro del bloqueo «Trabajo». Guardar sin consentimiento se rechazó; con consentimiento se creó.
3. Ajustar a 09:30: se pidió de nuevo consentimiento del bloqueo; al recargar persistió 09:30 y 75 minutos.
4. Convertir esa clase a Entrenamiento: vista previa con cuota de $2.000 y primer mes completo; confirmar, recargar y comprobar Entrenamiento.
5. Crear QA Paridad Inline dentro de participantes ($1.000 por clase); guardar y reabrir confirmó QA Uno Prueba y QA Paridad Inline. Una selección accidental durante la carga fue quitada antes de guardar.
6. Reprogramar a 29/10 20:30: aviso del choque con QA Tres Prueba, confirmar «Eliminar y reemplazar». Se conservó el origen reprogramado, apareció el destino y la clase sustituida quedó cancelada.
7. Ficha de QA Tres: aviso con fecha y «Entendido, ya avisé»; captura aviso-reemplazo-produccion.png y confirmación del aviso.
8. Clases de QA Tres: corrección de 12:00–13:00 a 12:01–13:01 y puntualidad A horario; recargar y reabrir devolvió los horarios corregidos.
9. Registro: mostrar/ocultar Habla, flags y selector de próximas clases presentes. El borrador de la prueba de salida no se guardó.

## Datos de QA conservados

Un alumno QA Paridad Inline; una clase QA Paridad Codex convertida y reprogramada, su acuerdo/cargo de prueba; cancelación de una ocurrencia QA Tres y aviso confirmado; corrección horaria de un registro QA Tres. No se registró dinero real ni se tocaron los alumnos de Lara.

## Límites de evidencia

La comprobación del aviso nativo de salida encontró una limitación del panel: al abrir la confirmación se bloquearon los clics automatizados. Se solicitó cancelar el aviso sin cerrar la sesión. La cuenta sigue autenticada. Esto no acredita el cierre/recarga en todos los navegadores.

El ciclo global de clase en vivo, el corte de serie al convertir y los errores/reintentos están cubiertos por pruebas de código y base; no se atribuye a esta ronda un recorrido visual de todas sus variantes. La prueba física de iPhone anclado/Mac Safari sigue separada. El bloque entregado a Claude y los pendientes fuera de este reparto no se declaran terminados.

## Publicación final

Commit de código edd7cc7, despliegue dpl_HhqWrWAjojQ6sAwQdwKLtgir2Phs, READY. teacherflowapp.com está asignado a teacherflow-oevesa2k9-teacherflow.vercel.app. Última verificación: 5076/5076 pruebas, tipos/lint/build correctos; base remota al día. El tamaño temporal del navegador se restauró y se conservan las pestañas autenticadas de QA. El aviso nativo de la prueba de salida sigue pendiente de cancelación por la persona; no se cerró sesión ni se guardó ese texto de prueba.
