# Preparación pública para Rebill — 4/11/2026

## Confirmado por el titular

- Matías Ezequiel Metrailler, CUIT 20-39093458-1.
- Precios v2 aprobados: $25.900 por mes; trimestral $23.300 por mes ($69.900 por 3 meses); semestral $21.900 por mes ($131.400 por 6 meses); anual $19.900 por mes ($238.800 por 12 meses).
- Anual destacado: «12 meses por menos de lo que cuestan 10». Ahorra $72.000 respecto de doce pagos mensuales ($310.800). Trimestral y semestral ahorran $7.800 y $24.000, respectivamente. Porcentajes redondeados: 10 %, 15 % y 23 %.
- Precio mensual comparable en grande y total real del período inmediatamente debajo. Sin referencia por día. Cuatro tarjetas simultáneas y funciones comunes en un único bloque.

## Páginas públicas preparadas para publicación

- `/planes`, pública, cuatro tarjetas comparables y mismos precios que el catálogo servidor.
- `/terminos-y-condiciones`, `/politica-de-privacidad` y `/contacto`, con plantilla común, identificación del titular y enlaces en el pie.
- Correo y domicilio en una única configuración, `lib/business/public-profile.ts`. Las páginas legales y sus enlaces quedan habilitados con el contacto corregido. La bandera de revisión de la integración de pagos no se cambia.
- Las páginas dicen que la contratación está en preparación. No se incorpora un checkout ficticio ni se activa la integración anterior de Mobbex.

## Contacto corregido

La captura aportada por el titular confirma `techflowapk@gmail.com`, sin la «a» de la primera transcripción. Se utiliza el domicilio declarado en el alta de Rebill: Pellegrini 3603, Rosario, Santa Fe, Argentina. `contactConfirmed` queda `true`.

## Documentación y activación externas

- Comprobante de domicilio a nombre del titular con antigüedad no mayor a tres meses, conforme al pedido de Rebill.
- Constancia de CVU con nombre del titular y CUIT.
- Enviar comprobantes y enlaces publicados como respuesta al hilo original y solicitar continuar la revisión, cuyo plazo original venció el 28/10/2026.
- Completar aprobación de Rebill e integración/ensayo de suscripciones, avisos de pago, cancelación, reintentos y conciliación antes de habilitar cobros reales. La implementación previa es para Mobbex y no se considera una integración Rebill.

## Referencias utilizadas para preparar los textos

- Información clara y condiciones de contratación: https://www.argentina.gob.ar/normativa/nacional/ley-24240-638/actualizacion
- Derechos sobre datos personales: https://www.argentina.gob.ar/aaip/datospersonales/derechos
- Protección de datos: https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion
- Baja y arrepentimiento: https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-3-2026-423007/texto

Los textos preparados no constituyen una certificación de cumplimiento ni de aprobación de Rebill. La página Contacto utiliza enlaces de correo; tocar uno no se presenta como una baja o devolución ejecutada.

## Catálogo v2 y verificación

Migración `20261104120000_public_pricing_v2.sql`: agrega únicamente cuatro planes. Ensayo previo y aplicación remota completados; consulta posterior de sólo lectura confirma los importes v2 y la conservación de los cuatro v1. No se modifican cargos, pagos ni suscripciones. Las versiones anteriores continúan siendo reconocidas para historial y conciliación, pero no se permiten nuevas compras ni cambios hacia precios retirados. Se puede mantener un plan histórico existente.

Pruebas: 5293/5293, lint y build correctos. La facturación real sigue sin activarse; no se crea ninguna suscripción en Mobbex ni Rebill con esta publicación.
