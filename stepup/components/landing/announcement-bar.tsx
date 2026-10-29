import { TextLink } from "@/components/auth/public-links";

/**
 * Franja de anuncio de la landing: UNA sola, de borde a borde, fuera del ancho máximo. El mensaje se repite y se desplaza de forma
 * continua hacia la izquierda con CSS puro (sin JavaScript ni librerías): dos grupos idénticos y un recorrido de −50 % que no deja salto.
 * Sólo la primera copia es un enlace enfocable y legible; el resto es relleno visual (`aria-hidden`, sin tabulación). Se pausa al
 * pasar el mouse o enfocar, y con «reducir movimiento» queda un solo mensaje quieto (ver landing-natural.css).
 *
 * El destino es el flujo real: crear la cuenta. Todavía no hay cobro del plan anual configurado, así que no se simula ninguna compra.
 * Alto fijado por el encargo (34 px escritorio, 30 px móvil): es la única excepción deliberada a los 44 px de los enlaces (el aviso
 * ocupa todo el ancho de cada mensaje; ver landing-natural.css).
 */
const COPIES = 9; // cada grupo mide ≥ 2.000 px aun en móvil y ≈ 3.800 px en escritorio: cubre pantallas de hasta 3.440 px sin huecos

function Message({ ghost }: { ghost: boolean }) {
  return (
    <TextLink href="/crear-cuenta" className="tf-announce-item" {...(ghost ? { tabIndex: -1, "aria-hidden": true } : {})}>
      <strong>15 % OFF</strong>
      <span>al pagar el año completo</span>
      <b>Creá tu cuenta</b>
      <span aria-hidden="true">✦</span>
    </TextLink>
  );
}

export function AnnouncementBar() {
  return (
    <aside aria-label="Anuncio: 15 % de descuento al pagar el año completo" className="tf-announce">
      <div className="tf-announce-track">
        <div className="tf-announce-group">
          {Array.from({ length: COPIES }, (_, index) => (
            <Message key={index} ghost={index > 0} />
          ))}
        </div>
        <div className="tf-announce-group" aria-hidden="true">
          {Array.from({ length: COPIES }, (_, index) => (
            <Message key={index} ghost />
          ))}
        </div>
      </div>
    </aside>
  );
}
