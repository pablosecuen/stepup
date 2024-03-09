"use client";
import React, { useEffect, useState } from "react";
import { ZapatillaJordan } from "@/app/data";
import AddProduct from "./add-product";
import { useProducts } from "@/app/providers/ProductsContextProvider";
import { ClipLoader } from "react-spinners";

const Products = () => {
  const { updateProductStatus, productsData, isLoading, loadingStates } = useProducts();
  const [filteredProducts, setFilteredProducts] = useState<ZapatillaJordan[] | undefined>(
    productsData
  );

  const handleToggleChange = async (productId: string, newStatus: boolean) => {
    updateProductStatus(productId, newStatus);
  };

  useEffect(() => {
    setFilteredProducts(productsData);
  }, [productsData]);

  const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const searchTerm = event.target.value.toLowerCase();

    const filtered = productsData?.filter((product: ZapatillaJordan) => {
      return (
        product.marca.toLowerCase().includes(searchTerm) ||
        product.modelo.toLowerCase().includes(searchTerm) ||
        product.color.toLowerCase().includes(searchTerm)
      );
    });

    if (filtered) {
      filtered.sort((a, b) => a.modelo.localeCompare(b.modelo));
    }

    setFilteredProducts(filtered);
  };

  return (
    <div className="w-full   h-full p-10 animate-fadeIn">
      <h3 className="text-2xl">Products</h3>
      <div className="flex justify-between">
        {" "}
        <input type="text" placeholder="Search products" onChange={handleSearchInputChange} />
        <AddProduct />
      </div>

      <table className="table-auto w-full rounded-xl">
        <thead className="rounded-xl">
          <tr className="rounded-xl b">
            <th className="px-4 py-2 order-2">Modelo</th>
            <th className="px-4 py-2 order-2">Marca</th>
            <th className="px-4 py-2 order-2">Color</th>
            <th className="px-4 py-2 order-2">ID</th>
            <th className="px-4 py-2 order-2">Talles</th>
            <th className="px-4 py-2 order-2">Precio</th>
            <th className="px-4 py-2 order-2">Status</th>
          </tr>
        </thead>
        <tbody className="rounded-xl">
          {filteredProducts?.map((zapatilla: ZapatillaJordan) => (
            <tr key={zapatilla.id} className="rounded-xl">
              <td className="border-2 px-4 py-2 text-lg whitespace-nowrap">{zapatilla.modelo}</td>
              <td className="border-2 px-4 py-2 text-lg ">{zapatilla.marca}</td>
              <td className="border-2 px-4 py-2 text-lg ">{zapatilla.color}</td>
              <td className="border-2 px-4 py-2 text-xs">{zapatilla.id}</td>

              <td className="border-2 px-4 py-2 text-xs">
                <ul className=" flex flex-wrap gap-1">
                  {zapatilla.talles.map((talle: { [key: string]: number }) =>
                    Object.entries(talle).map(([numero, stock]: [string, number]) => {
                      if (stock > 0) {
                        return (
                          <li key={numero} className="border px-2 py-1">
                            talle: {numero} /stock: {stock}
                          </li>
                        );
                      }
                      return null;
                    })
                  )}
                </ul>
              </td>
              <td className="border-2 px-4 py-2 text-lg ">${zapatilla.precio}</td>
              <td className="border-2 px-4 py-2">
                {loadingStates[zapatilla.id] ? (
                  <div className="flex items-center justify-center mx-auto">
                    {" "}
                    <ClipLoader color={"#123abc"} loading={true} size={25} />
                  </div>
                ) : (
                  <label className="inline-flex  cursor-pointer flex-col justify-center items-center  pt-1">
                    <input
                      type="checkbox"
                      value=""
                      className="sr-only peer "
                      checked={zapatilla.status}
                      onChange={(e) => handleToggleChange(zapatilla.id, e.target.checked)}
                    />
                    <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    <span className=" text-sm mx-auto font-medium text-gray-900 dark:text-gray-300">
                      {zapatilla.status ? "Activado" : "Pausado"}
                    </span>
                  </label>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Products;
