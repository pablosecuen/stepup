
import nodemailer from 'nodemailer';
require("dotenv").config();
export const enviarCorreoElectronico = async (paymentData: any) => {
    const { payer, items, transaction_amount } = paymentData;

    // Configurar el transporter para enviar el correo electrónico
const transporter = nodemailer.createTransport({
  host: process.env.HOST_SMTP, 
  port: 465,
  secure: true, 
  auth: {
    user: process.env.SMTP_USER, 
    pass: process.env.SMTP_PASSWORD, 
  },
});

    // Crear el cuerpo del correo electrónico
    const mailOptions = {
        from: process.env.SMTP_USER, // Correo electrónico del remitente
        to: "pablosecuen@gmail.com", // Correo electrónico del destinatario (usuario que realizó la compra)
        subject: 'Confirmación de compra', // Asunto del correo electrónico
        cc: "web@carbonloslenos.com",
        html: `<p>Hola ${payer.first_name},</p>
           <p>Gracias por tu compra. Aquí está la información de tu compra:</p>
           <ul>
             ${items.map((item: any) => `<li>${item.title}: $${item.unit_price}</li>`).join('')}
           </ul>
           <p>Total pagado: $${transaction_amount}</p>`, // Cuerpo del correo electrónico en formato HTML
    };

    // Enviar el correo electrónico
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Error al enviar el correo electrónico:", error);
        } else {
            console.log("Correo electrónico enviado:", info.response);
        }
    })
}