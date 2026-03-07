// app/api/shopify/install/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateInstallUrl, generateNonce, sanitizeShop } from '@/app/lib/shopify/auth';
import { createClient } from '@/app/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const shop = searchParams.get('shop');

  if (!shop) {
    return NextResponse.json({ error: 'Missing shop parameter' }, { status: 400 });
  }

  const sanitizedShop = sanitizeShop(shop);
  if (!sanitizedShop) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
  }

  // Generate and store nonce for CSRF protection
  const nonce = generateNonce();
  
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    // Store intended install in cookie/session, redirect to login
    return NextResponse.redirect(new URL('/login?shop=' + sanitizedShop, request.url));
  }

  // Store nonce in database temporarily
  await supabase
    .from('integrations')
    .upsert({
      workspace_id: await getUserWorkspace(user.id),
      provider: 'shopify',
      credentials: { nonce, shop: sanitizedShop },
      settings: {},
    }, { onConflict: 'workspace_id,provider' });

  // Redirect to Shopify OAuth
  const installUrl = generateInstallUrl(sanitizedShop, nonce);
  return NextResponse.redirect(installUrl);
}

async function getUserWorkspace(userId: string): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .single();
  
  return data?.workspace_id;
}
