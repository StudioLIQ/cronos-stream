import { getNetworkConfig } from './x402/constants.js';
import { logger } from './logger.js';

// Load .env if present
import 'dotenv/config';

function parseDbConfigFromUrl(databaseUrl: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'mysql:') {
    throw new Error(`Unsupported DATABASE_URL protocol: ${url.protocol}`);
  }

  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL must include a database name (e.g. mysql://user:pass@host:3306/stream402)');
  }

  return {
    host: url.hostname || '127.0.0.1',
    port: url.port ? parseInt(url.port, 10) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

export const config = {
  apiPort: parseInt(process.env.API_PORT || '3402', 10),
  db: process.env.DATABASE_URL
    ? parseDbConfigFromUrl(process.env.DATABASE_URL)
    : {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3307', 10),
        user: process.env.DB_USER || 'stream402',
        password: process.env.DB_PASSWORD || 'stream402',
        database: process.env.DB_NAME || 'stream402',
      },
  defaultNetwork: process.env.DEFAULT_NETWORK || 'cronos-testnet',
  sellerWallet: process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000',
  dashboardToken: process.env.DASHBOARD_TOKEN || 'demo-token',
} as const;

// Validate and log config on startup
export function logConfig(): void {
  const networkConfig = getNetworkConfig(config.defaultNetwork);

  logger.info('Configuration loaded:');
  logger.info(`  API Port: ${config.apiPort}`);
  logger.info(`  DB: mysql://${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);
  logger.info(`  Network: ${config.defaultNetwork}`);
  logger.info(`  Chain ID: ${networkConfig.chainId}`);
  logger.info(`  USDC.e: ${networkConfig.usdcAddress}`);
  logger.info(`  Seller Wallet: ${config.sellerWallet}`);

  if (config.sellerWallet === '0x0000000000000000000000000000000000000000') {
    logger.warn('SELLER_WALLET not set - using zero address');
  }
}
