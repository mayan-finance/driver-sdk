import { Connection } from "@solana/web3.js";
import { FutureManager } from "./future-manager";
import { getCurrentSolanaTimeMS } from "./utils/solana-trx";

async function main() {

    ////// FUTURE MANAGER TEST //////
    // let futureManager = new FutureManager(10000);

    // // Add a future
    // futureManager.add('myOperation', async () => {
    //     for (let i = 0; i < 10; i++) {
    //         await new Promise(resolve => setTimeout(resolve, 500));
    //         console.log(`${i}...`);
    //     }
    //     return 'Hello World!';
    // }, true);

    // await new Promise(resolve => setTimeout(resolve, 5000));
    // // This will now actually wait for completion and return the resolved value
    // const result = await futureManager.await('myOperation');
    // console.log(result); // 'Hello World!' (not a Promise)


    // let start = Date.now();
    // let time = await getCurrentSolanaTimeMS(new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'), 4)
    // console.log(`solana time: ${time}`)
    // let end = Date.now();
    // console.log(`time taken: ${end - start}ms`)

    // let timestamp = new Date(time).getTime();
    // console.log(`timestamp from date: ${timestamp}`)

    let jiriJakeFeeMap: any = {
        fromToken: 'usdt',
        toToken: 'usdc',
        fromChainId: 1,
        toChainId: 1,
        gasDrop: 0,
    }

    jiriJakeFeeMap.timestamp = new Date().getTime();
    console.log(`jiri-jake-fee|${JSON.stringify(jiriJakeFeeMap)}`);

    process.exit(0);
}

main().catch(console.error);