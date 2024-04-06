
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
    img?: StaticImageData | string;
}


export interface ItemCart {
  id: string;
  marca: string
  modelo: string;
  descripcion: string,
  categoria: string,
  color: string;
  precio: number;
  talles: any;
  img: StaticImageData | string;
  imagenes?: string[]
  quantity?: number;
  status?: boolean;
}

export const brands = [{marca:"Adidas", img:adidaslogo},{marca:"Nike", img:nikelogo},{marca:"Puma", img:pumalogo}, ];