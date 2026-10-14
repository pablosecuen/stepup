import { Card } from "@/components/ui/card";

// «Cómo funciona»: las reglas de la suscripción en lenguaje simple. Es la misma información en Facturación y en Planes.
// No muestra nada del costo que cobra el servicio de pago: eso no le corresponde a quien se suscribe.

const RULES: ReadonlyArray<{ title: string; text: string }> = [
  { title: "Se renueva sola", text: "Al terminar cada período se cobra el siguiente con el mismo medio de pago, hasta que canceles." },
  { title: "Precio y duración", text: "Elegís mensual, trimestral, semestral o anual y pagás el precio completo del período. Sin período de prueba, sin costo de alta y sin cuotas." },
  { title: "Los planes largos cuestan menos por mes", text: "El ahorro frente al plan mensual se muestra en cada plan." },
  { title: "Cancelás cuando quieras", text: "Desde Facturación. Conservás el acceso completo hasta el final del período que ya pagaste y no se te vuelve a cobrar." },
  { title: "Si un cobro es rechazado", text: "Tenés 5 días corridos con acceso completo y un aviso para actualizar tu medio de pago. Si no se regulariza, tu cuenta pasa a modo limitado: podés ingresar, ver y exportar tus datos, pero no crear ni modificar información." },
  { title: "Tus datos están a salvo", text: "Un pago fallido o una cancelación nunca borran tus datos. El pago se hace en el sitio del servicio de cobro: TeacherFlow no ve ni guarda los datos de tu tarjeta." },
];

export function BillingRules({ heading = "Cómo funciona" }: { heading?: string }) {
  return (
    <Card aria-labelledby="como-funciona">
      <h2 id="como-funciona" className="font-display text-[22px] font-semibold tracking-tight text-textPrimary">
        {heading}
      </h2>
      <ul className="mt-3 grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
        {RULES.map((rule) => (
          <li key={rule.title}>
            <p className="text-[15px] font-[650] text-textPrimary">{rule.title}</p>
            <p className="mt-0.5 text-[14.5px] leading-relaxed text-textSecondary">{rule.text}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
