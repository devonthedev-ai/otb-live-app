// app/api/shopify/webhooks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/app/lib/shopify/auth';
import { processOrderWebhook, processInventoryWebhook } from '@/app/lib/shopify/webhooks';
import { createClient } from '@/app/lib/supabase/server';

// Map Shopify topics to our internal types
const TOPIC_MAP: Record<string, string> = {
  'orders/create': 'order.created',
  'orders/updated': 'order.updated',
  'inventory_levels/update': 'inventory.updated',
  'products/create': 'product.created',
  'products/update': 'product.updated',
};

export async function POST(request: NextRequest) {
  const topic = request.headers.get('x-shopify-topic');
  const shop = request.headers.get('x-shopify-shop-domain');
  const hmac = request.headers.get('x-shopify-hmac-sha256');

  if (!topic || !shop || !hmac) {
    return NextResponse.json({ error: 'Missing headers' }, { status: 400 });
  }

  // Get raw body
  const body = await request.text();

  // Verify webhook signature
  if (!await verifyWebhookSignature(body, hmac)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const supabase = createClient();

  // Find workspace by shop domain
  const { data: integration } = await supabase
    .from('integrations')
    .select('workspace_id, is_active')
    .eq('provider', 'shopify')
    .eq('credentials->>shop', shop)
    .single();

  if (!integration || !integration.is_active) {
    return NextResponse.json({ error: 'Shop not found or inactive' }, { status: 404 });
  }

  const workspaceId = integration.workspace_id;
  const eventType = TOPIC_MAP[topic] || topic;

  // Queue webhook for processing
  const { error: queueError } = await supabase
    .from('webhook_events')
    .insert({
      workspace_id: workspaceId,
      provider: 'shopify',
      event_type: eventType,
      payload,
      processed: false,
    });

  if (queueError) {
    console.error('Failed to queue webhook:', queueError);
    return NextResponse.json({ error: 'Failed to queue' }, { status: 500 });
  }

  // Process immediately for critical events
  try {
    if (topic === 'orders/create') {
      await processOrderWebhook(workspaceId, shop, payload);
    } else if (topic === 'inventory_levels/update') {
      await processInventoryWebhook(workspaceId, payload);
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Don't fail the response - webhook is queued for retry
  }

  return NextResponse.json({ received: true });
}

// Required for Shopify webhook verification
export const runtime = 'edge';
export const preferredRegion = 'iad1'; // US East
