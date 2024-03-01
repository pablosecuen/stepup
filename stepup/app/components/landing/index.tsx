"use client";
import React, { useEffect, useState } from "react";
import "./lading.css";
import Image from "next/image";
import nikeShoe from "@/public/assets/jordan1/jordan1.png";
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
          className="w-[300px] h-[300px] object-contain transform scale-x-[-1] rotate-[35deg] transition duration-500 absolute z-10"
        />
        <span className="text-8xl uppercase tracking-widest font-bolder text-white transition duration-500">
          Nike
        </span>
        <div className="shadow  bg-gradient-to-t from-gray-700 to-transparent opacity-10 rounded-full transition duration-500"></div>
      </div>
      <div className="element2 flex items-center justify-center relative overflow-hidden">
        {" "}
        <Image
          src={nikeShoe}
          alt="nike shoe"
          width={300}
          height={300}
          className="w-[300px] h-[300px] object-contain transform scale-x-[-1] rotate-[35deg] transition duration-500 absolute z-10"
        />
        <span className="text-8xl uppercase tracking-widest font-bolder text-white transition duration-500">
          Adidas
        </span>
        <div className="shadow  bg-gradient-to-t from-gray-700 to-transparent opacity-10 rounded-full transition duration-500"></div>
      </div>
      <div className="element3 flex items-center justify-center relative overflow-hidden">
        {" "}
        <Image
          src={nikeShoe}
          alt="nike shoe"
          width={300}
          height={300}
          className="w-[300px] h-[300px] object-contain transform scale-x-[-1] rotate-[35deg] transition duration-500 absolute z-10"
        />
        <span className="text-8xl uppercase tracking-widest font-bolder text-white transition duration-500">
          Puma
        </span>
        <div className="shadow  bg-gradient-to-t from-gray-700 to-transparent opacity-10 rounded-full transition duration-500"></div>
      </div>
    </div>
  );
};

export default Landing;
