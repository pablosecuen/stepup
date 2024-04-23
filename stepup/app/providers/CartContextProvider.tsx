// useCartContext.tsx
"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ItemCart } from "../data";
import { toast } from "sonner";
import { log } from "console";

interface CartContextType {
  cart: ItemCart[];
  addToCart: (product: ItemCart) => void;
  clearCart: () => void;
  calculateTotal: number;
  deleteItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<ItemCart[]>([]);

  useEffect(() => {
    const storedCartString = localStorage.getItem("SneakersCart");
    const storedCart = storedCartString ? JSON.parse(storedCartString) : [];
    setCart(storedCart);
  }, []);

  const addToCart = (product: ItemCart) => {
    if (product.talles[0].null) {
      toast.error("Por favor selecciona un talle para poder agregar el producto al carrito");
      return;
    }
    const storedCart = JSON.parse(localStorage.getItem("SneakersCart") || "[]") as ItemCart[];
    let updatedCart: ItemCart[];
    const existingProductIndex = storedCart.findIndex(
      (item) => item.id === product.id && item.talles[0] === product.talles[0]
    );
    if (existingProductIndex !== -1) {
      updatedCart = storedCart.map((item, index) => {
        if (index === existingProductIndex) {
          return { ...item, quantity: (item.quantity || 0) + 1 };
        }
        return item;
      });
      toast.success("Sumada 1 unidad al carrito");
    } else {
      updatedCart = [...storedCart, { ...product, quantity: 1 }];
      toast.success("Producto agregado al carrito");
    }
    localStorage.setItem("SneakersCart", JSON.stringify(updatedCart));
    setCart(updatedCart);
  };

  const deleteItem = (itemId: string) => {
    // Identificar el índice del ítem a eliminar
    const itemIndex = cart.findIndex((item) => item.id === itemId);

    if (itemIndex === -1) {
      // Si no se encuentra el ítem, mostrar un mensaje de error o manejar la situación según sea necesario
      toast.error("El producto que intentas eliminar no se encuentra en el carrito");
      return;
    }

    // Crear un nuevo array de carrito excluyendo el ítem a eliminar
    const updatedCart = [...cart.slice(0, itemIndex), ...cart.slice(itemIndex + 1)];

    // Actualizar el estado del carrito y el almacenamiento local
    setCart(updatedCart);
    localStorage.setItem("SneakersCart", JSON.stringify(updatedCart));

    toast.success("Producto eliminado del carrito");
  };

  const clearCart = () => {
    setCart([]);
    localStorage.setItem("SneakersCart", JSON.stringify([]));
    toast.success("Carrito restaurado");
  };

  const calculateTotal = useMemo(() => {
    return cart.reduce((total, product) => total + product.precio * (product.quantity ?? 1), 0);
  }, [cart]);

  const updateQuantity = (productId: string, newQuantity: number) => {
    const updatedCart = cart.map((item) => {
      if (item.id === productId) {
        return { ...item, quantity: newQuantity };
      }
      return item;
    });
    setCart(updatedCart);
    localStorage.setItem("SneakersCart", JSON.stringify(updatedCart));
  };

  return (
    <CartContext.Provider
      value={{ cart, addToCart, clearCart, calculateTotal, deleteItem, updateQuantity }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart debe ser usado dentro de un CartProvider");
  }
  return context;
};
