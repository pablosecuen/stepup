import { TalleDisponible } from "@/app/data";
import Image, { StaticImageData } from "next/image";
import React from "react";

export interface CardProps {
  img: StaticImageData;
  marca: string;
  modelo: string;
  color: string;
  precio: number;
  talles: any;
}

const SneakersCard = ({ img, marca, modelo, color, precio, talles }: CardProps) => {
  return (
    <div className="w-[350px] md:w-[500px] h-40 mx-auto flex border border-gray-300 rounded-lg overflow-hidden shadow-xl ">
      <div className="relative w-2/5 flex items-center justify-center rounded-xl p-2 md:p-8">
        <div className="bg-gradient-to-br rounded-xl from-[#010187] to-[#170011] via-[#18000E] aspect-square relative flex items-center justify-center ">
          <Image
            src={img}
            alt={modelo}
            className="scale-150 hover:scale-[160%] transition duration-500"
          />
        </div>
      </div>
      <div className="py-1 px-4 mx-auto flex flex-col justify-center">
        <h2 className="text-xl font-bold whitespace-nowrap">
          {marca} {modelo}
        </h2>
        <p className="text-gray-600 font semi-bold">Color: {color}</p>
        <p className="text-gray-600">Precio: ${precio}</p>
        <ul className="text-gray-600 mt-4 flex gap-1">
          {talles.map((talle: TalleDisponible, index: number) => (
            <div
              key={index}
              className={`w-8 h-8 flex gap-3 items-center justify-center border border-gray-200 rounded-md relative ${
                Object.values(talle)[0] > 0 ? "" : ""
              }`}
            >
              {Object.keys(talle)}
              {Object.values(talle)[0] === 0 && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-full w-full text-red-500 absolute transform translate-x-1/2 top-1/2 right-1/2 -translate-y-1/2"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M13.405 10l4.247-4.249a1 1 0 1 0-1.414-1.414L12 8.587l-4.238-4.25a1 1 0 1 0-1.415 1.415L10.587 10l-4.25 4.238a1 1 0 1 0 1.415 1.415L12 11.414l4.248 4.248a1 1 0 1 0 1.414-1.414L13.405 10z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default SneakersCard;
