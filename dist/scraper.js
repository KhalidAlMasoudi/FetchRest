"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeMenu = scrapeMenu;
const puppeteer_1 = __importDefault(require("puppeteer"));
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
async function scrapeMenu(restaurantName) {
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1366, height: 900 }
    });
    const page = await browser.newPage();
    try {
        // Start directly from the area page with restaurants
        const BASE_URL = 'https://www.talabat.com/oman/restaurants/1414/al-mawalih-south';
        await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
        await sleep(2000); // Give page time to fully load
        // Try a few likely search inputs
        const searchSelectors = [
            'input[placeholder="Search restaurants"]',
            'input[placeholder*="Search restaurants"]',
            'input[type="search"]',
            'input[placeholder*="Search for area"]',
            'input[type="text"]'
        ];
        let found = null;
        for (const sel of searchSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 3000 });
                found = sel;
                break;
            }
            catch (e) {
                // try next
            }
        }
        if (!found) {
            throw new Error('Could not locate search input on Talabat page');
        }
        await page.click(found, { clickCount: 3 }).catch(() => { });
        await page.type(found, restaurantName, { delay: 25 });
        await page.keyboard.press('Enter');
        await sleep(1200);
        // Wait for a restaurant link
        await page.waitForFunction(() => !!document.querySelector('a[href*="/oman/restaurant/"]'), { timeout: 15000 }).catch(() => { });
        // Find and click the restaurant link
        const targetName = restaurantName.toLowerCase().trim();
        const linkHandles = await page.$$('a[href*="/oman/restaurant/"]');
        let clicked = false;
        for (const link of linkHandles) {
            const [href, text, aria] = await Promise.all([
                link.evaluate((el) => (el.getAttribute('href') || '')),
                link.evaluate((el) => (el.textContent || '').trim()),
                link.evaluate((el) => (el.getAttribute('aria-label') || '').trim())
            ]);
            // Only accept actual restaurant detail pages
            if (!href || !href.includes('/oman/restaurant/'))
                continue;
            const combinedText = (text + ' ' + aria).toLowerCase();
            if (combinedText.includes(targetName)) {
                await link.evaluate((el) => {
                    if (el instanceof HTMLElement) {
                        el.scrollIntoView({ block: 'center' });
                    }
                }).catch(() => { });
                await sleep(300);
                await link.click().catch(() => { });
                clicked = true;
                break;
            }
        }
        // Fallback: click first restaurant link if no match found
        if (!clicked && linkHandles.length > 0) {
            await linkHandles[0].evaluate((el) => {
                if (el instanceof HTMLElement) {
                    el.scrollIntoView({ block: 'center' });
                }
            }).catch(() => { });
            await sleep(300);
            await linkHandles[0].click().catch(() => { });
            clicked = true;
        }
        if (!clicked) {
            throw new Error(`Could not find restaurant "${restaurantName}" in search results`);
        }
        // Wait for navigation to restaurant page
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
        await sleep(2000);
        // On brand page, may need to click "Show menu" and select area
        const showMenuBtn = await page.$('[data-testid="header-show-menu-btn"]').catch(() => null);
        if (showMenuBtn) {
            await showMenuBtn.click().catch(() => { });
            await sleep(1000);
            // If area input appears, enter an area
            const areaInput = await page.$('#search-box-map-first, input[placeholder*="Search for area"]').catch(() => null);
            if (areaInput) {
                await areaInput.click({ clickCount: 3 }).catch(() => { });
                await areaInput.type('Bawshar', { delay: 15 }).catch(() => { });
                await sleep(1000);
                await page.keyboard.press('Enter').catch(() => { });
                await sleep(1000);
                // Click "Show menu" again if it reappears
                const showMenuAgain = await page.$('[data-testid="header-show-menu-btn"]').catch(() => null);
                if (showMenuAgain) {
                    await showMenuAgain.click().catch(() => { });
                    await sleep(2000);
                }
            }
        }
        // Wait for the menu area to load
        await page.waitForSelector('div[data-testid="menu-category"]', { timeout: 30000 }).catch(() => { });
        await sleep(2000);
        // Scrape menu items
        const menu = await page.evaluate(() => {
            const normalize = (s) => (s || '').toLowerCase().trim();
            const priceLike = (s) => /\d+(?:[.,]\d{1,3})/.test(s);
            const items = [];
            // Find all menu categories
            const categories = Array.from(document.querySelectorAll('div[data-testid="menu-category"]'));
            for (const category of categories) {
                // Find all items in this category (inside .content.open)
                const contentOpen = category.querySelector('.content.open');
                if (!contentOpen)
                    continue;
                // Find all clickable item containers
                const itemContainers = Array.from(contentOpen.querySelectorAll('div.clickable, div[class*="clickable"]'));
                for (const itemContainer of itemContainers) {
                    // Extract name from .item-name > .f-15
                    const nameEl = itemContainer.querySelector('.item-name .f-15, .item-name > .f-15');
                    const name = nameEl?.textContent?.trim() || '';
                    if (!name)
                        continue;
                    // Extract description from .item-name > .f-12.description
                    const descEl = itemContainer.querySelector('.item-name .f-12.description, .item-name .description, .item-name > .description');
                    const desc = descEl?.textContent?.trim() || '';
                    // Extract price from .text-right.price-rating .currency
                    // Skip the old price (data-testid="old-price") and get the current price
                    const priceContainer = itemContainer.querySelector('.text-right.price-rating');
                    if (!priceContainer)
                        continue;
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
                        const lastEl = allCurrencyEls[allCurrencyEls.length - 1];
                        priceRaw = lastEl.textContent?.trim() || '';
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
                    if (!name)
                        continue;
                    const descEl = itemContainer.querySelector('.item-name .description, .item-name > .description');
                    const desc = descEl?.textContent?.trim() || '';
                    const priceContainer = itemContainer.querySelector('.text-right.price-rating');
                    if (!priceContainer)
                        continue;
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
                        const lastEl = allCurrencyEls[allCurrencyEls.length - 1];
                        priceRaw = lastEl.textContent?.trim() || '';
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
                if (seen.has(key))
                    continue;
                seen.add(key);
                deduped.push(it);
            }
            return deduped;
        });
        await browser.close();
        return {
            restaurant: restaurantName,
            source: 'Talabat',
            menuItems: menu
        };
    }
    catch (err) {
        await browser.close().catch(() => { });
        throw err;
    }
}
//# sourceMappingURL=scraper.js.map