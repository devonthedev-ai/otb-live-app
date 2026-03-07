// lib/data/products.ts
import { createClient } from '../supabase/client';
import { DbProduct, PaginatedResponse } from '@/app/types/database';

export class ProductService {
  private supabase = createClient();

  async getProducts(
    workspaceId: string,
    options?: {
      page?: number;
      pageSize?: number;
      style?: string;
      category?: string;
      vendor?: string;
      search?: string;
    }
  ): Promise<PaginatedResponse<DbProduct>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 50;
    const start = (page - 1) * pageSize;

    let query = this.supabase
      .from('products')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('style', { ascending: true })
      .range(start, start + pageSize - 1);

    if (options?.style) {
      query = query.eq('style', options.style);
    }
    if (options?.category) {
      query = query.eq('category', options.category);
    }
    if (options?.vendor) {
      query = query.eq('vendor', options.vendor);
    }
    if (options?.search) {
      query = query.or(`style.ilike.%${options.search}%,color.ilike.%${options.search}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return {
      data: data || [],
      count: count || 0,
      page,
      pageSize,
      hasMore: (count || 0) > page * pageSize,
    };
  }

  async getProductById(workspaceId: string, productId: string): Promise<DbProduct | null> {
    const { data, error } = await this.supabase
      .from('products')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', productId)
      .single();

    if (error) throw error;
    return data;
  }

  async upsertProducts(workspaceId: string, products: Partial<DbProduct>[]): Promise<void> {
    const withWorkspace = products.map(p => ({
      ...p,
      workspace_id: workspaceId,
    }));

    const { error } = await this.supabase
      .from('products')
      .upsert(withWorkspace, {
        onConflict: 'workspace_id,style,color,size',
      });

    if (error) throw error;
  }

  async updateProduct(
    workspaceId: string,
    productId: string,
    updates: Partial<DbProduct>
  ): Promise<void> {
    const { error } = await this.supabase
      .from('products')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('id', productId);

    if (error) throw error;
  }

  async deleteProduct(workspaceId: string, productId: string): Promise<void> {
    const { error } = await this.supabase
      .from('products')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', productId);

    if (error) throw error;
  }

  async getCategories(workspaceId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('products')
      .select('category')
      .eq('workspace_id', workspaceId)
      .not('category', 'is', null);

    if (error) throw error;

    const categories = Array.from(new Set(data?.map(d => d.category).filter(Boolean)));
    return categories as string[];
  }

  async getVendors(workspaceId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('products')
      .select('vendor')
      .eq('workspace_id', workspaceId)
      .not('vendor', 'is', null);

    if (error) throw error;

    const vendors = Array.from(new Set(data?.map(d => d.vendor).filter(Boolean)));
    return vendors as string[];
  }

  async getStyles(workspaceId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('products')
      .select('style')
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    const styles = Array.from(new Set(data?.map(d => d.style)));
    return styles as string[];
  }
}

export const productService = new ProductService();
