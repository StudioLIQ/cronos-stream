# Stream402 Membership NFT (ERC-1155)

This repo can mint a **soulbound ERC-1155** membership token after a successful x402 settlement.

## Contract

- `contracts/Stream402Membership1155.sol`
- Mint/burn is restricted to the contract owner (intended to be the API “minter” wallet).
- Transfers are disabled (mint + burn only).

## Token IDs

Token IDs are deterministic per channel slug:

- `tokenId = keccak256("stream402:membership:<slug>")` (uint256)

The API computes this the same way via `ethers` (see `apps/api/src/lib/membershipNft.ts`).

## API configuration

Set these env vars on the API:

```bash
MEMBERSHIP_NFT_ADDRESS_CRONOS_TESTNET=0x...
MEMBERSHIP_NFT_ADDRESS_CRONOS_MAINNET=0x...
MEMBERSHIP_NFT_MINTER_PRIVATE_KEY=0x...
```

The minter wallet must have enough native token for gas (e.g. **TCRO** on Cronos).

