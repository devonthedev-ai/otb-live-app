// test/manualTest.ts - Test app logic with real CSV data
// @ts-nocheck

const fs = require('fs');
const Papa = require('papaparse');

console.log('=== OTB Live Manual Test ===\n');

// Read CSVs
const inventoryCSV = fs.readFileSync('./test-data/file_7---6087b703-b936-447f-ae79-0e2503214f49.csv', 'utf-8');
const salesCSV = fs.readFileSync('./test-data/file_0---cf55782c-f68a-461e-8db2-98904c37acf7.csv', 'utf-8');

// Import the actual parser functions
// Since we can't use ES modules easily, inline the fixed parser here

function parseInventoryCSV(csvText) {
  const products = [];
  const inventory = [];
  
  // Parse without headers first to detect structure
  const rawResult = Papa.parse(csvText, {
    header: false,
    skipEmptyLines: true
  });
  
  if (rawResult.data.length < 2) {
    return { products, inventory };
  }
  
  // First row is headers - find size column positions
  const headerRow = rawResult.data[0];
  const styleIdx = headerRow.findIndex(h => h?.trim() === 'Style');
  const colorIdx = headerRow.findIndex(h => h?.trim() === 'Color');
  const otherIdx = headerRow.findIndex(h => h?.trim() === 'Other');
  const avgIdx = headerRow.findIndex(h => h?.trim() === 'Avg');
  
  // Size columns are between "Other" and "Avg"
  const sizeColumnIndices = [];
  if (otherIdx >= 0 && avgIdx > otherIdx) {
    for (let i = otherIdx + 1; i < avgIdx; i++) {
      if (headerRow[i] !== undefined) {
        sizeColumnIndices.push(i);
      }
    }
  }
  
  console.log(`   Parser debug: Style@${styleIdx}, Color@${colorIdx}, Other@${otherIdx}, Avg@${avgIdx}`);
  console.log(`   Size columns found: ${sizeColumnIndices.length} (${sizeColumnIndices.map(i => headerRow[i]).join(', ')})`);
  
  // Parse data rows
  let currentStyle = '';
  
  for (let rowIdx = 1; rowIdx < rawResult.data.length; rowIdx++) {
    const row = rawResult.data[rowIdx];
    
    const style = row[styleIdx]?.trim();
    const color = row[colorIdx]?.trim();
    const other = row[otherIdx]?.trim();
    
    if (style === 'Total') continue;
    
    // Row with style but no color = product name row
    if (style && !color && other) {
      currentStyle = style;
      continue;
    }
    
    if (!style || !color) continue;
    currentStyle = style;
    
    const costStr = avgIdx >= 0 ? row[avgIdx] : '0';
    const cost = parseFloat(costStr?.replace('$', '').replace(',', '') || '0');
    
    // Parse each size column
    for (const sizeIdx of sizeColumnIndices) {
      const sizeName = headerRow[sizeIdx]?.trim() || `Col${sizeIdx}`;
      const qtyStr = row[sizeIdx]?.trim();
      
      if (!qtyStr) continue;
      
      const qty = parseInt(qtyStr) || 0;
      if (qty === 0 && qtyStr !== '0') continue;
      
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

function parseSalesCSV(csvText) {
  const sales = [];
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  
  for (const row of result.data) {
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
    
    sales.push({
      style,
      color,
      size,
      units,
      date: new Date().toISOString().split('T')[0],
      netSales: 0
    });
  }
  
  return sales;
}

function calculateRecommendations(products, inventory, sales) {
  const recommendations = [];
  const velocityMap = new Map();
  const skuSales = new Map();
  
  for (const sale of sales) {
    const key = `${sale.style}-${sale.color}-${sale.size}`;
    skuSales.set(key, (skuSales.get(key) || 0) + sale.units);
  }
  
  const daysInPeriod = 30;
  skuSales.forEach((units, key) => {
    velocityMap.set(key, units / daysInPeriod);
  });
  
  for (const inv of inventory) {
    const key = `${inv.style}-${inv.color}-${inv.size}`;
    const product = products.find(p => 
      p.style === inv.style && p.color === inv.color && p.size === inv.size
    );
    
    if (!product) continue;
    
    const isCore = product.season === 'Core';
    const dailyVelocity = velocityMap.get(key) || 0;
    const availableStock = inv.onHand - inv.reservedQty + inv.incomingQty;
    const daysUntilStockout = dailyVelocity > 0 ? availableStock / dailyVelocity : Infinity;
    
    let suggestedQty = 0;
    
    if (isCore && dailyVelocity > 0) {
      const projectedDemand = Math.ceil(dailyVelocity * 104);
      if (availableStock < projectedDemand) {
        suggestedQty = projectedDemand - availableStock;
      }
    }
    
    recommendations.push({
      style: inv.style,
      color: inv.color,
      size: inv.size,
      currentStock: availableStock,
      dailyVelocity,
      daysUntilStockout: Math.floor(daysUntilStockout),
      suggestedQty,
      isCore
    });
  }
  
  return recommendations.sort((a, b) => {
    if (a.isCore && a.suggestedQty > 0 && (!b.isCore || b.suggestedQty === 0)) return -1;
    if (b.isCore && b.suggestedQty > 0 && (!a.isCore || a.suggestedQty === 0)) return 1;
    return a.daysUntilStockout - b.daysUntilStockout;
  });
}

console.log('1. PARSING CSV FILES...');
const { products, inventory } = parseInventoryCSV(inventoryCSV);
const sales = parseSalesCSV(salesCSV);

console.log(`   Inventory items: ${inventory.length}`);
console.log(`   Sales records: ${sales.length}`);

// Check SW0173 specifically
const sw0173inv = inventory.filter(i => i.style === 'SW0173');
const sw0173sales = sales.filter(s => s.style === 'SW0173');

console.log('\n2. SW0173 INVENTORY:');
sw0173inv.forEach(i => {
  console.log(`   ${i.color}-${i.size}: ${i.onHand}`);
});

console.log('\n3. SW0173 SALES:');
sw0173sales.forEach(s => {
  console.log(`   ${s.color}-${s.size}: ${s.units}`);
});

console.log('\n4. CALCULATING RECOMMENDATIONS...');
const recommendations = calculateRecommendations(products, inventory, sales);

console.log(`   Total: ${recommendations.length}`);
console.log(`   Need reorder: ${recommendations.filter(r => r.isCore && r.suggestedQty > 0).length}`);

const sw0173Rec = recommendations.find(r => r.style === 'SW0173' && r.color === 'BLK' && r.size === 'M');
if (sw0173Rec) {
  console.log('\n5. SW0173-BLK-M:');
  console.log(`   Stock: ${sw0173Rec.currentStock}`);
  console.log(`   Velocity: ${sw0173Rec.dailyVelocity.toFixed(2)}`);
  console.log(`   Days left: ${sw0173Rec.daysUntilStockout}`);
  console.log(`   Suggested: ${sw0173Rec.suggestedQty}`);
} else {
  console.log('\n5. SW0173-BLK-M: NOT FOUND');
  console.log('   Available:', recommendations.filter(r => r.style === 'SW0173').map(r => `${r.color}-${r.size}`));
}

console.log('\n6. TOP 5 CRITICAL:');
recommendations
  .filter(r => r.isCore && r.suggestedQty > 0)
  .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)
  .slice(0, 5)
  .forEach((r, i) => {
    console.log(`   ${i+1}. ${r.style}-${r.color}-${r.size}: ${r.daysUntilStockout} days, ${r.suggestedQty} qty`);
  });

console.log('\n=== TEST COMPLETE ===');
