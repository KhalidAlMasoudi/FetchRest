import express, { Request, Response } from 'express';
import cors from 'cors';
import { scrapeMenu } from './scraper';

const app = express();
const PORT: number = Number(process.env.PORT) || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Menu scraper API is running' });
});

// POST endpoint to scrape menu
app.post('/scrape-menu', async (req: Request, res: Response) => {
  try {
    const { restaurant } = req.body;

    if (!restaurant || typeof restaurant !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'Please provide a "restaurant" field in the request body (string)'
      });
    }

    const result = await scrapeMenu(restaurant);

    return res.json({
      success: true,
      restaurant: result.restaurant,
      source: result.source,
      count: result.menuItems.length,
      menuItems: result.menuItems
    });
  } catch (error: any) {
    console.error('Scraping error:', error);
    return res.status(500).json({
      success: false,
      error: 'Scraping failed',
      message: error?.message ?? 'An unknown error occurred while scraping the menu'
    });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀Menu scraper API server running on port ${PORT}`);
  console.log(`📡 POST endpoint: http://localhost:${PORT}/scrape-menu`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});

