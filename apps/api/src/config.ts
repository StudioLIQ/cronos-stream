import path from 'path';
import { getNetworkConfig } from './x402/constants.js';
import { logger } from './logger.js';

// Load .env if present
import 'dotenv/config';

export const config = {
  apiPort: parseInt(process.env.API_PORT || '3402', 10),
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'stream402.db'),
  defaultNetwork: process.env.DEFAULT_NETWORK || 'cronos-testnet',
  sellerWallet: process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000',
  dashboardToken: process.env.DASHBOARD_TOKEN || 'demo-token',
} as const;

// Validate and log config on startup
export function logConfig(): void {
  const networkConfig = getNetworkConfig(config.defaultNetwork);

  logger.info('Configuration loaded:');
  logger.info(`  API Port: ${config.apiPort}`);
  logger.info(`  DB Path: ${config.dbPath}`);
  logger.info(`  Network: ${config.defaultNetwork}`);
  logger.info(`  Chain ID: ${networkConfig.chainId}`);
  logger.info(`  USDC.e: ${networkConfig.usdcAddress}`);
  logger.info(`  Seller Wallet: ${config.sellerWallet}`);

  if (config.sellerWallet === '0x0000000000000000000000000000000000000000') {
    logger.warn('SELLER_WALLET not set - using zero address');
  }
}
