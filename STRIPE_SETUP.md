# Stripe setup — one-time install

This gets the Firebase Extension and your Stripe product ready so the
Subscribe button in the app actually does something. Estimated time:
**~20 minutes**, all via web UIs.

The code for checkout + customer portal is already shipped. The
Subscribe card hides itself until `environment.stripe.priceId` is
filled in at the bottom of this doc.

---

## Step 1 — Create a Stripe account (2 min)

1. Go to <https://stripe.com/> → "Start now" → sign up.
2. Skip "Activate your account" for now — you can use **test mode** end-to-end to verify the flow before enabling live mode.
3. In the Stripe dashboard, top-left, make sure the **Test mode** toggle is ON (orange). You'll switch it off after verifying.

## Step 2 — Create the product + price (3 min)

1. Left sidebar → **Product catalog** → **+ Add product**.
2. Name: `Macro Log Pro`
3. Description: `Unlimited AI coach, higher photo quota, webhook, weekly reports.`
4. Price: `3.00 USD`, **Recurring**, Billing period: **Monthly**.
5. Click **Save product**.
6. On the product page, click the price → copy the **Price ID** (starts with `price_...`). Save this somewhere — you'll paste it in Step 6.
7. **Important — set the Firebase role metadata.** Click the product (not the price) → **Edit metadata** → add key `firebaseRole` = `paid`. This is how the extension knows which custom claim to set on subscribed users.

## Step 3 — Install the Firebase Extension (5 min)

In a terminal, from the repo root:

```sh
firebase ext:install invertase/firestore-stripe-payments --project=fitness-tracker-gb-1775407101
```

You'll be prompted for several parameters. Recommended answers:

| Prompt | Answer |
|---|---|
| Cloud Functions location | `us-central1` (matches your other functions) |
| Products and pricing plans collection | `products` (default) |
| Customer details and subscriptions collection | `customers` (default) |
| Stripe configuration collection | `configuration` (default) |
| Sync new users to Stripe | `Do not sync` (creates on first checkout, cheaper) |
| Automatically delete Stripe customer objects | `Auto delete` (matches your `deleteAccount` function — privacy-clean) |
| Stripe API key with restricted access | See Step 4 below |
| Stripe webhook secret | Leave blank for now — you'll update after Step 5 |
| Extension instance id | Leave default: `firestore-stripe-payments` |

## Step 4 — Create a restricted Stripe API key

Don't paste your full secret key into the extension. Create a scoped one:

1. Stripe dashboard (test mode) → top-right profile → **Developers** → **API keys**.
2. Scroll down → **Restricted keys** → **+ Create restricted key**.
3. Name: `firebase-extension-restricted`.
4. Permissions (all under "Resource access"):
   - **Customers** — Write
   - **Checkout Sessions** — Write
   - **Customer portal** — Write
   - **Subscriptions** — Read
   - **Prices** — Read
   - **Products** — Read
   - **Tax rates** — Read
   - Everything else: **None**.
5. Click **Create key** → copy the value (starts with `rk_test_...`) → paste into the extension installer prompt.

## Step 5 — Register the Stripe webhook (3 min)

After the extension finishes installing, it prints a **function URL** for the webhook handler. It looks like:

```
https://us-central1-fitness-tracker-gb-1775407101.cloudfunctions.net/ext-firestore-stripe-payments-handleWebhookEvents
```

1. Stripe dashboard → **Developers** → **Webhooks** → **+ Add endpoint**.
2. Endpoint URL: paste the URL above.
3. Events to send: click **+ Select events** and subscribe to at minimum:
   - `product.created`, `product.updated`, `product.deleted`
   - `price.created`, `price.updated`, `price.deleted`
   - `checkout.session.completed`
   - `customer.subscription.created`, `.updated`, `.deleted`
   - `invoice.paid`, `invoice.payment_failed`
   - `tax_rate.created`, `tax_rate.updated`
4. Click **Add endpoint**.
5. On the endpoint page, click **Reveal** next to "Signing secret" → copy the value (starts with `whsec_...`).
6. Update the extension config with this secret:
   ```sh
   firebase ext:configure firestore-stripe-payments --project=fitness-tracker-gb-1775407101
   ```
   When prompted for "Stripe webhook secret", paste the `whsec_...`.

## Step 6 — Paste the price ID into environment.ts

Open `src/environments/environment.ts` and set:

```ts
stripe: {
  priceId: 'price_XXX_FROM_STEP_2',   // your Price ID
  displayPrice: '$3/mo',
  trialDays: 7,
},
```

Commit, push, and redeploy hosting:

```sh
npx ng build
firebase deploy --only hosting
```

The Subscribe card will now render in the app footer.

## Step 7 — Verify end-to-end in test mode

1. Open <https://macrolog.web.app> in an incognito window.
2. Sign in with a Google account that's not already subscribed.
3. Scroll to the footer → you should see **"support · $3/mo (7-day free trial)"**.
4. Click it → Stripe Checkout opens.
5. Use Stripe's test card: `4242 4242 4242 4242`, any future date, any CVC, any ZIP.
6. Complete checkout. You should redirect back to the app.
7. Within ~5 seconds, the footer card should flip to "on free trial until [date]…" with a "manage" button.
8. Click manage → Stripe Customer Portal opens. Cancel the subscription there. Back in the app, the card should flip back to the Subscribe state.

If anything goes wrong:
- Check the Cloud Functions logs: `firebase functions:log --project=fitness-tracker-gb-1775407101 --only=ext-firestore-stripe-payments-handleWebhookEvents`
- Check the Stripe webhook delivery: Stripe dashboard → Developers → Webhooks → your endpoint → **Events**. Retry failed events from here.

## Step 8 — Go live

Once the test flow works end-to-end:

1. In Stripe dashboard, top-left, toggle **Test mode** OFF.
2. Repeat **Step 2** in live mode (create a separate live-mode product + price). Copy the new `price_...` — it's different from the test one.
3. Repeat **Step 4** — create a new restricted key in live mode.
4. Repeat **Step 5** — create a new webhook endpoint in live mode (Stripe keeps test and live webhooks separate).
5. Run `firebase ext:configure firestore-stripe-payments` again and swap the API key + webhook secret to the live-mode versions.
6. Update `environment.ts` with the live-mode `priceId`.
7. Deploy.
8. Charge your first customer.

---

## Notes

- **No hard feature gates yet.** This ship wires checkout + portal + subscription state into the app, but nothing *requires* a subscription. The Subscribe card is voluntary support. Feature gates (webhook-only-for-paid, unlimited-AI-for-paid, etc.) will come in a later PR once there's real subscriber data to shape the free tier with.
- **Custom claims take ~1 minute to propagate.** After a successful checkout, the user's `request.auth.token.stripeRole` claim becomes `paid`, but they may need to sign out and back in once for the ID token to refresh. This is a Firebase Auth quirk, not an extension bug. We'll call `getIdToken(true)` from the app in the gating PR to force-refresh.
- **Stripe fees.** $3/mo subscription → Stripe keeps ~$0.39 (2.9% + $0.30 for a US card). Net: ~$2.61/sub/mo. Annual plan ($30/yr) nets ~$28.57/sub/yr after fees.
- **Refunds.** Full refund through the Stripe dashboard — no app work needed. Customer portal does not expose refunds (deliberate; you control that flow).
- **Cancellations.** Users cancel via the Customer Portal. Subscription stays active until `current_period_end`, then status flips to `canceled`. Our UI will handle that gracefully (`isPaid` becomes false at period end).
