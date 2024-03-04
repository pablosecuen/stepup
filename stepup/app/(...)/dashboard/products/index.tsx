"use client";
import React from "react";
import { ZapatillaJordan, zapatillasJordan } from "@/app/data";
import { useAutoAnimate } from "@formkit/auto-animate/react";

interface ProductProps {
  filteredProducts: ZapatillaJordan[];
  handleSearchInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const Products = ({ filteredProducts, handleSearchInputChange }: ProductProps) => {

  return (
    <div className="w-full   h-full p-10">
      <h3 className="text-2xl">Products</h3>
      <input type="text" placeholder="Search products" onChange={handleSearchInputChange} />
      <table className="table-auto w-full rounded-xl">
        <thead className="rounded-xl">
          <tr className="rounded-xl b">
            <th className="px-4 py-2 order-2">ID</th>
            <th className="px-4 py-2 order-2">Marca</th>
            <th className="px-4 py-2 order-2">Modelo</th>
            <th className="px-4 py-2 order-2">Color</th>
            <th className="px-4 py-2 order-2">Precio</th>
            <th className="px-4 py-2 order-2">Talles</th>
          </tr>
        </thead>
        <tbody className="rounded-xl">
          {filteredProducts.map((zapatilla: ZapatillaJordan) => (
            <tr key={zapatilla.id} className="rounded-xl">
              <td className="border-2 px-4 py-2 ">{zapatilla.id}</td>
              <td className="border-2 px-4 py-2">{zapatilla.marca}</td>
              <td className="border-2 px-4 py-2">{zapatilla.modelo}</td>
              <td className="border-2 px-4 py-2">{zapatilla.color}</td>
              <td className="border-2 px-4 py-2">${zapatilla.precio}</td>
              <td className="border-2 px-4 py-2">
                <ul>
                  {zapatilla.talles.map((talle: { [key: string]: number }) =>
                    Object.entries(talle).map(([numero, stock]: [string, number]) => {
                      // Solo mostrar el talle si hay stock disponible
                      if (stock > 0) {
                        return (
                          <li key={numero}>
                            {numero} - {stock}
                          </li>
                        );
                      }
                      return null; // No mostrar el talle si no hay stock disponible
                    })
                  )}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Products;
