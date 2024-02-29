import Image, { StaticImageData } from "next/image";
import React from "react";

interface FilterProps {
  marcas: { marca: string; img: StaticImageData }[];
  handleFilterByMarca: (marca: string | null) => void;
}

const Filters: React.FC<FilterProps> = ({ marcas, handleFilterByMarca }) => {
  return (
    <div className="max-w-full">
      <ul className="flex justify-center items-center gap-1 overflow-x-auto">
        <li
          className="cursor-pointer ml-16 flex items-center border-2 rounded-full px-3 py-1 h-10"
          onClick={() => handleFilterByMarca(null)}
        >
          Todos
        </li>
        {marcas.map((marca, index) => (
          <div key={index} className="flex-shrink-0 w-auto">
            <li
              className={`cursor-pointer flex items-center border-2 rounded-full px-3 py-1 h-10 ${
                index === marcas.length - 1 ? "mr-2" : ""
              }`}
              onClick={() => handleFilterByMarca(marca.marca)}
            >
              <Image src={marca.img} alt={marca.marca} className="h-10 w-auto max-h-8" />
              <span>{marca.marca}</span>
            </li>
          </div>
        ))}
      </ul>
    </div>
  );
};

export default Filters;
