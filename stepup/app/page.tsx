"use client";
import CardContainer from "./components/cardContainer/card-container";
import { brands, zapatillasJordan } from "@/app/data";
import { useFilter } from "./components/hooks/useFilter";
import Filters from "./components/filters/filters";
export default function Home() {
  const { filteredZapatillas, filterByMarca } = useFilter(zapatillasJordan);

  return (
    <main className="flex  flex-col items-center pt-4 min-h-screen h-full">
      <Filters marcas={brands} handleFilterByMarca={filterByMarca} />
      <CardContainer zapatillasJordan={filteredZapatillas} />
    </main>
  );
}
