# Payment Microservice – RabbitMQ Integration

## 1. Présentation

Dans le cadre du TP sur la communication entre microservices, j'ai réalisé l'intégration de RabbitMQ dans le microservice Payment afin de permettre une communication asynchrone avec le microservice Shipping.

L'objectif est de déclencher la préparation d'une expédition après la réussite d'un paiement, sans que le service Payment ait besoin d'appeler directement le service Shipping.

## 2. Technologies utilisées

- Node.js
- Express.js
- RabbitMQ
- Docker et Docker Compose
- amqplib

## 3. Travail réalisé

### Configuration de RabbitMQ
- Configuration de RabbitMQ avec Docker Compose.
- Utilisation de l'image `rabbitmq:3-management`.
- Exposition des ports 5672 et 15672.
- Création de la queue durable `shipment_queue`.

### Implémentation du Publisher

Création du fichier `src/services/rabbitmqService.js` pour gérer la communication avec RabbitMQ.

Le Publisher :
- Établit une connexion avec RabbitMQ.
- Déclare la queue `shipment_queue`.
- Transforme les informations du paiement en message JSON.
- Publie l'événement avec l'option `persistent: true`.
- Attend la confirmation de publication du broker.

### Intégration avec Payment

Modification de `paymentService.js` pour publier automatiquement un événement après un paiement réussi.

Modification de `paymentController.js` pour prendre en charge le traitement asynchrone.

## 4. Format de l'événement envoyé

L'événement publié est `payment.successful`.

Exemple de message :

```json
{
  "event": "payment.successful",
  "paymentId": "example-payment-id",
  "orderId": "ORDER_TEST_001",
  "method": "CARD",
  "status": "SUCCESS",
  "createdAt": "2026-11-25T21:23:06.123Z"
}
```

## 5. Tests effectués

Un test a été réalisé avec PowerShell en envoyant une requête POST à l'API Payment.

Résultats obtenus :
- Paiement traité avec succès.
- Connexion à RabbitMQ établie.
- Queue `shipment_queue` déclarée.
- Événement `payment.successful` publié avec confirmation.
- Un message visible dans la queue RabbitMQ.

## 6. État de l'intégration

La partie Publisher du microservice Payment est implémentée et testée.

La prochaine étape consiste à intégrer le Consumer dans le microservice Shipping afin de recevoir les événements, créer les expéditions et confirmer le traitement des messages avec ACK.

## 7. Conclusion

L'intégration de RabbitMQ permet au microservice Payment de communiquer de manière asynchrone avec le microservice Shipping. Cette approche réduit le couplage direct entre les deux services et permet à RabbitMQ de conserver les messages en attente de leur consommation.
