// useFilter.tsx
"use client"
import { useState } from 'react';
import { Zapatilla } from '../cardContainer/card-container';

export const useFilter = (initialZapatillas: Zapatilla[]) => {
  const [filteredZapatillas, setFilteredZapatillas] = useState(initialZapatillas);

  const filterByMarca = (marca: string | null) => {
    if (marca === null) {
      setFilteredZapatillas(initialZapatillas); // Mostrar todos los productos
    } else {
      const filteredProducts = initialZapatillas.filter(zapatilla => zapatilla.marca === marca);
      setFilteredZapatillas(filteredProducts);
    }
  };

  return {
    filteredZapatillas,
    filterByMarca,
  };
};
