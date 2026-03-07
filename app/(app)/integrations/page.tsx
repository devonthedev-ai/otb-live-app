// app/(app)/integrations/page.tsx
'use client';

import { useState } from 'react';
import { useWorkspace } from '@/app/context/WorkspaceContext';

export default function IntegrationsPage() {
  const { currentWorkspace } = useWorkspace();
  
  const [shopDomain, setShopDomain] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopDomain) return;

    setIsConnecting(true);
    
    let domain = shopDomain.toLowerCase().trim();
    if (!domain.includes('.')) {
      domain = `${domain}.myshopify.com`;
    }

    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(domain)}`;
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Integrations</h1>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
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

            <form onSubmit={handleConnect} className="mt-4">
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
                  disabled={isConnecting || !shopDomain}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-gray-50 rounded-xl p-4">
        <h4 className="font-medium text-gray-900 mb-2">What gets synced:</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>✓ Products and variants</li>
          <li>✓ Inventory levels</li>
          <li>✓ Orders (real-time)</li>
          <li>✓ Sales velocity calculations</li>
        </ul>
      </div>

      {/* ApparelMagic - Coming Soon */}
      <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-6 opacity-50">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </div>
          
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">ApparelMagic</h3>
              <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">Coming Soon</span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Connect via SFTP to automatically import inventory and sales data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
