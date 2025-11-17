import express, { Request, Response } from 'express';
import cors from 'cors';
import { scrapeMenu } from './scraper';

const app = express();
const PORT = process.env.PORT || 3000;

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

    // Validate input
    if (!restaurant || typeof restaurant !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Please provide a "restaurant" field in the request body (string)'
      });
    }

    // Scrape the menu
    const result = await scrapeMenu(restaurant);

    // Return the result
    res.json(result);
  } catch (error: any) {
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

