// app/api/apparelmagic/sync/route.ts
import { createClient } from '@/app/lib/supabase/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { workspaceId } = body;
    
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Workspace ID required' },
        { status: 400 }
      );
    }
    
    // Check user has permission
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();
    
    if (!membership || !['owner', 'admin', 'buyer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Get credentials using service client
    const serviceSupabase = createServiceClient();
    const { data: credentials, error: credsError } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (credsError || !credentials) {
      console.error('Credentials error:', credsError);
      return NextResponse.json(
        { error: 'ApparelMagic not connected' },
        { status: 400 }
      );
    }
    
    const client = new ApparelMagicClient(credentials);
    
    // Fetch inventory (has proper Style/Color/Size/SKU breakdown)
    console.log('Fetching inventory from ApparelMagic for products...');
    let inventory;
    try {
      inventory = await client.getAllInventory();
      console.log(`Fetched ${inventory.length} inventory records`);
    } catch (fetchError) {
      console.error('Error fetching inventory:', fetchError);
      return NextResponse.json(
        { error: `Failed to fetch products: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` },
        { status: 500 }
      );
    }
    
    // Transform to our format - using inventory for proper Style/Color/Size/SKU
    console.log('Raw inventory from ApparelMagic:', inventory.slice(0, 3));
    
    const transformedProducts = inventory.map((item) => ({
      workspace_id: workspaceId,
      external_id: item.sku_id,
      name: `${item.style_number} ${item.attr_2 || ''} ${item.size || ''}`.trim(),
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      category: 'Uncategorized', // Inventory endpoint doesn't have category
      source: 'apparelmagic',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    
    // Deduplicate by SKU (keep first occurrence)
    const uniqueProducts = Array.from(
      new Map(transformedProducts.map(p => [p.sku, p])).values()
    );
    
    console.log(`Transformed ${transformedProducts.length} products, ${uniqueProducts.length} unique`);
    
    // Upsert products using service client
    console.log('Upserting products to database...');
    const { error: productsError } = await serviceSupabase
      .from('products')
      .upsert(uniqueProducts, {
        onConflict: 'workspace_id,sku',
        ignoreDuplicates: false,
      });
    
    if (productsError) {
      console.error('Products sync error:', productsError);
      return NextResponse.json(
        { error: `Failed to sync products: ${productsError.message}` },
        { status: 500 }
      );
    }
    
    console.log(`Successfully synced ${uniqueProducts.length} products`);
    
    // Update last sync time
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    
    return NextResponse.json({
      success: true,
      productsSynced: uniqueProducts.length,
    });
    
  } catch (error) {
    console.error('ApparelMagic sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
