import { Worker } from "bullmq";
import { connection } from "./queue";
import { scrapeMenu } from "./scraper";

new Worker("scrapeQueue", async (job) => {
  const { restaurant } = job.data;
  
  console.log(`Processing job ${job.id} for restaurant: ${restaurant}`);
  
  const result = await scrapeMenu(restaurant);
  
  console.log(`Job ${job.id} completed. Found ${result.menuItems.length} menu items.`);
  
  return result; // Saved automatically in Redis
}, { connection });

console.log("🚀 Worker started and listening for jobs...");

