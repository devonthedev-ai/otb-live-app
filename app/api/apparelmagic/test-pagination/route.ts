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
    
    // Test inventory endpoint (which we know works)
    console.log('Testing inventory page 1...');
    const invPage1 = await client.getInventory({ pageSize: 100 });
    
    // Test products endpoint
    console.log('Testing products page 1...');
    const prodPage1 = await client.getProducts({ pageSize: 100 });
    
    // Test second page if we have last_id
    let invPage2: any = null;
    if (invPage1.lastId) {
      console.log(`Testing inventory page 2 with last_id: ${invPage1.lastId}...`);
      invPage2 = await client.getInventory({ pageSize: 100, lastId: invPage1.lastId });
    }
    
    return NextResponse.json({
      inventory: {
        page1: {
          count: invPage1.inventory.length,
          lastId: invPage1.lastId,
          firstItem: invPage1.inventory[0]?.style_number || 'none',
          lastItem: invPage1.inventory[invPage1.inventory.length - 1]?.style_number || 'none',
        },
        page2: invPage2 ? {
          count: invPage2.inventory.length,
          lastId: invPage2.lastId,
          firstItem: invPage2.inventory[0]?.style_number || 'none',
          lastItem: invPage2.inventory[invPage2.inventory.length - 1]?.style_number || 'none',
        } : null,
      },
      products: {
        page1: {
          count: prodPage1.products.length,
          lastId: prodPage1.lastId,
        },
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
