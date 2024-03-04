// components/checkout/CartDetails.tsx
import React from "react";
import Image from "next/image";

import "@/app/globals.css";
import { ShoppingCartIcon } from "@heroicons/react/24/outline";
import { useCart } from "@/app/providers/CartContextProvider";

interface cartDetailsProps {
  isOpen: boolean;
  toggleDetails: () => void;
  calculateTotal: () => number;
}

function CartDetails({ isOpen, toggleDetails, calculateTotal }: cartDetailsProps) {
  const { cart } = useCart();
  console.log(cart);

  return (
    <aside className="border md:border-l md:border-none md:w-1/2 md:pt-10 md:order-last  rounded-lg md:rounded-none py-4 px-2 w-full">
      <details
        className={`custom-transition md:hidden ${
          isOpen ? "max-h-[1000px] opacity-100" : "max-h-10 opacity-100"
        }`}
      >
        <summary className="flex items-center justify-center" onClick={toggleDetails}>
          <span className="h-5 w-5 mr-2">
            <ShoppingCartIcon />
          </span>
          <span className="text-blue-600 text-sm pt-2 ">Mostrar</span>
        </summary>
        <div
          className={`mt-8 overflow-hidden transition-max-h duration-500 ${
            isOpen ? "max-h-[1000px]" : "max-h-0"
          } ${isOpen ? "opacity-100" : "opacity-0"}`}
        >
          {cart.map((item: any, index: number) => (
            <div key={index} className="flex justify-between py-2 border-b items-center ">
              <div>
                <div className="relative">
                  <Image
                    src={item.img}
                    alt={item.modelo}
                    blurDataURL={item.blurDataURL}
                    width={80}
                    height={80}
                    className="border border-gray-500/80 rounded-xl"
                  />
                  <span className="absolute top-0  right-0 z-10 text-sm px-[6px] -translate-y-[50%]  shadow-inner  shadow-white rounded-full">
                    {item.quantity}
                  </span>
                </div>
              </div>
              <div className="flex flex-col w-full px-6">
                <span>{item.modelo}</span>
                <span className="text-sm opacity-70">{item.talle}</span>
              </div>
              <div>
                <span className="font-semibold tracking-wide w-auto flex text-sm">
                  $ {item.precio}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-between items-center">
          <span className="font-semibold tracking-wide">Total</span>
          {<span className="font-semibold tracking-wide">$ {calculateTotal()}</span>}
        </div>
      </details>
      <div className="hidden md:flex p-8 md:flex-col gap-2 md:w-96 overflow-y-auto">
        {cart.map((item: any, index: number) => (
          <div key={index} className="flex justify-between  border-b pb-4 items-center ">
            <div>
              <div className="relative w-20 h-20">
                <Image
                  src={item.img}
                  alt={item.modelo}
                  width={80}
                  height={80}
                  className="border border-gray-500/80 rounded-xl   w-full h-full object-contain "
                />
                <span className="absolute top-0 right-0 z-10 text-sm px-[6px] -translate-y-[50%]  shadow-inner  shadow-white rounded-full">
                  {item.quantity}
                </span>
              </div>
            </div>
            <div className="flex flex-col w-full px-6 overflow-hidden">
              <span>{item.modelo}</span>
              <span className="text-sm opacity-70">{item.descripcion}</span>
            </div>
            <div>
              <span className="font-semibold tracking-wide w-auto flex text-sm">
                ${item.precio}
              </span>
            </div>
          </div>
        ))}
        <div className="mt-8 flex justify-between items-center md:pl-2">
          <span className="font-semibold tracking-wide ">Total</span>
          {<span className="font-semibold tracking-wide">$ {calculateTotal()}</span>}
        </div>
      </div>
    </aside>
  );
}

export default CartDetails;
