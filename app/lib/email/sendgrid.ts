// lib/email/sendgrid.ts - Email service
import { DbAlert, DbRecommendation, Workspace } from '@/app/types/database';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'alerts@otblive.com';

interface EmailData {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send email via SendGrid
 */
export async function sendEmail(data: EmailData): Promise<{ success: boolean; error?: string }> {
  if (!SENDGRID_API_KEY) {
    console.log('Email would be sent (no SENDGRID_API_KEY):', data.to, data.subject);
    return { success: true };
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: data.to }] }],
        from: { email: FROM_EMAIL, name: 'OTB Live' },
        subject: data.subject,
        content: [
          { type: 'text/plain', value: data.text },
          { type: 'text/html', value: data.html },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    return { success: true };
  } catch (error) {
    console.error('Send email error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Send critical stock alert
 */
export async function sendCriticalAlert(
  to: string,
  workspaceName: string,
  alerts: DbAlert[],
  recommendations: DbRecommendation[]
) {
  const criticalCount = alerts.filter(a => a.severity === 'high').length;
  const subject = `🚨 ${criticalCount} Critical Items Need Reorder - ${workspaceName}`;

  const items = recommendations
    .filter(r => alerts.some(a => a.product_id === r.product_id))
    .map(r => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${r.product?.style || 'Unknown'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${r.current_stock}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; color: ${r.days_until_stockout < 30 ? '#dc2626' : '#d97706'};">${r.days_until_stockout} days</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${r.suggested_qty}</td>
      </tr>
    `).join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">⚠️ Critical Stock Alerts</h2>
      <p>You have ${alerts.length} items in ${workspaceName} that need attention:</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 8px; text-align: left;">Product</th>
            <th style="padding: 8px; text-align: left;">Stock</th>
            <th style="padding: 8px; text-align: left;">Days Left</th>
            <th style="padding: 8px; text-align: left;">Reorder</th>
          </tr>
        </thead>
        <tbody>
          ${items}
        </tbody>
      </table>

      <a href="${process.env.NEXT_PUBLIC_APP_URL}" 
         style="display: inline-block; background: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
        View in OTB Live
      </a>
    </div>
  `;

  const text = `Critical Stock Alert for ${workspaceName}\n\nYou have ${alerts.length} items that need attention.\n\nView in OTB Live: ${process.env.NEXT_PUBLIC_APP_URL}`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Send weekly digest
 */
export async function sendWeeklyDigest(
  to: string,
  workspaceName: string,
  stats: {
    totalSKUs: number;
    criticalCount: number;
    reorderCount: number;
    avgWeeksOfSupply: number;
    topMoving: { style: string; velocity: number }[];
  }
) {
  const subject = `📊 Weekly Inventory Report - ${workspaceName}`;

  const topItems = stats.topMoving
    .slice(0, 5)
    .map((item, i) => `<li>${i + 1}. ${item.style} - ${item.velocity.toFixed(2)}/day</li>`
    )
    .join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>📊 Weekly Inventory Report</h2>
      <p>Here's your inventory summary for ${workspaceName}:</p>

      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <p style="color: #6b7280; margin: 0;">Total SKUs</p>
            <p style="font-size: 24px; font-weight: bold; margin: 4px 0;">${stats.totalSKUs}</p>
          </div>
          <div>
            <p style="color: #6b7280; margin: 0;">Critical Items</p>
            <p style="font-size: 24px; font-weight: bold; margin: 4px 0; color: ${stats.criticalCount > 0 ? '#dc2626' : '#16a34a'};">${stats.criticalCount}</p>
          </div>
          <div>
            <p style="color: #6b7280; margin: 0;">Need Reorder</p>
            <p style="font-size: 24px; font-weight: bold; margin: 4px 0; color: ${stats.reorderCount > 0 ? '#d97706' : '#16a34a'};">${stats.reorderCount}</p>
          </div>
          <div>
            <p style="color: #6b7280; margin: 0;">Avg Weeks Supply</p>
            <p style="font-size: 24px; font-weight: bold; margin: 4px 0;">${stats.avgWeeksOfSupply}w</p>
          </div>
        </div>
      </div>

      <h3>Top Moving Items</h3>
      <ol>${topItems}</ol>

      <a href="${process.env.NEXT_PUBLIC_APP_URL}" 
         style="display: inline-block; background: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
        View Full Report
      </a>
    </div>
  `;

  const text = `Weekly Inventory Report for ${workspaceName}\n\nTotal SKUs: ${stats.totalSKUs}\nCritical: ${stats.criticalCount}\nNeed Reorder: ${stats.reorderCount}\nAvg Weeks Supply: ${stats.avgWeeksOfSupply}\n\nView in OTB Live: ${process.env.NEXT_PUBLIC_APP_URL}`;

  return sendEmail({ to, subject, html, text });
}
