import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { sendCriticalAlert, sendWeeklyDigest } from '@/app/lib/email/sendgrid';

/**
 * POST /api/alerts/send
 * Trigger email alerts for critical stock or weekly digest
 *
 * Body: {
 *   type: 'critical' | 'weekly',
 *   workspaceId: string,
 *   to?: string (optional, defaults to workspace owner)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, workspaceId, to } = body;

    if (!type || !workspaceId) {
      return NextResponse.json(
        { error: 'Missing required fields: type, workspaceId' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Get workspace info
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', workspaceId)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Get owner email if not provided
    let recipientEmail = to;
    if (!recipientEmail) {
      const { data: owner } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('role', 'owner')
        .single();

      if (owner) {
        const { data: user } = await supabase
          .from('auth.users')
          .select('email')
          .eq('id', owner.user_id)
          .single();

        recipientEmail = user?.email;
      }
    }

    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'No recipient email found' },
        { status: 400 }
      );
    }

    if (type === 'critical') {
      // Get critical items (days until stockout < 30)
      const { data: inventory } = await supabase
        .from('inventory_levels')
        .select('*')
        .eq('workspace_id', workspaceId);

      const { data: sales } = await supabase
        .from('sales')
        .select('*')
        .eq('workspace_id', workspaceId)
        .gte('sale_date', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

      // Calculate critical items
      const criticalItems = [];
      const salesBySku = new Map();

      for (const sale of sales || []) {
        if (!salesBySku.has(sale.sku)) salesBySku.set(sale.sku, []);
        salesBySku.get(sale.sku).push(sale);
      }

      for (const item of inventory || []) {
        const skuSales = salesBySku.get(item.sku) || [];
        const totalSales = skuSales.reduce((sum: number, s: any) => sum + (s.units || 0), 0);
        const velocity = totalSales / 90;
        const daysUntil = velocity > 0 ? Math.floor(item.qty_available / velocity) : 999;

        if (daysUntil < 60) {
          criticalItems.push({
            ...item,
            days_until_stockout: daysUntil,
            velocity,
            suggested_qty: Math.ceil(velocity * 90) // 90 days worth
          });
        }
      }

      if (criticalItems.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No critical items to alert',
          sent: false
        });
      }

      // Send email
      const result = await sendCriticalAlert(
        recipientEmail,
        workspace.name,
        criticalItems.map(i => ({
          id: i.id,
          product_id: i.sku,
          severity: i.days_until_stockout < 30 ? 'high' : 'medium',
          message: `${i.days_until_stockout} days until stockout`,
          workspace_id: workspaceId,
          type: 'critical_stock',
          read: false,
          created_at: new Date().toISOString()
        })) as any,
        criticalItems.map(i => ({
          product_id: i.sku,
          style: i.style,
          current_stock: i.qty_available,
          days_until_stockout: i.days_until_stockout,
          suggested_qty: i.suggested_qty,
          product: { style: `${i.style}-${i.color}-${i.size}` }
        })) as any
      );

      return NextResponse.json({
        success: result.success,
        message: result.success ? `Alert sent to ${recipientEmail}` : result.error,
        criticalCount: criticalItems.length
      });

    } else if (type === 'weekly') {
      // Get weekly stats
      const { data: inventory } = await supabase
        .from('inventory_levels')
        .select('*')
        .eq('workspace_id', workspaceId);

      const { data: sales } = await supabase
        .from('sales')
        .select('*')
        .eq('workspace_id', workspaceId)
        .gte('sale_date', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

      const totalSKUs = inventory?.length || 0;

      // Calculate critical and reorder counts
      let criticalCount = 0;
      let reorderCount = 0;
      const topMoving = [];

      const salesBySku = new Map();
      for (const sale of sales || []) {
        if (!salesBySku.has(sale.sku)) salesBySku.set(sale.sku, []);
        salesBySku.get(sale.sku).push(sale);
      }

      for (const item of inventory || []) {
        const skuSales = salesBySku.get(item.sku) || [];
        const totalSales = skuSales.reduce((sum: number, s: any) => sum + (s.units || 0), 0);
        const velocity = totalSales / 90;
        const daysUntil = velocity > 0 ? Math.floor(item.qty_available / velocity) : 999;

        if (daysUntil < 30) criticalCount++;
        else if (daysUntil < 90) reorderCount++;

        if (velocity > 0) {
          topMoving.push({ style: item.style, velocity });
        }
      }

      topMoving.sort((a, b) => b.velocity - a.velocity);

      // Calculate average weeks of supply
      const avgWeeksOfSupply = totalSKUs > 0
        ? Math.round((inventory || []).reduce((sum: number, i: any) => {
            const skuSales = salesBySku.get(i.sku) || [];
            const velocity = skuSales.reduce((s: number, sale: any) => s + sale.units, 0) / 90;
            const weeks = velocity > 0 ? i.qty_available / (velocity * 7) : 0;
            return sum + weeks;
          }, 0) / totalSKUs)
        : 0;

      const result = await sendWeeklyDigest(
        recipientEmail,
        workspace.name,
        {
          totalSKUs,
          criticalCount,
          reorderCount,
          avgWeeksOfSupply,
          topMoving: topMoving.slice(0, 5)
        }
      );

      return NextResponse.json({
        success: result.success,
        message: result.success ? `Digest sent to ${recipientEmail}` : result.error
      });
    }

    return NextResponse.json(
      { error: 'Invalid alert type. Use "critical" or "weekly"' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Alert API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
