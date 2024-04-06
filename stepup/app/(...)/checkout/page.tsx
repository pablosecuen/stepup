"use client";

import Image from "next/image";
import { Suspense, useEffect, useState } from "react";
import "@/app/globals.css";

import useCreatePreference from "@/app/hooks/useCreatePreference";
import InformationForm from "./information-form";
import ShippingForm from "./shipping-form";
import useCalculateShippingCost from "@/app/hooks/useCalculateShippingCost";
import { ShoppingCartIcon } from "@heroicons/react/24/outline";
import ChevronRight from "@/app/components/icons/chevron-right";
import { useCart } from "@/app/providers/CartContextProvider";

function Checkout() {
  const { cart, calculateTotal } = useCart();
  const { loading, preferenceId, error, createPreference } = useCreatePreference();

  const {
    loading: shippingLoading,
    error: shippingError,
    shippingCost,
    calculateShippingCost,
  } = useCalculateShippingCost();
  const [postalCode, setPostalCode] = useState("");
  const [activeTab, setActiveTab] = useState("information");
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    area_code: "",
    number: "",
    firstname: "",
    lastname: "",
    calle: "",
    altura: "",
    provincia: "",
    ciudad: "",
    codigoPostal: "",
    mail: "",
    dni: "",
  });
  const handleChange = (e: any) => {
    const { name, value } = e.target;

    const updatedFormData = {
      ...formData,
      [name]: value,
    };
    setFormData(updatedFormData);

    if (name === "codigoPostal" && value.length === 4) {
      setPostalCode(value);
    }
  };

  const handleTabChange = (tab: any) => {
    setActiveTab(tab);
  };

  const handleSubmit = (e: any) => {
    e.preventDefault();
  };

  const toggleDetails = () => {
    setIsOpen(!isOpen);
  };

  const handleCreatePreference = () => {
    const totalItems = cart.reduce((acc, item) => acc + (item.quantity ?? 0), 0);
    const shippingCostPerItem = 5;
    const shippingCost = shippingCostPerItem * totalItems;

    if (cart && Array.isArray(cart) && cart.length > 0) {
      const body = {
        items: [
          ...cart.map((item) => ({
            title: item.modelo,
            description: item.descripcion,
            category_id: item.categoria,
            quantity: item.quantity,
            unit_price: item.precio,
            id: item.id,
          })),
          {
            title: "Costo de envío",
            description: "Envío estándar",
            category_id: "envios",
            unit_price: shippingCost,
            quantity: totalItems,
          },
        ],
        back_urls: {
          success: "http://localhost:3001/checkout/success",
          failure: "http://localhost:3001/checkout/failure",
          pending: "http://localhost:3001/checkout/pending",
        },
        auto_return: "approved",
        notification_url: "https://cv07lbkm-3000.brs.devtunnels.ms/api/payments/webhook",
        payer: {
          firstname: formData.firstname,
          lastname: formData.lastname,
          email: formData.mail,
          identification: {
            type: "DNI",
            number: formData.dni,
          },
          phone: {
            number: formData.number,
            area_code: formData.area_code,
          },
          address: {
            street_name: formData.calle,
            street_number: formData.altura,
            zip_code: formData.codigoPostal,
          },
        },
        shipments: {
          receiver_address: {
            zip_code: formData.codigoPostal,
            state_name: formData.provincia,
            city_name: formData.ciudad,
            street_name: formData.calle,
            street_number: formData.altura,
            country_id: "AR",
          },
        },
      };

      createPreference(body);
    } else {
      console.error("Error: 'cart' no está definido o no es un array");
    }
  };

  useEffect(() => {
    if (postalCode) {
      calculateShippingCost(postalCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postalCode]);

  return (
    <Suspense>
      <div className="">
        <div className="flex flex-col !font-atlas-grotesk-medium   md:min-h-[80vh] pt-0 md:pt-24 h-full  rounded-lg  bg-white p-4 text-black dark:terciario md:p-0 lg:flex-row lg:gap-8 ">
          <aside className="border-l md:w-1/2 md:pt-10 md:order-last  rounded-lg md:rounded-none    py-4 px-2 w-full mt-20 md:mt-0">
            <details
              className={`custom-transition md:hidden ${
                isOpen ? "max-h-[1000px] opacity-100" : "max-h-10 opacity-100"
              }`}
            >
              <summary className="flex items-center justify-center" onClick={toggleDetails}>
                <span className="h-5 w-5 mr-2">
                  <ShoppingCartIcon />
                </span>
                <span className="text-blue-600 text-sm pt-2 ">Mostrar</span>
              </summary>
              <div
                className={`mt-8 custom-transition gap-2  ${
                  isOpen ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                {cart.map((item: any, index: number) => (
                  <div key={index} className="flex justify-between py-2 border-b items-center ">
                    <div>
                      <div className="relative">
                        <Image
                          src={item.img}
                          alt={item.title}
                          width={80}
                          height={80}
                          className="border border-gray-500/80 rounded-xl"
                        />
                        <span className="absolute top-0  right-0 z-10 text-sm px-[6px] -translate-y-[50%] bg-gray shadow-inner bg-gray-400 shadow-white rounded-full">
                          {item.quantity}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col w-full px-6">
                      <span>{item.title}</span>
                      <span className="text-sm opacity-70">{item.description}</span>
                    </div>
                    <div>
                      <span className="font-semibold tracking-wide w-auto flex text-sm">
                        $ {item.price}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex justify-between items-center md:pl-2 flex-col">
                <div className="w-full flex justify-between ">
                  {" "}
                  <span className="font-semibold tracking-wide ">Subtotal</span>
                  <span className="font-semibold tracking-wide">$ {calculateTotal}</span>
                </div>
                <div className="w-full flex justify-between">
                  <span className="font-semibold tracking-wide">Envio</span>
                  {shippingLoading ? (
                    <span className="font-semibold tracking-wide ">
                      Calculando costo de envío...
                    </span>
                  ) : shippingError || !shippingCost ? (
                    <span className="font-semibold tracking-wide text-gray-500 italic">
                      Ingrese el código postal para calcular el costo de envío
                    </span>
                  ) : (
                    <span className="font-semibold tracking-wide">$ {shippingCost}</span>
                  )}
                </div>

                <div className="w-full flex justify-between ">
                  {" "}
                  <span className="font-semibold tracking-wide ">Total</span>
                  <span className="font-semibold tracking-wide">
                    ${" "}
                    {(shippingCost && `${calculateTotal + parseFloat(shippingCost)} `) ||
                      calculateTotal}
                  </span>
                </div>
                <span className="opacity-80 italic text-xs mt-8">
                  en caso de que el costo del envio sea 0 (puede que el sistema automatico de
                  calculo concurra en problemas tecnicos), debera consultar el costo del envio al
                  realizar el pedido.
                </span>
              </div>
            </details>
            <div className="hidden md:flex p-8 md:flex-col gap-2 md:w-96 overflow-y-auto">
              {cart.map((item: any, index: number) => (
                <div key={index} className="flex justify-between  border-b pb-4 items-center ">
                  <div>
                    <div className="relative w-20 h-20">
                      <Image
                        src={item.img}
                        alt={item.description}
                        width={80}
                        height={80}
                        className="border border-gray-500/80 rounded-xl bg-[#181818] w-full h-full "
                      />
                      <span className="absolute top-0 right-0 z-10 text-sm px-[6px] -translate-y-[50%] bg-gray shadow-inner bg-gray-400 shadow-white rounded-full">
                        {item.quantity}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col w-full px-6">
                    <span>{item.title}</span>
                    <span className="text-sm opacity-70">{item.description}</span>
                  </div>
                  <div>
                    <span className="font-semibold tracking-wide w-auto flex text-sm">
                      $ {item.price}
                    </span>
                  </div>
                </div>
              ))}
              <div className="mt-8 flex justify-between items-center md:pl-2 flex-col">
                <div className="w-full flex justify-between ">
                  {" "}
                  <span className="font-semibold tracking-wide ">Subtotal</span>
                  {<span className="font-semibold tracking-wide">$ {calculateTotal}</span>}
                </div>
                <div className="w-full flex justify-between">
                  <span className="font-semibold tracking-wide">Envio</span>
                  {shippingLoading ? (
                    <span className="font-semibold tracking-wide ">
                      Calculando costo de envío...
                    </span>
                  ) : shippingError || !shippingCost ? (
                    <span className="font-semibold tracking-wide text-gray-500 italic text-sm ml-8">
                      Ingrese el código postal para calcular el costo de envío
                    </span>
                  ) : (
                    <span className="font-semibold tracking-wide">$ {shippingCost}</span>
                  )}
                </div>

                <div className="w-full flex justify-between ">
                  {" "}
                  <span className="font-semibold tracking-wide ">Total</span>
                  <span className="font-semibold tracking-wide">
                    ${" "}
                    {(shippingCost && `${calculateTotal + parseFloat(shippingCost)} `) ||
                      calculateTotal}
                  </span>
                </div>
                <span className="opacity-80 italic text-sm mt-8">
                  en caso de que el costo del envio sea 0 (puede que el sistema automatico de
                  calculo concurra en problemas tecnicos), debera consultar el costo del envio al
                  realizar el pedido.
                </span>
              </div>
            </div>
          </aside>
          <div className="md:w-1/2 md:flex md:pt-10 md:justify-end max-w-screen md:mb-20">
            <div className="mb-4  md:border-none md:w-[550px] ">
              {/* Pestañas */}
              <div className="mb-4 flex items-center ">
                <button
                  onClick={() => handleTabChange("information")}
                  className={` py-2 mr-2 text-xs flex items-center  ${
                    activeTab === "information" ? "text-blue-500 font-regular" : "font-semibold"
                  }`}
                >
                  <span className="mr-1 "> Informacion</span>
                  {/* <AiOutlineRight /> */}
                  <ChevronRight />
                </button>
                <button
                  onClick={() => handleTabChange("shipping")}
                  className={` py-2 mr-2 text-xs  ${
                    activeTab === "shipping" ? "text-blue-500 font-regular" : "font-semibold"
                  }`}
                >
                  Envio
                </button>
              </div>

              {/* Contenido del formulario */}
              {activeTab === "information" && (
                <InformationForm
                  formData={formData}
                  handleChange={handleChange}
                  handleSubmit={handleSubmit}
                  handleTabChange={handleTabChange}
                  setPostalCode={setPostalCode}
                />
              )}

              {activeTab === "shipping" && (
                <ShippingForm
                  formData={formData}
                  handleChange={handleChange}
                  handleSubmit={handleSubmit}
                  handleTabChange={handleTabChange}
                  preferenceId={preferenceId}
                  handleCreatePreference={handleCreatePreference}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Suspense>
  );
}

export default Checkout;
