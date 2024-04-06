// controllers/checkoutController.js
import { Request, Response } from 'express';
import { MercadoPagoConfig, Preference } from "mercadopago";
import axios from 'axios';
import Payment from '../models/payment-model';
import { enviarCorreoElectronico } from '../middleware/nodemailer';

require("dotenv").config();



interface MercadoPagoItem {
  id: string;
  title: string;
  description: string;
  category_id: string;
  unit_price: number;
  quantity: number;
  size: string;
}

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

if (!accessToken) {
  throw new Error('El token de acceso a Mercado Pago no está definido.');
}


const client = new MercadoPagoConfig({
  accessToken: accessToken,
});


export const createPreference = async (req: Request, res: Response) => {  
  try {
    const preference = new Preference(client);
    const result = await preference.create({ body: req.body });
    
    res.status(200).json({ preferenceId: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json( "Error interno del servidor" );
  }
};


const webHookController = async (req: Request, res: Response) => {
  const paymentId = req.body?.data?.id;

  try {
    let paymentData;

    try {
      const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
        },
      });

  const { date_created, additional_info, status, payer, data } = response.data;
      const { items, shipments, transaction_amount } = additional_info || {};

     paymentData = {
        paymentId,
        dateCreated: date_created,
        items: items?.map((item: any) => ({
          category_id: item.category_id || '',
          description: item.description || '',
          id: item.id || '',
          picture_url: item.picture_url || '',
          quantity: item.quantity || '',
          title: item.title || '',
          unit_price: item.unit_price || '',
        })),
        status,
        payer: {
          identification: payer?.identification || {},
          entity_type: payer?.entity_type || '',
          phone: payer?.phone || {},
          last_name: payer?.last_name || '',
          id: payer?.id || '',
          type: payer?.type || '',
          first_name: payer?.first_name || '',
          email: payer?.email || '',
        },
        shipments: {
          receiver_address: shipments?.receiver_address || {},
        },
        transaction_amount,
      };
      
      if (paymentData.status === 'approved') {
       await enviarCorreoElectronico(paymentData)
      }

      const payment = await Payment.create(paymentData);
 
 
    console.log("el pago se ha guardado con exito en la db")
    } catch (axiosError) {
      console.error("Error en la llamada a la API de MercadoPago:", axiosError);
    }

    res.status(200).json('webhook recibido exitosamente');
  } catch (error) {
    console.error("Error interno del servidor:", error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};



export const getAllPayments = async (req: Request, res: Response) => {
  try {
    let payments = await Payment.findAll();

    if (!payments) {
      payments = []; 
    }

    res.status(200).json(payments);
  } catch (error) {
    console.error('Error al obtener los pagos: ', error);
    res.status(500).json({ status: 'error', message: 'Error interno del servidor' });
  }
};


export const searchPaymentInfo = async (req: Request, res: Response) => {
  try {
    const paymentId = req.query.payment_id as string;

    // Realizar la búsqueda de la información del pago utilizando el paymentId
    const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    });


    
    // Enviar la información del pago como respuesta al cliente
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error al buscar la información del pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};













export default { createPreference, webHookController, getAllPayments, searchPaymentInfo  };


