// fetchrestpup.js
const puppeteer = require('puppeteer');
const fs = require('fs/promises');

async function fetchMenu(restaurantName) {
  const browser = await puppeteer.launch({
    headless: false,      // run visible for debugging; set true later
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 900 },
    slowMo: 20
  });
  const page = await browser.newPage();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const normalize = s => (s||'').toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  try {
    // Start directly from the area page with restaurants
    const BASE_URL = 'https://www.talabat.com/oman/restaurants/1414/al-mawalih-south';
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(2000); // Give page time to fully load

    // Try a few likely search inputs
    const searchSelectors = [
      'input[placeholder="Search restaurants"]',
      'input[placeholder*="Search restaurants"]',
      'input[type="search"]',
      'input[placeholder*="Search for area"]', // sometimes a combined box
      'input[type="text"]'
    ];

    let found = null;
    for (const sel of searchSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        found = sel;
        break;
      } catch (e) { /* try next */ }
    }
    if (!found) {
      // If no input was found, take a screenshot and bail with diagnostics
      await page.screenshot({ path: 'debug_no_input.png', fullPage: true });
      throw new Error('Could not locate search input on Talabat Muscat page — saved debug_no_input.png');
    }

    await page.click(found, { clickCount: 3 }).catch(()=>{});
    await page.type(found, restaurantName, { delay: 25 });
    await page.keyboard.press('Enter');
    await sleep(1200);

    // Wait for a restaurant link (Talabat's detail URLs include /oman/restaurant/ or /oman/restaurants/)
    await page.waitForFunction(() =>
      !!document.querySelector('a[href*="/oman/restaurant/"]'),
      { timeout: 15000 }
    ).catch(()=>{});

    // Find and click the restaurant link using Puppeteer (not evaluateHandle)
    const targetName = restaurantName.toLowerCase().trim();
    const linkHandles = await page.$$('a[href*="/oman/restaurant/"]');
    
    let clicked = false;
    for (const link of linkHandles) {
      const [href, text, aria] = await Promise.all([
        link.evaluate(el => (el.getAttribute('href') || '')),
        link.evaluate(el => (el.textContent || '').trim()),
        link.evaluate(el => (el.getAttribute('aria-label') || '').trim())
      ]);
      
      // Only accept actual restaurant detail pages (singular /restaurant/)
      if (!href || !href.includes('/oman/restaurant/')) continue;
      
      const combinedText = (text + ' ' + aria).toLowerCase();
      if (combinedText.includes(targetName)) {
        await link.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await sleep(300);
        await link.click().catch(() => {});
        clicked = true;
        break;
      }
    }
    
    // Fallback: click first restaurant link if no match found
    if (!clicked && linkHandles.length > 0) {
      await linkHandles[0].evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await sleep(300);
      await linkHandles[0].click().catch(() => {});
      clicked = true;
    }
    
    if (!clicked) {
      throw new Error(`Could not find restaurant "${restaurantName}" in search results`);
    }

    // Wait for navigation to restaurant page
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(2000);

    // On brand page, may need to click "Show menu" and select area
    const showMenuBtn = await page.$('[data-testid="header-show-menu-btn"]').catch(() => null);
    if (showMenuBtn) {
      await showMenuBtn.click().catch(() => {});
      await sleep(1000);
      
      // If area input appears, enter an area
      const areaInput = await page.$('#search-box-map-first, input[placeholder*="Search for area"]').catch(() => null);
      if (areaInput) {
        await areaInput.click({ clickCount: 3 }).catch(() => {});
        await areaInput.type('Bawshar', { delay: 15 }).catch(() => {});
        await sleep(1000);
        await page.keyboard.press('Enter').catch(() => {});
        await sleep(1000);
        
        // Click "Show menu" again if it reappears
        const showMenuAgain = await page.$('[data-testid="header-show-menu-btn"]').catch(() => null);
        if (showMenuAgain) {
          await showMenuAgain.click().catch(() => {});
          await sleep(2000);
        }
      }
    }

    // Wait for the menu area to load - look for menu categories
    await page.waitForSelector('div[data-testid="menu-category"]', { timeout: 30000 }).catch(()=>{});
    await sleep(2000); // Extra wait for dynamic content

    // Scrape menu items using the exact structure provided
    const menu = await page.evaluate(() => {
      const normalize = (s) => (s || '').toLowerCase().trim();
      const priceLike = (s) => /\d+(?:[.,]\d{1,3})/.test(s);
      
      const items = [];
      
      // Find all menu categories
      const categories = Array.from(document.querySelectorAll('div[data-testid="menu-category"]'));
      
      for (const category of categories) {
        // Find all items in this category (inside .content.open)
        const contentOpen = category.querySelector('.content.open');
        if (!contentOpen) continue;
        
        // Find all clickable item containers
        const itemContainers = Array.from(contentOpen.querySelectorAll('div.clickable, div[class*="clickable"]'));
        
        for (const itemContainer of itemContainers) {
          // Extract name from .item-name > .f-15
          const nameEl = itemContainer.querySelector('.item-name .f-15, .item-name > .f-15');
          const name = nameEl?.textContent?.trim() || '';
          
          if (!name) continue;
          
          // Extract description from .item-name > .f-12.description
          const descEl = itemContainer.querySelector('.item-name .f-12.description, .item-name .description, .item-name > .description');
          const desc = descEl?.textContent?.trim() || '';
          
          // Extract price from .text-right.price-rating .currency
          // Skip the old price (data-testid="old-price") and get the current price
          const priceContainer = itemContainer.querySelector('.text-right.price-rating');
          if (!priceContainer) continue;
          
          // Find all currency elements, but skip the one with old-price
          const allCurrencyEls = Array.from(priceContainer.querySelectorAll('.currency'));
          let priceRaw = '';
          
          // Look for the current price (not inside old-price)
          for (const currencyEl of allCurrencyEls) {
            const oldPriceParent = currencyEl.closest('[data-testid="old-price"]');
            if (!oldPriceParent) {
              // This is the current price
              priceRaw = currencyEl.textContent?.trim() || '';
              break;
            }
          }
          
          // If no current price found, try the last currency element
          if (!priceRaw && allCurrencyEls.length > 0) {
            priceRaw = allCurrencyEls[allCurrencyEls.length - 1].textContent?.trim() || '';
          }
          
          // Validate price
          if (priceRaw && priceLike(priceRaw) && name) {
            items.push({ name, description: desc, price: priceRaw });
          }
        }
      }
      
      // Fallback: if no categories found, try finding items directly
      if (!items.length) {
        const itemContainers = Array.from(document.querySelectorAll('div.clickable, div[class*="clickable"]'));
        for (const itemContainer of itemContainers) {
          const nameEl = itemContainer.querySelector('.item-name .f-15, .item-name > .f-15');
          const name = nameEl?.textContent?.trim() || '';
          
          if (!name) continue;
          
          const descEl = itemContainer.querySelector('.item-name .description, .item-name > .description');
          const desc = descEl?.textContent?.trim() || '';
          
          const priceContainer = itemContainer.querySelector('.text-right.price-rating');
          if (!priceContainer) continue;
          
          const allCurrencyEls = Array.from(priceContainer.querySelectorAll('.currency'));
          let priceRaw = '';
          
          for (const currencyEl of allCurrencyEls) {
            const oldPriceParent = currencyEl.closest('[data-testid="old-price"]');
            if (!oldPriceParent) {
              priceRaw = currencyEl.textContent?.trim() || '';
              break;
            }
          }
          
          if (!priceRaw && allCurrencyEls.length > 0) {
            priceRaw = allCurrencyEls[allCurrencyEls.length - 1].textContent?.trim() || '';
          }
          
          if (priceRaw && priceLike(priceRaw) && name) {
            items.push({ name, description: desc, price: priceRaw });
          }
        }
      }
      
      // Dedupe by name+price
      const seen = new Set();
      const deduped = [];
      for (const it of items) {
        const key = `${normalize(it.name)}|${it.price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(it);
      }
      
      return deduped;
    });

    // optional: save debug HTML/screenshot
    try {
      const html = await page.content();
      await fs.writeFile('debug_search.html', html, 'utf8');
      await page.screenshot({ path: 'debug_menu.png', fullPage: true });
    } catch (e) {}

    await browser.close();
    return {
      restaurant: restaurantName,
      source: 'Talabat',
      menuItems: menu
    };
  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}

// allow CLI
if (require.main === module) {
  (async () => {
    const nameArg = process.argv.slice(2).join(' ') || 'Manoush';
    try {
      const res = await fetchMenu(nameArg);
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error('ERROR:', err.message || err);
      process.exit(1);
    }
  })();
}

module.exports = { fetchMenu };
