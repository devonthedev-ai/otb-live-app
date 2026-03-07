// utils/poExport.ts - Purchase Order generation and export

import { ReorderRecommendation, PODraft, POItem, Product } from '../types';

/**
 * Generate a PO draft for a specific vendor
 */
export function generatePODraft(
  vendor: string,
  recommendations: ReorderRecommendation[],
  products: Product[],
  poNumber?: string
): PODraft {
  const items: POItem[] = [];
  let totalQty = 0;
  let totalCost = 0;
  
  for (const rec of recommendations) {
    const product = products.find(p => 
      p.style === rec.style && p.color === rec.color && p.size === rec.size
    );
    
    if (!product || product.vendor !== vendor) continue;
    
    const item: POItem = {
      style: rec.style,
      color: rec.color,
      size: rec.size,
      qty: rec.suggestedQty,
      cost: product.cost,
      extendedCost: rec.suggestedQty * product.cost
    };
    
    items.push(item);
    totalQty += item.qty;
    totalCost += item.extendedCost;
  }
  
  // Sort by style, then color, then size
  items.sort((a, b) => {
    if (a.style !== b.style) return a.style.localeCompare(b.style);
    if (a.color !== b.color) return a.color.localeCompare(b.color);
    return a.size.localeCompare(b.size);
  });
  
  // Calculate delivery date (today + lead time)
  const deliveryDate = new Date();
  const avgLeadTime = Math.round(
    items.reduce((sum, item) => {
      const prod = products.find(p => p.style === item.style);
      return sum + (prod?.leadTimeDays || 90);
    }, 0) / items.length
  );
  deliveryDate.setDate(deliveryDate.getDate() + avgLeadTime);
  
  return {
    poNumber: poNumber || generatePONumber(),
    vendor,
    date: new Date().toISOString().split('T')[0],
    deliveryDate: deliveryDate.toISOString().split('T')[0],
    items,
    totalQty,
    totalCost,
    notes: `Based on OTB Live analysis. Reorder to prevent stockouts.`
  };
}

/**
 * Generate unique PO number
 */
function generatePONumber(): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `PO${year}${month}${day}-${random}`;
}

/**
 * Generate CSV for PO
 */
export function generatePOCSV(draft: PODraft): string {
  let csv = 'Purchase Order\n';
  csv += `PO Number,${draft.poNumber}\n`;
  csv += `Vendor,${draft.vendor}\n`;
  csv += `Date,${draft.date}\n`;
  csv += `Delivery Date,${draft.deliveryDate}\n\n`;
  
  csv += 'Style,Color,Size,Quantity,Unit Cost,Extended Cost\n';
  
  for (const item of draft.items) {
    csv += `"${item.style}","${item.color}","${item.size}",${item.qty},${item.cost.toFixed(2)},${item.extendedCost.toFixed(2)}\n`;
  }
  
  csv += `\n,,,${draft.totalQty},,${draft.totalCost.toFixed(2)}\n`;
  
  return csv;
}

/**
 * Generate HTML for PO (for printing/PDF)
 */
export function generatePOHTML(draft: PODraft, companyInfo?: {
  name: string;
  address: string;
  email: string;
}): string {
  const company = companyInfo || { name: 'Your Company', address: '', email: '' };
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Purchase Order ${draft.poNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; color: #333; }
    .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
    .company { font-size: 24px; font-weight: bold; }
    .po-title { font-size: 32px; font-weight: bold; margin-top: 10px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px; }
    .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; }
    .info-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .info-value { font-size: 16px; font-weight: 600; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { text-align: left; padding: 12px; border-bottom: 2px solid #333; font-size: 12px; text-transform: uppercase; color: #666; }
    td { padding: 12px; border-bottom: 1px solid #ddd; }
    .text-right { text-align: right; }
    .total-row { font-weight: bold; border-top: 2px solid #333; }
    .notes { margin-top: 40px; padding: 20px; background: #f9f9f9; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">${company.name}</div>
    <div class="po-title">Purchase Order</div>
  </div>
  
  <div class="info-grid">
    <div class="info-box">
      <div class="info-label">Vendor</div>
      <div class="info-value">${draft.vendor}</div>
    </div>
    <div class="info-box">
      <div class="info-label">PO Number</div>
      <div class="info-value">${draft.poNumber}</div>
    </div>
    
    <div class="info-box">
      <div class="info-label">Order Date</div>
      <div class="info-value">${draft.date}</div>
    </div>
    
    <div class="info-box">
      <div class="info-label">Delivery Date</div>
      <div class="info-value">${draft.deliveryDate}</div>
    </div>
  </div>
  
  <table>
    <thead>
      <tr>
        <th>Style</th>
        <th>Color</th>
        <th>Size</th>
        <th class="text-right">Qty</th>
        <th class="text-right">Unit Cost</th>
        <th class="text-right">Total</th>
      </tr>
    </thead>
    <tbody>
`;

  for (const item of draft.items) {
    html += `
      <tr>
        <td>${item.style}</td>
        <td>${item.color}</td>
        <td>${item.size}</td>
        <td class="text-right">${item.qty}</td>
        <td class="text-right">$${item.cost.toFixed(2)}</td>
        <td class="text-right">$${item.extendedCost.toFixed(2)}</td>
      </tr>
    `;
  }

  html += `
      <tr class="total-row">
        <td colspan="3"><strong>Total</strong></td>
        <td class="text-right"><strong>${draft.totalQty}</strong></td>
        <td></td>
        <td class="text-right"><strong>$${draft.totalCost.toFixed(2)}</strong></td>
      </tr>
    </tbody>
  </table>
  
  ${draft.notes ? `<div class="notes">
    <strong>Notes:</strong><br>
    ${draft.notes}
  </div>` : ''}
  
</body>
</html>
`;

  return html;
}

/**
 * Download PO as HTML file (for printing to PDF)
 */
export function downloadPO(draft: PODraft, companyInfo?: { name: string; address: string; email: string }) {
  const html = generatePOHTML(draft, companyInfo);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PO_${draft.poNumber}_${draft.vendor.replace(/\s+/g, '_')}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
