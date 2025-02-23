import express from 'express';
import fetch from 'node-fetch'; // If on Node 18+, you can use global fetch
import * as cheerio from 'cheerio';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

const allowedDomains = ['*', 'https://skibc.tech', 'https://skibc.netlify.app'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    if (allowedDomains.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// In-memory cache: mapping URL -> scraped result
//const cache = {};

const skiResorts = [
  "Apex", "Mt-Baldy-Ski-Area", "Big-White", "Cypress-Mountain",
  "Fairmont-Hot-Springs", "Fernie", "Grouse-Mountain", "Harper-Mountain", "Ski-Smithers",
  "Kicking-Horse", "Kimberley", "Manning-Park-Resort", "MountCain", "Mount-Timothy-Ski-Area",
  "Mount-Washington", "Mount-Seymour", "Murray-Ridge", "Panorama", "PowderKing",
  "Red-Mountain", "Revelstoke", "HemlockResort", "ShamesMountain", "Silver-Star",
  "Summit-Lake-Ski-and-Snowboard-Area", "Sun-Peaks", "Troll-Resort",
  "Whistler-Blackcomb", "Whitewater", "Lake-Louise", "Sunshine", "Banff-Norquay",
  "Marmot-Basin", "Nakiska", "Castle-Mountain-Resort", "Pass-Powderkeg", "Mount-Baker", "Crystal-Mountain", "Stevens-Pass"
];

// This object will hold the aggregated results from the scraping job.
let botData = {};
let midData = {};
let topData = {};

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

      const parsedValue = (type === 'phrases')
        ? value
        : (value ? parseFloat(value) : '-');

      currentBlock.push(parsedValue);

      const classList = containerDiv.attr('class') || '';
      const hasBorder = classList.includes('forecast-table__container--border');
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

/**
 * Scrapes the given URL and returns the scraped data as an object.
 */
async function scrapeUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);

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

  const bottomElevation = getResortElevation($);

  return {
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
  };
}

/** -------------- Routes -------------- **/

app.get('/', (req, res) => {
  res.send('Hello!');
});

/**
 * GET /scrape?url=<snow-forecast-page>
 *
 * If cached data exists, it is immediately returned and refreshed in the background.
 * Deprecated
app.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Missing ?url=' });
    }

    // If cache exists, return cached data immediately.
    if (cache[url]) {
      const cachedData = cache[url];
      res.json({ success: true, cached: true, data: cachedData });
      
      // Asynchronously refresh the cache.
      scrapeUrl(url)
        .then(newData => {
          cache[url] = newData;
        })
        .catch(err => {
          console.error("Error refreshing cache for url:", url, err);
        });
    } else {
      // No cache exists, scrape and cache the result, then return it.
      const result = await scrapeUrl(url);
      cache[url] = result;
      res.json({ success: true, cached: false, data: result });
    }
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
*/

async function scrapeBot() {
  try {
    // Create an array of promises that will scrape data for each resort.
    const resortPromises = skiResorts.map(async (resort) => {
      const url = `https://www.snow-forecast.com/resorts/${resort}/6day/bot`;
      try {
        const data = await scrapeUrl(url);
        return { resort, data };
      } catch (error) {
        console.error(`Error scraping ${resort}:`, error);
        return { resort, error: error.message };
      }
    });

    // Wait for all the promises to resolve.
    const results = await Promise.all(resortPromises);

    // Update the botData object.
    botData = {
      timestamp: new Date(),
      resorts: results
    };

    console.log('Bot Data:', botData);
    // You can now process/store botData as needed.
  } catch (error) {
    console.error('Error in scraping all resorts:', error);
  }
}

async function scrapeMid() {
  try {
    // Create an array of promises that will scrape data for each resort.
    const resortPromises = skiResorts.map(async (resort) => {
      const url = `https://www.snow-forecast.com/resorts/${resort}/6day/mid`;
      try {
        const data = await scrapeUrl(url);
        return { resort, data };
      } catch (error) {
        console.error(`Error scraping ${resort}:`, error);
        return { resort, error: error.message };
      }
    });

    // Wait for all the promises to resolve.
    const results = await Promise.all(resortPromises);

    // Update the botData object.
    midData = {
      timestamp: new Date(),
      resorts: results
    };

    console.log('Mid Data:', midData);
    // You can now process/store botData as needed.
  } catch (error) {
    console.error('Error in scraping all resorts:', error);
  }
}

async function scrapeTop() {
  try {
    // Create an array of promises that will scrape data for each resort.
    const resortPromises = skiResorts.map(async (resort) => {
      const url = `https://www.snow-forecast.com/resorts/${resort}/6day/top`;
      try {
        const data = await scrapeUrl(url);
        return { resort, data };
      } catch (error) {
        console.error(`Error scraping ${resort}:`, error);
        return { resort, error: error.message };
      }
    });

    // Wait for all the promises to resolve.
    const results = await Promise.all(resortPromises);

    // Update the topData object.
    topData = {
      timestamp: new Date(),
      resorts: results
    };

    console.log('Top Data:', topData);
    // You can now process/store botData as needed.
  } catch (error) {
    console.error('Error in scraping all resorts:', error);
  }
}

/**
 * Scrapes data for all ski resorts concurrently, aggregates it into one object,
 * and updates the global `aggregatedData` with a timestamp.
 */
async function scrapeAllResorts() {
  try {
    scrapeBot();
    scrapeMid();
    scrapeTop();
  } catch (error) {
    console.error('Error in scraping all resorts:', error);
  }
}

// Run the scraping function immediately on startup.
scrapeAllResorts();

// Schedule the scraping function to run every 30 minutes (30 * 60 * 1000 milliseconds).
setInterval(scrapeAllResorts, 30 * 60 * 1000);

app.get('/bot', (req, res) => {
  res.json(botData);
});

app.get('/mid', (req, res) => {
  res.json(midData);
});

app.get('/top', (req, res) => {
  res.json(topData);
});

app.get('/all', (req, res) => {
  res.json({ botData, midData, topData });
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

