const mongoose = require('mongoose');

// This defines the structure for storing the overall purchase order
const PurchaseSchema = new mongoose.Schema({
    buyerName: {
        type: String,
        required: true,
    },
    buyerEmail: {
        type: String,
        required: true,
    },
    // This stores what the user bought, e.g., [{ type: 'regular', quantity: 2 }]
    inventory: [
        {
            ticketType: String,
            quantity: Number,
            name: String,
        }
    ],
    totalAmount: {
        type: Number, // Stored in kobo, as received from Paystack
        required: true,
    },
    paystackReference: {
        type: String,
        required: true,
        unique: true,
    },
    purchaseDate: {
        type: Date,
        default: Date.now, // Automatically records the time and date
    },
});

module.exports = mongoose.model('Purchase', PurchaseSchema);