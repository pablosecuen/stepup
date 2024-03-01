// useFilter.tsx
import { useState, useEffect } from 'react';
import { Zapatilla } from '../cardContainer/card-container';

export const useFilter = (initialZapatillas: Zapatilla[]) => {
  const [filteredZapatillas, setFilteredZapatillas] = useState(initialZapatillas);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const marcaParam = params.get('marca');
    if (marcaParam) {
      const filteredProducts = initialZapatillas.filter(zapatilla => zapatilla.marca.toLowerCase() === marcaParam.toLowerCase());
      setFilteredZapatillas(filteredProducts);
    } else {
      setFilteredZapatillas(initialZapatillas);
    }
  }, [initialZapatillas]);

  return {
    filteredZapatillas,
    filterByMarca: (marca: string | null) => {
      if (marca === null) {
        setFilteredZapatillas(initialZapatillas); 
      } else {
        const filteredProducts = initialZapatillas.filter(zapatilla => zapatilla.marca.toLowerCase() === marca.toLowerCase());
        setFilteredZapatillas(filteredProducts);
      }
      // Actualizar la URL con el parámetro de marca
      const newUrl = marca ? `?marca=${marca.toLowerCase()}` : '/';
      window.history.pushState({}, '', newUrl);
    }
  };
};
