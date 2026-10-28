# Trabajo para Claude: alumnos, cobros y reportes

Continuá la migración funcional de TeacherFlow original a web, conservando la estética actual de la web. Tu bloque es ALUMNOS, COBROS DEL ALUMNO y COMPARTIR REPORTES. Codex se ocupa de autenticación/dos sesiones, calendario, clase en vivo y registro. No modifiques esas áreas compartidas sin señalar primero una dependencia concreta.

## Base y fuentes

- Partí del commit `7dde04b518833ee937b9abfaf2eacad9517d7cf4`, rama remota `parity-codex`, repositorio `pablosecuen/stepup` (web dentro de `stepup/`). Creá tu propia rama/worktree desde ese commit; no uses una rama vieja de la portada ni descartes cambios ajenos.
- Worktree de Codex: `C:\Users\joaqu\OneDrive\Documentos\techflow\TeacherFlow_web_completion`.
- Original de sólo lectura: `C:\Users\joaqu\Downloads\aca va tdo\TeacherFlow_NuevaClase\TeacherFlow`.
- Leé `stepup/docs/AUDITORIA_FUNCIONAL_20261028.md` y su JSON. La matriz anterior conserva estados históricos obsoletos; no vuelvas a implementar lo que ya existe.
- Compará pantallas, opciones, acciones, validaciones, datos guardados y sus consumidores reales. El nombre de un archivo no acredita paridad, y no hace falta comparar líneas ni carpetas generadas.

## Implementá este bloque completo

1. **Alta y edición del alumno (ALU-04/05).** Replicá los campos funcionales que faltan del original: edad, objetivos académicos, días/horario habituales y la configuración de planes en el alta. Revisá captura, validación, persistencia, reapertura y ficha; no agregues campos decorativos que no se guarden. Conservá los valores existentes y la interpretación estricta de importes y centavos. Los cambios de plan y monto posteriores siguen su circuito específico, no se cuelan por Editar alumno.
2. **Situación mensual inicial y corrección (PAG-05/ALU-16).** Portá las opciones de este mes pago/pendiente, fecha real, declaración y corrección, contrastando `initialMonthlyBillingService` y sus reglas. No inventes un ingreso bancario a partir de una declaración. Una corrección no borra pagos ni cobros históricos, no duplica mensualidades y no cambia acuerdos de entrenamiento.
3. **Reactivación (ALU-09).** Recuperá la decisión de retomar cobro desde este mes o el próximo, con su fecha efectiva y reglas del original. No restaures series antiguas automáticamente ni generes deuda dos veces.
4. **Historial individual de pagos (PAG-07).** En Cobros del alumno, agregá los últimos 12 meses, puntaje/categoría, historial insuficiente, obligaciones en término/fuera de término, deuda actual y racha. Usá las reglas reales del original (`studentPaymentHistory`, `paymentStats` y `PaymentHistorySection`), con categorías en texto y datos propios de ese alumno. El gráfico agregado de todos los alumnos no sustituye este apartado. No actives recargos automáticos.
5. **Acciones desde la lista (ALU-03).** Ofrecé los accesos funcionales del original a registrar clase/pago, reprogramar, perfil, reporte, editar y cambios de estado, reutilizando los circuitos actuales. No es obligatorio imitar el gesto nativo de deslizar: sí permitir la acción conservando el contexto y sin tocar al alumno equivocado. Si necesitás un enlace nuevo hacia un circuito de Codex, hacelo mediante una integración pequeña y documentada.
6. **Compartir reportes (REP-03).** Compartir el PDF real mediante el selector del sistema si el navegador lo admite, copiar mensaje y flujo de WhatsApp como el original. Incorporá alternativas claras de descarga/copia cuando no haya soporte. Conservá archivo privado y aislamiento entre alumnos: no publiques URL firmadas duraderas ni envíes nada a contactos reales durante QA.

## Límites y coordinación

- No toques autenticación ni `active_sessions`/`web_device_sessions`: Codex ya publicó dos dispositivos web simultáneos, separados del permiso de respaldo móvil.
- No restaures Planificado/Visto, no cambies las calificaciones accesibles ni las escalas aprobadas del calendario. No modifiques la portada.
- No implementes eliminación definitiva en cascada (ALU-10): sigue pendiente por su efecto sobre el historial financiero. No habilites reparaciones destructivas automáticas.
- Las operaciones financieras deben ser atómicas, idempotentes y aisladas por cuenta. Probá concurrencia y error intermedio cuando corresponda. No edites migraciones ya aplicadas; elegí identificadores nuevos sin colisionar con `20261030130000_two_web_devices.sql`.
- Trabajá con QA/sintéticos. No cobres, anules, reasignes ni repares datos de Lara para probar. No pidas contraseñas ni cierres la sesión abierta de QA. Si no hay sesión, seguí con el trabajo independiente y marcá la prueba autenticada pendiente.
- No despliegues tu rama sobre producción ni reemplaces el trabajo de Codex. Entregá commits listos para integrar; Codex hará la integración y publicación conjunta del siguiente bloque. No force push.

## Verificación y entrega

Comprobá cada circuito modificado con guardar → salir → reabrir → editar → guardar; en finanzas, saldo real, pagos preexistentes, reintento, cambio de mes/año y separación de clase/entrenamiento/acuerdo. Para cambios SQL usá Postgres aislado y permisos entre cuentas. Revisá los componentes reales a 375/390/430 px y escritorio; no des por probado iPhone/Safari físico por achicar una ventana.

Al cerrar el bloque, corré tipos, lint, pruebas pertinentes y build; una suite final integrada, sin repetirla por cada texto. Actualizá sólo tus filas de la auditoría con evidencia concreta. Entregá resumen de diferencias resueltas, archivos/commits, migraciones nuevas sin aplicar y pruebas que realmente hiciste. No declares completa la migración ni conviertas la cantidad de pruebas copiadas del original en evidencia de la interfaz.
