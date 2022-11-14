import type { RouteData } from '../../@types/astro';
import type { SerializedSSRManifest, SSRManifest } from './types';

import * as fs from 'fs';
import { IncomingMessage } from 'http';
import { deserializeManifest } from './common.js';
import { App, MatchOptions } from './index.js';

const clientAddressSymbol = Symbol.for('astro.clientAddress');

function createRequestFromNodeRequest(req: IncomingMessage, body?: Uint8Array): Request {
	let url = `http://${req.headers.host}${req.url}`;
	let rawHeaders = req.headers as Record<string, any>;
	const entries = Object.entries(rawHeaders);
	const method = req.method || 'GET';
	let request = new Request(url, {
		method,
		headers: new Headers(entries),
		body: ['HEAD', 'GET'].includes(method) ? null : body,
	});
	if (req.socket?.remoteAddress) {
		Reflect.set(request, clientAddressSymbol, req.socket.remoteAddress);
	}
	return request;
}

export class NodeApp extends App {
	match(req: IncomingMessage | Request, opts: MatchOptions = {}) {
		return super.match(req instanceof Request ? req : createRequestFromNodeRequest(req), opts);
	}
	render(req: IncomingMessage | Request, routeData?: RouteData) {
		if ('on' in req) {
			let body = Buffer.from([]);
			let reqBodyComplete = new Promise((resolve, reject) => {
				req.on('data', (d) => {
					body = Buffer.concat([body, d]);
				});
				req.on('end', () => {
					resolve(body);
				});
				req.on('error', (err) => {
					reject(err);
				});
			});

			return reqBodyComplete.then(() => {
				return super.render(
					req instanceof Request ? req : createRequestFromNodeRequest(req, body),
					routeData
				);
			});
		}
		return super.render(
			req instanceof Request ? req : createRequestFromNodeRequest(req),
			routeData
		);
	}
}

export async function loadManifest(rootFolder: URL): Promise<SSRManifest> {
	const manifestFile = new URL('./manifest.json', rootFolder);
	const rawManifest = await fs.promises.readFile(manifestFile, 'utf-8');
	const serializedManifest: SerializedSSRManifest = JSON.parse(rawManifest);
	return deserializeManifest(serializedManifest);
}

export async function loadApp(rootFolder: URL): Promise<NodeApp> {
	const manifest = await loadManifest(rootFolder);
	return new NodeApp(manifest);
}
