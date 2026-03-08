// app/api/apparelmagic/connect/route.ts
import { createClient } from '@/app/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient, saveApparelMagicCredentials } from '@/app/lib/apparelmagic/api';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { workspaceId, subdomain, token } = body;
    
    if (!workspaceId || !subdomain || !token) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Check user has permission
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();
    
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Test connection
    const client = new ApparelMagicClient({ subdomain, token });
    const isConnected = await client.testConnection();
    
    if (!isConnected) {
      console.error('ApparelMagic connection failed:', { subdomain, tokenLength: token?.length });
      return NextResponse.json(
        { error: 'Could not connect to ApparelMagic. Please check your subdomain and token.' },
        { status: 400 }
      );
    }
    
    // Save credentials
    const { error: saveError } = await saveApparelMagicCredentials(workspaceId, {
      subdomain,
      token,
    });
    
    if (saveError) {
      console.error('Failed to save ApparelMagic credentials:', saveError);
      return NextResponse.json(
        { error: `Failed to save credentials: ${saveError.message}` },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true, message: 'Connected to ApparelMagic' });
    
  } catch (error) {
    console.error('ApparelMagic connect error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
