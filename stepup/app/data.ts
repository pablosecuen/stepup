import jordan1 from "@/public/assets/jordan1/jordan1.png"
import jordan4 from "@/public/assets/jordan4/jordan4.png"
import jordan6 from "@/public/assets/jordan6/jordan6.png"
import jordan11 from "@/public/assets/jordan11/jordan11.png"
import { StaticImageData } from "next/image";


export interface TalleDisponible {
  [talle: string]: number;
}

export interface ZapatillaJordan {
  modelo: string;
  color: string;
  precio: number;
  talles: any;
  img: StaticImageData ;
}


export const zapatillasJordan = [
  {
    modelo: "Air Jordan 1",
    color: "Negro/Rojo",
    precio: 150,
    talles: [
      { "40": 0 },
      { "41": 15 },
      { "42": 0 },
      { "43": 12 },
      { "44": 8 }
        ],
    img: jordan1,
  },
  {
    modelo: "Air Jordan 4",
    color: "Blanco/Negro/Rojo",
    precio: 200,
    talles: [
    { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 0 },
      { "44": 8 }
      ],
    img: jordan4,
  },
  {
    modelo: "Air Jordan 11",
    color: "Negro/Gamma Azul",
    precio: 220,
    talles: [
    { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 0 },
      { "44": 8 }
      ],
    img: jordan11
  },
  {
    modelo: "Air Jordan 6",
    color: "Negro/Infrarrojo",
    precio: 180,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 0 }
      ],
        img: jordan6
  }
];
