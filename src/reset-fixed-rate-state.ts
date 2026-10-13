import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { Database } from './persistence/index.js';

async function main() {
  const config = loadConfig();
  const database = new Database(config.databaseUrl);

  try {
    await database.migrate();
    await database.resetFixedRateRewardState(config.startBlock);
    console.log(`Fixed rate reward state and crawler cursor reset to block ${config.startBlock}. Start the crawler to rebuild it.`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
