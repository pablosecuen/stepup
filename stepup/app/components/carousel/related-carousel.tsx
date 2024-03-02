"use client";

import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Image from "next/image";
import { useRef } from "react";
import { ZapatillaJordan } from "@/app/data";
import badge from "@/public/assets/badge/badge.png";

interface RelatedCarouselProps {
  relatedZapatillas: ZapatillaJordan[];
}

const RelatedCarousel = ({ relatedZapatillas }: RelatedCarouselProps) => {
  let sliderRef = useRef<Slider>(null);

  const next = () => {
    if (sliderRef.current) {
      sliderRef.current.slickNext();
    }
  };
  const previous = () => {
    if (sliderRef.current) {
      sliderRef.current.slickPrev();
    }
  };

  const settings = {
    dots: false,
    infinite: true,
    speed: 500,
    slidesToShow: 5,
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
    <section className="w-full py-20 animate-fadeIn">
      <div className="flex items-center justify-end px-16 w-full">
        <h2 className="font-bold tracking-wider text-xl uppercase mr-4">Productos relacionados</h2>
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
          {relatedZapatillas.map((zapatilla: ZapatillaJordan, index: number) => (
            <div key={zapatilla.modelo}>
              {" "}
              <div className="sm:w-92 w-11/12 flex flex-col  aspect-square  text-lg leading-tight relative">
                <Image
                  src={badge}
                  alt="badge"
                  width={0}
                  height={0}
                  className="object-cover absolute w-20 -top-0 -right-8"
                />

                <div className="w-full h-full bg-gradient-to-b from-white to-gray-400/40 flex items-center justify-center mb-1">
                  {" "}
                  <Image src={zapatilla.img} alt={zapatilla.modelo} width={0} height={0} />B
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

export default RelatedCarousel;
