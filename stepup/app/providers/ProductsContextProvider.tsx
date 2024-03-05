"use client";
import React, { createContext, useContext } from "react";
import { useQuery } from "react-query";
import { getDocs, collection } from "firebase/firestore";
import { db } from "@/firebase";
import { ZapatillaJordan } from "../data";
import { FirebaseError } from "firebase/app";
import { getDownloadURL, getStorage, ref } from "firebase/storage";

// Definir el tipo del contexto de productos
interface ProductsContextType {
  data: ZapatillaJordan[] | undefined;
}

// Crear el contexto de productos con el tipo definido
const ProductsContext = createContext<ProductsContextType>({
  data: undefined,
});

interface ProductsProviderProps {
  children: React.ReactNode;
}

// Función para obtener las URLs de las imágenes
const getImageUrls = async (imageNames: string[]) => {
  try {
    const storage = getStorage();
    const imageUrls: string[] = [];
    for (const imageName of imageNames) {
      const imageUrl = await getDownloadURL(ref(storage, imageName));
      imageUrls.push(imageUrl);
    }

    return imageUrls;
  } catch (error) {
    console.error("Error al obtener las URLs de las imágenes:", error);
    return [];
  }
};

export const ProductsProvider = ({ children }: ProductsProviderProps) => {
  const { data, isLoading, isError, error } = useQuery("products", async () => {
    const querySnapshot = await getDocs(collection(db, "products"));
    const productsData: ZapatillaJordan[] = [];
    // Usar Promise.all para esperar a que todas las llamadas asíncronas se completen
    await Promise.all(
      querySnapshot.docs.map(async (doc) => {
        const productData = doc.data() as ZapatillaJordan;
        // Obtener las URLs de las imágenes de la zapatilla y guardarlas en la propiedad imagenes
        if (productData.imagenes && productData.imagenes.length > 0) {
          productData.imagenes = await getImageUrls(productData.imagenes);
        }
        productsData.push(productData);
      })
    );
    return productsData;
  });
  console.log(data);

  // Renderizar el proveedor de contexto
  return <ProductsContext.Provider value={{ data }}>{children}</ProductsContext.Provider>;
};

// Crear un hook personalizado para acceder al contexto de productos
export const useProducts = (): ProductsContextType => useContext(ProductsContext);
