"use client";
import CardContainer from "@/app/components/cardContainer/card-container";
import Filters from "@/app/components/filters/filters";
import { useFilter } from "@/app/components/hooks/useFilter";
import { brands, zapatillasJordan } from "@/app/data";
import React from "react";

const Tienda = () => {
  const { filteredZapatillas, filterByMarca } = useFilter(zapatillasJordan);
  return (
    <div className="flex  flex-col items-center pt-4 min-h-screen h-full m-20">
      <Filters marcas={brands} handleFilterByMarca={filterByMarca} />
      <CardContainer zapatillasJordan={filteredZapatillas} />
    </div>
  );
};

export default Tienda;
