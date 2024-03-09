"use client";
import React, { createContext, useContext, useState } from "react";
import { useMutation, useQuery } from "react-query";
import { getDocs, collection, updateDoc, doc } from "firebase/firestore";
import { db } from "@/firebase";
import { ZapatillaJordan } from "../data";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { toast } from "sonner";

const ProductsContext = createContext<ProductsContextType>({
  productsData: undefined,
  isLoading: false,
  isError: false,
  error: "",
  updateProductStatus: () => {},
  loadingStates: {},
});

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
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStates, setLoadingStates] = useState<{ [key: string]: boolean }>({});
  const [isError, setIsError] = useState<boolean>(false);
  const [error, setError] = useState<any | null>(null);
  const [productsData, setProductsData] = useState<ZapatillaJordan[] | undefined>(undefined);

  const { data } = useQuery("products", async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, "products"));
      const productsData: ZapatillaJordan[] = [];

      await Promise.all(
        querySnapshot.docs.map(async (doc) => {
          try {
            const productData = doc.data() as ZapatillaJordan;
            const productWithId: ZapatillaJordan = {
              ...productData,
              id: doc.id,
            };

            if (productWithId.imagenes && productWithId.imagenes.length > 0) {
              productWithId.imagenes = await getImageUrls(productWithId.imagenes);
            }
            productsData.push(productWithId);
            setLoadingStates((prevLoadingStates) => ({ ...prevLoadingStates, [doc.id]: false }));
          } catch (error: any) {
            setIsError(true);
            setError(error);
          }
        })
      );

      // Ordenar los productos alfabéticamente por la propiedad 'modelo'
      productsData.sort((a, b) => a.modelo.localeCompare(b.modelo));

      setIsLoading(false);
      setProductsData(productsData); // Actualiza el estado local con los nuevos datos
      return productsData;
    } catch (error: any) {
      toast.error("Error al cargar productos");
      setIsError(true);
      setError(error.message);
      throw error;
    }
  });

  const updateProductStatusMutation = useMutation(
    async ({ productId, status }: { productId: string; status: boolean }) => {
      try {
        setLoadingStates((prevLoadingStates) => ({ ...prevLoadingStates, [productId]: true }));
        await updateDoc(doc(db, "products", productId), { status });
      } catch (error) {
        console.error("Error al actualizar el estado del producto:", error);
        throw error;
      }
    },
    {
      onSuccess: async () => {
        try {
          const querySnapshot = await getDocs(collection(db, "products"));
          const updatedProductsData: ZapatillaJordan[] = [];

          await Promise.all(
            querySnapshot.docs.map(async (doc) => {
              try {
                const productData = doc.data() as ZapatillaJordan;
                const productWithId: ZapatillaJordan = {
                  ...productData,
                  id: doc.id,
                };

                if (productWithId.imagenes && productWithId.imagenes.length > 0) {
                  productWithId.imagenes = await getImageUrls(productWithId.imagenes);
                }
                updatedProductsData.push(productWithId);
                setLoadingStates((prevLoadingStates) => ({
                  ...prevLoadingStates,
                  [doc.id]: false,
                }));
              } catch (error: any) {
                setIsError(true);
                setError(error);
              }
            })
          );
          updatedProductsData.sort((a, b) => a.modelo.localeCompare(b.modelo));
          setProductsData(updatedProductsData);
          toast.success("Status editado exitosamente");
        } catch (error: any) {
          toast.error("Error al cargar productos");
          setIsError(true);
          setError(error.message);
        }
      },
    }
  );

  const updateProductStatus = async (productId: string, status: boolean) => {
    try {
      await updateProductStatusMutation.mutateAsync({ productId, status });
    } catch (error) {
      console.error("Error al actualizar el estado del producto:", error);
      throw error;
    }
  };

  return (
    <ProductsContext.Provider
      value={{ productsData, isLoading, isError, error, updateProductStatus, loadingStates }}
    >
      {children}
    </ProductsContext.Provider>
  );
};

export const useProducts = (): ProductsContextType => useContext(ProductsContext);

interface ProductsProviderProps {
  children: React.ReactNode;
}

interface ProductsContextType {
  productsData: ZapatillaJordan[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: string | undefined;
  updateProductStatus: (productId: string, status: boolean) => void;
  loadingStates: { [key: string]: boolean };
}
