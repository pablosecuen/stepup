// app.ts
require('dotenv').config();
import express from 'express';
import {v2 as cloudinary} from 'cloudinary';

import paymentsRoutes from './routes/payments-route';
import morgan from 'morgan';

const app = express();
const PORT = process.env.PORT || 3000; 
          
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET
});



app.use((req, res, next) => {
      const allowedOrigins = [
        "http://localhost:3001"
    ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS,PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  // Handling preflight requests
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use('/api/payments', paymentsRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});