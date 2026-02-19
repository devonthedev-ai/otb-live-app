// utils/csvParser.ts - Parse ApparelMagic CSV exports

import Papa from 'papaparse';
import { Product, InventoryItem, SaleRecord } from '../types';

export interface ParsedInventory {
  products: Product[];
  inventory: InventoryItem[];
}

export function parseInventoryCSV(csvText: string): ParsedInventory {
  const products: Product[] = [];
  const inventory: InventoryItem[] = [];
  
  // Parse without headers
  const rawResult = Papa.parse(csvText, {
    header: false,
    skipEmptyLines: true
  });
  
  if (rawResult.data.length < 3) {
    return { products, inventory };
  }
  
  // Find column indices from header row
  const headerRow = rawResult.data[0] as string[];
  const styleIdx = headerRow.findIndex(h => h?.trim() === 'Style');
  const colorIdx = headerRow.findIndex(h => h?.trim() === 'Color');
  const avgIdx = headerRow.findIndex(h => h?.trim() === 'Avg');
  
  // Size columns are positions 3 through avgIdx-1 (between "Other" and "Avg")
  const sizeStartIdx = 3;
  
  let currentStyle = '';
  let currentSizeNames: string[] = [];
  
  for (let rowIdx = 1; rowIdx < rawResult.data.length; rowIdx++) {
    const row = rawResult.data[rowIdx] as string[];
    
    const style = row[styleIdx]?.trim().replace(/^"|"$/g, '');
    const color = row[colorIdx]?.trim().replace(/^"|"$/g, '');
    
    if (!style || style === 'Total') continue;
    
    // Detect size header row: has XS, S, M in columns 3,4,5
    const col3 = row[sizeStartIdx]?.trim();
    const col4 = row[sizeStartIdx + 1]?.trim();
    const col5 = row[sizeStartIdx + 2]?.trim();
    
    const isSizeHeader = col3 === 'XS' && col4 === 'S' && col5 === 'M';
    
    if (isSizeHeader) {
      currentStyle = style;
      currentSizeNames = [];
      for (let c = sizeStartIdx; c < avgIdx && c < row.length; c++) {
        const val = row[c]?.trim().replace(/^"|"$/g, '');
        if (val) currentSizeNames.push(val);
      }
      continue;
    }
    
    // Data row - must have a color and match current style
    if (!color || color === '' || currentStyle !== style) continue;
    
    const costStr = avgIdx >= 0 ? row[avgIdx] : '0';
    const cost = parseFloat(costStr?.replace(/[$,"]/g, '') || '0');
    
    // Parse quantities for each size
    for (let s = 0; s < currentSizeNames.length; s++) {
      const colIdx = sizeStartIdx + s;
      if (colIdx >= row.length) break;
      
      const sizeName = currentSizeNames[s];
      const qtyStr = row[colIdx]?.trim().replace(/^"|"$/g, '');
      
      if (!qtyStr) continue;
      const qty = parseInt(qtyStr);
      if (isNaN(qty)) continue;
      
      products.push({
        style: currentStyle,
        color: color,
        size: sizeName,
        season: 'Core',
        leadTimeDays: 90,
        cost
      });
      
      inventory.push({
        style: currentStyle,
        color: color,
        size: sizeName,
        onHand: qty,
        incomingQty: 0,
        reservedQty: 0
      });
    }
  }
  
  return { products, inventory };
}

export function parseSalesCSV(csvText: string): SaleRecord[] {
  const sales: SaleRecord[] = [];
  
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true
  });
  
  for (const row of result.data as Record<string, string>[]) {
    const rawStyle = row['Style']?.trim();
    if (!rawStyle || rawStyle === 'Total') continue;
    
    let style = rawStyle;
    let color = row['Color']?.trim() || '';
    
    if (rawStyle.includes('-')) {
      const parts = rawStyle.split('-');
      const potentialStyle = parts[0];
      const potentialColor = parts[1];
      
      if (!color || color === potentialColor) {
        style = potentialStyle;
        color = potentialColor;
      }
    }
    
    const size = row['Size']?.trim() || '';
    if (!size) continue;
    
    const units = parseInt(row['Units']) || 0;
    const netSales = parseFloat(row['Net Sales']?.replace('$', '').replace(',', '') || '0');
    
    sales.push({
      style,
      color,
      size,
      units,
      date: new Date().toISOString().split('T')[0],
      netSales
    });
  }
  
  return sales;
}
