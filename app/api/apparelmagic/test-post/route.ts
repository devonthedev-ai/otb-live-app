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
    
    // Test POST /products with pagination in body (inventory doesn't support POST)
    const requestBody = {
      time: time,
      token: connection.token,
      pagination: {
        page_size: 1000,
      },
    };
    
    console.log('POST /products Request Body:', JSON.stringify(requestBody).replace(connection.token, '***TOKEN***'));
    
    const resp = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: {
        'User-Agent': 'OTB-Live/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const data = await resp.json();
    
    // Test page 2 if we got last_id
    let data2 = null;
    const lastId1 = data.meta?.pagination?.last_id;
    
    if (lastId1 && data.response?.length > 0) {
      const requestBody2 = {
        time: time,
        token: connection.token,
        pagination: {
          page_size: 1000,
          last_id: String(lastId1),
        },
      };
      
      const resp2 = await fetch(`${baseUrl}/products`, {
        method: 'POST',
        headers: {
          'User-Agent': 'OTB-Live/1.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody2),
      });
      
      data2 = await resp2.json();
    }
    
    return NextResponse.json({
      page1: {
        itemCount: data.response?.length || 0,
        lastId: data.meta?.pagination?.last_id || null,
      },
      page2: data2 ? {
        itemCount: data2.response?.length || 0,
        lastId: data2.meta?.pagination?.last_id || null,
      } : null,
      totalItems: (data.response?.length || 0) + (data2?.response?.length || 0),
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
