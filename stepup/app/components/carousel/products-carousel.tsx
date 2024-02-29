"use client";
import { ZapatillaJordan, zapatillasJordan } from "@/app/data";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Image from "next/image";
import SneakersCard from "../card/sneakers-card";

const PrevArrow = (props: any) => {
  const { onClick } = props;
  return (
    <button
      onClick={onClick}
      className="prev-arrow   left-0 top-1/2 absolute z-10 -translate-y-1/2 transform scale-x-[-1] w-10"
    >
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
  );
};

const NextArrow = (props: any) => {
  const { onClick } = props;
  return (
    <button
      onClick={onClick}
      className="next-arrow w-10  absolute right-0 top-1/2 z-10  -translate-y-1/2 "
    >
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
  );
};

const settings = {
  dots: false,
  infinite: true,
  speed: 500,
  slidesToShow: 3,
  slidesToScroll: 1,
  swipeToSlide: true,
  prevArrow: <PrevArrow />,
  nextArrow: <NextArrow />,
  responsive: [
    {
      breakpoint: 768,
      settings: {
        slidesToShow: 1,
        slidesToScroll: 1,
        swipeToSlide: true,
      },
    },
  ],
};
const ProductsCarousel = () => {
  return (
    <div className="w-full p-10">
      <div className=" flex flex-col w-full  max-w-screen-2xl mx-auto gap-10 md:pt-10 z-50  overflow-hidden ">
        {" "}
        <Slider {...settings}>
          {zapatillasJordan.map((zapatilla: ZapatillaJordan, index: number) => (
            <div key={zapatilla.modelo}>
              {" "}
              <SneakersCard
                key={index}
                img={zapatilla.img}
                modelo={zapatilla.modelo}
                marca={zapatilla.marca}
                talles={zapatilla.talles}
                color={zapatilla.color}
                precio={zapatilla.precio}
              />
            </div>
          ))}
        </Slider>
      </div>
    </div>
  );
};

export default ProductsCarousel;
