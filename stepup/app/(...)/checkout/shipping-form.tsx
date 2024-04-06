import { Wallet } from "@mercadopago/sdk-react";

import { useState } from "react";
import useCalculateShippingCost from "@/app/hooks/useCalculateShippingCost";
import ChevronLeft from "@/app/components/icons/chevron-left";

const ShippingForm = ({
  formData,
  preferenceId,
  handleSubmit,
  handleTabChange,
  handleCreatePreference,
}: any) => {
  const [postalCode, setPostalCode] = useState("");
  const { shippingCost, error, loading, calculateShippingCost } = useCalculateShippingCost();

  const handleChange = (e: any) => {
    setPostalCode(e.target.value);
    if (e.target.value.length === 4) {
      calculateShippingCost(e.target.value);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="border rounded-lg px-4 mb-10  ">
        <div className="flex justify-between gap-2 border-b py-4">
          <div className="flex flex-col gap-2">
            <span className="opacity-70 text-sm ">Contacto</span>
            <span className="text-sm">
              {formData.area_code} {"-"}
              {formData.number}
            </span>
          </div>
          <button
            onClick={() => handleTabChange("information")}
            className="text-blue-600 underline"
          >
            cambiar
          </button>
        </div>

        <div className="flex justify-between gap-2 py-4">
          <div className="flex flex-col gap-2">
            <span className="opacity-70 text-sm">Envio</span>
            <span className="text-sm">
              {formData.calle}, {formData.altura}, {formData.ciudad}, {formData.provincia},{" "}
              {formData.codigoPostal}
            </span>
          </div>
          <button
            onClick={() => handleTabChange("information")}
            className="text-blue-600 underline"
          >
            cambiar
          </button>
        </div>
      </div>

      {preferenceId && (
        <Wallet
          initialization={{ preferenceId: preferenceId }}
          customization={{ texts: { valueProp: "smart_option" } }}
        />
      )}
      {!preferenceId && (
        <button
          color="primary"
          type="button"
          onClick={() => handleCreatePreference()}
          className="w-full bg-blue-600 text-white py-6 rounded-md"
        >
          Generar Pago
        </button>
      )}
      <button
        type="button"
        onClick={() => handleTabChange("information")}
        className="flex justify-center w-full h-16 mt-6 items-center  semibold"
      >
        <ChevronLeft />
        <span className="text-blue-600 pl-2">Volver a informacion</span>
      </button>
    </form>
  );
};

export default ShippingForm;
