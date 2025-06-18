export class SimpleCache {
    private cache = new Map<string, any>();

    // Removes expired entries from the cache
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt && entry.expiresAt <= now) {
                this.cache.delete(key);
            }
        }
    }

    // Wraps a function and caches its result based on arguments, with optional fixed TTL support
    wrap<T extends (...args: any[]) => any>(fn: T, ttl?: number) {
        const cache = this.cache;
        const cleanup = this.cleanup.bind(this);
        // The wrapped function accepts the same arguments as the original, plus an optional { forceNoCache, key } object as the last argument
        return function (...args: any[]) {
            cleanup(); // Clean up expired entries before proceeding
            let forceNoCache = false;
            let manualKey: string | undefined = undefined;
            let realArgs = args;
            if (
                args.length &&
                typeof args[args.length - 1] === 'object' &&
                args[args.length - 1] !== null &&
                ('forceNoCache' in args[args.length - 1] || 'key' in args[args.length - 1])
            ) {
                const options = args[args.length - 1];
                forceNoCache = !!options.forceNoCache;
                if (typeof options.key === 'string') {
                    manualKey = options.key;
                }
                realArgs = args.slice(0, -1);
            }
            const key = manualKey !== undefined ? manualKey : JSON.stringify(realArgs);
            const now = Date.now();
            if (!forceNoCache && cache.has(key)) {
                const entry = cache.get(key);
                if (!entry.expiresAt || entry.expiresAt > now) {
                    return entry.value;
                } else {
                    cache.delete(key); // expired
                }
            }
            const result = fn(...realArgs);
            let expiresAt = undefined;
            if (typeof ttl === 'number' && ttl > 0) {
                expiresAt = now + ttl;
            }
            cache.set(key, { value: result, expiresAt });
            return result;
        };
    }

    // Clear the cache
    clear() {
        this.cache.clear();
    }

    // Remove a specific key from the cache
    remove(key: string) {
        this.cache.delete(key);
    }
}

// import { SimpleCache } from "./cache";

// const cache = new SimpleCache();

// function fetchData(id: number) {
//     console.log('Fetching data for', id);
//     return { id, data: `Data for ${id}` };
// }

// // Wrap with a fixed TTL of 2 seconds (2000 ms)
// const cachedFetchData = cache.wrap(fetchData, 2000);

// console.log(cachedFetchData(1)); // Fetches and caches
// console.log(cachedFetchData(1)); // Returns cached value
// console.log(cachedFetchData(1, { forceNoCache: true })); // Returns cached value

// setTimeout(() => {
//     // After 2.5 seconds, cache has expired, so it fetches again
//     console.log(cachedFetchData(1)); // Fetches and caches again
// }, 2500);