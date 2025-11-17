import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null
});

export const scrapeQueue = new Queue("scrapeQueue", { connection });

