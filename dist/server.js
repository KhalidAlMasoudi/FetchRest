"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const scraper_1 = require("./scraper");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Menu scraper API is running' });
});
// POST endpoint to scrape menu
app.post('/scrape-menu', async (req, res) => {
    try {
        const { restaurant } = req.body;
        // Validate input
        if (!restaurant || typeof restaurant !== 'string') {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'Please provide a "restaurant" field in the request body (string)'
            });
        }
        // Scrape the menu
        const result = await (0, scraper_1.scrapeMenu)(restaurant);
        // Return the result
        res.json(result);
    }
    catch (error) {
        console.error('Scraping error:', error);
        // Return proper error response
        res.status(500).json({
            error: 'Scraping failed',
            message: error.message || 'An unknown error occurred while scraping the menu'
        });
    }
});
// Start server
app.listen(PORT, () => {
    console.log(`🚀 Menu scraper API server running on http://localhost:${PORT}`);
    console.log(`📡 POST endpoint: http://localhost:${PORT}/scrape-menu`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});
//# sourceMappingURL=server.js.map