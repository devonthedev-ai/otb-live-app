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
    
    // Test POST with pagination in body
    const requestBody = {
      time: time,
      token: connection.token,
      pagination: {
        page_size: 1000,
      },
    };
    
    console.log('POST Request Body:', JSON.stringify(requestBody).replace(connection.token, '***TOKEN***'));
    
    const resp = await fetch(`${baseUrl}/inventory`, {
      method: 'POST',
      headers: {
        'User-Agent': 'OTB-Live/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const data = await resp.json();
    
    return NextResponse.json({
      method: 'POST',
      requestBody: {
        time: time,
        token: '***TOKEN***',
        pagination: { page_size: 1000 },
      },
      response: {
        status: resp.status,
        itemCount: data.response?.length || 0,
        lastId: data.meta?.pagination?.last_id || null,
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
