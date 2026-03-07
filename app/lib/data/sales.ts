// lib/data/sales.ts
import { createClient } from '../supabase/client';
import { DbSale } from '@/app/types/database';

export class SalesService {
  private supabase = createClient();

  async getSales(
    workspaceId: string,
    options?: {
      productId?: string;
      startDate?: string;
      endDate?: string;
      channel?: string;
      limit?: number;
    }
  ): Promise<DbSale[]> {
    let query = this.supabase
      .from('sales')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sale_date', { ascending: false });

    if (options?.productId) {
      query = query.eq('product_id', options.productId);
    }
    if (options?.startDate) {
      query = query.gte('sale_date', options.startDate);
    }
    if (options?.endDate) {
      query = query.lte('sale_date', options.endDate);
    }
    if (options?.channel) {
      query = query.eq('channel', options.channel);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  async getSalesByStyleColor(
    workspaceId: string,
    style: string,
    color: string,
    days: number = 30
  ): Promise<DbSale[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await this.supabase
      .from('sales')
      .select(`
        *,
        product:products!inner(style, color)
      `)
      .eq('workspace_id', workspaceId)
      .eq('products.style', style)
      .eq('products.color', color)
      .gte('sale_date', startDate.toISOString().split('T')[0])
      .order('sale_date', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async upsertSales(workspaceId: string, sales: Partial<DbSale>[]): Promise<void> {
    const withWorkspace = sales.map(s => ({
      ...s,
      workspace_id: workspaceId,
    }));

    const { error } = await this.supabase
      .from('sales')
      .insert(withWorkspace);

    if (error) throw error;
  }

  async deleteSalesByBatch(workspaceId: string, batchId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sales')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('import_batch_id', batchId);

    if (error) throw error;
  }

  async getSalesSummary(
    workspaceId: string,
    days: number = 30
  ): Promise<{
    totalUnits: number;
    totalRevenue: number;
    uniqueProducts: number;
    avgUnitsPerDay: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await this.supabase
      .from('sales')
      .select('units, net_sales, product_id')
      .eq('workspace_id', workspaceId)
      .gte('sale_date', startDate.toISOString().split('T')[0]);

    if (error) throw error;

    const sales = data || [];
    const totalUnits = sales.reduce((sum, s) => sum + s.units, 0);
    const totalRevenue = sales.reduce((sum, s) => sum + (s.net_sales || 0), 0);
    const uniqueProducts = new Set(sales.map(s => s.product_id)).size;
    const avgUnitsPerDay = totalUnits / days;

    return {
      totalUnits,
      totalRevenue,
      uniqueProducts,
      avgUnitsPerDay,
    };
  }
}

export const salesService = new SalesService();
