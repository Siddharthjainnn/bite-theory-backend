# WhatsApp setup (Meta WhatsApp Cloud API)

Bite Theory sends two kinds of WhatsApp messages from your business number:

- **Customers:** order confirmed (with the delivery-time range and a tracking link), cooking started (optional), on the way, delivered, cancelled, running late, and late make-good.
- **You and your staff:** new order, not accepted after N minutes, food ready with no rider or Porter after N minutes, book Porter now, and order running late.

Everything is queued in `notification_outbox` and sent in the background. A WhatsApp outage can never block or fail an order.

## Which number

Choose one route:

- **New number, direct with Meta (simplest).** Use a fresh SIM that is not on WhatsApp, and register it on the Cloud API as below. Your existing WhatsApp Business app number keeps working on your phone as it does today.
- **Keep your existing WhatsApp Business app number ("coexistence").** Meta offers this only through a Solution Partner or Tech Provider's Embedded Signup, not directly. It needs WhatsApp Business app 2.24.17 or newer, and the app must be opened at least every ~13 days or the number disconnects. Pick a partner that supports coexistence, then share their API details so the sender can be pointed at them.

## Steps (new number, direct)

1. **Meta Business account.** Go to business.facebook.com and create one, or use your existing one. Business verification raises your sending limits.
2. **App.** At developers.facebook.com, create an app of type Business and add the **WhatsApp** product.
3. **Phone number.** In WhatsApp Manager, add your number, set the display name ("Bite Theory"), and verify it by SMS or a call. Copy its **Phone Number ID**. This is an ID, not the number itself.
4. **Permanent token.** In Business Settings → System users, create an admin system user and assign it the app and your WhatsApp account. Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. Temporary tokens from the app dashboard expire within a day, so don't use those.
5. **Payment method.** In WhatsApp Manager, add a payment method. Template messages are billed per message, and sends fail with error 131042 without one.
6. **Templates.** In WhatsApp Manager → Message templates, create these four. Use category **Utility**, language **English**, and copy the names and text exactly. The admin panel's WhatsApp tab shows the same list.

| Name | Text |
| --- | --- |
| `bt_order_placed` | Hi {{1}}, thanks for ordering from Bite Theory! Your order {{2}} for ₹{{3}} is confirmed. Expected delivery: {{4}}. Track your order here: {{5}} — Team Bite Theory |
| `bt_order_update` | Hi {{1}}, an update on your Bite Theory order {{2}}: {{3}}. Track your order here: {{4}} — Team Bite Theory |
| `bt_order_delayed` | Hi {{1}}, sorry, your Bite Theory order {{2}} is running a little late. It is now expected around {{3}}. We are getting it to you as fast as we can. |
| `bt_kitchen_alert` | Bite Theory kitchen alert for order {{1}}: {{2}}. Open Live Orders: {{3}} to act on it. |

   One more, for the Bhawarkua opening day. Submit it as category **Marketing** (Meta files announcements there), language English. It goes once to everyone who tapped "Notify me on opening day" on the home page, at the opening time set in Admin → Home page:

| Name | Text |
| --- | --- |
| `bt_outlet_open` | Hi {{1}}, Bites Theory is now open in {{2}}! Come and visit us, or order online at our best price: {{3}} — Team Bite Theory |

   Meta asks for sample values for each variable when you submit. Approval usually takes minutes to a day.

7. **Webhook.** In the app → WhatsApp → Configuration, set:
   - Callback URL: `https://YOUR-BACKEND-HOST/api/notify/whatsapp/webhook`
   - Verify token: any string you choose. Use the same value for `WHATSAPP_VERIFY_TOKEN` below.

   Then subscribe to the **messages** field. Meta delivers both receipts and replies (STOP and START) on that field.
8. **Render environment variables**, then redeploy:

```
WHATSAPP_TOKEN=<system user token>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_APP_SECRET=<app → Settings → Basic → App secret>
WHATSAPP_VERIFY_TOKEN=<the string from step 7>
PUBLIC_SITE_URL=https://<your site>        # tracking links in messages
# optional: WHATSAPP_API_VERSION=v25.0  WHATSAPP_TEMPLATE_LANG=en  NOTIFY_SENDER=off (pause sending)
```

9. **Turn it on.** Go to Admin → Delivery → WhatsApp. Check that the status says *Connected*. Add staff numbers, switch on **Customers** and **You and your staff**, then **Save**. Send yourself a test with **Send test alert**.

## Cost (India, as of October 2026)

Utility templates cost about ₹0.145 each; the one-off `bt_outlet_open` is Marketing, about ₹1.09 each. A typical order sends 4–5 customer messages, about ₹0.60–0.75 per order, plus about ₹0.145 for each staff alert. Turning off "cooking started" saves one message per order. Messages you send by hand from the WhatsApp Business app stay free.

## Opt-out

Customers can reply **STOP** to stop order updates and **START** to resume. Checkout tells them about this when customer updates are on. In-app notifications and email are not affected by STOP.

## Troubleshooting (Admin → Delivery → WhatsApp → Recent messages)

| Shows | Meaning | Fix |
| --- | --- | --- |
| Not sent: not configured | Token or Phone Number ID missing | Set the env vars on Render and redeploy |
| Failed [132001] | Template not approved, or the name differs | Check the name and language in WhatsApp Manager |
| Failed [132000] | Variable count doesn't match | Recreate the template exactly as above |
| Failed [131026] | That number can't receive WhatsApp | Nothing to fix; in-app and email still go out |
| Failed [131042] | Payment problem | Fix the payment method in WhatsApp Manager |
| Queued, retrying [130429 / 131056] | Rate limited | Retries automatically after 30 s, 2, 10, then 30 min |
