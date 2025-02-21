import express from 'express';
import fetch from 'node-fetch'; // If on Node 18+, can use global fetch
import * as cheerio from 'cheerio';
import cors from 'cors';





// Use CORS middleware
// For local dev: origin: "http://localhost:3000"
// Or use "*" to allow all domains (less secure).
app.use(cors({ origin: "*" }));
/** -------------- Helper Functions -------------- **/

function getResortElevation($) {
  try {
    const elevationList = $('.elevation-control__list').first();
    if (!elevationList.length) return null;
    
    const bottomElevation = elevationList.find('.elevation-control__link--bot .height').text();
    return bottomElevation ? parseInt(bottomElevation, 10) : null;
  } catch (err) {
    console.error('Error getting elevation:', err);
    return null;
  }
}

function findMaxBlockLength(blocks) {
  if (!blocks || blocks.length === 0) return 0;
  return Math.max(...blocks.map(block => (block ? block.length : 0)));
}

function extractBlockData(row, $, type) {
  if (!row || !row.length) return [];
  
  const cells = row.find('td.forecast-table__cell');
  if (!cells.length) return [];
  
  const blocks = [];
  let currentBlock = [];

  cells.each((i, cell) => {
    const $cell = $(cell);
    let containerDiv, value;

    try {
      switch (type) {
        case 'snow':
          containerDiv = $cell.find('.forecast-table__container--snow');
          const snowAmount = containerDiv.find('.snow-amount');
          value = snowAmount.attr('data-value');
          break;
        case 'temperature':
          containerDiv = $cell.find('.temp-value');
          value = containerDiv.attr('data-value');
          // Example offset
          if (value) value = (parseFloat(value) + 1).toString();
          break;
        case 'wind':
          containerDiv = $cell.find('.forecast-table__container--wind');
          const windIcon = containerDiv.find('.wind-icon');
          value = windIcon.attr('data-speed');
          break;
        case 'freezing-level':
          containerDiv = $cell.find('.forecast-table__container--blue');
          const levelValue = containerDiv.find('.level-value');
          value = levelValue.attr('data-value');
          if (value) value = (parseFloat(value) + 100).toString();
          break;
        case 'rain':
          containerDiv = $cell.find('.rain-amount');
          value = containerDiv.attr('data-value');
          if (value) value = (parseFloat(value) / 10).toString();
          break;
        case 'phrases':
          containerDiv = $cell.find('.forecast-table__container');
          const phraseSpan = containerDiv.find('.forecast-table__phrase');
          value = phraseSpan.text().trim();
          break;
      }

      if (!containerDiv || !containerDiv.length) return;

      // Parse numeric except for 'phrases'
      const parsedValue = (type === 'phrases')
        ? value
        : (value ? parseFloat(value) : '-');

      currentBlock.push(parsedValue);

      const classList = containerDiv.attr('class') || '';
      const hasBorder = classList.includes('forecast-table__container--border');
      // If there's a border or it's the last cell, close off the block
      if (hasBorder || i === cells.length - 1) {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
      }
    } catch (err) {
      console.warn(`Error extracting ${type} data:`, err);
    }
  });

  return blocks;
}

/** -------------- Express Server -------------- **/

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Hello from Azure!');
});

/**
 * GET /scrape?url=<snow-forecast-page>
 *
 * Example:
 *   /scrape?url=https://www.snow-forecast.com/resorts/Cypress-Mountain/6day/bot
 */
app.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Missing ?url=' });
    }

    // 1) Fetch the HTML directly (no proxy needed!)
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const html = await response.text();

    // 2) Load into Cheerio
    const $ = cheerio.load(html);

    // 3) Extract data from relevant rows
    const snowRow = $('.forecast-table__row[data-row="snow"]');
    const snowBlocks = extractBlockData(snowRow, $, 'snow');

    const tempRow = $('.forecast-table__row[data-row="temperature-max"]');
    const temperatureBlocks = extractBlockData(tempRow, $, 'temperature');

    const windRow = $('.forecast-table__row[data-row="wind"]');
    const windBlocks = extractBlockData(windRow, $, 'wind');

    const flRow = $('.forecast-table__row[data-row="freezing-level"]');
    const freezinglevelBlocks = extractBlockData(flRow, $, 'freezing-level');

    const rainRow = $('.forecast-table__row[data-row="rain"]');
    const rainBlocks = extractBlockData(rainRow, $, 'rain');

    const phrasesRow = $('.forecast-table__row[data-row="phrases"]');
    const phrasesBlocks = extractBlockData(phrasesRow, $, 'phrases');

    // Elevation
    const bottomElevation = getResortElevation($);

    // 4) Respond with JSON
    res.json({
      success: true,
      resort: url,
      bottomElevation,
      snowBlocks,
      temperatureBlocks,
      windBlocks,
      freezinglevelBlocks,
      rainBlocks,
      phrasesBlocks,
      maxSnowBlockLength: findMaxBlockLength(snowBlocks),
    });
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start listening
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
