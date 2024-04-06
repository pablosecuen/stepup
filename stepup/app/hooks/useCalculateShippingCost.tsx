import { useState } from "react";
import axios from "axios";

const useCalculateShippingCost = () => {
  const [shippingCost, setShippingCost] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const calculateShippingCost = async (codigoPostal: string) => {
    setLoading(true);
    try {
      const response = await axios.post(
        "http://localhost:3000/api/payments/shipping-cost",
        {
          codigoPostal: codigoPostal,
        }
      );

      setShippingCost(response.data.valorTarifa);
    } catch (error: any) {
      setError(error.message || "Error al calcular el costo del envío");
    } finally {
      setLoading(false);
    }
  };

  return { shippingCost, error, loading, calculateShippingCost };
};

export default useCalculateShippingCost;
