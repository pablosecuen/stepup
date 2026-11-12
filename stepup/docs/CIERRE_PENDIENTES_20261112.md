# Cierre de pendientes (12/11/2026, tercera entrega)

Complementa `CIERRE_PENDIENTES_20261111.md`. Todo lo que dice «QA» se hizo con la cuenta de pruebas (alumnos «QA …»), nunca con la cuenta real.

## 1. Cuotas y pagos (QA, con persistencia)

| Prueba | Resultado |
|---|---|
| Monto mensual «este mes» ($ 1.500 → $ 2.500) | La pantalla muestra «$ 2.500 por mes» y el cargo de noviembre en $ 2.500; la base guarda `plan.amount = 2500` y el cargo `2026-11 = 2500` (octubre sigue en 1500). |
| Monto «desde el próximo mes» ($ 3.000) | «Desde 12/2026: $ 3.000 por mes»; la base guarda `pendingAmount = 3000` desde `2026-12`. |
| Guardar → salir → reabrir | Ambos resultados siguen iguales tras ir a Inicio y volver. |
| Editar la cuota de UN entrenamiento desde Cobros › Por alumno | El diálogo se abre en la misma pantalla (URL, conceptos desplegados y posición no cambian); la base guardó `pending_monthly_fee = 2200` desde `2026-12` SÓLO en ese acuerdo (el otro acuerdo, intacto). Al reabrir dice «Ya programada: $ 2.200 desde 12/2026». |
| Cancelar el diálogo | Conserva la URL, el concepto desplegado y la posición. |
| Un alumno con clases individuales y DOS entrenamientos | «Clases $ 40.600», «Entrenamiento · QA Paridad Codex $ 2.000», «Entrenamiento · QA Prueba Entrenamiento B $ 3.000»; total $ 45.600 = suma exacta; cada concepto con su propia fecha de último pago. |
| Pago parcial | $ 10.000 de una clase de $ 36.000 → «Pendiente $ 26.000, ya pagó $ 10.000»; $ 1.000 de una cuota de $ 3.000 → «Pendiente $ 2.000», sin tocar los otros conceptos. |
| Importe menor a lo ya pagado | «Ya se asignó un pago a este período: el nuevo importe no puede ser menor a lo ya pagado…» (rechazado, nada cambió). |
| Doble clic en «Confirmar pago» y en «Confirmar» de la cuota | Un único pago / un único acuerdo y un único cargo (comprobado en la base). |
| Integridad | Consulta de la base: ningún pago cuyo importe difiera de lo asignado. |

### Defecto encontrado y corregido: el segundo pago del mismo cobro se perdía en silencio

Con un cobro de $ 2.500 se registró $ 1.000 y después los $ 1.500 restantes: la pantalla cerró el diálogo **sin error**, pero no se creó ningún pago (reproducido tres veces; la base sólo tenía el primero).

**Causa:** `useDraftOperationId` borraba la clave de operación del almacenamiento (`clear`) pero el componente —que sigue montado después de `router.refresh()`— conservaba la clave vieja en su estado. El servidor tomaba el segundo envío por un reintento del primero, devolvía el pago anterior como «éxito» y no escribía nada.
**Arreglo:** `charge-actions.tsx` y `training-billing-config.tsx` usan `rotate` (clave nueva tras una respuesta exitosa; ante un error se conserva la misma para el reintento). Prueba: `lib/payments/__tests__/operation-key-rotation.test.ts`.
**Pendiente de verificar publicado:** el pago de los $ 1.500 restantes y la validación «mes ya pagado» (ver el informe final).

## 2. Horas enseñadas del mes

Inicio y Resumen financiero tenían **dos reglas distintas** que sólo coincidían cuando ambos daban cero:

| | Inicio | Resumen financiero |
|---|---|---|
| Qué es «dictada» | `counts_as_class` | resultado `clase_dictada` (o feriado con excepción) |
| Mes de la clase | inicio real, si no el programado | programado, si no el real |
| Duración | real guardada → inicio/fin reales → inicio/fin programados | real guardada → inicio/fin reales → duración programada |
| Alumnos de prueba excluidos | no | sí |
| Cómo se muestra | 1 decimal | horas **enteras** |

Con las mismas clases (45 + 60 min) se vio **«1,8 h» en Inicio y «2 h» en el Resumen**.

**Ahora** las dos salen de `heldMinutesInRange` / `lessonMinutesOrNull` (`lib/reports/registered-lessons.ts`): mismo filtro de clase dictada, mismo día civil de Argentina, misma duración (real → inicio/fin reales → programada; una duración 0 no cuenta como dato; sin ninguna es «sin dato», nunca 0), alumnos de prueba excluidos en ambas, un registro por clase (una grupal no se multiplica por alumno) y el mismo formateador (`formatHours`, 1 decimal). Si Inicio no puede leer los datos muestra «Sin datos», no 0.

**Comprobación independiente (QA, noviembre 2026):** se registraron por la pantalla una clase individual de 45 min (3/11), una grupal de 2 alumnos de 60 min (6/11, una sola clase) y un «alumno ausente sin aviso» (5/11, no cuenta). Consulta SQL independiente sobre `lesson_registrations` (resultado `clase_dictada`, mes civil de Argentina, minutos entre inicio y fin reales): **2 clases, 105 min = 1,75 h → «1,8 h»**. Con el cálculo por participante habría dado 165 min (2,75 h). Antes de publicar: Inicio «1,8 h», Resumen «2 h».

Pruebas: `lib/dashboard/__tests__/home-stats.test.ts` (fuentes de duración, mes civil, grupal, no dictadas, reprogramada, alumnos de prueba, notas, igualdad Inicio = Resumen).

## 3. Calendario móvil

* **Matriz de nombres** (`matriz-nombres.mjs`, 68 / 71 / 79 px = 375 / 390 / 430): clases sueltas y consecutivas salen con palabras completas; no cambió el planificador. Siguen sin caber (sin iniciales ni nombres accesibles como solución): simultáneas con nombres largos (necesitan ≈ 87–95 px de columna), una sola palabra de ≥ 10 letras en 5–10 min (p. ej. «Maximiliano») y «Guadalupe» en cadena a 375 px.
* **Redimensionado (defecto encontrado y corregido):** al ensanchar la ventana (375 → 430) el desplazamiento horizontal pasaba de 100 a 81 px y se quedaba ahí, porque el navegador recorta `scrollLeft` mientras las columnas todavía son angostas y ese recorte se tomaba por la posición de la usuaria. **Un primer arreglo salió mal y se corrigió el mismo día:** «ignorar el primer evento tras un `resize`» dependía del orden en que el navegador despacha los eventos; en la versión publicada (commit `6e60a4a`) dejó el desplazamiento en 0 al cambiar de ancho (verificado en el panel). El criterio definitivo no depende de ese orden: sólo un desplazamiento que sigue a un gesto de la usuaria (dedo, rueda, teclado, foco, con 1,5 s de margen para la inercia) se toma como su posición, y cuando las columnas terminan de acomodarse se vuelve a ella (acotada al máximo actual). Laboratorio (Edge, componente real, **deslizamientos táctiles reales**): 375 → 430 → 390 → 375 → 430 → 390 → 375 conserva 103 px horizontal y 127 px vertical en todos los pasos (también el 375 → 430 que antes quedaba en 81), un segundo deslizamiento (130 px) sigue valiendo, y cabecera y columnas quedan alineadas.
* **QA publicado (antes del arreglo):** abrir y cerrar el detalle conserva 120/140 px y la URL; cambiar de semana (siguiente y anterior, 2 veces) deja la URL de la semana, conserva el desplazamiento vertical (la semana nueva empieza en lunes: horizontal en 0, a propósito); columnas 68,4 / 71,2 / 79,2 px a 375 / 390 / 430.
* **Demostración de la lista del grupo (NO publicada, NO sustituye la interacción actual):** página de laboratorio con la grilla real; el grupo se marca con un contorno punteado y una insignia con la cantidad; al tocarlo se abre una lista con los nombres completos (sin cortar), horario y modalidad; tocar una fila abre el detalle real de esa clase; al cerrar, la grilla queda en el mismo desplazamiento y URL. Capturas: `C:\Users\joaqu\tf-design\carga\capturas\grupos-{375,390,430}-{1-grilla,2-lista,3-detalle,4-vuelta}.png`; código: `C:\Users\joaqu\tf-design\carga\harness-backup\zz-harness\calendario\grupos\` (fuera del repositorio).

## 4. Segunda carga y «doble pantalla»

* `ChargeGenerationTrigger` llama a `router.refresh()` sólo si se crearon cargos (cambio de período o de semana, acuerdo nuevo). En QA no se pudo provocar esa condición «de verdad» (un alumno nuevo ya nace con su cargo; el cargo semanal lo generó la primera visita), así que el refresco se ejercitó a mano con `router.refresh()` en `/cobros` (390 px, datos reales): una única petición RSC; sin esqueleto, sin segunda `main`, cabecera y barra estables, posición (420 px) y alto de página intactos, ninguna animación reiniciada.
* Recorrido autenticado Inicio → Cobros (390 px): una sola vez el esqueleto (con la transición de vistas iniciada), una sola `main`, una barra inferior y la pantalla final sin cambios posteriores. Las instantáneas de la transición de vistas (4 grupos de pseudo-elementos mientras dura) son el cruce por diseño.
* No se cambió el flujo: no se demostró ningún defecto. **Falta** la grabación/ejecución en iPhone/Safari.

## 5. Lo que NO se pudo comprobar

* Cualquier prueba física (iPhone/Safari): calendario, transiciones, pantalla de autorización de dispositivo.
* La «doble pantalla» de iPhone (sin causa demostrada).
