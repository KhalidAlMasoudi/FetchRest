interface MenuItem {
    name: string;
    description: string;
    price: string;
}
interface ScrapeResult {
    restaurant: string;
    source: string;
    menuItems: MenuItem[];
}
export declare function scrapeMenu(restaurantName: string): Promise<ScrapeResult>;
export {};
//# sourceMappingURL=scraper.d.ts.map