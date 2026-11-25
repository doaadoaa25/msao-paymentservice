
const amqp = require("amqplib");

const QUEUE = process.env.RABBITMQ_QUEUE || "shipment_queue";

let connection = null;
let channel = null;
let connecting = null;

async function getChannel() {
    if (channel) {
        return channel;
    }

    if (connecting) {
        return connecting;
    }

    connecting = (async () => {
        const conn = await amqp.connect(
            process.env.RABBITMQ_URL ||
            "amqp://guest:guest@localhost:5672"
        );

        conn.on("error", (error) => {
            console.error("RabbitMQ connection error:", error.message);
            connection = null;
            channel = null;
        });

        conn.on("close", () => {
            console.log("RabbitMQ connection closed");
            connection = null;
            channel = null;
        });

        connection = conn;

        const ch = await conn.createConfirmChannel();

        await ch.assertQueue(QUEUE, {
            durable: true
        });

        channel = ch;

        console.log("Connected to RabbitMQ");
        console.log(`Queue ready: ${QUEUE}`);

        return ch;
    })();

    try {
        return await connecting;
    } finally {
        connecting = null;
    }
}

async function publishPaymentSuccess(payment) {
    const ch = await getChannel();

    const message = {
        event: "payment.successful",
        paymentId: payment.id,
        orderId: payment.orderId,
        method: payment.method,
        status: payment.status,
        createdAt: payment.createdAt
    };

    ch.sendToQueue(
        QUEUE,
        Buffer.from(JSON.stringify(message)),
        {
            persistent: true,
            contentType: "application/json"
        }
    );

    await ch.waitForConfirms();

    console.log("Payment event published:", message);

    return message;
}

module.exports = {
    publishPaymentSuccess
};
