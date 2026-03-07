// lib/jobs/calculations.ts - Background recommendation calculations with seasonal analysis
import { createClient } from '../supabase/client';
import { DbProduct, DbInventory, DbSale, DbRecommendation } from '@/app/types/database';
import { generateSeasonalRecommendations } from '@/app/utils/seasonalRecommendations';

/**
 * Recalculate all recommendations for a workspace with seasonal analysis
 */
export async function recalculateWorkspace(workspaceId: string) {
  const supabase = createClient();
  const startTime = Date.now();

  try {
    // Fetch all data
    const [{ data: products }, { data: inventory }, { data: sales }] = await Promise.all([
      supabase.from('products').select('*').eq('workspace_id', workspaceId),
      supabase.from('inventory').select('*').eq('workspace_id', workspaceId),
      supabase.from('sales').select('*').eq('workspace_id', workspaceId),
    ]);

    if (!products || !inventory) {
      throw new Error('Failed to fetch data');
    }

    // Calculate seasonal recommendations
    const recommendations = generateSeasonalRecommendations(
      products,
      inventory,
      sales || [],
      new Date()
    );

    // Convert to database format
    const dbRecommendations: Partial<DbRecommendation>[] = recommendations.map(rec => ({
      workspace_id: rec.workspace_id,
      product_id: rec.product_id,
      current_stock: rec.current_stock,
      daily_velocity: rec.daily_velocity,
      days_until_stockout: rec.days_until_stockout,
      suggested_qty: rec.suggested_qty,
      reason: rec.reason,
      is_core: rec.is_core,
      confidence: rec.confidence,
      volatility: rec.volatility,
      trend: rec.trend,
      calculated_at: rec.calculated_at,
      // Seasonal fields
      seasonal_classification: rec.classification.type,
      seasonal_confidence: rec.classification.confidence,
      peak_months: rec.seasonalAdjustment.peakMonths,
      seasonal_multiplier: rec.seasonalAdjustment.multiplier,
    }));

    // Upsert recommendations
    const { error } = await supabase
      .from('recommendations')
      .upsert(dbRecommendations, {
        onConflict: 'workspace_id,product_id',
      });

    if (error) throw error;

    const duration = Date.now() - startTime;
    console.log(`Recalculated ${recommendations.length} seasonal recommendations in ${duration}ms`);

    return { success: true, count: recommendations.length, duration };
  } catch (error) {
    console.error('Recalculation error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Check for critical alerts with seasonal priority
 */
export async function checkAlerts(workspaceId: string) {
  const supabase = createClient();

  // Get recommendations with critical stock
  // Prioritize seasonal items approaching peak
  const { data: criticalItems } = await supabase
    .from('recommendations')
    .select(`
      *,
      product:products(style, color, size)
    `)
    .eq('workspace_id', workspaceId)
    .eq('is_core', true)
    .lt('days_until_stockout', 60)
    .gt('suggested_qty', 0)
    .order('seasonal_multiplier', { ascending: false }); // Prioritize seasonal boosts

  if (!criticalItems || criticalItems.length === 0) {
    return { alerts: 0 };
  }

  // Check which alerts already exist (unread)
  const { data: existingAlerts } = await supabase
    .from('alerts')
    .select('product_id')
    .eq('workspace_id', workspaceId)
    .eq('read', false)
    .in('product_id', criticalItems.map(i => i.product_id));

  const alertedProductIds = new Set(existingAlerts?.map(a => a.product_id));

  // Create new alerts with seasonal context
  const newAlerts = criticalItems
    .filter(item => !alertedProductIds.has(item.product_id))
    .map(item => {
      // Add seasonal urgency
      let severity: 'high' | 'medium' | 'low' = item.days_until_stockout < 30 ? 'high' : 'medium';
      let message = `${item.product?.style} ${item.product?.color} ${item.product?.size}: ${item.days_until_stockout} days until stockout. Suggested reorder: ${item.suggested_qty}`;
      
      // Boost severity for seasonal items approaching peak
      if (item.seasonal_classification === 'seasonal' && item.seasonal_multiplier && item.seasonal_multiplier > 1.2) {
        severity = 'high';
        message += ' (SEASONAL PEAK APPROACHING)';
      }

      return {
        workspace_id: workspaceId,
        product_id: item.product_id,
        type: severity === 'high' ? 'critical' : 'reorder',
        severity,
        message,
        read: false,
        created_at: new Date().toISOString(),
      };
    });

  if (newAlerts.length > 0) {
    const { error } = await supabase.from('alerts').insert(newAlerts);
    if (error) console.error('Failed to create alerts:', error);
  }

  return { alerts: newAlerts.length, totalCritical: criticalItems.length };
}
