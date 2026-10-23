import { prisma } from '../db';
import { redis } from '../redis';
import { reindexAll } from '../services/searchService';

// Rebuild the whole Elasticsearch index from PostgreSQL:  npm run reindex
reindexAll()
  .then((count) => console.log(`Reindexed ${count} emails`))
  .catch((error) => {
    console.error('Reindex failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
