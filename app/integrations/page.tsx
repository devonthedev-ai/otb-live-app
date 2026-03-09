// app/integrations/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useWorkspace } from '@/app/context/WorkspaceContext';
import { createClient } from '@/app/lib/supabase/client';
import { Sidebar } from '@/app/components/Sidebar';

export default function IntegrationsPage() {
  const { currentWorkspace, isLoading: isWorkspaceLoading, workspaces } = useWorkspace();
  const supabase = createClient();
  
  const [shopDomain, setShopDomain] = useState('');
  const [isConnectingShopify, setIsConnectingShopify] = useState(false);
  
  // ApparelMagic state
  const [amSubdomain, setAmSubdomain] = useState('');
  const [amToken, setAmToken] = useState('');
  const [isConnectingAM, setIsConnectingAM] = useState(false);
  const [amConnected, setAmConnected] = useState(false);
  const [amSyncing, setAmSyncing] = useState(false);
  const [amSyncProgress, setAmSyncProgress] = useState(0);
  const [amLastSync, setAmLastSync] = useState<string | null>(null);

  // Check ApparelMagic connection status
  useEffect(() => {
    if (!currentWorkspace) return;
    
    const checkConnection = async () => {
      try {
        const { data, error } = await supabase
          .from('apparelmagic_connections')
          .select('last_sync_at')
          .eq('workspace_id', currentWorkspace.id)
          .maybeSingle();
        
        if (error) {
          console.error('Error checking connection:', error);
          return;
        }
        
        if (data) {
          setAmConnected(true);
          setAmLastSync(data.last_sync_at);
        }
      } catch (err) {
        console.error('Connection check failed:', err);
      }
    };
    
    checkConnection();
  }, [currentWorkspace, supabase]);

  const handleConnectShopify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopDomain) return;

    setIsConnectingShopify(true);
    
    let domain = shopDomain.toLowerCase().trim();
    if (!domain.includes('.')) {
      domain = `${domain}.myshopify.com`;
    }

    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(domain)}`;
  };

  const handleConnectApparelMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amSubdomain || !amToken || !currentWorkspace) return;

    setIsConnectingAM(true);
    
    try {
      // Extract just the subdomain (remove .app.apparelmagic.com if present)
      let cleanSubdomain = amSubdomain.trim().toLowerCase();
      cleanSubdomain = cleanSubdomain.replace(/\.app\.apparelmagic\.com$/, '');
      cleanSubdomain = cleanSubdomain.replace(/^https?:\/\//, '');
      
      const response = await fetch('/api/apparelmagic/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspace.id,
          subdomain: cleanSubdomain,
          token: amToken,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setAmConnected(true);
        alert('Connected to ApparelMagic!');
      } else {
        alert(data.error || 'Failed to connect');
      }
    } catch (error) {
      alert('Connection failed. Please try again.');
    } finally {
      setIsConnectingAM(false);
    }
  };

  const handleSyncApparelMagic = async () => {
    if (!currentWorkspace) return;
    
    setAmSyncing(true);
    setAmSyncProgress(0);
    
    // Animate progress bar
    const progressInterval = setInterval(() => {
      setAmSyncProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 500);
    
    try {
      const response = await fetch('/api/apparelmagic/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspace.id,
        }),
      });
      
      clearInterval(progressInterval);
      
      const data = await response.json();
      
      if (response.ok) {
        setAmSyncProgress(100);
        setAmLastSync(new Date().toISOString());
        setTimeout(() => {
          setAmSyncing(false);
          setAmSyncProgress(0);
          alert(`Synced ${data.productsSynced} products!`);
        }, 500);
      } else {
        setAmSyncing(false);
        setAmSyncProgress(0);
        alert(data.error || 'Sync failed');
      }
    } catch (error) {
      clearInterval(progressInterval);
      setAmSyncing(false);
      setAmSyncProgress(0);
      alert('Sync failed. Please try again.');
    }
  };

  if (isWorkspaceLoading) {
    return (
      <div className="flex min-h-screen bg-[#F5F5F7]">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-600">Loading workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="flex min-h-screen bg-[#F5F5F7]">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-red-50 text-red-700 p-4 rounded-lg">
            <p className="font-medium">No workspace found</p>
            <p className="text-sm mt-1">Please create a workspace first.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F7]">
      <Sidebar />
      <div className="flex-1">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-8 py-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Integrations</h1>
              <p className="text-sm text-gray-500 mt-0.5">Connect your systems</p>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-5xl mx-auto px-8 py-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Integrations</h1>

      {/* Shopify */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.058-.121-.074l-.914 21.104h.023zm-1.659-19.009c0 .091-.121.166-.121.166s-1.082.739-2.494.739c-1.592 0-2.519-.501-2.519-1.56 0-1.074.987-1.639 2.062-1.639.968 0 1.916.369 2.915 1.154.045.037.157.11.157.14zM8.917 8.131c.966 0 1.747.765 1.747 1.71 0 .945-.781 1.71-1.747 1.71-.965 0-1.747-.765-1.747-1.71 0-.945.782-1.71 1.747-1.71zm.129 4.785c.258 0 .471.21.471.47 0 .258-.213.47-.471.47-.258 0-.47-.212-.47-.47 0-.26.212-.47.47-.47zm3.507-4.785c.967 0 1.748.765 1.748 1.71 0 .945-.781 1.71-1.748 1.71-.965 0-1.747-.765-1.747-1.71 0-.945.782-1.71 1.747-1.71zm.129 4.785c.259 0 .471.21.471.47 0 .258-.212.47-.471.47-.258 0-.47-.212-.47-.47 0-.26.212-.47.47-.47z"/>
            </svg>
          </div>
          
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Shopify</h3>
            <p className="text-gray-500 text-sm mt-1">
              Sync orders and inventory automatically from your Shopify store.
            </p>

            <form onSubmit={handleConnectShopify} className="mt-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  placeholder="your-store.myshopify.com"
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={isConnectingShopify || !shopDomain}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {isConnectingShopify ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* ApparelMagic */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </div>
          
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">ApparelMagic</h3>
              {amConnected && (
                <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">Connected</span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Import products and inventory from ApparelMagic ERP.
            </p>

            {!amConnected ? (
              <form onSubmit={handleConnectApparelMagic} className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subdomain</label>
                  <input
                    type="text"
                    value={amSubdomain}
                    onChange={(e) => setAmSubdomain(e.target.value)}
                    placeholder="yourcompany"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">yourcompany.app.apparelmagic.com</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Token</label>
                  <input
                    type="password"
                    value={amToken}
                    onChange={(e) => setAmToken(e.target.value)}
                    placeholder="Paste your API token"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">From Settings &gt; API &gt; Tokens</p>
                </div>
                
                <button
                  type="submit"
                  disabled={isConnectingAM || !amSubdomain || !amToken}
                  className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {isConnectingAM ? 'Connecting...' : 'Connect ApparelMagic'}
                </button>
              </form>
            ) : (
              <div className="mt-4 space-y-3">
                {amSyncing ? (
                  <div className="space-y-2">
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div 
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                        style={{ width: `${amSyncProgress}%` }}
                      ></div>
                    </div>
                    <p className="text-sm text-gray-600 text-center">
                      Syncing products... {amSyncProgress}%
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleSyncApparelMagic}
                    className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                  >
                    Sync Products Now
                  </button>
                )}
                
                {amLastSync && (
                  <p className="text-sm text-gray-500 text-center">
                    Last synced: {new Date(amLastSync).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-gray-50 rounded-xl p-4">
        <h4 className="font-medium text-gray-900 mb-2">What gets synced:</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>✓ Products and variants</li>
          <li>✓ Inventory levels</li>
          <li>✓ Orders (real-time with Shopify)</li>
          <li>✓ Sales velocity calculations</li>
        </ul>
      </div>
      </main>
    </div>
  </div>
  );
}
