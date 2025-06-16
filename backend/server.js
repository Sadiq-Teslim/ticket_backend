require('dotenv').config()
const express = require('express')
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args))
const cors = require('cors')

const app = express()

// Middleware
app.use(cors()) 
app.use(express.json()) 

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY
const PORT = process.env.PORT || 3000

// The API endpoint to initialize a transaction
app.post('/api/pay', async (req, res) => {
  const { email, name, amount } = req.body

  if (!email || !name || !amount) {
    return res
      .status(400)
      .json({ message: 'Email, name, and amount are required.' })
  }

  const params = JSON.stringify({
    email: email,
    amount: amount,
    metadata: {
      full_name: name
    },
    callback_url: 'http://localhost:3000/pages/success.html',
  })

  try {
    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: params
      }
    )

    const data = await response.json()

    if (!data.status) {
      console.error('Paystack error:', data)
      return res.status(500).json({ message: data.message })
    }

    // Send the authorization_url back to the frontend
    res.status(200).json(data)
  } catch (error) {
    console.error('Server error:', error)
    res.status(500).json({ message: 'An internal server error occurred.' })
  }
})

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
  if (!PAYSTACK_SECRET_KEY) {
    console.warn('WARNING: PAYSTACK_SECRET_KEY is not set. Payments will fail.')
  }
})
