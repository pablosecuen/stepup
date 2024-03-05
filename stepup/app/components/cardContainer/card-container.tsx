import React from "react";
import SneakersCard from "../card/sneakers-card";
import { StaticImageData } from "next/image";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { ZapatillaJordan } from "@/app/data";

interface CardContainerProps {
  zapatillasJordan: ZapatillaJordan[];
}

const CardContainer = ({ zapatillasJordan }: CardContainerProps) => {
  const [animationParent] = useAutoAnimate();
  return (
    <ul className="flex flex-col gap-4 md:grid sm:grid-cols-2 py-4" ref={animationParent}>
      {zapatillasJordan.map((zapatilla: ZapatillaJordan, index: number) => (
        <SneakersCard
          // Asegúrate de agregar la clave única para cada iteración
          key={index}
          img={zapatilla.imagenes[0]}
          modelo={zapatilla.modelo}
          marca={zapatilla.marca}
          talles={zapatilla.talles}
          color={zapatilla.color}
          precio={zapatilla.precio}
        />
      ))}
    </ul>
  );
};

export default CardContainer;
