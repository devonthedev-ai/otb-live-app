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
    
    // Test POST /products with filter in body
    const requestBody = {
      time: time,
      token: connection.token,
      parameters: [
        {
          field: 'style_number',
          operator: '=',
          value: 'TS0085'
        }
      ]
    };
    
    const resp = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: {
        'User-Agent': 'OTB-Live/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({
        error: 'POST failed',
        status: resp.status,
        body: text.substring(0, 200),
      });
    }
    
    const data = await resp.json();
    
    return NextResponse.json({
      styleSearched: 'TS0085',
      itemCount: data.response?.length || 0,
      items: data.response?.slice(0, 5).map((i: any) => ({
        id: i.id,
        style: i.style_number,
        name: i.name,
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
