"use client";
import React, { useEffect, useState } from "react";
import "@/app/globals.css";

import "./styles.css";
import CartDetails from "./components/cart-details";
import CheckoutForm from "./components/checkout-form";
import { useCart } from "@/app/providers/CartContextProvider";
import { ItemCart } from "@/app/data";

const Checkout = () => {
  const { cart } = useCart();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const storedCartString = localStorage.getItem("SneakersCart");
    /*     const storedCart = storedCartString ? JSON.parse(storedCartString) : []; */
    /*     setCart(storedCart); */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDetails = () => {
    setIsOpen(!isOpen);
  };

  const calculateTotal = () => {
    let totalAmount = 0;

    cart.forEach((item: ItemCart) => {
      totalAmount += item.precio * (item.quantity ?? 0);
    });

    return totalAmount;
  };

  return (
    <div className="flex flex-col !font-atlas-grotesk-medium   md:min-h-[80vh] pt-0 md:pt-24 h-full  rounded-lg   p-4  dark:terciario md:p-0 lg:flex-row lg:gap-8 ">
      <CartDetails isOpen={isOpen} toggleDetails={toggleDetails} calculateTotal={calculateTotal} />
      <CheckoutForm />
    </div>
  );
};

export default Checkout;
