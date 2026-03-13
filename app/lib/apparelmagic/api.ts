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
    
    return {
      products: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all products (handles pagination)
  async getAllProducts(): Promise<ApparelMagicProduct[]> {
    return this.getAllProductsChunked();
  }

  // Get all products (handles pagination) - CHUNKED VERSION
  async getAllProductsChunked(
    onChunk?: (products: ApparelMagicProduct[], page: number) => Promise<boolean> | boolean,
    maxPages: number = 50
  ): Promise<ApparelMagicProduct[]> {
    const allProducts: ApparelMagicProduct[] = [];
    let lastId: string | undefined;
    let pageCount = 0;
    
    try {
      while (pageCount < maxPages) {
        pageCount++;
        
        const { products, lastId: newLastId } = await this.getProducts(
          lastId ? { lastId } : undefined
        );
        
        if (products.length === 0) break;
        
        allProducts.push(...products);
        
        // Call callback if provided - return false to stop early
        if (onChunk) {
          const shouldContinue = await onChunk(products, pageCount);
          if (shouldContinue === false) {
            break;
          }
        }
        
        if (!newLastId) break;
        lastId = newLastId;
      }
    } catch (error) {
      console.error('Error during chunked pagination:', error);
    }
    
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

  // Get all inventory (handles pagination)
  async getAllInventory(): Promise<ApparelMagicInventory[]> {
    const allInventory: ApparelMagicInventory[] = [];
    let lastId: string | undefined;
    
    while (true) {
      const { inventory, lastId: newLastId } = await this.getInventory(
        lastId ? { lastId } : undefined
      );
      
      allInventory.push(...inventory);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allInventory;
  }

  // Get invoices (sales) with date filter
  async getInvoices(startDate?: string, pagination?: PaginationParams): Promise<{
    invoices: ApparelMagicInvoice[];
    lastId: string | null;
  }> {
    const params: Record<string, string> = {};
    if (startDate) {
      params['parameters[0][field]'] = 'date';
      params['parameters[0][operator]'] = '>=';
      params['parameters[0][value]'] = startDate;
    }
    
    const response = await this.request<ApparelMagicInvoicesResponse>(
      'invoices',
      'GET',
      Object.keys(params).length > 0 ? params : undefined,
      pagination
    );
    
    return {
      invoices: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all invoices (handles pagination)
  async getAllInvoices(startDate?: string): Promise<ApparelMagicInvoice[]> {
    const allInvoices: ApparelMagicInvoice[] = [];
    let lastId: string | undefined;
    
    while (true) {
      const { invoices, lastId: newLastId } = await this.getInvoices(
        startDate,
        lastId ? { lastId } : undefined
      );
      
      allInvoices.push(...invoices);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allInvoices;
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

  // Get all vendors (handles pagination)
  async getAllVendors(): Promise<ApparelMagicVendor[]> {
    const allVendors: ApparelMagicVendor[] = [];
    let lastId: string | undefined;
    
    while (true) {
      const { vendors, lastId: newLastId } = await this.getVendors(
        lastId ? { lastId } : undefined
      );
      
      allVendors.push(...vendors);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allVendors;
  }

  // Get product attributes
  async getProductAttributes(pagination?: PaginationParams): Promise<{
    attributes: any[];
    lastId: string | null;
  }> {
    const response = await this.request<any>(
      'product_attributes',
      'GET',
      undefined,
      pagination
    );
    
    return {
      attributes: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all product attributes (handles pagination)
  async getAllProductAttributes(): Promise<any[]> {
    const allAttributes: any[] = [];
    let lastId: string | undefined;
    
    while (true) {
      const { attributes, lastId: newLastId } = await this.getProductAttributes(
        lastId ? { lastId } : undefined
      );
      
      allAttributes.push(...attributes);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allAttributes;
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
  sku_id: string;
  product_id: string;
  style_number: string;
  attr_2?: string;
  attr_3?: string;
  size?: string;
  sku_concat?: string;
  qty_inventory: string;
  qty_avail_sell: string;
  qty_alloc: string;
  qty_picked: string;
  qty_open_po: string;
  upc_display?: string;
  upc_11?: string;
  price?: string;
  cost?: string;
  weight?: string;
  [key: string]: unknown;
}

interface ApparelMagicInvoiceItem {
  id: string;
  sku_id: string;
  style_number: string;
  attr_2?: string;
  attr_3?: string;
  size?: string;
  qty: string;
  unit_price: string;
  amount: string;
}

interface ApparelMagicInvoice {
  invoice_id: string;
  customer_id: string;
  date: string;
  invoice_items?: ApparelMagicInvoiceItem[];
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
type ApparelMagicInvoicesResponse = ApparelMagicResponse<ApparelMagicInvoice>;

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
