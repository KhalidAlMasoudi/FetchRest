import express, { Request, Response } from 'express';
import cors from 'cors';
import { scrapeQueue } from './queue';

const app = express();
const PORT: number = Number(process.env.PORT) || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Menu scraper API is running' });
});

// POST endpoint to create scraping job
app.post('/scrape-menu', async (req: Request, res: Response) => {
  try {
    const { restaurant } = req.body;

    if (!restaurant || typeof restaurant !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Please provide a "restaurant" field in the request body (string)'
      });
    }

    const job = await scrapeQueue.add('scrape', {
      restaurant
    });

    return res.json({
      jobId: job.id,
      status: 'queued'
    });
  } catch (error: any) {
    console.error('Job creation error:', error);
    return res.status(500).json({
      error: 'Failed to create job',
      message: error?.message ?? 'An unknown error occurred'
    });
  }
});

// GET endpoint to check job status
app.get('/scrape-menu/:jobId', async (req: Request, res: Response) => {
  try {
    const job = await scrapeQueue.getJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    const result = await job.returnvalue;

    return res.json({
      jobId: job.id,
      status: state,
      result: result || null
    });
  } catch (error: any) {
    console.error('Job status error:', error);
    return res.status(500).json({
      error: 'Failed to get job status',
      message: error?.message ?? 'An unknown error occurred'
    });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Menu scraper API server running on port ${PORT}`);
  console.log(`📡 POST endpoint: http://localhost:${PORT}/scrape-menu`);
  console.log(`📊 GET job status: http://localhost:${PORT}/scrape-menu/:jobId`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});

