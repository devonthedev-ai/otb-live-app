// app/api/stripe/webhooks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/app/lib/supabase/server';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  const supabase = createClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.metadata?.workspace_id;
        const subscriptionId = session.subscription as string;

        if (workspaceId && subscriptionId) {
          // Get subscription details
          const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0].price.id;

          // Map price to plan
          let plan = 'starter';
          if (priceId === process.env.STRIPE_GROWTH_PRICE_ID) plan = 'growth';
          if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) plan = 'enterprise';

          // Update workspace
          await supabase
            .from('workspaces')
            .update({
              plan,
              stripe_subscription_id: subscriptionId,
            })
            .eq('id', workspaceId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const subscriptionId = invoice.subscription as string | null;

        if (!subscriptionId) break;

        // Find workspace by subscription
        const { data: workspace } = await supabase
          .from('workspaces')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .single();

        if (workspace) {
          // Downgrade to free or mark for review
          await supabase
            .from('workspaces')
            .update({ plan: 'free' })
            .eq('id', workspace.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;

        // Find and downgrade workspace
        const { data: workspace } = await supabase
          .from('workspaces')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .single();

        if (workspace) {
          await supabase
            .from('workspaces')
            .update({
              plan: 'free',
              stripe_subscription_id: null,
            })
            .eq('id', workspace.id);
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
