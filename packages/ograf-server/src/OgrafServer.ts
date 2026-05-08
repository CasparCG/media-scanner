import type { Express, Request, Response, Handler, NextFunction } from 'express'
import type ExpressWs from 'express-ws'
import { JSONRPCServerAndClient, JSONRPCServer, JSONRPCClient, JSONRPCErrorException } from 'json-rpc-2.0'
import { GraphicInstanceError, RenderTargetInfo, type Config, type ErrorReturnValue } from '@helper/shared'
import { RendererInstancePlaceholder, RendererManager } from './managers/RendererManager.js'
import { GraphicsStore } from './GraphicsStore.js'
import type { ServerApi } from 'ograf'
import { ZodError, z } from 'zod/v4'
import {
	GraphicId,
	RendererId,
	RenderTargetIdentifier,
	GraphicFilter,
	GraphicInstanceId,
	UpdateActionParams,
	PlayActionParams,
	StopActionParams,
	CustomActionParams,
} from './types/OpenApiTypes.js'
import path from 'path'
import fs from 'fs/promises'

// console.log('process.pkg.defaultEntrypoint', process.pkg?.defaultEntrypoint)

export class OgrafServer {
	private rendererManager: RendererManager
	private graphicsStore: GraphicsStore

	constructor(private config: Config) {
		this.rendererManager = new RendererManager(config)
		this.graphicsStore = new GraphicsStore(config.paths.template)
	}
	public setupRendererApi(wsApp: ExpressWs.Application): void {
		if (!this.config.enable.ograf) return
		// Websocket connection to the renderer:

		wsApp.ws('/rendererApi/v1', (ws) => {
			// A client has connected,

			// console.log(`New Renderer connected`)
			const jsonRpcConnection = new JSONRPCServerAndClient(
				new JSONRPCServer(),
				new JSONRPCClient(async (request) => {
					try {
						ws.send(JSON.stringify(request))
						return Promise.resolve()
					} catch (error) {
						return Promise.reject(error instanceof Error ? error : new Error(`${error}`))
					}
				})
			)

			// Handle incoming messages:
			ws.on('message', (message: Buffer) => {
				const messageString = message.toString()

				Promise.resolve()
					.then(async () => {
						try {
							await jsonRpcConnection.receiveAndSend(JSON.parse(messageString))
						} catch (error) {
							console.error('Error handling message:', error)
						}
					})
					.catch(console.error)
			})
			ws.on('close', (_code, reason) => {
				this.rendererManager.closeRendererInstance(rendererInstance)
				jsonRpcConnection.rejectAllPendingRequests(`Connection is closed (${reason}).`)

				console.log(`Renderer disconnected`)
			})
			ws.on('error', (err) => {
				console.error(`Error: ${err}`)
			})

			// Track Renderer
			const rendererInstance = this.rendererManager.addRendererInstance(jsonRpcConnection)
		})
	}
	public setupOGrafApi(app: Express): void {
		if (!this.config.enable.ograf) return

		app.get(
			'/ograf/v1/',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/']['get']

				const returnData: Method['responses'][keyof Method['responses']] = {
					headers: {},
					content: {
						'application/json': {
							name: 'CasparCG OGraf Server',
							author: {
								name: 'CasparCG Team',
								url: 'https://github.com/CasparCG',
							},
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.get(
			'/ograf/v1/graphics',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/graphics']['get']

				const list = await this.graphicsStore.listGraphics()

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							graphics: list,
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.get(
			'/ograf/v1/graphics/:graphicId',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/graphics/{graphicId}']['get']
				const ReqParams = z.object({ graphicId: GraphicId })
				const params = ReqParams.parse(req.params)

				const graphicInfo = await this.graphicsStore.getGraphicInfo(params.graphicId)

				if (!graphicInfo) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Graphic not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							graphic: graphicInfo.graphic,
							metadata: graphicInfo.metadata,
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.delete(
			'/ograf/v1/graphics/:graphicId',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/graphics/{graphicId}']['delete']
				const ReqParams = z.object({ graphicId: GraphicId })
				const ReqQuery = z.object({ force: z.coerce.boolean().optional() })

				const params = ReqParams.parse(req.params)
				const query = ReqQuery.parse(req.query)

				const found = await this.graphicsStore.deleteGraphic(params.graphicId, query.force)

				if (!found) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Graphic not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.get(
			'/ograf/v1/renderers',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers']['get']

				const renderers = await this.rendererManager.listRenderers()

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							renderers: renderers.map((r) => ({
								id: r.id,
								name: r.name,
								description: r.description,
							})),
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.get(
			'/ograf/v1/renderers/:rendererId',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}']['get']
				const ReqParams = z.object({ rendererId: RendererId })
				const params = ReqParams.parse(req.params)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, true)

				if (!rendererInstance?.info) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				await rendererInstance.updateInfo()

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							renderer: rendererInstance.info as any,
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.get(
			'/ograf/v1/renderers/:rendererId/target',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}/target']['get']
				const ReqParams = z.object({ rendererId: RendererId })
				const ReqQuery = z.object({ renderTarget: RenderTargetIdentifier })

				const params = ReqParams.parse(req.params)
				const query = ReqQuery.parse(req.query)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, true)

				if (!rendererInstance?.info) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				let renderTargetInfo: RenderTargetInfo
				if (rendererInstance instanceof RendererInstancePlaceholder) {
					renderTargetInfo = rendererInstance.getRenderTargetInfo(query.renderTarget)
				} else {
					const result = await rendererInstance.api.getTargetStatus({
						renderTarget: query.renderTarget,
					})
					renderTargetInfo = result.renderTargetInfo
				}

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': renderTargetInfo as any,
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.post(
			'/ograf/v1/renderers/:rendererId/customActions/:customActionId',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}/customActions/{customActionId}']['post']
				const ReqParams = z.object({
					rendererId: RendererId,
					customActionId: z.string(),
				})
				const ReqBody = z.object({
					payload: z.unknown(),
				})

				const params = ReqParams.parse(req.params)
				const body = ReqBody.parse(req.body)

				let rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, false)

				if (!rendererInstance) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const result = await rendererInstance.api.invokeRendererAction({
					action: {
						id: params.customActionId,
						payload: body.payload,
					},
				})

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							result: result.value,
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.put(
			'/ograf/v1/renderers/:rendererId/target/graphicInstance/clear',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}/target/graphicInstance/clear']['put']
				const ReqParams = z.object({ rendererId: RendererId })
				const ReqBody = z.object({ filters: z.array(GraphicFilter) })

				const params = ReqParams.parse(req.params)
				const body = ReqBody.parse(req.body)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, false)
				if (!rendererInstance) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const result = await rendererInstance.api.clearGraphics({
					filters: body.filters,
				})

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							graphicInstances: result.graphicInstances.map((gi: any) => ({
								renderTarget: gi.renderTarget,
								graphicInstanceId: gi.graphicInstanceId,
							})),
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.post(
			'/ograf/v1/renderers/:rendererId/target/graphicInstance/load',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}/target/graphicInstance/load']['post']
				const ReqParams = z.object({ rendererId: RendererId })
				const ReqBody = z.object({
					renderTarget: RenderTargetIdentifier,
					graphicId: GraphicId,
					params: z.object({ data: z.unknown() }),
				})

				const params = ReqParams.parse(req.params)
				const body = ReqBody.parse(req.body)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, false)
				if (!rendererInstance) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const result = await rendererInstance.api.loadGraphic({
					renderTarget: body.renderTarget,
					graphicId: body.graphicId,
					params: body.params,
				})

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							...result.result, // To pipe through any vendor specific data
							graphicInstanceId: result.graphicInstanceId,
							statusCode: result.result?.statusCode ?? 200,
							statusMessage: result.result?.statusMessage ?? 'N/A',
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.post(
			'/ograf/v1/renderers/:rendererId/target/graphicInstance/updateAction',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}/target/graphicInstance/updateAction']['post']
				const ReqParams = z.object({ rendererId: RendererId })
				const ReqBody = z.object({
					renderTarget: RenderTargetIdentifier,
					graphicInstanceId: GraphicInstanceId,
					params: UpdateActionParams,
				})

				const params = ReqParams.parse(req.params)
				const body = ReqBody.parse(req.body)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, false)
				if (!rendererInstance) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const result = await rendererInstance.api.invokeGraphicUpdateAction({
					renderTarget: body.renderTarget,
					graphicInstanceId: body.graphicInstanceId,
					params: body.params,
				})

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							...result.result,
							graphicInstanceId: result.graphicInstanceId,
							statusCode: result.result?.statusCode ?? 200,
							statusMessage: result.result?.statusMessage ?? 'N/A',
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.post(
			'/ograf/v1/renderers/:rendererId/target/graphicInstance/playAction',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}/target/graphicInstance/playAction']['post']
				const ReqParams = z.object({ rendererId: RendererId })
				const ReqBody = z.object({
					renderTarget: RenderTargetIdentifier,
					graphicInstanceId: GraphicInstanceId,
					params: PlayActionParams,
				})

				const params = ReqParams.parse(req.params)
				const body = ReqBody.parse(req.body)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, false)
				if (!rendererInstance) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const result = await rendererInstance.api.invokeGraphicPlayAction({
					renderTarget: body.renderTarget,
					graphicInstanceId: body.graphicInstanceId,
					params: body.params,
				})

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							...result.result,
							graphicInstanceId: result.graphicInstanceId,
							statusCode: result.result?.statusCode ?? 200,
							statusMessage: result.result?.statusMessage ?? 'N/A',
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.post(
			'/ograf/v1/renderers/:rendererId/target/graphicInstance/stopAction',
			this.wrap(async (req, res) => {
				type Method = ServerApi.paths['/renderers/{rendererId}/target/graphicInstance/stopAction']['post']
				const ReqParams = z.object({ rendererId: RendererId })
				const ReqBody = z.object({
					renderTarget: RenderTargetIdentifier,
					graphicInstanceId: GraphicInstanceId,
					params: StopActionParams,
				})

				const params = ReqParams.parse(req.params)
				const body = ReqBody.parse(req.body)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, false)
				if (!rendererInstance) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const result = await rendererInstance.api.invokeGraphicStopAction({
					renderTarget: body.renderTarget,
					graphicInstanceId: body.graphicInstanceId,
					params: body.params,
				})

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							...result.result,
							graphicInstanceId: result.graphicInstanceId,
							statusCode: result.result?.statusCode ?? 200,
							statusMessage: result.result?.statusMessage ?? 'N/A',
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		app.post(
			'/ograf/v1/renderers/:rendererId/target/graphicInstance/customActions/:customActionId',
			this.wrap(async (req, res) => {
				type Method =
					ServerApi.paths['/renderers/{rendererId}/target/graphicInstance/customActions/{customActionId}']['post']
				const ReqParams = z.object({
					rendererId: RendererId,
					customActionId: z.string(),
				})
				const ReqBody = z.object({
					renderTarget: RenderTargetIdentifier,
					graphicInstanceId: GraphicInstanceId,
					params: CustomActionParams,
				})

				const params = ReqParams.parse(req.params)
				const body = ReqBody.parse(req.body)

				const rendererInstance = await this.rendererManager.getRendererInstance(params.rendererId, false)
				if (!rendererInstance) {
					const returnData: Method['responses'][404] = {
						headers: {},
						content: {
							'application/json': {
								error: 'Renderer not found',
							},
						},
					}
					this.handleReturn<Method>(req, res, 404, returnData)
					return
				}

				const result = await rendererInstance.api.invokeGraphicCustomAction({
					renderTarget: body.renderTarget,
					graphicInstanceId: body.graphicInstanceId,
					params: {
						...body.params,
						id: params.customActionId,
					},
				})

				const returnData: Method['responses'][200] = {
					headers: {},
					content: {
						'application/json': {
							...result.result,
							graphicInstanceId: result.graphicInstanceId,
							statusCode: result.result?.statusCode ?? 200,
							statusMessage: result.result?.statusMessage ?? 'N/A',
						},
					},
				}
				this.handleReturn<Method>(req, res, 200, returnData)
			})
		)

		// Serve the Renderer:
		app.get(/\/renderer\/(.*)/, async (ctx, res) => {
			let subPath = ctx.params['0']
			if (!subPath || subPath === '' || subPath === '/') subPath = '/index.html'
			subPath = subPath.replace(/^\/+/, '') // remove leading slashes

			// see https://www.npmjs.com/package/pkg#snapshot-filesystem
			const pkgDefaultEntrypoint = (process as any).pkg?.defaultEntrypoint

			const rendererDistPath = pkgDefaultEntrypoint
				? // Is running as a pkg executable:
					path.join(path.dirname(pkgDefaultEntrypoint), 'assets/renderer')
				: // Is running in dev/unpackaged-mode
					path.resolve('../ograf-renderer/dist')

			await serveFromPath(res, rendererDistPath, subPath)
		})
		// Serve graphics on path /graphic/id/subPath
		app.get(/\/graphic\/([^/]+)\/(.*)/, async (ctx, res) => {
			let graphicsId = ctx.params['0']
			let subPath = ctx.params['1']
			if (!subPath || subPath === '' || subPath === '/') subPath = '/index.html'
			subPath = subPath.replace(/^\/+/, '') // remove leading slashes

			const resource = await this.graphicsStore.getGraphicResource(graphicsId, subPath)

			if (!resource) {
				res.status(404)
				res.send('Resource not found')
				return
			}

			res.set('Content-Type', resource.mimeType)
			resource.readStream.pipe(res)
			// res.write(resource.readStream)
		})
	}

	private wrap(fn: Handler) {
		return async (req: Request, res: Response, next: NextFunction) => {
			try {
				await Promise.resolve(fn(req, res, next))
			} catch (err) {
				console.error(err)
				if (err instanceof ZodError) {
					res.status(400)
					res.send({
						headers: {},
						content: {
							'application/json': {
								status: 400,
								title: 'Bad Request',
								detail: err.message,
								stack: err instanceof Error ? err.stack : undefined,
							} satisfies ServerApi.components['schemas']['ErrorResponse'],
						},
					})
					return
				}
				let statusCode = 500
				if (err instanceof JSONRPCErrorException) {
					const err0 = err as ErrorReturnValue

					if (err0.code === 550 && err0.data.errorType === 'GraphicInstanceError') {
						const err2 = new GraphicInstanceError(err0.message)
						err2.stack = err0.stack
						err2.statusCode = err0.code
						err = err2
					} else {
						const err2 = new Error(err0.message)
						err2.stack = err0.stack
						statusCode = err0.code || 500
						err = err2
					}
				}
				if (err instanceof GraphicInstanceError) {
					res.status(err.statusCode)
					res.send({
						headers: {},
						content: {
							'application/json': {
								status: err.statusCode,
								title: 'Error thrown in GraphicsInstance',
								detail: err.message,

								stack: err.stack,
							} satisfies ServerApi.components['schemas']['ErrorResponse'],
						},
					})
					return
				}
				if (err instanceof Error) {
					res.status(statusCode)
					res.send({
						headers: {},
						content: {
							'application/json': {
								status: statusCode,
								title: 'Internal Error',
								detail: err.message,

								stack: err.stack,
							} satisfies ServerApi.components['schemas']['ErrorResponse'],
						},
					})
					return
				}

				res.status(statusCode)
				res.send({
					headers: {},
					content: {
						'application/json': {
							status: statusCode,
							title: 'Internal Error',
							detail: `${err}`,

							stack: 'No stack available',
						} satisfies ServerApi.components['schemas']['ErrorResponse'],
					},
				})
			}
		}
	}
	private handleReturn<Method extends AnyMethod>(
		req: Request<any>,
		res: Response,
		statusCode: keyof Method['responses'],
		returnData: Method['responses'][keyof Method['responses']]
	): void {
		const r = returnData as AnyResponse

		// Status code
		res.status(Number(statusCode))
		// Headers
		for (const header in r.headers) {
			res.set(header, r.headers[header])
		}
		// Body:
		// Serve the correct content type based on the request:
		const contentType = req.headers['content-type'] || 'application/json'
		for (const [key, value] of Object.entries<any>(r.content)) {
			if (key === contentType) {
				res.set('content-type', contentType)
				res.send(value)
				return
			}
		}
		// If no contentType is matching, fall back to whatever is provided:

		for (const value of Object.values<any>(r.content)) {
			if (value !== undefined) {
				res.send(value)
				return
			}
		}
	}
}
type AnyMethod = {
	parameters?:
		| {
				query?: {
					[key: string]: any
				}
				path?: {
					[key: string]: any
				}
				header?: {
					[key: string]: any
				}
				cookie?: {
					[key: string]: any
				}
		  }
		| never
	requestBody?: any
	responses: {
		[status: number]: AnyResponse
	}
}
type AnyResponse = {
	headers: {
		[name: string]: any
	}
	content: {
		'application/json'?: {
			[key: string]: unknown
		}
		'application/octet-stream'?: string
	}
}

async function serveFromPath(res: Response, folderPath: string, url: string) {
	const filePath = path.resolve(folderPath, url)

	// ensure that the resulting path is in public:
	if (!filePath.startsWith(folderPath)) throw new Error(`Invalid path, url ${url}, ${filePath} is not in ${folderPath}`)

	await serveFile(res, filePath)
}
async function serveFile(res: Response, filePath: string) {
	// set header to the correct mime type
	const ext = path.extname(filePath)

	let contentType = 'application/octet-stream' // unknown

	if (ext === '.js') contentType = 'text/javascript'
	else if (ext === '.css') contentType = 'text/css'
	else if (ext === '.html') contentType = 'text/html'
	else if (ext === '.png') contentType = 'image/png'
	else if (ext === '.svg') contentType = 'image/svg+xml'
	else if (ext === '.map') contentType = 'application/json'
	else {
		console.error(`Unknown file type: ${ext} (${filePath})`)
	}

	try {
		res.set('Content-Type', contentType)

		if (contentType.startsWith('text/')) {
			res.set('charset', 'utf-8')
			res.send(await fs.readFile(filePath, 'utf8'))
		} else {
			res.send(await fs.readFile(filePath))
		}
	} catch (e) {
		if ((e as any).code === 'ENOENT') {
			res.status(404)
			res.send('File not found')
			console.log('File not found:', filePath)
		} else {
			res.status(500)
			res.send('Internal server error')
			throw e
		}
	}
}
