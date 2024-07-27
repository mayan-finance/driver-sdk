# Mayan driver sdk

## Running the driver

Copy `.env.sample` into `.env` and set the required values including:

-   `JUP_V6_ENDPOINT` for using custom or self hosted jup endpoint
-   `JUP_API_KEY` for swapping on Solana via Jupiter [jup.ag](https://station.jup.ag/docs/apis/swap-api)
-   `ONE_INCH_API_KEY` for swapping on EVM chains via [1inch](https://portal.1inch.dev/)

-   `EVM_PRIVATE_KEY` Hex encoded private key of your EVM wallet (for all chains)
-   `SOLANA_PRIVATE_KEY` Base-58 encoded private key of your Solana wallet

-   `XXX_RPC` Your desired rpc for chain `XXX`. We strongly encourage getting private rpcs with higher throughputs but default public rpcs are provided

Optional `.env` overrides:

-   `ETHEREUM_FLASHBOT_RPC` writes to ethereum are sent thorugh flashbots rpc to avoid expensive revert costs. You could provide something else
-   `SOLANA_SEND_RPCS` solana transactions are broadcasted to multiple rpcs to decrease transacttion landing times

Install NodeJS (node 20 is recommended)

```bash
npm install
npx ts-node .
```

## Driver Reserves

You only need to provide native `USDC` and `ETH` (wormhole's [`WETH`](https://solscan.io/account/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs) on solana) to fulfill swaps. Based on the source asset (which is either `USDC` or `ETH`) the equivalent asset is chosen on the destination chain and used to fulfill the order via a simple transfer or in-chain swap using swap aggregators.

## Auction Configuration

You can override auction participation logic via editing [auction.ts](src/auction.ts). Here you could decide to participate in an auction or not, and you could provide your own `bid` amount. By default all available amount (after deducting gas costs) is filled.

# Overall Fulfillment Lifecycle

1. User submits their swap on-chain or off-chain (for gasless swaps)
2. Mayan explorer indexes the swap and notifies registered drivers (via websockets or long polling)
3. Driver receives the swap and starts bidding on the auction using the [mayan auction program](https://explorer.solana.com/account/4oUq8HocfbPUpvu1j5ZVbLcoak7DFz2CLK3f91qUuQzH)'s `bid` instruction
4. If driver wins the auction and the order is gasless, the drive submits the swap on the source chain using evm contract's `createOrderWithSig` method.

5.  1. If the destination is solana, driver registers itself as winner using [mayan program](https://explorer.solana.com/account/5vBpQGxxnzjhv3FNFVpVmGWsUhhNFu4xTbyGs3W2Sbbx)'s `registerWinner` instruction 2. If the destination is an evm chain, driver posts a wormhole message to the destination chain using mayan progarm's `postAuction` instruction

6. Driver fulfills the auction on the destination chain: 1. On solana the driver sends a transaction that transfers assets and calls the [mayan programs](https://explorer.solana.com/account/5vBpQGxxnzjhv3FNFVpVmGWsUhhNFu4xTbyGs3W2Sbbx) `fulfill` instruction 2. On evm chains the driver gets the wormhole signed VAA and uses the proof of auction to fulfill the promised amount using either `fulfillOrder` method of the main contract or
   `fulfillWithERC20,fulfillWithEth` methods of the fulfill helper contract.

7. If the destination chain is solana, another step is required for completiion. Driver calls the `settle` instruction of the [mayan programs](https://explorer.solana.com/account/5vBpQGxxnzjhv3FNFVpVmGWsUhhNFu4xTbyGs3W2Sbbx).

8. After fulfilling multiple orders, fulfillment proofs are gathered in batch using `postBatch` solana instruction or evm method. Then signed VAAs are using in source chains to unlock assets.

# Other Components

-   [routers.ts](src/driver/routers.ts) Helper functions for fetching intra-chain swap params from swap aggregators like jupiter or 1inch
-   [register.ts](src/driver/register.ts) registers the driver wallets to mayan backend. This helps us provide more accurate quotes according to driver balances. It also ensures that your [AddressLookupTables](https://solana.com/docs/advanced/lookup-tables) are indexed properly
-   [unlocker.ts](src/driver/unlocker.ts) responsible for unlocking fulfilled swaps
-   [lut.ts](src/utils/lut.ts) tries to use existing mayan [AddressLookupTables](https://solana.com/docs/advanced/lookup-tables) to fit transactions. Creates new tables otherwise. These tables are indexed via mayan and closed later on
-   [finality.ts](src/utils/finality.ts) Provides a balance between risk of block reversal and fast fulfillment
