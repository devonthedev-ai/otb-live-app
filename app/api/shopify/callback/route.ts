// app/api/shopify/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exchangeAccessToken, verifyCallbackSignature } from '@/app/lib/shopify/auth';
import { syncProducts, syncOrders } from '@/app/lib/shopify/webhooks';
import { createClient } from '@/app/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const shop = searchParams.get('shop');
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const hmac = searchParams.get('hmac');

  // Validate required params
  if (!shop || !code || !state) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  // Verify HMAC signature
  const query = Object.fromEntries(searchParams.entries());
  if (!verifyCallbackSignature(query)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const supabase = createClient();

  // Get user session
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Get workspace
  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (!member) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 });
  }

  const workspaceId = member.workspace_id;

  // Verify nonce matches
  const { data: integration } = await supabase
    .from('integrations')
    .select('credentials')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'shopify')
    .single();

  if (!integration || integration.credentials.nonce !== state) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 401 });
  }

  try {
    // Exchange code for access token
    const accessToken = await exchangeAccessToken(shop, code);

    // Update integration with access token
    await supabase
      .from('integrations')
      .update({
        credentials: {
          access_token: accessToken,
          shop,
        },
        is_active: true,
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'connected',
      })
      .eq('workspace_id', workspaceId)
      .eq('provider', 'shopify');

    // Initial sync in background
    // Don't await - let user continue
    syncProducts(workspaceId, shop, accessToken)
      .then(() => syncOrders(workspaceId, shop, accessToken, 90))
      .catch(console.error);

    // Redirect to app with success message
    return NextResponse.redirect(new URL('/?shopify=connected', request.url));

  } catch (error) {
    console.error('Shopify OAuth error:', error);
    
    await supabase
      .from('integrations')
      .update({
        last_sync_status: 'error',
        last_error: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('workspace_id', workspaceId)
      .eq('provider', 'shopify');

    return NextResponse.redirect(new URL('/?error=shopify_connection_failed', request.url));
  }
}
