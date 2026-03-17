import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';
import { createServiceClient } from '@/app/lib/supabase/service';

export async function GET(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .limit(1)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No connection' }, { status: 404 });
    }
    
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    // Test products endpoint with POST pagination
    console.log('Testing products pagination...');
    const allProducts: any[] = [];
    let lastId: string | undefined;
    let pageNum = 0;
    
    while (pageNum < 20) {
      pageNum++;
      const { products, lastId: newLastId } = await client.getProducts(
        lastId ? { lastId, pageSize: 100 } : { pageSize: 100 }
      );
      
      console.log(`Page ${pageNum}: ${products.length} products, last_id: ${newLastId || 'null'}`);
      
      if (products.length === 0) break;
      
      allProducts.push(...products);
      
      if (!newLastId || newLastId === lastId) break;
      lastId = newLastId;
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 300));
    }
    
    return NextResponse.json({
      totalProducts: allProducts.length,
      pagesFetched: pageNum,
      uniqueStyleNumbers: Array.from(new Set(allProducts.map((p: any) => p.style_number))).slice(0, 20),
      sampleProducts: allProducts.slice(0, 5).map((p: any) => ({
        id: p.id,
        style_number: p.style_number,
        name: p.name,
      })),
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
