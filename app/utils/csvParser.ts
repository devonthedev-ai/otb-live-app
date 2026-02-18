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
  
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true
  });
  
  let currentStyle = '';
  let currentColor = '';
  
  for (const row of result.data as Record<string, string>[]) {
    const style = row['Style']?.trim();
    const colorHeader = row['Color']?.trim();
    
    // Skip total rows
    if (style === 'Total') continue;
    
    // New style row - captures product name
    if (style && !colorHeader) {
      currentStyle = style;
      continue;
    }
    
    // Style with color
    if (style && colorHeader) {
      currentStyle = style;
      currentColor = colorHeader;
    } else if (colorHeader && !style) {
      // Just color change
      currentColor = colorHeader;
    }
    
    // Parse size columns (28, 29, 30, 31, 32, etc. or XS, S, M, L, XL, XXL)
    const sizeColumns = Object.keys(row).filter(k => 
      k && !['Style', 'Color', 'Other', 'Avg', 'Units', 'Value'].includes(k) && row[k]?.trim()
    );
    
    for (const sizeCol of sizeColumns) {
      const qty = parseInt(row[sizeCol]) || 0;
      const cost = parseFloat(row['Avg']?.replace('$', '').replace(',', '') || '0');
      
      // Determine if Core (you'll need to set this manually or via lookup)
      // For now, we'll default to Core for testing
      const season = 'Core'; // TODO: Read from separate source
      
      const product: Product = {
        style: currentStyle,
        color: currentColor,
        size: sizeCol,
        season,
        leadTimeDays: 90, // Default 90 days
        cost
      };
      
      const invItem: InventoryItem = {
        style: currentStyle,
        color: currentColor,
        size: sizeCol,
        onHand: qty,
        incomingQty: 0, // Will be populated from PO data
        reservedQty: 0
      };
      
      products.push(product);
      inventory.push(invItem);
    }
    
    // Handle OS (One Size) items
    if (row['OS'] !== undefined) {
      const qty = parseInt(row['OS']) || 0;
      const cost = parseFloat(row['Avg']?.replace('$', '').replace(',', '') || '0');
      
      const product: Product = {
        style: currentStyle,
        color: currentColor,
        size: 'OS',
        season: 'Core',
        leadTimeDays: 90,
        cost
      };
      
      const invItem: InventoryItem = {
        style: currentStyle,
        color: currentColor,
        size: 'OS',
        onHand: qty,
        incomingQty: 0,
        reservedQty: 0
      };
      
      products.push(product);
      inventory.push(invItem);
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
    
    // Extract base style and color from Style field
    // Style format can be: "SW0173" or "SW0173-BLK" or "AC0001-BLK"
    let style = rawStyle;
    let color = row['Color']?.trim() || '';
    
    // If style contains a dash, it might have color embedded
    // Check if the part after dash matches the Color column
    if (rawStyle.includes('-')) {
      const parts = rawStyle.split('-');
      const potentialStyle = parts[0];
      const potentialColor = parts[1];
      
      // If the color column matches or is empty, use the base style
      if (!color || color === potentialColor) {
        style = potentialStyle;
        color = potentialColor;
      }
    }
    
    // Skip rows without size (these are rollups/totals)
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
