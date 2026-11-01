# Movimientos compartidos · 1/11/2026

Base: `cf083bb`, último ordenamiento de Cobros por alumno. Este bloque no cambia registros, acuerdos, cálculos, pagos ni datos de la cuenta. La corrección de separación de entrenamientos sigue asignada a Claude.

- Botones compartidos, controles privados y botones/enlaces de la landing: relleno desde abajo (280 ms), respuesta al foco y al toque, elevación de 2 px sólo con puntero fino. Conserva variantes, colores de alerta, tamaño, estado deshabilitado y geometría. Movimiento reducido elimina la transición y la elevación.
- `AnimatedNumber`: conteo decorativo de 900 ms con desaceleración; conserva valor accesible final y reserva su ancho. Usa los formateadores únicos. Al finalizar entrega el importe exacto, incluidos centavos. Se cancela al salir o cambiar de dato; el HTML ya visible antes de hidratar no vuelve a cero. No se usa en tarifas/cargos de las listas ni en campos de entrada.
- Cifras del período, distribución sugerida y totales de ahorro usan ese componente. Barras: 800 ms más un escalonado máximo de 160 ms. Donas: 900 ms más un máximo de 90 ms. Cambiar Barras/Torta no reinicia las cifras ni la entrada de datos. Tampoco se agrega un tiempo mínimo al esqueleto.
- `ListCascade`: filas visibles de Alumnos (tabla y tarjetas) y Cobros por alumno; desplazamiento de 8 px/320 ms con 40 ms entre filas y retraso máximo de 240 ms. Al hacer scroll entran las filas nuevas; buscar, ordenar y desplegar no vuelven a animar toda la lista. No remonta filas ni bloquea eventos.

## Comprobación visual

Laboratorio temporal con componentes reales de gráficos, distribución, botones y Cobros por alumno, datos sintéticos. Retirado antes de compilar/publicar. Escritorio y anchos de 375, 390 y 430 px; en la emulación de 375 el navegador informó 376 px. Se conservaron cifras finales y no hubo desborde de página en esos anchos. La lista mantuvo búsqueda inmediata y su estructura de columnas.

Se observó un fallo real del ensayo estricto de efectos de React: cancelaba la primera entrada y la daba por ejecutada. Corregido para permitir el segundo montaje de prueba sin repetir una animación completada.

Muestras del contador real: 6.658.248,41 → 11.148.489,25 → 12.954.942,53 → 14.000.181,33 → 14.475.265,13 → 14.518.950,50. El texto accesible permaneció en 14.518.950,50. El botón activo mostró relleno 100% y elevación -2 px; las otras variantes conservaron su estado normal. Cambiar a torta no reinició el contador.

Evidencia fuera del repositorio: `output/movimientos-20261101/` (capturas, muestras y demostración como secuencia de capturas con intervalos reales, no video continuo de 60 fps).

No probado en iPhone/Safari físicos. Movimiento reducido revisado en el código y sus salidas accesibles; no se cambió la preferencia del sistema del usuario. La sesión privada del panel indica dispositivo reemplazado; no se reemplazó ni cerró ninguna sesión y no se usaron datos reales.

Controles locales: suite completa 5255/5255, lint completo sin errores y build de producción correcto. Las pruebas estructurales existentes se adaptaron al componente numérico compartido y a los atributos de cascada; se conservaron las comprobaciones financieras, de aislamiento y de navegación.
