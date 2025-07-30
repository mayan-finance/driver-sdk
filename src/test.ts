import { Connection, PublicKey } from "@solana/web3.js";
import { FutureManager } from "./future-manager";
import { getCurrentSolanaTimeMS } from "./utils/solana-trx";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import axios from "axios";

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


    ////// SOLANA TIME TEST //////
    // let start = Date.now();
    // let time = await getCurrentSolanaTimeMS(new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'), 4)
    // console.log(`solana time: ${time}`)
    // let end = Date.now();
    // console.log(`time taken: ${end - start}ms`)

    // let timestamp = new Date(time).getTime();
    // console.log(`timestamp from date: ${timestamp}`)


    ////// JIRI-JAKE FEE TEST //////
    // let jiriJakeFeeMap: any = {
    //     fromToken: 'usdt',
    //     toToken: 'usdc',
    //     fromChainId: 1,
    //     toChainId: 1,
    //     gasDrop: 0,
    // }

    // jiriJakeFeeMap.timestamp = new Date().getTime();
    // console.log(`jiri-jake-fee|${JSON.stringify(jiriJakeFeeMap)}`);


    ////// ATA TEST //////
    // let connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
    // let userAddress = new PublicKey('ChK5nzqPEhw8SVjitqHF9DK4yJ26ApPDzzfgaBBLQj2Y')
    // // let tokenAddress = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    // let tokenAddress = new PublicKey('BXhVjDNucDJP2B8hZZbK4YtaVLjLdQ1PtW1ATcKrbonk')
    // let ata = getAssociatedTokenAddressSync(tokenAddress, userAddress, true, TOKEN_PROGRAM_ID)
    // const accountData = await connection.getAccountInfo(ata)
    // const exists = accountData !== null;
    // console.log(exists)



    let url = 'https://bundles.jito.wtf/api/v1/bundles/tip_floor';
    let response = await axios.get(url);
    // [
    //     {
    //     "time": "2025-07-30T02:26:54+00:00",
    //     "landed_tips_25th_percentile": 0.0000015750000000000002,
    //     "landed_tips_50th_percentile": 0.000006264500000000001,
    //     "landed_tips_75th_percentile": 0.000034694500000000005,
    //     "landed_tips_95th_percentile": 0.0010141,
    //     "landed_tips_99th_percentile": 0.005139953829999986,
    //     "ema_landed_tips_50th_percentile": 0.0000061535582920159765
    //     }
    // ]
    let x = response.data[0].landed_tips_75th_percentile + response.data[0].landed_tips_50th_percentile;
    x = x < response.data[0].landed_tips_95th_percentile ? x : response.data[0].landed_tips_95th_percentile;
    console.log(x);

    process.exit(0);
}

main().catch(console.error);