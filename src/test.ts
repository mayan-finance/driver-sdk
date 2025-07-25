import { FutureManager } from "./future-manager";

async function main() {

    let futureManager = new FutureManager(10000);

    // Add a future
    futureManager.add('myOperation', async () => {
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log(`${i}...`);
        }
        return 'Hello World!';
    }, true);

    await new Promise(resolve => setTimeout(resolve, 5000));
    // This will now actually wait for completion and return the resolved value
    const result = await futureManager.await('myOperation');
    console.log(result); // 'Hello World!' (not a Promise)

    process.exit(0);
}

main().catch(console.error);