// lib/shopify/webhooks.ts - Process Shopify webhooks
import { createClient } from '../supabase/client';
import { ShopifyAPI } from './api';

interface OrderWebhookPayload {
  id: string;
  name: string;
  created_at: string;
  line_items: Array<{
    id: string;
    variant_id: string;
    title: string;
    quantity: number;
    price: string;
  }>;
}

interface InventoryWebhookPayload {
  inventory_item_id: string;
  available: number;
  location_id: string;
}

/**
 * Process order/create webhook
 */
export async function processOrderWebhook(
  workspaceId: string,
  shop: string,
  payload: OrderWebhookPayload
) {
  const supabase = createClient();
  
  // Get integration for this workspace/shop
  const { data: integration } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'shopify')
    .single();

  if (!integration) throw new Error('Integration not found');

  const accessToken = integration.credentials.access_token as string;
  const api = new ShopifyAPI(shop, accessToken);

  // Get product mapping from our database
  const { data: products } = await supabase
    .from('products')
    .select('id, metadata')
    .eq('workspace_id', workspaceId);

  const sales = [];
  
  for (const item of payload.line_items) {
    // Find our product by Shopify variant ID
    const product = products?.find(
      p => p.metadata?.shopify_variant_id === item.variant_id.toString()
    );

    if (!product) continue;

    sales.push({
      workspace_id: workspaceId,
      product_id: product.id,
      units: item.quantity,
      net_sales: parseFloat(item.price) * item.quantity,
      sale_date: payload.created_at.split('T')[0],
      channel: 'online',
      source: 'shopify_webhook',
    });
  }

  if (sales.length > 0) {
    const { error } = await supabase.from('sales').insert(sales);
    if (error) throw error;
  }

  return { processed: sales.length };
}

/**
 * Process inventory_levels/update webhook
 */
export async function processInventoryWebhook(
  workspaceId: string,
  payload: InventoryWebhookPayload
) {
  const supabase = createClient();

  // Find product by Shopify inventory item ID
  const { data: products } = await supabase
    .from('products')
    .select('id, metadata')
    .eq('workspace_id', workspaceId);

  const product = products?.find(
    p => p.metadata?.shopify_inventory_item_id === payload.inventory_item_id.toString()
  );

  if (!product) return { skipped: true };

  // Update inventory
  const { error } = await supabase
    .from('inventory')
    .update({ 
      on_hand: payload.available,
      last_synced_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('product_id', product.id);

  if (error) throw error;

  return { updated: true };
}

/**
 * Sync all products from Shopify to our database
 */
export async function syncProducts(
  workspaceId: string,
  shop: string,
  accessToken: string
) {
  const api = new ShopifyAPI(shop, accessToken);
  const supabase = createClient();

  const products = [];
  let hasNextPage = true;
  let cursor: string | undefined;

  // Fetch all products
  while (hasNextPage) {
    const data = await api.getProducts(cursor);
    
    for (const edge of data.products.edges) {
      const product = edge.node;
      
      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        
        // Parse SKU: STYLE-COLOR-SIZE
        const skuParts = variant.sku?.split('-') || [];
        const style = skuParts[0] || variant.sku || product.title;
        const color = skuParts[1] || 'Default';
        const size = skuParts[2] || 'OS';

        products.push({
          workspace_id: workspaceId,
          style,
          color,
          size,
          category: product.productType,
          vendor: product.vendor,
          cost: parseFloat(variant.inventoryItem?.cost?.amount || '0'),
          metadata: {
            shopify_product_id: product.id,
            shopify_variant_id: variant.id,
            shopify_inventory_item_id: variant.inventoryItem?.id,
            shopify_sku: variant.sku,
          },
        });
      }
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.edges[data.products.edges.length - 1]?.cursor;
  }

  // Batch insert/update
  const { error } = await supabase
    .from('products')
    .upsert(products, { onConflict: 'workspace_id,style,color,size' });

  if (error) throw error;

  // Create inventory records for new products
  const { data: existingInventory } = await supabase
    .from('inventory')
    .select('product_id')
    .eq('workspace_id', workspaceId);

  const existingIds = new Set(existingInventory?.map(i => i.product_id));
  const { data: allProducts } = await supabase
    .from('products')
    .select('id')
    .eq('workspace_id', workspaceId);

  const newInventory = allProducts
    ?.filter(p => !existingIds.has(p.id))
    .map(p => ({
      workspace_id: workspaceId,
      product_id: p.id,
      on_hand: 0,
    })) || [];

  if (newInventory.length > 0) {
    await supabase.from('inventory').insert(newInventory);
  }

  return { count: products.length };
}

/**
 * Sync recent orders from Shopify
 */
export async function syncOrders(
  workspaceId: string,
  shop: string,
  accessToken: string,
  days: number = 30
) {
  const api = new ShopifyAPI(shop, accessToken);
  const supabase = createClient();

  // Get products for mapping
  const { data: products } = await supabase
    .from('products')
    .select('id, metadata')
    .eq('workspace_id', workspaceId);

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const sales = [];
  let hasNextPage = true;
  let cursor: string | undefined;

  while (hasNextPage) {
    const data = await api.getOrders(sinceStr, cursor);

    for (const edge of data.orders.edges) {
      const order = edge.node;
      const orderDate = order.createdAt.split('T')[0];

      for (const itemEdge of order.lineItems.edges) {
        const item = itemEdge.node;
        if (!item.variant) continue;

        const product = products?.find(
          p => p.metadata?.shopify_variant_id === item.variant.id.toString()
        );

        if (!product) continue;

        sales.push({
          workspace_id: workspaceId,
          product_id: product.id,
          units: item.quantity,
          net_sales: parseFloat(item.variant.price) * item.quantity,
          sale_date: orderDate,
          channel: 'online',
          source: 'shopify_sync',
        });
      }
    }

    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.edges[data.orders.edges.length - 1]?.cursor;
  }

  // Insert sales
  if (sales.length > 0) {
    const { error } = await supabase.from('sales').insert(sales);
    if (error) throw error;
  }

  return { count: sales.length };
}
