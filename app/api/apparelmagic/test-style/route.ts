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
    
    // Search for style ZIP1 (we know this exists from previous results)
    const targetStyle = 'ZIP1';
    
    console.log('Fetching inventory filtered by style', targetStyle);
    const filteredInventory = await client.getInventoryByStyle(targetStyle);
    
    // Also get regular inventory to compare
    console.log('Fetching regular inventory');
    const { inventory, lastId } = await client.getInventory();
    
    // Get unique style numbers from inventory
    const uniqueStyles = Array.from(new Set(inventory.map((i: any) => i.style_number)));
    
    return NextResponse.json({
      searchStyle: targetStyle,
      filteredResults: {
        count: filteredInventory.length,
        items: filteredInventory.slice(0, 5).map((i: any) => ({
          sku_id: i.sku_id,
          style: i.style_number,
          color: i.attr_2,
          size: i.size,
        })),
      },
      regularInventory: {
        count: inventory.length,
        lastId: lastId,
        uniqueStyles: uniqueStyles.slice(0, 10),
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
