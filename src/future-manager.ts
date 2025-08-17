import logger from './utils/logger';

export type FutureStatus = 'pending' | 'resolved' | 'rejected';

export interface FutureEntry<T = any> {
    promise: Promise<T>;
    status: FutureStatus;
    result?: T;
    error?: any;
    createdAt: number;
}

export class FutureManager {
    private futures = new Map<string, FutureEntry>();
    private cleanupInterval?: NodeJS.Timeout;

    constructor(autoCleanupIntervalMs?: number) {
        // Initial cleanup
        this.cleanup();

        // Set up periodic cleanup if interval is provided
        if (autoCleanupIntervalMs && autoCleanupIntervalMs > 0) {
            this.cleanupInterval = setInterval(() => {
                this.cleanup(5000);
            }, autoCleanupIntervalMs);
        }
    }

    /**
     * Add a future to the manager
     * @param key - Unique identifier for the future
     * @param futureOrPromise - Promise or function that returns a promise
     * @param skipIfExists - If true, won't add if key already exists
     * @returns The promise for chaining, or existing promise if skipIfExists is true and key exists
     */
    add<T>(key: string, futureOrPromise: Promise<T> | (() => Promise<T>), skipIfExists: boolean = false): Promise<T> {
        if (this.futures.has(key)) {
            if (skipIfExists) {
                logger.debug(`Future with key "${key}" already exists. Skipping add.`);
                return this.get<T>(key)!;
            }
            logger.warn(`Future with key "${key}" already exists. Replacing it.`);
        }

        const promise = typeof futureOrPromise === 'function' ? futureOrPromise() : futureOrPromise;

        const entry: FutureEntry<T> = {
            promise,
            status: 'pending',
            createdAt: Date.now()
        };

        // Track the promise resolution/rejection
        promise
            .then((result) => {
                entry.status = 'resolved';
                entry.result = result;
                logger.debug(`Future "${key}" resolved`);
            })
            .catch((error) => {
                entry.status = 'rejected';
                entry.error = error;
                logger.debug(`Future "${key}" rejected:`, error);
            });

        this.futures.set(key, entry);
        return promise;
    }

    /**
     * Get a future by key
     * @param key - The key to lookup
     * @returns The promise if it exists, undefined otherwise
     */
    get<T = any>(key: string): Promise<T> | undefined {
        const entry = this.futures.get(key);
        return entry?.promise as Promise<T>;
    }

    /**
     * Wait for a future to complete and return its result
     * @param key - The key to lookup
     * @returns The result of the promise
     * @throws Error if the future doesn't exist or was rejected
     */
    async await<T = any>(key: string): Promise<T> {
        const promise = this.get<T>(key);
        if (!promise) {
            throw new Error(`Future with key "${key}" not found`);
        }
        return await promise;
    }

    /**
     * Check if a future exists
     * @param key - The key to check
     * @returns true if the future exists
     */
    has(key: string): boolean {
        return this.futures.has(key);
    }

    /**
     * Get the status of a future
     * @param key - The key to check
     * @returns The status or undefined if not found
     */
    getStatus(key: string): FutureStatus | undefined {
        return this.futures.get(key)?.status;
    }

    /**
     * Get the result of a completed future (without waiting)
     * @param key - The key to check
     * @returns The result if resolved, undefined otherwise
     */
    getResult<T = any>(key: string): T | undefined {
        const entry = this.futures.get(key);
        return entry?.status === 'resolved' ? entry.result : undefined;
    }

    /**
     * Get the error of a rejected future
     * @param key - The key to check
     * @returns The error if rejected, undefined otherwise
     */
    getError(key: string): any | undefined {
        const entry = this.futures.get(key);
        return entry?.status === 'rejected' ? entry.error : undefined;
    }

    /**
     * Remove a future from the manager
     * @param key - The key to remove
     * @returns true if the future was removed, false if it didn't exist
     */
    remove(key: string): boolean {
        return this.futures.delete(key);
    }

    /**
     * Clear all futures
     */
    clear(): void {
        this.futures.clear();
        logger.debug('All futures cleared');
    }

    /**
     * Destroy the future manager and clear any intervals
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
        this.clear();
        logger.debug('FutureManager destroyed');
    }

    /**
     * Get all future keys
     * @returns Array of all keys
     */
    keys(): string[] {
        return Array.from(this.futures.keys());
    }

    /**
     * Get the number of futures
     * @returns The count of futures
     */
    size(): number {
        return this.futures.size;
    }

    /**
     * Clean up completed futures (resolved or rejected)
     * @param olderThanMs - Optional: only remove futures older than this many milliseconds
     */
    cleanup(olderThanMs?: number): void {
        const now = Date.now();
        let removedCount = 0;

        for (const [key, entry] of this.futures.entries()) {
            const shouldRemove = entry.status !== 'pending' &&
                (!olderThanMs || (now - entry.createdAt) > olderThanMs);

            if (shouldRemove) {
                this.futures.delete(key);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            logger.debug(`Cleaned up ${removedCount} completed futures`);
        }
    }

    /**
     * Get summary of all futures
     * @returns Object with counts by status
     */
    getSummary(): { pending: number; resolved: number; rejected: number; total: number } {
        let pending = 0;
        let resolved = 0;
        let rejected = 0;

        for (const entry of this.futures.values()) {
            switch (entry.status) {
                case 'pending':
                    pending++;
                    break;
                case 'resolved':
                    resolved++;
                    break;
                case 'rejected':
                    rejected++;
                    break;
            }
        }

        return {
            pending,
            resolved,
            rejected,
            total: this.futures.size
        };
    }
}
