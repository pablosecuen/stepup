import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_BUSINESS } from "@/lib/business/public-profile";
import { BusinessDetails } from "@/components/public/business-details";

export const metadata: Metadata = { title: "Contacto · TeacherFlow", description: "Contacto y datos del titular de TeacherFlow." };

export default function ContactPage() {
  if (!PUBLIC_BUSINESS.contactConfirmed) notFound();
  return <article className="mx-auto max-w-3xl">
    <h1 className="font-display text-4xl sm:text-5xl">Hablemos.</h1>
    <p className="mt-4 text-lg text-textSecondary">Para consultas sobre TeacherFlow, suscripciones, pagos, cancelaciones, devoluciones o tus datos personales, escribinos por correo.</p>
    <BusinessDetails />
    <h2 className="mt-8 font-display text-2xl">Cómo ayudarnos a resolver tu consulta</h2>
    <p className="mt-3 text-textSecondary">Indicá el correo de tu cuenta y el motivo. Si consultás por un pago, agregá la fecha y la referencia de la operación, si la tenés. No envíes contraseñas, códigos de acceso ni datos completos de tarjetas.</p>
    <div className="mt-6 flex flex-wrap gap-3">
      <a className="tf-motion-link inline-flex min-h-11 items-center rounded-full border border-borderStrong px-5 py-2 font-semibold" href={`mailto:${PUBLIC_BUSINESS.email}?subject=Solicitud%20de%20baja%20de%20TeacherFlow`}>Solicitar baja</a>
      <a className="tf-motion-link inline-flex min-h-11 items-center rounded-full border border-borderStrong px-5 py-2 font-semibold" href={`mailto:${PUBLIC_BUSINESS.email}?subject=Arrepentimiento%20de%20contrataci%C3%B3n%20TeacherFlow`}>Solicitar arrepentimiento</a>
    </div>
    <p className="mt-4 text-sm text-textSecondary">Estos enlaces abren un mensaje nuevo en tu servicio de correo. La solicitud se envía cuando completás y enviás el mensaje; tocar el enlace no cancela ni devuelve un pago automáticamente.</p>
  </article>;
}
