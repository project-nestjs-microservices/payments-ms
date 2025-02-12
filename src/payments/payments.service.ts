import {Inject, Injectable} from '@nestjs/common';
import {envs, NATS_SERVICE} from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import {ClientProxy} from "@nestjs/microservices";

@Injectable()
export class PaymentsService {


    private readonly stripe = new Stripe(envs.stripeSecret)

    constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

    async createPaymentSession(paymentSessionDto: PaymentSessionDto) {

        const { currency, items, orderId } = paymentSessionDto

        const lineItems = items.map(item => {
            return {
                price_data: {
                    currency: currency,
                    product_data: {
                        name: item.name,
                    },
                    unit_amount: Math.round(item.price * 100) //20 dolares -> 2000 / 100 = 20
                },
                quantity: item.quantity
            }
        })
        
        const session = await this.stripe.checkout.sessions.create({
            payment_intent_data: {
                metadata: {
                    orderId
                }
            },

            line_items: lineItems,
            mode: 'payment',
            success_url: envs.stripeSuccessUrl,
            cancel_url: envs.stripeCancelledUrl
        })

        return {
            cancelUrl: session.cancel_url,
            success_url: session.success_url,
            url: session.url
        }
    }

    async stripeWebhook(req: Request, res: Response) {
        const sig = req.headers['stripe-signature']
        
        let event: Stripe.Event
        const endpointSecret = envs.stripeEndpointSecret

        try {
            event = this.stripe.webhooks.constructEvent(
                req['rawBody'],
                sig,
                endpointSecret
            )
        } catch (err) {
            console.log({ "Error at Catch": err })
            return res.status(400).send(`Webhook Error: ${err.message}`)
        }

        switch (event.type) {
            case 'charge.succeeded':
              const chargeSucceeded = event.data.object;
              const payload = {
                  stripePaymentId: chargeSucceeded.id,
                  orderId: chargeSucceeded.metadata.orderId,
                  receiptUrl: chargeSucceeded.receipt_url,
              }

              console.log("Payload Payments Services: ", payload)
              this.client.emit('payment.succeeded', payload)
              break;
            default:
              console.log(`Event ${ event.type } not handled`)
          }


        return res.status(200).send({ sig })
    }

}
