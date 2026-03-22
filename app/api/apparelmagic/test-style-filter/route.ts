import { NextRequest, NextResponse } from 'next/server';
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
    
    const baseUrl = `https://${connection.subdomain}.app.apparelmagic.com/api/json`;
    const time = String(Math.floor(Date.now() / 1000));
    
    // Test filtering by style_number=TS0085
    // Per AM docs: parameters0field=style_number&parameters0operator===&parameters0value=TS0085
    const url = `${baseUrl}/inventory?time=${time}&token=${connection.token}&parameters0field=style_number&parameters0operator===&parameters0value=TS0085`;
    
    console.log('Request:', url.replace(connection.token, '***TOKEN***'));
    
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    
    const data = await resp.json();
    
    return NextResponse.json({
      styleSearched: 'TS0085',
      itemCount: data.response?.length || 0,
      items: data.response?.map((i: any) => ({
        sku_id: i.sku_id,
        style: i.style_number,
        color: i.attr_2,
        size: i.size,
        qty: i.qty_inventory,
      })) || [],
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
