// app/api/apparelmagic/sync-inventory/route.ts
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
    
    // Check permissions
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
    
    // Get credentials
    const serviceSupabase = createServiceClient();
    const { data: credentials } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (!credentials) {
      return NextResponse.json(
        { error: 'ApparelMagic not connected' },
        { status: 400 }
      );
    }
    
    const client = new ApparelMagicClient(credentials);
    
    // Fetch all inventory
    console.log('Fetching inventory from ApparelMagic...');
    const inventory = await client.getAllInventory();
    console.log(`Fetched ${inventory.length} inventory records`);
    
    // Transform to our format
    const transformedInventory = inventory.map((item) => ({
      workspace_id: workspaceId,
      external_id: item.sku_id,
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      qty_on_hand: parseFloat(String(item.qty_inventory || 0)) || 0 || 0,
      qty_available: parseFloat(String(item.qty_avail_sell || 0)) || 0 || 0,
      qty_allocated: parseFloat(String(item.qty_alloc || 0)) || 0 || 0,
      qty_reserved: parseFloat(String(item.qty_picked || 0)) || 0 || 0,
      qty_open_po: parseFloat(item.qty_open_po || '0') || 0,
      upc: item.upc_display || item.upc_11 || '',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      weight: parseFloat(item.weight || '0') || 0,
      source: 'apparelmagic',
      last_synced_at: new Date().toISOString(),
    }));
    
    // Deduplicate
    const uniqueInventory = Array.from(
      new Map(transformedInventory.map(i => [i.sku, i])).values()
    );
    
    // Upsert to database
    const { error: inventoryError } = await serviceSupabase
      .from('inventory_levels')
      .upsert(uniqueInventory, {
        onConflict: 'workspace_id,sku',
        ignoreDuplicates: false,
      });
    
    if (inventoryError) {
      console.error('Inventory sync error:', inventoryError);
      return NextResponse.json(
        { error: `Failed to sync inventory: ${inventoryError.message}` },
        { status: 500 }
      );
    }
    
    // Update sync time
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({ last_inventory_sync: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    
    return NextResponse.json({
      success: true,
      inventorySynced: uniqueInventory.length,
    });
    
  } catch (error) {
    console.error('Inventory sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
