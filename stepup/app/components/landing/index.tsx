"use client";
import React, { useEffect, useState } from "react";
import "./lading.css";
import Image from "next/image";
import nikeShoe from "@/public/assets/jordan1/jordan1.png";
import niketipo from "@/public/assets/logo/niketipo.png";
import adidastipo from "@/public/assets/logo/adidastipo.png";
import pumatipo from "@/public/assets/logo/pumatipo.png";
import { useInView } from "react-intersection-observer";
const Landing = () => {
  const [isVisible, setIsVisible] = useState(false);
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.6,
  });

  useEffect(() => {
    if (inView) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [inView]);

  return (
    <div className={`flex w-full h-screen  ${isVisible ? "animate-fadeIn" : ""}`} ref={ref}>
      <div className="element1 flex items-center justify-center relative overflow-hidden">
        <Image
          src={nikeShoe}
          alt="nike shoe"
          width={300}
          height={300}
          className="shoe w-[300px] h-[300px] object-contain transform scale-x-[-1] rotate-[35deg] transition duration-500 absolute z-10"
        />
        {/*     <span className="text-8xl uppercase tracking-widest font-bolder text-white transition duration-500">
          Nike
        </span> */}{" "}
        <Image src={niketipo} alt="nike tipo" width={0} height={0} className="tipo w-96 max-w-96" />
        <div className="shadow  bg-gradient-to-t from-gray-700 to-transparent opacity-10 rounded-full transition duration-500"></div>
      </div>
      <div className="element2 flex items-center justify-center relative overflow-hidden">
        {" "}
        <Image
          src={nikeShoe}
          alt="nike shoe"
          width={300}
          height={300}
          className="shoe w-[300px] h-[300px] object-contain transform scale-x-[-1] rotate-[35deg] transition duration-500 absolute z-10"
        />
        {/*  <span className="text-8xl uppercase tracking-widest font-bolder text-white transition duration-500">
          Adidas
        </span> */}
        <Image
          src={adidastipo}
          alt="adidas tipo"
          width={0}
          height={0}
          className="tipo w-96 max-w-64"
        />
        <div className="shadow  bg-gradient-to-t from-gray-700 to-transparent opacity-10 rounded-full transition duration-500"></div>
      </div>
      <div className="element3 flex items-center justify-center relative overflow-hidden">
        {" "}
        <Image
          src={nikeShoe}
          alt="nike shoe"
          width={300}
          height={300}
          className="shoe w-[300px] h-[300px] object-contain transform scale-x-[-1] rotate-[35deg] transition duration-500 absolute z-10"
        />
        {/*    <span className="text-8xl uppercase tracking-widest font-bolder text-white transition duration-500">
          Puma
        </span> */}
        <Image src={pumatipo} alt="puma tipo" width={0} height={0} className="tipo w-96 max-w-96" />
        <div className="shadow  bg-gradient-to-t from-gray-700 to-transparent opacity-10 rounded-full transition duration-500"></div>
      </div>
    </div>
  );
};

export default Landing;
