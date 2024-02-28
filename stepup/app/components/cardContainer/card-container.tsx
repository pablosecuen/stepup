import React from "react";
import { zapatillasJordan } from "@/app/data";
import SneakersCard from "../card/sneakers-card";

const CardContainer = () => {
  return (
    <div className="flex flex-col gap-4 py-4">
      {zapatillasJordan.map((zapatilla, index) => (
        <SneakersCard
          // Asegúrate de agregar la clave única para cada iteración
          key={index}
          img={zapatilla.img}
          modelo={zapatilla.modelo}
          talles={zapatilla.talles}
          color={zapatilla.color}
          precio={zapatilla.precio}
        />
      ))}
    </div>
  );
};

export default CardContainer;
