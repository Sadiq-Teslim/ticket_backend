// Check if not in production, then load .env
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const cors = require('cors');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const qrcode = require('qrcode');
const sharp = require('sharp');
const path = require('path');

const app = express();

// --- Webhook Route (MUST come before general express.json()) ---
// This route listens for successful payment events from Paystack.
app.post('/api/paystack-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  // Validate the request is from Paystack by checking the signature
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    console.log('Webhook Error: Invalid signature');
    return res.sendStatus(401); // Unauthorized
  }

  const event = JSON.parse(req.body.toString());

  // Listen for the 'charge.success' event
  if (event.event === 'charge.success') {
    const { customer, metadata } = event.data;
    // Retrieve the cart details we stored in metadata
    const cart = metadata.cart || [];

    console.log(`Payment successful for ${customer.email}. Generating tickets...`);

    // Loop through each item in the cart (e.g., 2 Regular tickets, 1 VIP ticket)
    for (const item of cart) {
      // Loop for the quantity of each ticket type
      for (let i = 0; i < item.quantity; i++) {
        try {
          // 1. Generate a unique ID for this specific ticket
          const ticketId = `ULES-${item.type.toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

          // 2. Generate a QR Code image buffer from the unique ID
          const qrCodeDataUrl = await qrcode.toDataURL(ticketId, { width: 250, margin: 1 });
          const qrCodeBuffer = Buffer.from(qrCodeDataUrl.split(",")[1], 'base64');

          // 3. Select the correct base ticket image from the 'assets' folder
          const baseTicketPath = path.join(__dirname, 'assets', `${item.type}-ticket.png`);

          // 4. Composite the QR Code onto the base ticket image
          const finalTicketBuffer = await sharp(baseTicketPath)
            .composite([{
              input: qrCodeBuffer,
              // IMPORTANT: You MUST adjust these values to position the QR code correctly on your ticket image
              top: 450,
              left: 150
            }])
            .png()
            .toBuffer();

          // 5. Configure and send the email with the ticket as an attachment
          sgMail.setApiKey(process.env.SENDGRID_API_KEY);
          const msg = {
            to: customer.email,
            from: 'your-verified-email@example.com', // MUST be your verified SendGrid sender email
            subject: `Your ULES Dinner Ticket: ${item.name}`,
            html: `
                            <h1>Thank You, ${metadata.full_name}!</h1>
                            <p>We are thrilled to have you at the ULES Annual Dinner & Awards Night.</p>
                            <p>Please find your attached ticket. This ticket is unique and can only be used once.</p>
                            <p><strong>Ticket ID:</strong> ${ticketId}</p>
                            <hr>
                            <h3>Event Details:</h3>
                            <ul>
                                <li><strong>Date:</strong> Monday, September 3, 2025</li>
                                <li><strong>Time:</strong> 7:00 PM Prompt</li>
                                <li><strong>Venue:</strong> Eko Hotel Grand Ballroom</li>
                            </ul>
                            <p>We look forward to celebrating with you!</p>
                        `,
            attachments: [{
              content: finalTicketBuffer.toString('base64'),
              filename: `ules-ticket-${item.type}-${ticketId}.png`,
              type: 'image/png',
              disposition: 'attachment'
            }],
          };

          await sgMail.send(msg);
          console.log(`Successfully generated and sent ${item.name} #${i + 1} to ${customer.email}`);

        } catch (error) {
          console.error(`Error generating ticket ${item.name} #${i + 1}:`, error.response ? error.response.body : error);
        }
      }
    }
  }

  // Acknowledge receipt of the event to Paystack
  res.sendStatus(200);
});


// --- General Middleware ---
app.use(cors());
app.use(express.json());

// --- Environment Variables ---
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PORT = process.env.PORT || 3000;

// --- Initialize Payment Route (Updated to accept cart details) ---
app.post('/api/pay', async (req, res) => {
  // Get the detailed cart and other info from the frontend request
  const { email, name, amount, cart } = req.body;

  if (!email || !name || !amount || !cart || cart.length === 0) {
    return res.status(400).json({ message: 'Email, name, amount, and cart are required.' });
  }

  const params = JSON.stringify({
    email: email,
    amount: amount,
    // Store the detailed cart and user's name in Paystack's metadata
    metadata: {
      full_name: name,
      cart: cart
    },
    // This URL is where the user is sent back to after payment
    callback_url: 'https://ticketgenerator-rho.vercel.app/pages/success.html',
  });

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: params
    });

    const data = await response.json();

    if (!data.status) {
      console.error('Paystack error:', data.message);
      return res.status(500).json({ message: data.message });
    }

    // Send the authorization_url back to the frontend to redirect the user
    res.status(200).json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
});

// --- Start the server ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!PAYSTACK_SECRET_KEY) {
    console.warn('WARNING: PAYSTACK_SECRET_KEY is not set. Payments will fail.');
  }
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('WARNING: SENDGRID_API_KEY is not set. Emails will not be sent.');
  }
});