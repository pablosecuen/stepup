import jordan1 from "@/public/assets/jordan1/jordan1.png"
import jordan4 from "@/public/assets/jordan4/jordan4.png"
import jordan6 from "@/public/assets/jordan6/jordan6.png"
import jordan11 from "@/public/assets/jordan11/jordan11.png"
import badbunny from "@/public/assets/adidas/badbunny.png"
import superstars from "@/public/assets/adidas/superstar.png"
import clyde from "@/public/assets/puma/pumaclyde.png"
import suede from "@/public/assets/puma/pumasuede.png"
import adidaslogo from "@/public/assets/logo/adidas.png"
import pumalogo from "@/public/assets/logo/puma.png"
import nikelogo from "@/public/assets/logo/nike.png"
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
    marca: "Adidas",
    modelo: "Superstar",
    color: "Blanco/Negro",
    precio: 120,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: superstars
  },
  {
    marca: "Adidas",
    modelo: "Bad Bunny",
    color: "Blanco/Verde",
    precio: 100,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: badbunny
  },
  {
    marca: "Puma",
    modelo: "Suede",
    color: "Negro/Blanco",
    precio: 90,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: suede
  },
  {
    marca: "Puma",
    modelo: "Clyde",
    color: "Rojo/Blanco",
    precio: 110,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: clyde
  },
  {
    marca: "Nike",
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
        marca: "Nike",
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
        marca: "Nike",
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
        marca: "Nike",
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


export const brands = [{marca:"Adidas", img:adidaslogo},{marca:"Nike", img:nikelogo},{marca:"Puma", img:pumalogo}, ];