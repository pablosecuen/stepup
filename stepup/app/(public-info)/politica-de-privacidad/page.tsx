import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_BUSINESS } from "@/lib/business/public-profile";
import { BusinessDetails } from "@/components/public/business-details";

export const metadata: Metadata = { title: "Política de Privacidad · TeacherFlow" };

export default function PrivacyPage() {
  if (!PUBLIC_BUSINESS.contactConfirmed) notFound();
  const sections = [
    ["Responsable y alcance", "El titular identificado en esta página es responsable del tratamiento de datos de las cuentas y del funcionamiento de TeacherFlow. Respecto de la información de alumnos que carga cada profesor, el profesor determina los fines de su gestión y debe contar con una base legal para ese tratamiento; TeacherFlow la procesa para prestar las funciones solicitadas. Esta política alcanza al sitio, la cuenta y el uso del servicio."],
    ["Información que tratamos", "Según las funciones utilizadas, tratamos datos de cuenta y contacto; información de alumnos y sus clases, asistencia, calificaciones, tareas y observaciones; fotografías, archivos y reportes que decidas cargar; importes y pagos que registres para tu gestión; y datos técnicos necesarios para autenticar la sesión, identificar dispositivos y resolver incidentes. No cargues datos sensibles ni información que no sea necesaria para tu actividad."],
    ["Para qué se utiliza", "Utilizamos la información para autenticarte, mantener tu cuenta, organizar los datos que cargás, prestar las funciones de agenda, registro, cobros y reportes, atender soporte y reclamos, proteger el servicio y cumplir obligaciones legales. Los datos de alumnos no se utilizan para publicidad dirigida. No vendemos los datos personales cargados en TeacherFlow."],
    ["Proveedores y pagos", "Utilizamos servicios de infraestructura de Vercel y Supabase para alojar la aplicación, autenticar cuentas, almacenar datos y archivos y sostener su operación. Cuando se habilite la contratación de suscripciones, el procesador de pago se identificará antes de pagar y recibirá los datos necesarios para gestionar esa operación conforme a su propia política. TeacherFlow no solicita que envíes tarjetas por correo. No incluiremos en una solicitud de pago los registros pedagógicos de tus alumnos."],
    ["Almacenamiento y transferencias", "La infraestructura de nuestros proveedores puede procesar o almacenar información fuera de Argentina. Las transferencias deben realizarse con las garantías y mecanismos exigidos por la normativa aplicable. Restringimos el acceso a la información conforme a la cuenta y a las funciones autorizadas; ninguna medida técnica elimina por completo los riesgos inherentes al uso de servicios digitales."],
    ["Sesiones y almacenamiento del navegador", "Utilizamos cookies y almacenamiento local para funciones como autenticación, continuidad de sesión y preferencias de la interfaz. Bloquearlos puede impedir el acceso o algunas funciones. Esta política no constituye consentimiento para incorporar rastreadores publicitarios: cualquier uso adicional que requiera autorización deberá informarse y obtenerla antes de activarse."],
    ["Conservación", "Conservamos la información mientras sea necesaria para prestar el servicio, atender pedidos y reclamos y cumplir las obligaciones legales aplicables. Al solicitar eliminar tu cuenta, puede ser necesario conservar de forma restringida los registros fiscales o de operaciones exigidos legalmente. Los respaldos se gestionan de acuerdo con su ciclo de conservación y no deben utilizarse para restablecer una cuenta eliminada sin causa legítima."],
    ["Tus derechos", "Podés solicitar acceso a tus datos, rectificación, actualización y supresión cuando corresponda, así como revocar autorizaciones en los términos legales, escribiendo al correo publicado en esta página. Podremos pedir información razonable para verificar tu identidad y proteger datos de terceros. Para pedidos relativos a datos de un alumno, contactá también al profesor que los incorporó. Las solicitudes se atienden en los plazos legalmente aplicables."],
    ["Menores de edad y reportes", "La contratación de TeacherFlow está destinada a personas mayores de edad. Los profesores pueden gestionar información de alumnos menores cuando cuenten con la autorización o base legal correspondiente. Antes de compartir fotografías, tareas o reportes deben comprobar qué información incluyen y quién puede recibirla."],
    ["Cambios y consultas", "La fecha de actualización figura al comienzo de esta política. Los cambios relevantes se comunicarán por canales de la cuenta o del sitio antes de su aplicación cuando corresponda. Podés consultar o reclamar ante el titular a través de Contacto y ante la Agencia de Acceso a la Información Pública, autoridad de control de la Ley 25.326."],
  ];
  return <article className="mx-auto max-w-3xl">
    <h1 className="font-display text-4xl sm:text-5xl">Política de Privacidad</h1>
    <p className="mt-3 text-sm text-textSecondary">Actualización: {PUBLIC_BUSINESS.updatedAt}</p>
    <BusinessDetails />
    <div className="mt-8 space-y-7">{sections.map(([title, body]) => <section key={title}><h2 className="font-display text-2xl">{title}</h2><p className="mt-3 leading-relaxed text-textSecondary">{body}</p></section>)}</div>
    <p className="mt-7"><a className="underline underline-offset-4" href="https://www.argentina.gob.ar/aaip/datospersonales/derechos">Información oficial de la AAIP sobre tus derechos</a></p>
  </article>;
}
