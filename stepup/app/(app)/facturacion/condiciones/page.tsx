import { notFound } from "next/navigation";
import { BackLink, PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SupportCard } from "@/components/billing/support-card";
import { loadLegalPageData } from "@/lib/billing/page-data";
import { LEGAL_DRAFT_NOTICE, LEGAL_SECTIONS } from "@/lib/billing/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Condiciones de la suscripción · TeacherFlow" };

// Con la facturación apagada esta ruta NO EXISTE (404). Mientras BILLING_LEGAL_REVIEWED no sea «true» muestra el aviso de borrador.
export default function CondicionesPage() {
  const data = loadLegalPageData();
  if (!data) notFound();

  return (
    <div className={PAGE_WIDTH.medium}>
      <div className="mb-3">
        <BackLink href="/facturacion">Facturación</BackLink>
      </div>
      <PageHeader title="Condiciones de la suscripción" subtitle="Cómo se renueva, se cancela y se protege tu pago." />
      <div className="mt-7 flex flex-col gap-5">
        {!data.reviewed && (
          <Notice tone="warn" title="Texto en revisión">
            {LEGAL_DRAFT_NOTICE}
          </Notice>
        )}
        <Card>
          <div className="flex flex-col gap-6">
            {LEGAL_SECTIONS.map((section) => (
              <section key={section.id} aria-labelledby={`legal-${section.id}`}>
                <h2 id={`legal-${section.id}`} className="font-display text-[20px] font-semibold tracking-tight text-textPrimary">
                  {section.title}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-textSecondary">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>
        </Card>
        <SupportCard support={data.support} />
      </div>
    </div>
  );
}
