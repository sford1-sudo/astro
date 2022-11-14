import { bootstrap as bootstrapGlobalAgent } from 'global-agent'
import type { RequestInit } from 'node-fetch'
import { default as nodeFetch, Headers, Request, Response } from 'node-fetch'
import Stream from 'node:stream'
import * as _ from './utils'

bootstrapGlobalAgent({
	environmentVariableNamespace: '',
})

export { Headers, Request, Response }

export const fetch = {
	fetch(
		resource: string | Request,
		init?: Partial<FetchInit>
	): Promise<Response> {
		const resourceURL = new URL(
			_.__object_isPrototypeOf(Request.prototype, resource)
				? (resource as Request).url
				: _.pathToPosix(resource),
			typeof Object(globalThis.process).cwd === 'function'
				? 'file:' + _.pathToPosix(process.cwd()) + '/'
				: 'file:'
		)

		if (resourceURL.protocol.toLowerCase() === 'file:') {
			return import('node:fs').then((fs) => {
				try {
					const stats = fs.statSync(resourceURL)
					const body = fs.createReadStream(resourceURL)

					return new Response(body, {
						status: 200,
						statusText: '',
						headers: {
							'content-length': String(stats.size),
							date: new Date().toUTCString(),
							'last-modified': new Date(stats.mtimeMs).toUTCString(),
						},
					})
				} catch (error) {
					const body = new Stream.Readable()

					body._read = () => {}
					body.push(null)

					return new Response(body, {
						status: 404,
						statusText: '',
						headers: {
							date: new Date().toUTCString(),
						},
					})
				}
			})
		} else {
			return nodeFetch(resource, init)
		}
	},
}.fetch

type USVString = {} & string

interface FetchInit {
	body: RequestInit['body']
	cache:
		| 'default'
		| 'no-store'
		| 'reload'
		| 'no-cache'
		| 'force-cache'
		| 'only-if-cached'
	credentials: 'omit' | 'same-origin' | 'include'
	headers: Headers | Record<string, string>
	method:
		| 'GET'
		| 'HEAD'
		| 'POST'
		| 'PUT'
		| 'DELETE'
		| 'CONNECT'
		| 'OPTIONS'
		| 'TRACE'
		| 'PATCH'
		| USVString
	mode: 'cors' | 'no-cors' | 'same-origin' | USVString
	redirect: 'follow' | 'manual' | 'error'
	referrer: USVString
	referrerPolicy:
		| 'no-referrer'
		| 'no-referrer-when-downgrade'
		| 'same-origin'
		| 'origin'
		| 'strict-origin'
		| 'origin-when-cross-origin'
		| 'strict-origin-when-cross-origin'
		| 'unsafe-url'
	integrity: USVString
	keepalive: boolean
	signal: AbortSignal
}
