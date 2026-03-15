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
    
    // Test inventory endpoint
    console.log('Testing inventory page 1...');
    const invPage1 = await client.getInventory({ pageSize: 100 });
    
    // Test second page if we have last_id
    let invPage2: any = null;
    if (invPage1.lastId) {
      console.log(`Testing inventory page 2 with last_id: ${invPage1.lastId}...`);
      invPage2 = await client.getInventory({ pageSize: 100, lastId: invPage1.lastId });
    }
    
    // Check if pages have different items
    const page1Ids = new Set(invPage1.inventory.map((i: any) => i.sku_id));
    const page2Ids = invPage2 ? new Set(invPage2.inventory.map((i: any) => i.sku_id)) : new Set();
    const uniqueToPage2 = invPage2 ? invPage2.inventory.filter((i: any) => !page1Ids.has(i.sku_id)) : [];
    const duplicateCount = invPage2 ? invPage2.inventory.filter((i: any) => page1Ids.has(i.sku_id)).length : 0;
    
    return NextResponse.json({
      inventory: {
        page1: {
          count: invPage1.inventory.length,
          lastId: invPage1.lastId,
          sampleIds: invPage1.inventory.slice(0, 3).map((i: any) => i.sku_id),
        },
        page2: invPage2 ? {
          count: invPage2.inventory.length,
          lastId: invPage2.lastId,
          sampleIds: invPage2.inventory.slice(0, 3).map((i: any) => i.sku_id),
        } : null,
      },
      analysis: {
        page1UniqueIds: page1Ids.size,
        page2UniqueIds: page2Ids.size,
        uniqueToPage2: uniqueToPage2.length,
        duplicates: duplicateCount,
        totalUnique: page1Ids.size + uniqueToPage2.length,
      },
      totalInventory: invPage1.inventory.length + (invPage2?.inventory?.length || 0),
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
