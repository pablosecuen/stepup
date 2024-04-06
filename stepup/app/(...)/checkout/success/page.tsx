/* eslint-disable @next/next/no-img-element */
// components/checkout/Success.js
"use client";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import html2canvas from "html2canvas";
import { format } from "date-fns";
import usePaymentInfo from "@/app/hooks/usePaymentInfo";
import Link from "next/link";

const Success = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const payment_id = searchParams.get("payment_id");
  const [localPaymentInfo, setLocalPaymentInfo] = useState<any>(null);
  const headerRef = useRef(null);

  const { paymentInfo, isLoading, error } = usePaymentInfo(payment_id || "");

  useEffect(() => {
    if (paymentInfo) {
      setLocalPaymentInfo(paymentInfo);
    }
  }, [paymentInfo]);

  const handleSaveSnapshot = () => {
    if (headerRef.current) {
      html2canvas(headerRef.current).then((canvas) => {
        const link = document.createElement("a");
        link.download = "snapshot.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
      });
    }
  };

  console.log(localPaymentInfo);

  return (
    <Suspense>
      {localPaymentInfo ? (
        <div className="flex justify-center items-center min-h-screen h-auto py-20 pt-32 text-black fadeIn">
          <div className="flex flex-col items-center gap-8">
            <div className="min-w-[400px] border-black border-4 p-10" ref={headerRef}>
              <header className="flex gap-3 w-full ">
                <div className="flex flex-col mx-auto">
                  <span className="mx-auto">
                    <img src="/assets/logo/Recurso 19.png" className="h-8" alt="Los Leños Logo" />
                  </span>
                  <p className="text-small text-default-500 text-center">Los Leños</p>
                </div>
              </header>
              <hr />
              <div>
                <div className="flex flex-col gap-4 h-auto py-3">
                  <h2 className="text-lg font-bold">¡Felicitaciones, Compra Exitosa!</h2>
                  <p className="font-semibold">Detalles del Pago:</p>
                  <ul>
                    <li>ID de Pago: {payment_id}</li>
                    <li>
                      Fecha de Aprobación:{" "}
                      {localPaymentInfo
                        ? format(new Date(localPaymentInfo.date_approved), "dd/MM/yyyy HH:mm:ss")
                        : ""}
                    </li>
                    <li>Estado: {localPaymentInfo?.status}</li>
                    {/* Agrega más detalles según sea necesario */}
                  </ul>
                  <p className="font-semibold">Detalles de los Productos Comprados:</p>
                  <p className="font-semibold">Listado de productos</p>
                  <ul className="flex  gap-4 flex-wrap">
                    {localPaymentInfo?.additional_info?.items.map((product: any, index: number) => (
                      <li key={index} className="border  rounded-md p-4">
                        <strong>Producto #{index + 1}</strong>
                        <ul>
                          <li>Nombre: {product.title}</li>
                          <li>id: {product.id}</li>
                          <li>Cantidad: {product.quantity}</li>
                          <li>Precio Unitario:$ {product.unit_price}</li>
                        </ul>
                      </li>
                    ))}
                  </ul>
                  <p className="font-semibold">
                    Total Pagado: $ {localPaymentInfo?.transaction_amount}{" "}
                  </p>
                </div>
              </div>
              <hr />
              <div className="flex flex-col gap-3 items-center justify-center w-full h-full py-4 fadeIn transition duration-500">
                <Link href="/" className="w-full">
                  <button className="mx-auto py-2 w-full bg-primario text-white bg-blue-900">
                    Continuar Comprando
                  </button>
                </Link>
                <button
                  onClick={handleSaveSnapshot}
                  className="mx-auto py-2 w-full bg-primario text-white bg-blue-900"
                >
                  Guardar Comprobante
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center min-h-screen text-black fadeIn transition duration-500">
          <p>Cargando Ticket de compra, no cierre esta ventana</p>
        </div>
      )}
    </Suspense>
  );
};

export default Success;
