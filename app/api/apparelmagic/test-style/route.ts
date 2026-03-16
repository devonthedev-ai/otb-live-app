import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';
import { createServiceClient } from '@/app/lib/supabase/service';

export async function GET(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    // Get the first workspace with AM connection
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .limit(1)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No ApparelMagic connection found' }, { status: 404 });
    }
    
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    // Search for style TS0085 using the new filtered method
    const targetStyle = 'TS0085';
    
    console.log('Fetching inventory filtered by style', targetStyle);
    const filteredInventory = await client.getInventoryByStyle(targetStyle);
    
    // Also get regular inventory to compare
    console.log('Fetching regular inventory');
    const { inventory, lastId } = await client.getInventory();
    
    return NextResponse.json({
      searchStyle: targetStyle,
      filteredResults: {
        count: filteredInventory.length,
        items: filteredInventory.map((i: any) => ({
          sku_id: i.sku_id,
          style: i.style_number,
          color: i.attr_2,
          size: i.size,
          qty: i.qty_inventory,
        })),
      },
      regularInventory: {
        count: inventory.length,
        lastId: lastId,
      },
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
