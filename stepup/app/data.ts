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


export const createUrl = (...segments: string[]) => {
  const encodedSegments = segments.map(encodeURIComponent);
  return `http://localhost:3000/${encodedSegments.join('/')}`;
};

export interface TalleDisponible {
  [talle: string]: number;
}

export interface ZapatillaJordan {
  imagenes: string[]
  id: string;
  marca: string
  modelo: string;
  color: string;
  precio: number;
  descripcion:string
  talles: any;
  categoria: string,
  quantity?: number;
    status?: boolean;
}




export const zapatillasJordan = [
  {
      id: "1",
    marca: "Adidas",
    modelo: "Superstar",
    color: "Blanco/Negro",
    categoria: "Sneakers",
      descripcion:"una descripcion",
    precio: 120,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: superstars,
    status: true,
  },
  {
      id: "2",
    marca: "Adidas",
    modelo: "Bad Bunny",
    color: "Blanco/Verde",
    categoria: "Sneakers",
      descripcion:"una descripcion",
    precio: 100,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: badbunny,
      status: true,
  },
  {
      id: "3",
    marca: "Puma",
    modelo: "Suede",
    color: "Negro/Blanco",
    categoria: "Sneakers",
    descripcion:"una descripcion",
    precio: 90,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: suede,
      status: true,
  },
  {
      id: "4",
    marca: "Puma",
    modelo: "Clyde",
    color: "Rojo/Blanco",
    descripcion: "una descripcion",
        categoria: "Sneakers",
    precio: 110,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 8 }
    ],
    img: clyde,
      status: true,
  },
  {
      id: "5",
    marca: "Nike",
    modelo: "Air Jordan 1",
    color: "Negro/Rojo",
    descripcion: "una descripcion",
        categoria: "Sneakers",
    precio: 150,
    talles: [
      { "40": 0 },
      { "41": 15 },
      { "42": 0 },
      { "43": 12 },
      { "44": 8 }
        ],
    img: jordan1,
    status: true,
  },
  {
      id: "6",
        marca: "Nike",
    modelo: "Air Jordan 4",
    color: "Blanco/Negro/Rojo",
    descripcion: "una descripcion",
        categoria: "Sneakers",
    precio: 200,
    talles: [
    { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 0 },
      { "44": 8 }
      ],
    img: jordan4,
      status: true,
  },
  {
      id: "7",
        marca: "Nike",
    modelo: "Air Jordan 11",
    color: "Negro/Gamma Azul",
    descripcion: "una descripcion",
        categoria: "Sneakers",
    precio: 220,
    talles: [
    { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 0 },
      { "44": 8 }
      ],
    img: jordan11,
      status: true,
  },
  {
      id: "8",
        marca: "Nike",
    modelo: "Air Jordan 6",
    color: "Negro/Infrarrojo",
    descripcion: "una descripcion",
        categoria: "Sneakers",
    precio: 180,
    talles: [
      { "40": 10 },
      { "41": 15 },
      { "42": 20 },
      { "43": 12 },
      { "44": 0 }
      ],
    img: jordan6,
          status: true,
  }
];

export interface ItemCart {
  id: string;
  marca: string
  modelo: string;
  descripcion: string,
  categoria: string,
  color: string;
  precio: number;
  talles: any;
  img: StaticImageData;
  quantity?: number;
  status?: boolean;
}

export const brands = [{marca:"Adidas", img:adidaslogo},{marca:"Nike", img:nikelogo},{marca:"Puma", img:pumalogo}, ];