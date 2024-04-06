import { useEffect, useState } from 'react';
import axios from 'axios';

const usePaymentInfo = (paymentId:string) => {
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchPaymentInfo = async () => {
      try {
        const response = await axios.get(`http://localhost:3000/api/payments/merchantOrder?payment_id=${paymentId}`);
        setPaymentInfo(response.data);
        setIsLoading(false);
      } catch (error:any) {
        setError(error);
        setIsLoading(false);
      }
    };

    fetchPaymentInfo();

    return () => {

    };
  }, [paymentId]);

  return { paymentInfo, isLoading, error };
};

export default usePaymentInfo;
