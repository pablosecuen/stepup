import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PUBLIC_BUSINESS } from "@/lib/business/public-profile";
import { BusinessDetails } from "@/components/public/business-details";
import { SUBSCRIPTION_TERMS } from "@/lib/business/subscription-terms";
import { isBillingPublic } from "@/lib/billing/pilot";

export const metadata: Metadata = { title: "Términos y Condiciones · TeacherFlow" };

export default function TermsPage() {
  if (!PUBLIC_BUSINESS.contactConfirmed) notFound();
  const sections = [
    ["El servicio", "TeacherFlow es una plataforma de gestión para profesoras y profesores independientes. Permite organizar alumnos, agenda y series, registrar clases, tareas y evidencias, controlar cobros y generar reportes. La suscripción paga el acceso al software. TeacherFlow no imparte las clases ni cobra a los alumnos por cuenta de los profesores: los importes registrados en la agenda y en Cobros son independientes de la suscripción."],
    ["Cuenta y uso responsable", "La cuenta debe estar a cargo de una persona mayor de edad con capacidad para contratar. Debés aportar datos correctos, proteger tus credenciales y utilizar el servicio de forma lícita. Sos responsable de contar con autorización o una base legal para cargar datos, fotografías y evidencias de tus alumnos, incluidos los permisos de sus representantes cuando corresponda. No publiques información innecesaria ni materiales que infrinjan derechos de terceros."],
    ["Planes, precios y contratación", `Los planes y sus importes totales se publican en Planes y precios, en pesos argentinos. El equivalente diario o mensual es únicamente orientativo: no implica cobros diarios ni cuotas. Cada pago corresponde al período completo elegido. ${isBillingPublic(process.env) ? SUBSCRIPTION_TERMS.contractingOpen : SUBSCRIPTION_TERMS.contractingInPreparation}`],
    ["Prueba gratuita", SUBSCRIPTION_TERMS.trial],
    ["Renovación y cambios", `Cualquier renovación automática requiere que se informe y acepte al contratar. ${SUBSCRIPTION_TERMS.withoutPayment} ${SUBSCRIPTION_TERMS.priceChange}`],
    ["Pagos", "La suscripción se abona mediante el procesador de pagos informado en el momento de contratar. No envíes datos de tarjeta por correo ni por mensajes de soporte. Los pagos de una suscripción a TeacherFlow no se aplican a los cobros que el profesor registra para sus propios alumnos. La aprobación del pago y la habilitación del período se verifican antes de confirmar el acceso contratado."],
    ["Baja, arrepentimiento y devoluciones", SUBSCRIPTION_TERMS.requests],
    ["Contenido y datos", "Conservás los derechos sobre el contenido que cargás. Autorizás su tratamiento en la medida necesaria para prestar el servicio y las funciones que solicites. Al compartir un reporte o evidencia, revisá el destinatario y el contenido. Podés pedir acceso, corrección o eliminación de datos por el canal de Contacto; se atenderá el pedido conforme a la normativa y a las obligaciones de conservación aplicables."],
    ["Disponibilidad y responsabilidad", "Trabajamos para mantener TeacherFlow disponible y proteger la información. Pueden existir interrupciones por mantenimiento o incidencias técnicas. El servicio no sustituye asesoramiento contable, fiscal, jurídico ni pedagógico. Los cálculos y proyecciones financieras son herramientas de gestión y deben revisarse antes de utilizarlos para tomar decisiones. Nada de esta cláusula excluye responsabilidades que la ley no permita excluir."],
    ["Legislación y contacto", "Estos términos se interpretan conforme a la legislación argentina, sin afectar las normas de protección al consumidor ni la competencia que resulte legalmente aplicable. Para consultas y reclamos utilizá los datos de contacto del titular publicados en esta página."],
  ];
  return <article className="mx-auto max-w-3xl">
    <h1 className="font-display text-4xl sm:text-5xl">Términos y Condiciones</h1>
    <p className="mt-3 text-sm text-textSecondary">Actualización: {PUBLIC_BUSINESS.updatedAt}</p>
    <BusinessDetails />
    <div className="mt-8 space-y-7">{sections.map(([title, body]) => <section key={title}><h2 className="font-display text-2xl">{title}</h2><p className="mt-3 leading-relaxed text-textSecondary">{body}</p></section>)}</div>
    <p className="mt-8 flex flex-wrap gap-5"><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/planes">Planes y precios</Link><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/contacto">Contacto</Link><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/politica-de-privacidad">Política de Privacidad</Link></p>
  </article>;
}
