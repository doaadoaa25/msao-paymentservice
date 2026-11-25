
const paymentModel = require("../models/paymentModel");
const paymentService = require("../services/paymentService");

// GET: récupérer tous les paiements
function getAllPayments(req, res) {
    const payments = paymentModel.getAllPayments();
    res.status(200).json(payments);
}

// GET: récupérer un paiement par orderId
function getPaymentByOrderId(req, res) {
    const { orderId } = req.params;

    const payment = paymentModel.getPaymentByOrderId(orderId);

    if (!payment) {
        return res.status(404).json({
            message: "Payment not found"
        });
    }

    res.status(200).json(payment);
}

// POST: créer un paiement

async function createPayment(req, res) {
    try {
        const { orderId, method } = req.body;

        const payment = await paymentService.processPayment(
            orderId,
            method
        );

        res.status(201).json({
            message: "Payment processed successfully",
            payment: payment,
            shipmentEvent: "PUBLISHED"
        });

    } catch (error) {
        console.error("Payment error:", error.message);

        res.status(500).json({
            message: error.message
        });
    }
}


module.exports = {
    getAllPayments,
    getPaymentByOrderId,
    createPayment
};
