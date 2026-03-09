// app/lib/apparelmagic/api.ts
import { createClient } from '@/app/lib/supabase/client';

interface ApparelMagicCredentials {
  subdomain: string;
  token: string;
}

interface PaginationParams {
  pageSize?: number;
  lastId?: string;
}

export class ApparelMagicClient {
  private subdomain: string;
  private token: string;
  private baseUrl: string;

  constructor(credentials: ApparelMagicCredentials) {
    this.subdomain = credentials.subdomain;
    this.token = credentials.token;
    this.baseUrl = `https://${this.subdomain}.app.apparelmagic.com/api/json`;
  }

  private getAuthParams(): Record<string, string> {
    return {
      time: String(Math.floor(Date.now() / 1000)),
      token: this.token,
    };
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, unknown>,
    pagination?: PaginationParams
  ): Promise<T> {
    const authParams = this.getAuthParams();
    
    let url: string;
    let requestBody: string | undefined;
    let headers: Record<string, string> = {
      'User-Agent': 'OTB-Live/1.0',
      'Content-Type': 'application/json',
    };

    if (method === 'GET') {
      const params = new URLSearchParams(authParams);
      // Note: ApparelMagic doesn't support page_size in GET query params
      // Default is 100 records per page
      // But we DO need to pass last_id for pagination
      if (pagination?.lastId) {
        params.append('last_id', pagination.lastId);
      }
      url = `${this.baseUrl}/${endpoint}?${params.toString()}`;
    } else {
      url = `${this.baseUrl}/${endpoint}`;
      const requestData = {
        ...authParams,
        ...body,
      };
      if (pagination?.pageSize) {
        requestData.pagination = {
          page_size: pagination.pageSize,
          ...(pagination.lastId && { last_id: pagination.lastId }),
        };
      }
      requestBody = JSON.stringify(requestData);
    }

    console.log('ApparelMagic API request:', { url: url.replace(this.token, '***TOKEN***'), method });

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
    });

    console.log('ApparelMagic API response:', { status: response.status, statusText: response.statusText });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      console.error('ApparelMagic API error:', errorText);
      throw new Error(`ApparelMagic API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing ApparelMagic connection:', { subdomain: this.subdomain, url: this.baseUrl });
      const result = await this.request('products', 'GET', undefined, { pageSize: 1 });
      console.log('ApparelMagic connection test result:', JSON.stringify(result).slice(0, 200));
      return true;
    } catch (error) {
      console.error('ApparelMagic connection failed:', error);
      return false;
    }
  }

  // Get products with pagination
  async getProducts(pagination?: PaginationParams): Promise<{
    products: ApparelMagicProduct[];
    lastId: string | null;
  }> {
    const response = await this.request<ApparelMagicProductsResponse>(
      'products',
      'GET',
      undefined,
      pagination
    );
    
    console.log('ApparelMagic API response:', JSON.stringify(response).slice(0, 500));
    
    return {
      products: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all products (handles pagination)
  async getAllProducts(): Promise<ApparelMagicProduct[]> {
    const allProducts: ApparelMagicProduct[] = [];
    let lastId: string | undefined;
    let pageCount = 0;
    
    while (true) {
      // Don't pass pageSize for GET requests - use default 100
      const { products, lastId: newLastId } = await this.getProducts(
        lastId ? { lastId } : undefined
      );
      
      pageCount++;
      console.log(`ApparelMagic page ${pageCount}: ${products.length} products`);
      
      allProducts.push(...products);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    console.log(`ApparelMagic total products: ${allProducts.length}`);
    return allProducts;
  }

  // Get inventory/stock
  async getInventory(pagination?: PaginationParams): Promise<{
    inventory: ApparelMagicInventory[];
    lastId: string | null;
  }> {
    const response = await this.request<ApparelMagicInventoryResponse>(
      'inventory',
      'GET',
      undefined,
      pagination
    );
    
    return {
      inventory: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get orders/sales
  async getOrders(pagination?: PaginationParams): Promise<{
    orders: ApparelMagicOrder[];
    lastId: string | null;
  }> {
    const response = await this.request<ApparelMagicOrdersResponse>(
      'orders',
      'GET',
      undefined,
      pagination
    );
    
    return {
      orders: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get vendors
  async getVendors(pagination?: PaginationParams): Promise<{
    vendors: ApparelMagicVendor[];
    lastId: string | null;
  }> {
    const response = await this.request<ApparelMagicVendorsResponse>(
      'vendors',
      'GET',
      undefined,
      pagination
    );
    
    return {
      vendors: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }
}

// Types
interface ApparelMagicResponse<T> {
  response: T[];
  meta: {
    pagination: {
      last_id: string | null;
    };
    errors: string[];
  };
}

interface ApparelMagicProduct {
  id: string;
  name: string;
  sku: string;
  style_number?: string;
  color?: string;
  size?: string;
  cost?: number;
  price?: number;
  category?: string;
  vendor_id?: string;
  [key: string]: unknown;
}

interface ApparelMagicInventory {
  id: string;
  product_id: string;
  sku: string;
  quantity_on_hand: number;
  quantity_available: number;
  quantity_reserved: number;
  warehouse_id?: string;
  [key: string]: unknown;
}

interface ApparelMagicOrder {
  id: string;
  order_number: string;
  order_date: string;
  status: string;
  items: Array<{
    product_id: string;
    sku: string;
    quantity: number;
    price: number;
  }>;
  [key: string]: unknown;
}

interface ApparelMagicVendor {
  id: string;
  name: string;
  code?: string;
  [key: string]: unknown;
}

type ApparelMagicProductsResponse = ApparelMagicResponse<ApparelMagicProduct>;
type ApparelMagicInventoryResponse = ApparelMagicResponse<ApparelMagicInventory>;
type ApparelMagicOrdersResponse = ApparelMagicResponse<ApparelMagicOrder>;
type ApparelMagicVendorsResponse = ApparelMagicResponse<ApparelMagicVendor>;

// Database functions
import { createServiceClient } from '@/app/lib/supabase/service';

export async function getApparelMagicCredentials(workspaceId: string): Promise<ApparelMagicCredentials | null> {
  const supabase = createClient();
  
  const { data, error } = await supabase
    .from('apparelmagic_connections')
    .select('subdomain, token')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  
  if (error || !data) return null;
  
  return {
    subdomain: data.subdomain,
    token: data.token,
  };
}

export async function saveApparelMagicCredentials(
  workspaceId: string,
  credentials: ApparelMagicCredentials
): Promise<{ error: Error | null }> {
  // Use service role to bypass RLS (we already checked permissions in API route)
  const supabase = createServiceClient();
  
  const { error } = await supabase
    .from('apparelmagic_connections')
    .upsert({
      workspace_id: workspaceId,
      subdomain: credentials.subdomain,
      token: credentials.token,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'workspace_id',
    });
  
  return { error: error as Error | null };
}

export async function deleteApparelMagicCredentials(workspaceId: string): Promise<void> {
  const supabase = createClient();
  
  await supabase
    .from('apparelmagic_connections')
    .delete()
    .eq('workspace_id', workspaceId);
}
