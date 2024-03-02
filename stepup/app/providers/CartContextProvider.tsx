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
    // Obtener el carrito del localStorage
    const storedCart = JSON.parse(localStorage.getItem("SneakersCart") || "[]") as ItemCart[];

    let updatedCart: ItemCart[];

    const existingProductIndex = storedCart.findIndex((item) => item.id === product.id);
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

    // Actualizar localStorage con el carrito actualizado
    localStorage.setItem("SneakersCart", JSON.stringify(updatedCart));

    // Actualizar el estado del carrito
    setCart(updatedCart);
  };

  const deleteItem = (itemId: string) => {
    const updatedCart = cart.filter((item) => item.id !== itemId);
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
