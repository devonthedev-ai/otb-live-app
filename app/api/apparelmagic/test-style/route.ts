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
    
    // Search for style TS0085
    const targetStyle = 'TS0085';
    
    // Get all inventory and search for the style
    console.log('Fetching inventory to search for', targetStyle);
    const { inventory, lastId } = await client.getInventory();
    
    // Find items matching the style
    const matchingItems = inventory.filter((item: any) => 
      item.style_number?.toLowerCase() === targetStyle.toLowerCase()
    );
    
    // Also check for partial matches
    const partialMatches = inventory.filter((item: any) => 
      item.style_number?.toLowerCase().includes(targetStyle.toLowerCase())
    );
    
    return NextResponse.json({
      searchStyle: targetStyle,
      totalInventoryItems: inventory.length,
      lastId: lastId,
      exactMatches: matchingItems.length,
      exactMatchDetails: matchingItems.map((i: any) => ({
        sku_id: i.sku_id,
        style: i.style_number,
        color: i.attr_2,
        size: i.size,
        qty: i.qty_inventory,
      })),
      partialMatches: partialMatches.length,
      partialMatchStyles: [...new Set(partialMatches.map((i: any) => i.style_number))],
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
