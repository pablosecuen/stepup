// components/checkout/Success.js
"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDispatch } from "react-redux";
import { AppDispatch } from "@/redux/store/store";
import { fetchPaymentInfoAsync } from "@/redux/actions/paymentActions";
import { PaymentInfo } from "@/redux/reducer/paymentReducer";
import { Button, Card, CardBody, CardFooter, CardHeader, Divider } from "@nextui-org/react";
import { AcmeLogo } from "@/components/icons/acmelogo";
import Mainnavbar from "@/components/navbar/navbar";
import Footer from "@/components/footer/footer";
import { updateProductStockAsync } from "@/redux/actions/productActions";
import html2canvas from "html2canvas";

const Success = () => {
  const router = useRouter();
  const dispatch: AppDispatch = useDispatch();
  const searchParams = useSearchParams();
  const payment_id = searchParams.get("payment_id");
  const [localPaymentInfo, setLocalPaymentInfo] = useState<PaymentInfo | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);

  // Primer useEffect para obtener la información del pago
  useEffect(() => {
    if (payment_id) {
      dispatch(fetchPaymentInfoAsync(payment_id)).then(({ payload }) => {
        setLocalPaymentInfo(payload.paymentInfo);
      });
    }
  }, [payment_id, dispatch]);

  // Segundo useEffect para actualizar el stock de productos si no se ha actualizado previamente
  useEffect(() => {
    const paymentOperationId = localPaymentInfo?.id;
    const isStockUpdated = localStorage.getItem(`isStockUpdated_${paymentOperationId}`);

    if (!isStockUpdated && localPaymentInfo?.additional_info?.items) {
      localPaymentInfo.additional_info.items.forEach((product: any) => {
        dispatch(
          updateProductStockAsync({
            productId: product.id,
            quantityToDeduct: parseInt(product.quantity),
          })
        );
      });

      localStorage.setItem(`isStockUpdated_${paymentOperationId}`, "true");
    }
  }, [localPaymentInfo, dispatch]);

  const handleContinueShopping = () => {
    router.push("/");
  };

  const handleSaveSnapshot = () => {
    if (headerRef.current) {
      // Asegurarse de que headerRef.current no sea null
      html2canvas(headerRef.current).then((canvas) => {
        const link = document.createElement("a");
        link.download = `Comprobante Neo Tech ${payment_id}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      });
    }
  };

  return (
    <>
      <Mainnavbar />
      <div className="flex justify-center items-center h-screen">
        <div className="flex flex-col items-center gap-8">
          <AcmeLogo />
          <div className="flex flex-col">
            <p className="text-md">Neo Tech</p>
            <p className="text-small text-default-500">neotech.com.ar</p>
          </div>
          {localPaymentInfo ? (
            <Card className="min-w-96 max-w-screen-xl" isFooterBlurred ref={headerRef}>
              <CardHeader className="flex gap-3">
                <AcmeLogo />
                <div className="flex flex-col">
                  <p className="text-md">Neo Tech</p>
                  <p className="text-small text-default-500">neotech.com.ar</p>
                </div>
              </CardHeader>
              <Divider />
              <CardBody>
                <div className="flex flex-col gap-4 ">
                  <h1>¡Compra Exitosa!</h1>
                  <p>Detalles del Pago:</p>
                  <ul>
                    <li>ID de Pago: {localPaymentInfo?.id}</li>
                    <li>Fecha de Aprobación: {localPaymentInfo?.date_approved}</li>
                    <li>Estado: {localPaymentInfo?.status}</li>
                    {/* Agrega más detalles según sea necesario */}
                  </ul>
                  <p>Detalles de los Productos Comprados:</p>
                  <ul className="flex  gap-4 flex-wrap">
                    {localPaymentInfo?.additional_info?.items.map((product, index) => (
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
                  <p>Total Pagado: $ {localPaymentInfo?.transaction_amount}</p>
                </div>
              </CardBody>
              <Divider />
              <CardFooter className="flex gap-3 mx-auto justify-center">
                <Button onPress={handleContinueShopping}>Continuar Comprando</Button>
                <Button onPress={handleSaveSnapshot}>Guardar Comprobantes</Button>
              </CardFooter>
            </Card>
          ) : (
            <p>Cargando información del pago...</p>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
};

export default Success;
