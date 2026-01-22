import dotenv from 'dotenv';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function resolveEnvPath(envFile: string, apiRoot: string): string {
  if (path.isAbsolute(envFile)) return envFile;
  // Prefer resolving relative to the API package root (apps/api) so
  // `ENV_FILE=.env.railway` works even when started from the repo root.
  return path.resolve(apiRoot, envFile);
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  dotenv.config({ path: filePath, override: false });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');

// Load order = precedence (earlier wins). No overrides.
const envFile = process.env.ENV_FILE;
if (envFile) {
  loadEnvFile(resolveEnvPath(envFile, apiRoot));
}

loadEnvFile(path.resolve(apiRoot, '.env.local'));
loadEnvFile(path.resolve(apiRoot, '.env'));

// Committable demo configs (safe only for testnet/demo use).
loadEnvFile(path.resolve(apiRoot, '.env.railway'));
loadEnvFile(path.resolve(apiRoot, '.env.demo'));

