"use client";
import { ZapatillaJordan, zapatillasJordan } from "@/app/data";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";

const ProductsCarousel = () => {
  let sliderRef = useRef<Slider>(null);

  const [isVisible, setIsVisible] = useState(false);
  const { ref, inView } = useInView({
    triggerOnce: false,
    threshold: 1, 
  });

  useEffect(() => {

    if (inView) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [inView]);



  const next = () => {
    if (sliderRef.current) {
      sliderRef.current.slickNext(); // Accede al método slickNext() a través de current
    }
  };
  const previous = () => {
    if (sliderRef.current) {
      sliderRef.current.slickPrev(); // Accede al método slickPrev() a través de current
    }
  };

  const settings = {
    dots: false,
    infinite: true,
    speed: 500,
    slidesToShow: 4,
    slidesToScroll: 1,
    swipeToSlide: true,
    responsive: [
      {
        breakpoint: 1150,
        settings: {
          slidesToShow: 2,
          slidesToScroll: 1,
          swipeToSlide: true,
        },
      },
      {
        breakpoint: 1600,
        settings: {
          slidesToShow: 3,
          slidesToScroll: 1,
          swipeToSlide: true,
        },
      },
      {
        breakpoint: 700,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1,
          swipeToSlide: true,
        },
      },
    ],
  };

  return (
    <section className={`w-full py-20  ${isVisible ? "animate-fadeIn" : ""}`} ref={ref}>
      <div className="flex items-center justify-end px-16 w-full">
        <h2 className="font-bold tracking-wider text-xl uppercase mr-4">Nuestras Zapatillas</h2>
        <button className="button w-10" onClick={previous}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="scale-x-[-1]">
            <g data-name="Circle Right">
              <circle cx="12" cy="12" r="10" className="fill-[#ece4b7] " />
              <path
                d="m17.706 11.292-3-3a1 1 0 0 0-1.414 1.414L14.586 11H7a1 1 0 0 0 0 2h7.586l-1.293 1.293a1 1 0 1 0 1.414 1.414l3-3a1 1 0 0 0-.001-1.415z"
                className="fill-[#ff8e31]"
              />
            </g>
          </svg>
        </button>
        <button className="button w-10" onClick={next}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <g data-name="Circle Right">
              <circle cx="12" cy="12" r="10" className="fill-[#ece4b7]" />
              <path
                d="m17.706 11.292-3-3a1 1 0 0 0-1.414 1.414L14.586 11H7a1 1 0 0 0 0 2h7.586l-1.293 1.293a1 1 0 1 0 1.414 1.414l3-3a1 1 0 0 0-.001-1.415z"
                className="fill-[#ff8e31]"
              />
            </g>
          </svg>
        </button>
      </div>

      <div className=" flex flex-col w-full mx-4 md:pt-10 z-50  overflow-hidden ">
        {" "}
        <Slider ref={sliderRef} {...settings}>
          {zapatillasJordan.map((zapatilla: ZapatillaJordan, index: number) => (
            <div key={zapatilla.modelo}>
              {" "}
              <div className="sm:w-96 w-11/12 flex flex-col  aspect-square  text-lg leading-tight">
                <div className="w-full h-full bg-gradient-to-b from-white to-gray-400/40 flex items-center justify-center mb-1">
                  {" "}
                  <Image src={zapatilla.img} alt={zapatilla.modelo} width={0} height={0} />
                </div>

                <span className="text-[#fb7633] font-semibold">{zapatilla.marca}</span>
                <span className="text-gray-500">{zapatilla.modelo}</span>
                <span className="text-gray-400 opacity-80">{zapatilla.color}</span>
                <span className="text-black font-semibold">${zapatilla.precio}</span>
              </div>
            </div>
          ))}
        </Slider>
      </div>
    </section>
  );
};

export default ProductsCarousel;
