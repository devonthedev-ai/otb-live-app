// Quick test
const fs = require('fs');
const Papa = require('papaparse');

const csv = fs.readFileSync('./test-data/file_7---6087b703-b936-447f-ae79-0e2503214f49.csv', 'utf-8');
const raw = Papa.parse(csv, { header: false });

// Find column indices
const headerRow = raw.data[0];
const styleIdx = headerRow.findIndex(h => h?.trim() === 'Style');
const colorIdx = headerRow.findIndex(h => h?.trim() === 'Color');
const otherIdx = headerRow.findIndex(h => h?.trim() === 'Other');
const avgIdx = headerRow.findIndex(h => h?.trim() === 'Avg');

console.log('Column indices:', { styleIdx, colorIdx, otherIdx, avgIdx });

// Check row 343 (SW0173 header)
const row343 = raw.data[343];
console.log('\nRow 343:', row343);

// Check row 344 (SW0173 BLK)
const row344 = raw.data[344];
console.log('\nRow 344:', row344);

// Now let's see if we can parse
let currentStyle = '';
let currentSizes = [];
const inventory = [];

for (let i = 343; i <= 346; i++) {
  const row = raw.data[i];
  const style = row[styleIdx]?.trim().replace(/^"|"$/g, '');
  const color = row[colorIdx]?.trim().replace(/^"|"$/g, '');
  const other = row[otherIdx]?.trim().replace(/^"|"$/g, '');
  
  console.log(`\nRow ${i}: style="${style}", color="${color}", other="${other}"`);
  
  // Detect size header row - has sizes in position 3-8
  const col3 = row[3]?.trim();
  const col4 = row[4]?.trim();
  const col5 = row[5]?.trim();
  
  // If col3 is XS and col4 is S and col5 is M, this is a size header
  if (col3 === 'XS' && col4 === 'S' && col5 === 'M') {
    currentStyle = style;
    currentSizes = [];
    for (let c = 3; c < avgIdx && c < row.length; c++) {
      const val = row[c]?.trim().replace(/^"|"$/g, '');
      if (val) currentSizes.push(val);
    }
    console.log(`  -> Size header for ${style}:`, currentSizes);
    continue;
  }
  
  // Data row
  if (color && color !== '' && currentStyle === style) {
    console.log(`  -> Data row for ${color}`);
    for (let s = 0; s < currentSizes.length; s++) {
      const qtyStr = row[3 + s]?.trim();
      if (!qtyStr) continue;
      const qty = parseInt(qtyStr);
      if (isNaN(qty)) continue;
      console.log(`     ${color}-${currentSizes[s]}: ${qty}`);
      inventory.push({ style, color, size: currentSizes[s], qty });
    }
  }
}

console.log('\n\nTotal parsed:', inventory.length);
inventory.forEach(i => console.log(`  ${i.style}-${i.color}-${i.size}: ${i.qty}`));

