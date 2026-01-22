import { Wallet } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSeedChannels } from '../db/seedChannels.js';

type AddressEntry = { displayName: string; address: string };
type PrivateKeyEntry = { displayName: string; privateKey: string };

type AddressesFile = Record<string, AddressEntry>;
type PrivateKeysFile = Record<string, PrivateKeyEntry>;

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, json, 'utf8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore chmod errors (e.g. Windows)
  }
}

function resolveRepoRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src/scripts -> repo root
  return path.resolve(__dirname, '../../../..');
}

function main(): void {
  const repoRoot = resolveRepoRoot();
  const walletDir = path.join(repoRoot, '.WALLET');

  fs.mkdirSync(walletDir, { recursive: true });

  const addressesPath = path.join(walletDir, 'addresses.json');
  const privateKeysPath = path.join(walletDir, 'privateKeys.json');

  const addresses: AddressesFile = readJsonFile<AddressesFile>(addressesPath) ?? {};
  const privateKeys: PrivateKeysFile = readJsonFile<PrivateKeysFile>(privateKeysPath) ?? {};

  const seedChannels = buildSeedChannels();

  for (const ch of seedChannels) {
    const slug = ch.slug;
    const displayName = ch.displayName;

    const existingAddress = addresses[slug];
    const existingPk = privateKeys[slug];

    if (existingAddress && existingPk) {
      const derivedAddress = new Wallet(existingPk.privateKey).address;
      if (existingAddress.address.toLowerCase() !== derivedAddress.toLowerCase()) {
        throw new Error(
          `Wallet mismatch for "${slug}": addresses.json has ${existingAddress.address} but privateKeys.json derives ${derivedAddress}`
        );
      }

      addresses[slug] = { displayName, address: derivedAddress };
      privateKeys[slug] = { displayName, privateKey: existingPk.privateKey };
      continue;
    }

    if (existingAddress && !existingPk) {
      throw new Error(
        `Found address for "${slug}" in ${addressesPath}, but missing private key in ${privateKeysPath}.`
      );
    }

    if (!existingAddress && existingPk) {
      const derivedAddress = new Wallet(existingPk.privateKey).address;
      addresses[slug] = { displayName, address: derivedAddress };
      privateKeys[slug] = { displayName, privateKey: existingPk.privateKey };
      continue;
    }

    const wallet = Wallet.createRandom();
    addresses[slug] = { displayName, address: wallet.address };
    privateKeys[slug] = { displayName, privateKey: wallet.privateKey };
  }

  writeJsonFile(addressesPath, sortObjectKeys(addresses));
  writeJsonFile(privateKeysPath, sortObjectKeys(privateKeys));

  console.log(`Wrote channel wallet mappings:\n- ${addressesPath}\n- ${privateKeysPath}`);
}

main();

