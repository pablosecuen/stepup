// routes/productRoutes.ts
import express from 'express';
import paymentController from '../controllers/payment-controller';





const router = express.Router();


router.get('/list',  paymentController.getAllPayments);

router.post('/preference',  paymentController.createPreference);

router.post('/webhook', paymentController.webHookController);

router.get('/merchantOrder', paymentController.searchPaymentInfo);

router.post('/shipping-cost', paymentController.calculateShippingCost);



export default router;
