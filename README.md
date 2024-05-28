# Mayan driver sdk

## Running the driver

Copy .env.sample into .env and set required values inclduing

-   `JUP_API_KEY` for swapping on solana via Jupiter
-   `ONE_INCH_API_KEY` for swapping on evm chains via 1inch
-   `EVM_PRIVATE_KEY` Hex encoded private key of your evm wallet (for all chains)
-   `SOLANA_PRIVATE_KEY` Base-58 encoded private key of your solana wallet

Install NodeJS (node 20 is recommended)

```bash
npm install -g ts-node
npm install
ts-node .
```

## Auction

You can override auction participation logic via editing [auction.ts](src/auction.ts).Here you could decide to participate in an auction or not, and you could provide your desired `bid` amount.
