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
    
    // Test POST /inventory with page_size 1000
    const url = `https://${connection.subdomain}.app.apparelmagic.com/api/json/inventory`;
    
    const requestBody = {
      time: String(Math.floor(Date.now() / 1000)),
      token: connection.token,
      pagination: {
        page_size: 1000,
      },
    };
    
    console.log('Testing POST /inventory with page_size 1000...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'OTB-Live/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({
        error: 'POST failed',
        status: response.status,
        details: errorText.substring(0, 200),
      });
    }
    
    const data = await response.json();
    
    return NextResponse.json({
      method: 'POST',
      pageSizeRequested: 1000,
      itemCount: data.response?.length || 0,
      lastId: data.meta?.pagination?.last_id || null,
      sampleItems: data.response?.slice(0, 3).map((i: any) => ({
        sku_id: i.sku_id,
        style: i.style_number,
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
