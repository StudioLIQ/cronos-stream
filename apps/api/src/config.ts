import './env.js';

import { getNetworkConfig } from './x402/constants.js';
import { logger } from './logger.js';

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

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDbConfigFromRailwayMysql(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} | null {
  // Railway MySQL plugin commonly injects these:
  // MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE, MYSQL_URL
  const host = process.env.MYSQLHOST;
  const user = process.env.MYSQLUSER;
  const password = process.env.MYSQLPASSWORD;
  const database = process.env.MYSQLDATABASE;
  if (!host || !user || !password || !database) return null;

  return {
    host,
    port: parsePort(process.env.MYSQLPORT, 3306),
    user,
    password,
    database,
  };
}

function getDbConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (databaseUrl) return parseDbConfigFromUrl(databaseUrl);

  const railwayMysql = getDbConfigFromRailwayMysql();
  if (railwayMysql) return railwayMysql;

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parsePort(process.env.DB_PORT, 3307),
    user: process.env.DB_USER || 'stream402',
    password: process.env.DB_PASSWORD || 'stream402',
    database: process.env.DB_NAME || 'stream402',
  };
}

export const config = {
  apiPort: parsePort(process.env.API_PORT || process.env.PORT, 3402),
  db: getDbConfig(),
  defaultNetwork: process.env.DEFAULT_NETWORK || 'cronos-testnet',
  sellerWallet: process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000',
  dashboardToken: process.env.DASHBOARD_TOKEN || 'demo-token',
  membershipNft: {
    minterPrivateKey: process.env.MEMBERSHIP_NFT_MINTER_PRIVATE_KEY || null,
    addressByNetwork: {
      'cronos-testnet':
        process.env.MEMBERSHIP_NFT_ADDRESS_CRONOS_TESTNET || process.env.MEMBERSHIP_NFT_ADDRESS || null,
      'cronos-mainnet':
        process.env.MEMBERSHIP_NFT_ADDRESS_CRONOS_MAINNET || process.env.MEMBERSHIP_NFT_ADDRESS || null,
    },
  },
} as const;

// Validate and log config on startup
export function logConfig(): void {
  const networkConfig = getNetworkConfig(config.defaultNetwork);
  const normalizedNetwork = config.defaultNetwork === 'cronos' ? 'cronos-mainnet' : config.defaultNetwork;
  const membershipNftAddress =
    normalizedNetwork === 'cronos-testnet' || normalizedNetwork === 'cronos-mainnet'
      ? config.membershipNft.addressByNetwork[normalizedNetwork]
      : null;

  logger.info('Configuration loaded:');
  logger.info(`  API Port: ${config.apiPort}`);
  logger.info(`  DB: mysql://${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);
  logger.info(`  Network: ${config.defaultNetwork}`);
  logger.info(`  Chain ID: ${networkConfig.chainId}`);
  logger.info(`  USDC.e: ${networkConfig.usdcAddress}`);
  logger.info(`  Seller Wallet: ${config.sellerWallet}`);
  logger.info(`  Membership NFT: ${membershipNftAddress || '(not configured)'}`);

  if (config.sellerWallet === '0x0000000000000000000000000000000000000000') {
    logger.warn('SELLER_WALLET not set - using zero address');
  }
}
