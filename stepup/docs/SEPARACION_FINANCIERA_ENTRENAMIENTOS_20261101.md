# Separación financiera entre entrenamientos, series y clases sueltas (01/11/2026)

Una misma alumna puede asistir a un entrenamiento mensual y, por separado, tomar clases sueltas. Registrar una actividad no debe generar, consumir, saldar ni modificar obligaciones de la otra.

## 1. Causa comprobada (consultas de SOLO LECTURA sobre la base real)

Recorrido: actividad del calendario → serie/ocurrencia → registro → participantes → acuerdo de cobro → cargos → asignaciones de pagos → aviso de pago. Los **únicos** escritores de cargos por clase son `sync_per_class_charge`, llamado desde `syncPerClassChargesForRegistration` al finalizar, editar o cerrar un registro. El aviso de pago sólo lee cargos por clase de ESE registro. Por lo tanto «un entrenamiento tratado como clase suelta» ocurre en una sola decisión: `syncPerClassChargesForRegistration` decidía **a cada guardado** si el participante estaba «cubierto».

Auditoría (todas las cuentas, sólo conteos, sin nombres):

| Dato | Resultado |
|---|---|
| Cargos por clase vigentes sobre registros de **entrenamiento** | 4 (en 2 cuentas), de 45 cargos por clase en total |
| …con pago registrado | 2 |
| …de una serie **con acuerdo** | 1 (26/09/2026; pagado) |
| …de una **sesión suelta** sin serie ni acuerdo propio | 3 (todas de grupos de dos participantes) |
| Registros de clase común cuya serie es de entrenamiento | 0 |

La cobertura por acuerdo se incorporó el 24/10/2026 (`e0eb853`). Dos de los cuatro cargos (26/09 y 23/10) **son anteriores**: historial, no un defecto vigente. Los otros dos son del 25/10 y pertenecen a un mismo grupo: uno es legítimo (esa alumna no pertenece a ningún acuerdo) y el otro **sí es el defecto vigente** — una alumna con acuerdo y cuota del mes cuya sesión suelta no quedó cubierta.

Causas, en orden de peso:

1. **Una sesión suelta de entrenamiento no declara su acuerdo.** `calendar_lessons.training_billing_agreement_id` sólo se completa en conversiones y reprogramaciones de una clase ya con acuerdo; una sesión creada suelta lo tiene vacío y no tiene serie. La cobertura se **inferia** («único acuerdo vigente con el mismo grupo de alumnos y cuota en el mes»).
2. **La inferencia falla en silencio y el resultado es un cobro.** Con dos acuerdos para el mismo grupo (una serie terminada y la activa: es el caso de una cuenta), con un grupo distinto, o con un participante que no figura en ninguna serie (el caso del cargo vigente: tiene acuerdo y cuota del mes, pero ninguna serie lo lista), la inferencia da «ninguno» y el registro se cobra como clase suelta.
3. **La decisión no se guardaba**: se recalculaba en cada guardado, así que finalizar, editar o reintentar podía dar resultados distintos si cambiaba el estado de la serie (una serie «terminada» deja de contar en la inferencia).
4. **Una serie con acuerdo cubría a TODOS sus participantes**, aunque alguno no perteneciera a ese acuerdo.
5. **Los dos interruptores** («¿Es cobrable?», «¿Consume una clase de la cuota mensual?») eran una causa **secundaria**: `is_billable` se aplica al registro entero (a todos los participantes) y se reenviaba en cada guardado; `consumes_monthly_package` sólo se almacenaba, sin consumidor financiero. No son la causa del cobro de un entrenamiento cubierto.

## 2. Cambios

- **Formulario**: se retiran «¿Es cobrable?» y «¿Consume una clase de la cuota mensual?» (individual, grupal, entrenamiento) junto con su tarjeta. El estado del formulario **ya no envía** esos valores: el valor guardado se conserva (no se reemplaza por `true`) y las excepciones históricas (`is_billable = false`) se siguen respetando al sincronizar. Los datos no se tocan.
- **Resolvedor por participante** (`lib/payments/training-coverage.ts`, puro; `lib/repositories/training-coverage.ts`, lectura): una clase común nunca queda cubierta ni cubre; un entrenamiento queda cubierto sólo por el acuerdo que **la serie (o la propia clase) declara**, y sólo si el participante **pertenece** a ese acuerdo (integrante de una serie con ese acuerdo o con cuota de ese acuerdo); sin ningún acuerdo posible se cobra por el régimen propio; si falta la asociación queda **pendiente**: no se genera ni se retira ningún cobro y no se supone cobertura. Nunca por nombre, por título ni por «mismo alumno».
- **Decisión explícita y guardada**: tabla `lesson_registration_billing_resolutions` + RPC `resolve_registration_billing` (migración `20261101120000`, aditiva, sin tocar cargos, pagos ni asignaciones). Guardar, finalizar, editar o reintentar leen siempre la misma decisión.
- **Pantalla**: panel «Cobro de este entrenamiento» (`RegistrationBillingPanel`) con una fila por participante que cobra por clase: «Cubierto por la cuota mensual de «X»», «Se cobra como clase suelta» o «Falta indicar a qué entrenamiento pertenece» con las opciones «Es parte de «X»» y «Cobrar como clase suelta». La sugerencia por grupo sólo **preselecciona**.
- **Acción** `resolveRegistrationBillingAction`: valida que el entrenamiento elegido corresponda al alumno, guarda la decisión y, si el registro ya está finalizado, sincroniza el cobro. Un cobro por clase **con pagos** nunca se anula ni se reasigna: se avisa «no se modificó, revisalo en Cobros».
- Se conservan las políticas de cancelación y los registros históricos. No se tocó ningún componente de botones, animaciones financieras ni cascada de listas.

## 3. Reglas resultantes

| Situación | Resultado |
|---|---|
| Clase común | Régimen propio del alumno, siempre. |
| Entrenamiento de serie con acuerdo, participante integrante | Cubierto por ESE acuerdo y período; sin cobro por clase ni aviso de pago. |
| Entrenamiento, participante sin acuerdo alguno | Régimen propio (no hay otra obligación). |
| Entrenamiento sin acuerdo declarado, o participante fuera del acuerdo de la serie, con acuerdos posibles | **Pendiente**: sin cobro hasta que se resuelva. |
| Dos entrenamientos de la misma alumna | Cada sesión usa SU acuerdo. |
| Grupo | Cada participante por su acuerdo; el plan de uno no se aplica a otro. |
| Decisión guardada | Manda sobre todo y no cambia al editar. |

## 4. Reparación de datos reales (PENDIENTE — no se ejecutó nada)

La auditoría encontró 4 cargos por clase sobre registros de entrenamiento (2 con pago). **Ninguno se modificó.** Con el código nuevo, las sesiones sueltas con participantes que pertenecen a algún acuerdo aparecerán como «pendientes de asociar» al abrirlas; resolverlas con «Es parte de …» **no anula** un cobro con pagos (avisa que lo revise) y retira uno sin pagos sólo cuando la profesora lo confirma. El cargo pagado de la serie del 26/09 y el pagado del 23/10 quedan como historial: devolución o reasignación de un pago es una decisión de la profesora, nunca automática.

## 5. Pruebas

- Unitarias: `session-billing-separation.test.ts`, `training-vs-individual-billing.test.ts` (ejecuta el cuerpo REAL de la sincronización), `registration-charge-and-training-coverage.test.ts`, `registration-outcome-charge-parity.test.ts`.
- Postgres real: `supabase/tests/postgres/registration_billing_resolutions.cjs` (33 comprobaciones: privilegios, validaciones, idempotencia, que guardar/finalizar/editar/reintentar no duplica cargos y que un cargo con pagos no se anula ni se reasigna).
- Pendiente de comprobar en el navegador con la cuenta de QA: ver el informe de la sesión.
