// server.js

// Check if not in production, then load .env
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const mongoose = require('mongoose');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const cors = require('cors');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const qrcode = require('qrcode');
const sharp = require('sharp');
const path = require('path');
const Purchase = require('./models/Purchase'); // Import the new Purchase model

const app = express();

// --- Connect to MongoDB ---
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected...');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    // Exit process with failure if DB connection fails
    process.exit(1);
  }
};
connectDB(); // Connect to the database when the server starts

// --- Webhook Route (MUST come before general express.json()) ---
app.post('/api/paystack-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    console.log('Webhook Error: Invalid signature');
    return res.sendStatus(401);
  }

  const event = JSON.parse(req.body.toString());

  if (event.event === 'charge.success') {
    const { customer, metadata, reference, amount } = event.data;
    const cart = metadata.cart || [];

    try {
      // 1. SAVE THE ENTIRE PURCHASE TO THE DATABASE
      const newPurchase = new Purchase({
        buyerName: metadata.full_name,
        buyerEmail: customer.email,
        inventory: cart.map(item => ({ ticketType: item.type, quantity: item.quantity, name: item.name })),
        totalAmount: amount, // Amount is in kobo
        paystackReference: reference,
      });
      await newPurchase.save();
      console.log(`Purchase ${reference} saved to database.`);

    } catch (dbError) {
      // Check for duplicate key error, which means we've already processed this webhook
      if (dbError.code === 11000) {
        console.log(`Webhook for purchase ${reference} already processed. Ignoring.`);
        return res.sendStatus(200); // Acknowledge receipt to prevent retries
      }
      console.error('Database save error:', dbError);
    }

    console.log(`Payment successful for ${customer.email}. Generating individual tickets...`);

    // 2. GENERATE AND EMAIL EACH INDIVIDUAL TICKET
    for (const item of cart) {
      for (let i = 0; i < item.quantity; i++) {
        try {
          const ticketId = `ULES-${item.type.toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          const qrCodeDataUrl = await qrcode.toDataURL(ticketId, { width: 250, margin: 1 });
          const qrCodeBuffer = Buffer.from(qrCodeDataUrl.split(",")[1], 'base64');
          const baseTicketPath = path.join(__dirname, 'assets', `${item.type}-ticket.png`);

          const finalTicketBuffer = await sharp(baseTicketPath)
            .composite([{ input: qrCodeBuffer, top: 100, left: 650 }])
            .png()
            .toBuffer();

          sgMail.setApiKey(process.env.SENDGRID_API_KEY);
          const msg = {
            to: customer.email,
            from: 'sadiqadetola08@gmail.com', // Your verified sender
            subject: `Your ULES Dinner Ticket: ${item.name}`,
            html: `<h1>Thank You, ${metadata.full_name}!</h1><p>Please find your attached ticket. ID: ${ticketId}</p>`,
            attachments: [{
              content: finalTicketBuffer.toString('base64'),
              filename: `ules-ticket-${ticketId}.png`,
              type: 'image/png',
              disposition: 'attachment'
            }],
          };
          await sgMail.send(msg);
          console.log(`Successfully sent ticket ${item.name} #${i + 1} to ${customer.email}`);

        } catch (ticketError) {
          console.error(`Error generating ticket ${item.name} #${i + 1}:`, ticketError);
        }
      }
    }
  }

  res.sendStatus(200);
});

// --- General Middleware ---
app.use(cors());
app.use(express.json());

// --- Environment Variables & Routes ---
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PORT = process.env.PORT || 3000;

app.post('/api/pay', async (req, res) => {
  const { email, name, amount, cart } = req.body;
  if (!email || !name || !amount || !cart || cart.length === 0) {
    return res.status(400).json({ message: 'Email, name, amount, and cart are required.' });
  }

  const params = JSON.stringify({
    email, amount, metadata: { full_name: name, cart },
    callback_url: 'https://ticketgenerator-rho.vercel.app/pages/success.html',
  });

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: params
    });
    const data = await response.json();
    if (!data.status) {
      return res.status(500).json({ message: data.message });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});

// --- Start the server ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!PAYSTACK_SECRET_KEY) console.warn('WARNING: PAYSTACK_SECRET_KEY is not set.');
  if (!process.env.SENDGRID_API_KEY) console.warn('WARNING: SENDGRID_API_KEY is not set.');
  if (!process.env.MONGODB_URI) console.warn('WARNING: MONGODB_URI is not set.');
});