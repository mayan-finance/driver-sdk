# Mayan Driver SDK
Drivers participate in on-chain auctions to compete for the opportunity to fulfill user intents, ensuring that users receive the best possible outcomes for their transactions. They act as the operational core that processes and completes transactions by finding optimal execution paths. In other protocols, this role is commonly known as a Solver or Relayer, but we refer to them as Drivers to emphasize their dynamic role in navigating and steering transactions to successful completion.

## Running the driver

Copy `.env.sample` into `.env` and set the required values including:

-   `JUP_V6_ENDPOINT` for using custom or self-hosted jup endpoint
-   `JUP_API_KEY` for swapping on Solana via Jupiter [jup.ag](https://station.jup.ag/docs/apis/swap-api)
-   `ONE_INCH_API_KEY` for swapping on EVM chains via [1inch](https://portal.1inch.dev/)

-   `EVM_PRIVATE_KEY` Hex-encoded private key of your EVM Wallet (for all chains)
-   `SOLANA_PRIVATE_KEY` Base-58 encoded private key of your Solana Wallet

-   `XXX_RPC` Your desired rpc for chain `XXX`. We strongly encourage getting private rpcs with higher throughputs, but default public rpcs are provided.

Optional `.env` overrides:

-   `ETHEREUM_FLASHBOT_RPC` writes to Ethereum are sent through flashbots rpc to avoid expensive revert costs. You could provide something else
-   `SOLANA_SEND_RPCS` Solana transactions are broadcasted to multiple rpcs to decrease transaction landing times.

Install NodeJS (node 20 is recommended)

```bash
npm install
npx ts-node
```

## Driver Reserves

You only need to provide native `USDC` and `ETH` (Wormhole's [`WETH`](https://solscan.io/account/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs) on Solana) to fulfill swaps. Based on the source asset (which is either `USDC` or `ETH`) the equivalent asset is chosen on the destination chain and used to fulfill the order via a simple transfer or in-chain swap using swap aggregators.

# Overall Fulfillment Lifecycle

1. User submits their swap on-chain or off-chain (for gasless swaps).
2. Mayan explorer indexes the swap and notifies registered drivers (via websockets or long polling).
3. Driver receives the swap and starts bidding on the auction using the [Mayan Auction Program](https://explorer.solana.com/account/9w1D9okTM8xNE7Ntb7LpaAaoLc6LfU9nHFs2h2KTpX1H)'s `bid` instruction.

4. 1. If the destination is solana, driver registers itself as winner using [Mayan Program](https://explorer.solana.com/account/BLZRi6frs4X4DNLw56V4EXai1b6QVESN1BhHBTYM9VcY)'s `registerWinner` instruction. 2. If the destination is an evm chain, driver posts a wormhole message to the destination chain using mayan progarm's `postAuction` instruction.

5. Driver fulfills the auction on the destination chain: 1. On Solana the driver sends a transaction that transfers assets and calls the [Mayan Program's](https://explorer.solana.com/account/BLZRi6frs4X4DNLw56V4EXai1b6QVESN1BhHBTYM9VcY) `fulfill` instruction. 2. On evm chains the driver gets the Wormhole signed VAA and uses the proof of auction to fulfill the promised amount using either `fulfillOrder` method of the main contract or
   `fulfillWithERC20,fulfillWithEth` methods of the fulfill helper contract.

6. If the destination chain is Solana, another step is required for completion. Driver calls the `settle` instruction of the [Mayan Program's](https://explorer.solana.com/account/BLZRi6frs4X4DNLw56V4EXai1b6QVESN1BhHBTYM9VcY).

7. After fulfilling multiple orders, fulfillment proofs are gathered in batch using `postBatch` Solana instruction or evm method. Then signed VAAs are using in source chains to unlock assets. If the order was fulfilled without batch, proof will be immediately issues and available after being signed by Wormhole Guardian's.

# Other Components

-   [routers.ts](src/driver/routers.ts) Helper functions for fetching intra-chain swap params from swap aggregators like Jupiter or 1inch.
-   [register.ts](src/driver/register.ts) registers the driver wallets to Mayan backend. This helps us provide more accurate quotes according to driver balances. It also ensures that your [AddressLookupTables](https://solana.com/docs/advanced/lookup-tables) are indexed properly.
-   [unlocker.ts](src/driver/unlocker.ts) responsible for unlocking fulfilled swaps
-   [lut.ts](src/utils/lut.ts) tries to use existing Mayan [AddressLookupTables](https://solana.com/docs/advanced/lookup-tables) to fit transactions. Creates new tables otherwise. These tables are indexed via Mayan and closed later on.
-   [finality.ts](src/utils/finality.ts) Provides a balance between risk of block reversal and fast fulfillment.
