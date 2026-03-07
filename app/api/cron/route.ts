// app/api/cron/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';
import { recalculateWorkspace, checkAlerts } from '@/app/lib/jobs/calculations';
import { sendCriticalAlert, sendWeeklyDigest } from '@/app/lib/email/sendgrid';

// Vercel Cron runs this every hour
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient();
  const results = {
    workspaces: 0,
    recalculated: [] as string[],
    errors: [] as string[],
    emailsSent: 0,
  };

  try {
    // Get all active workspaces
    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id, name, plan');

    if (!workspaces) {
      return NextResponse.json({ error: 'No workspaces found' }, { status: 404 });
    }

    results.workspaces = workspaces.length;

    // Process each workspace
    for (const workspace of workspaces) {
      try {
        // 1. Recalculate recommendations
        const calcResult = await recalculateWorkspace(workspace.id);
        if (calcResult.success) {
          results.recalculated.push(workspace.id);
        } else {
          results.errors.push(`${workspace.id}: calc failed`);
        }

        // 2. Check for alerts
        const alertResult = await checkAlerts(workspace.id);

        // 3. Send email alerts if critical items found (for paid plans)
        if (alertResult.alerts > 0 && workspace.plan !== 'free') {
          // Get workspace owner email
          const { data: owner } = await supabase
            .from('workspace_members')
            .select('user:auth.users(email)')
            .eq('workspace_id', workspace.id)
            .eq('role', 'owner')
            .single();

          if (owner) {
            const ownerData = owner as unknown as { user: { email: string } };
            if (ownerData.user?.email) {
            // Get critical recommendations
            const { data: criticalRecs } = await supabase
              .from('recommendations')
              .select('*, product:products(style, color, size)')
              .eq('workspace_id', workspace.id)
              .eq('is_core', true)
              .lt('days_until_stockout', 60)
              .gt('suggested_qty', 0);

            const { data: alerts } = await supabase
              .from('alerts')
              .select('*')
              .eq('workspace_id', workspace.id)
              .eq('read', false);

            if (criticalRecs && criticalRecs.length > 0 && alerts) {
              await sendCriticalAlert(
                ownerData.user.email,
                workspace.name,
                alerts,
                criticalRecs as any
              );
              results.emailsSent++;
            }
          }
        }
        }
      } catch (error) {
        console.error(`Error processing workspace ${workspace.id}:`, error);
        results.errors.push(`${workspace.id}: ${String(error)}`);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...results,
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
