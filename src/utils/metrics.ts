import dgram from 'dgram';

export type StatsDProtocol = 'udp4' | 'udp6';

export interface StatsDOptions {
	host: string;
	port?: number; // default: 8125
	protocol?: StatsDProtocol; // default: "udp4"
}

export class StatsD {
	private socket: dgram.Socket;
	private host: string;
	private port: number;

	constructor(opts: StatsDOptions) {
		const { host, port = 8125, protocol = 'udp4' } = opts;
		this.host = host;
		this.port = port;
		this.socket = dgram.createSocket(protocol);
	}

	/** Increment counter by n (default 1). */
	incr(name: string, n = 1, sampleRate?: number) {
		this.sendMetric(name, n, 'c', sampleRate);
	}

	/** Decrement counter by n (default 1). */
	decr(name: string, n = 1, sampleRate?: number) {
		this.sendMetric(name, -n, 'c', sampleRate);
	}

	/** Gauge set. */
	gauge(name: string, value: number) {
		this.sendMetric(name, value, 'g');
	}

	/** Timing in milliseconds. */
	timingMs(name: string, ms: number) {
		// Keep a few decimals; Graphite’s fine with floats for timers.
		this.sendMetric(name, Number(ms.toFixed(3)), 'ms');
	}

	/** Time any sync/async function and emit duration (ms). Also emits `<name>.error` counter on throw. */
	async timeFn<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
		const start = process.hrtime.bigint();
		try {
			const result = await fn();
			const end = process.hrtime.bigint();
			this.timingMs(name, Number(end - start) / 1e6);
			return result;
		} catch (err) {
			const end = process.hrtime.bigint();
			this.incr(`${name}.error`);
			this.timingMs(name, Number(end - start) / 1e6);
			throw err;
		}
	}

	/** Close UDP socket. Call on shutdown. */
	close() {
		this.socket.close();
	}

	// ---- internals ----
	private sendMetric(name: string, value: number, type: 'c' | 'g' | 'ms', sampleRate?: number) {
		let msg = `${name}:${value}|${type}`;
		if (sampleRate && sampleRate > 0 && sampleRate < 1) {
			msg += `|@${sampleRate}`;
		}
		const buf = Buffer.from(msg);
		this.socket.send(buf, 0, buf.length, this.port, this.host, (err: any) => {
			if (err) {
				// Non-fatal; UDP is fire-and-forget.
				// You could add a callback/queue if you care.
				// eslint-disable-next-line no-console
				console.error('StatsD send error:', err);
			}
		});
	}
}

export const statsd = new StatsD({ host: process.env.STATSD_HOST!, port: Number(process.env.STATSD_PORT || 8125) });

const prefix = 'swift.driver';

export function timed(headMessage?: string) {
	return function realTimed(originalMethod: any, context: ClassMethodDecoratorContext) {
		let methodName = String(context.name);
		if (headMessage) {
			methodName = `${headMessage}`;
		}

		return async function (this: any, ...args: any[]) {
			const start = performance.now();
			try {
				const result = await originalMethod.apply(this, args);
				return result;
			} catch (err) {
				statsd.incr(`${prefix}.${methodName}.error`);
				throw err;
			} finally {
				statsd.incr(`${prefix}.${methodName}.total`);
				const end = performance.now();
				statsd.timingMs(`${prefix}.${methodName}.duration`, end - start);
			}
		};
	};
}
