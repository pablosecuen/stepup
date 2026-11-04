import type { Metadata } from "next";
import { PlanComparison } from "@/components/public/plan-comparison";
import { publicPricing } from "@/lib/billing/public-pricing";

export const metadata: Metadata = { title: "Planes y precios · TeacherFlow", description: "Planes de TeacherFlow para profesoras y profesores independientes. Precios totales en pesos argentinos y períodos de acceso." };

export default function PublicPlansPage() {
  return <>
    <div className="mx-auto mb-8 max-w-3xl text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-textSecondary">Todo tu trabajo docente, ordenado</p>
      <h1 className="font-display text-4xl sm:text-5xl">Elegí cómo acompañar tu crecimiento.</h1>
      <p className="mt-4 text-lg text-textSecondary">Una suscripción a TeacherFlow, con todas sus funciones. Elegí el período que te resulte más cómodo.</p>
    </div>
    <PlanComparison plans={publicPricing()} />
    <p className="mx-auto mt-7 max-w-3xl text-sm text-textSecondary">La suscripción paga el uso de TeacherFlow por parte del profesor. Los cobros que cada profesor registra por las clases de sus alumnos son independientes y no se procesan mediante esta suscripción.</p>
  </>;
}
