import React from "react";
import SneakersCard from "../card/sneakers-card";
import { StaticImageData } from "next/image";
import { useAutoAnimate } from "@formkit/auto-animate/react";

export interface Zapatilla {
  img: StaticImageData;
  marca: string;
  modelo: string;
  color: string;
  precio: number;
  talles: any;
}

interface CardContainerProps {
  zapatillasJordan: Zapatilla[];
}

const CardContainer = ({ zapatillasJordan }: CardContainerProps) => {
  const [animationParent] = useAutoAnimate();
  return (
    <ul className="flex flex-col gap-4 py-4" ref={animationParent}>
      {zapatillasJordan.map((zapatilla: Zapatilla, index: number) => (
        <SneakersCard
          // Asegúrate de agregar la clave única para cada iteración
          key={index}
          img={zapatilla.img}
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