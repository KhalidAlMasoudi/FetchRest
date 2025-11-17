const puppeteer = require('puppeteer');
const fs = require('fs/promises');

async function fetchMenu(restaurantName) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const normalize = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  try {
    // Start from Muscat city page, then set a delivery location to reach area page
    const BASE_URL = 'https://www.talabat.com/oman/city/muscat';

    // Ensure consistent headers/UA/viewport for this site
    try {
      await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    } catch {}

    // Navigate to base (no strict verification to avoid SPA timing issues)
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});

    // Improve compatibility: set desktop user agent and viewport
    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1366, height: 900 });
    } catch {}

    // Handle cookie/consent banners if present
    try {
      await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, a'));
        const btn = candidates.find(el => /accept|agree|consent|allow/i.test(el.textContent || ''));
        if (btn && btn instanceof HTMLElement) btn.click();
      });
    } catch {}

    // On city page, enter delivery location to reach area page
    const locationSelectors = [
      '#search-box-map-first',
      'input[placeholder*="Search for area"]',
      'input[placeholder*="Search area"]',
      'input[type="text"]'
    ];
    let locFound = false;
    for (const sel of locationSelectors) {
      const handle = await page.$(sel);
      if (handle) {
        await page.click(sel, { clickCount: 3 }).catch(() => {});
        await page.type(sel, 'Al Mawalih South , Al Mazoon Street', { delay: 15 }).catch(() => {});
        locFound = true;
        break;
      }
    }
    if (!locFound) {
      // diagnostics
      try {
        await page.screenshot({ path: 'debug_city.png', fullPage: true });
        const html = await page.content();
        await fs.writeFile('debug_city.html', html, 'utf8');
      } catch {}
      throw new Error('Could not find location input on Muscat city page');
    }
    await sleep(1200);
    await page.keyboard.press('Enter').catch(() => {});
    // Some sessions require clicking the "Let's go" button
    const letsGoBtn = await page.$('[data-testid="letsgo-btn-mm3"]').catch(() => null);
    if (!letsGoBtn) {
      // Fallback: find button by text content
      const btnByText = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => /let's go/i.test(b.textContent || ''));
      }).catch(() => null);
      if (btnByText) {
        await btnByText.click().catch(() => {});
      }
    } else {
      await letsGoBtn.click().catch(() => {});
    }

    // Wait until redirected to an area page (accept any /oman/restaurants/…)
    await page.waitForFunction(() => /\/oman\/restaurants\/\d+\/[\w-]+/i.test(location.pathname), { timeout: 45_000 }).catch(() => {});

    // Now search for the restaurant within the area page
    const searchSelectors = [
      'input[placeholder="Search restaurants"]',
      'input[placeholder*="Search restaurants"]',
      'input[type="search"]'
    ];
    let searchFound = false;
    for (const sel of searchSelectors) {
      const handle = await page.$(sel);
      if (handle) {
        await page.click(sel, { clickCount: 3 }).catch(() => {});
        await page.type(sel, restaurantName, { delay: 20 }).catch(() => {});
        searchFound = true;
        break;
      }
    }
    if (!searchFound) {
      // fallback generic
      await page.waitForSelector('input[type="search"]', { timeout: 20_000 }).catch(() => {});
      const generic = await page.$('input[type="search"]');
      if (generic) {
        await generic.click({ clickCount: 3 }).catch(() => {});
        await generic.type(restaurantName, { delay: 20 }).catch(() => {});
        searchFound = true;
      }
    }
    await page.keyboard.press('Enter').catch(() => {});
    await sleep(1200);

    // Wait for restaurant result links to render
    await page.waitForFunction(() => !!document.querySelector('a[href*="/oman/restaurant/"]'), { timeout: 20_000 }).catch(() => {});

    // Click restaurant by matching link text (case-insensitive, partial match)
    let clicked = false;
    const lowered = normalize(restaurantName);
    const linkHandles = await page.$$('a[href*="/oman/restaurant/"]');
    for (const link of linkHandles) {
      const [href, text, aria] = await Promise.all([
        link.evaluate(el => (el.getAttribute('href') || '')),
        link.evaluate(el => (el.textContent || '').trim()),
        link.evaluate(el => (el.getAttribute('aria-label') || '').trim())
      ]);
      if (!href) continue;
      // Only accept actual restaurant detail pages
      const isRestaurantDetail = href.includes('/oman/restaurant/');
      if (!isRestaurantDetail) continue;

      const textNorm = normalize(text);
      const ariaNorm = normalize(aria);
      // require a word-boundary match in visible text or aria-label
      const wordMatch = new RegExp(`\\b${lowered.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if ((textNorm && wordMatch.test(textNorm)) || (ariaNorm && wordMatch.test(ariaNorm))) {
        try {
          await link.evaluate(el => (el instanceof HTMLElement) && el.scrollIntoView({ block: 'center' }));
        } catch {}
        await sleep(200);
        await link.click().catch(() => {});
        clicked = true;
        break;
      }
    }

    // Fallback: click the first restaurant detail link if search matched nothing
    if (!clicked) {
      // Try clicking from suggestions dropdown if present
      const suggestionClicked = await page.evaluate((name) => {
        const norm = (s) => (s||'').toLowerCase().trim();
        const target = norm(name);
        const anchors = Array.from(document.querySelectorAll('a[href*="/oman/restaurant/"]'));
        for (const a of anchors) {
          const t = norm(a.textContent || a.getAttribute('aria-label') || '');
          if (t.includes(target)) {
            (a instanceof HTMLElement) && a.click();
            return true;
          }
        }
        return false;
      }, restaurantName).catch(() => false);
      if (suggestionClicked) {
        clicked = true;
      }
    }

    if (!clicked) {
      // As a last resort, scroll and try again to reveal lazy content
      try {
        await page.evaluate(async () => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise(r => setTimeout(r, 1000));
      } catch {}
      const firstDetail = await page.$('a[href*="/oman/restaurant/"]');
      if (firstDetail) {
        await firstDetail.click().catch(() => {});
        clicked = true;
      }
    }

    if (!clicked) {
      // Provide diagnostics of what we saw
      const seen = await page.$$eval('a[href*="/oman/restaurant/"]', els =>
        els.map(el => ((el.getAttribute('aria-label') || el.textContent || '')).trim()).filter(Boolean).slice(0, 30)
      ).catch(() => []);

      // Debug outputs to help diagnose DOM structure differences
      try {
        await page.screenshot({ path: 'debug_search.png', fullPage: true });
        const html = await page.content();
        await fs.writeFile('debug_search.html', html, 'utf8');
      } catch {}

      throw new Error(`Could not find restaurant in results: ${restaurantName}. Seen: ${JSON.stringify(seen)}`);
    }

    // Wait for brand page to load
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});

    // On brand page, click "Show menu" and select an area (e.g., Bawshar) if required
    const showMenuSel = '[data-testid="header-show-menu-btn"]';
    const areaInputSel = '#search-box-map-first, input[placeholder*="Search for area"]';

    const hasShowMenu = await page.$(showMenuSel).catch(() => null);
    if (!hasShowMenu) {
      // Fallback: find button with chevron icon
      const btnWithChevron = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.querySelector('svg[data-icon="chevron-right"]'));
      }).catch(() => null);
      if (btnWithChevron) {
        await btnWithChevron.click().catch(() => {});
        await sleep(600);
      }
    } else {
      await page.click(showMenuSel).catch(() => {});
      await sleep(600);
    }

    const areaBox = await page.$(areaInputSel);
    if (areaBox) {
      await page.click(areaInputSel, { clickCount: 3 }).catch(() => {});
      await page.type(areaInputSel, 'Bawshar', { delay: 15 }).catch(() => {});
      await sleep(1200);
      await page.keyboard.press('Enter').catch(() => {});
      await sleep(800);
      const confirmShow = await page.$(showMenuSel);
      if (confirmShow) {
        await page.click(showMenuSel).catch(() => {});
      }
    }

    // Wait for menu elements to appear
    await page.waitForSelector('.menu-item, [data-test*="menu"], [class*="menu"] [class*="item"]', { timeout: 45_000 }).catch(() => {});

    // Scrape menu (selectors may need tuning)
    const menuItems = await page.evaluate(() => {
      const normalize = (s) =>
        (s || '')
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

      const priceLike = (s) => /\d+(?:[.,]\d{1,3})/.test(s);
      const isAddCta = (s) => /\badd\b/i.test(s) || /\bcustomize\b/i.test(s);

      const candidates = Array.from(document.querySelectorAll('.menu-item, [data-test*="menu-item"], [class*="menu"] [class*="item"]'));
      /** @type {any[]} */
      const results = [];

      for (const item of candidates) {
        const nameEl = item.querySelector('.item-name, [data-test*="item-name"], h3, h4, .title');
        const descEl = item.querySelector('.item-description, [data-test*="item-description"], p, .desc, .description');
        const priceEl = item.querySelector('.item-price, [data-test*="price"], [class*="price"]');

        const name = (nameEl?.textContent || '').trim();
        const desc = (descEl?.textContent || '').trim();
        const priceRaw = (priceEl?.textContent || '').trim();

        const nameNorm = normalize(name);
        const priceClean = priceRaw
          .replace(/OMR/i, '')
          .replace(/[^\d.,]/g, '')
          .trim();

        if (!name || isAddCta(name) || isAddCta(desc)) continue;
        if (!priceClean || !priceLike(priceClean)) continue;

        // @ts-ignore - JS runtime array; type is asserted dynamically
        results.push(/** @type {any} */ ({
          name,
          description: desc,
          price: priceClean
        }));
      }

      // Fallback heuristic: inspect generic cards but avoid CTAs
      if (results.length === 0) {
        const cards = Array.from(document.querySelectorAll('[class*="menu"], [class*="item"]'));
        for (const card of cards) {
          const priceText = (card.textContent || '');
          const match = priceText.match(/\d+(?:[.,]\d{1,3})/);
          const title = card.querySelector('h3, h4, .title')?.textContent?.trim() || '';
          if (!title || isAddCta(title)) continue;
          if (!match) continue;
          // @ts-ignore - JS runtime array; type is asserted dynamically
          results.push(/** @type {any} */ ({
            name: title,
            description: card.querySelector('p, .desc, .description')?.textContent?.trim() || '',
            price: match[0]
          }));
        }
      }

      // Dedupe by name+price
      const seen = new Set();
      /** @type {any[]} */
      const deduped = [];
      for (const it of results) {
        // @ts-ignore - iterating dynamic objects collected above
        const key = `${normalize(String(it.name))}|${String(it.price)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(it);
      }
      return deduped;
    });

    return {
      restaurant: restaurantName,
      source: 'Talabat',
      menuItems
    };
  } finally {
    await browser.close();
  }
}

module.exports = { fetchMenu };

// Allow running directly: node fetchrestpup "Manoush"
if (require.main === module) {
  (async () => {
    const nameArg = process.argv[2] || 'Manoush';
    const data = await fetchMenu(nameArg);
    console.log(JSON.stringify(data, null, 2));
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
