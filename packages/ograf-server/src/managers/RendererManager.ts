import { EmptyPayload, VendorExtend, ServerApi } from 'ograf'
import { JSONRPCServerAndClient } from 'json-rpc-2.0'
import * as RendererAPI from '@helper/shared'
import { RendererInfo, renderTargetSchema } from '@helper/shared'
import { CasparCG } from 'casparcg-connection'

export class RendererManager {
	private rendererInstances: Set<RendererInstance | RendererInstancePlaceholder> = new Set()
	private placeholderRenderers: Map<string, RendererInstancePlaceholder> = new Map()
	private registeredRenderers: Map<string, RendererInstance> = new Map()

	private casparcg: CasparCG | null = null
	constructor(private config: RendererAPI.Config) {
		// populate staticRenderers:
		for (const channelIndex of Array.from(Array(this.config.caspar.channelCount).keys())) {
			const channel = channelIndex + 1

			for (const layer of this.config.ograf.rendererLayers) {
				// A placeholder instance, no actuaL renderer yet
				const instance = new RendererInstancePlaceholder(
					{
						id: `casparcg-channel${channel}-layer${layer}`,
						name: `CasparCG Channel ${channel} Layer ${layer}`,
						customActions: [],
						status: {
							status: 'OK',
							message: 'Not initialized yet',
						},
						renderTargetSchema: renderTargetSchema,
						renderTargets: [],
					},
					channel,
					layer
				)
				this.rendererInstances.add(instance)
				this.placeholderRenderers.set(instance.info.id, instance)
			}
		}
	}

	public addRendererInstance(jsonRpcConnection: JSONRPCServerAndClient<void, void>): RendererInstance {
		const rendererInstance = new RendererInstance(this, jsonRpcConnection)
		this.rendererInstances.add(rendererInstance)

		return rendererInstance
	}
	public closeRendererInstance(rendererInstance: RendererInstance): void {
		this.rendererInstances.delete(rendererInstance)
		if (rendererInstance.info) this.registeredRenderers.delete(rendererInstance.info.id)
	}
	public registerRenderer(rendererInstance: RendererInstance, id: string): void {
		// already exist:
		// const existing = this.registeredRenderers.has(id)

		this.registeredRenderers.set(id, rendererInstance)
	}

	/** A ServerAPI Method */
	async listRenderers(): Promise<ServerApi.components['schemas']['RendererInfo'][]> {
		const renderers: ServerApi.components['schemas']['RendererInfo'][] = []
		for (const rendererInstance of this.rendererInstances) {
			if (!rendererInstance.info) continue

			renderers.push(rendererInstance.info)
		}

		return renderers
	}
	/** A ServerAPI Method */
	async getRendererInstance(id: string, allowPlaceholder: false): Promise<RendererInstance | undefined>
	async getRendererInstance(
		id: string,
		allowPlaceholder: true
	): Promise<RendererInstance | RendererInstancePlaceholder | undefined>
	async getRendererInstance(
		id: string,
		allowPlaceholder: boolean
	): Promise<RendererInstance | RendererInstancePlaceholder | undefined>
	async getRendererInstance(
		id: string,
		allowPlaceholder: boolean
	): Promise<RendererInstance | RendererInstancePlaceholder | undefined> {
		const instance = this.registeredRenderers.get(id)
		if (instance) return instance

		const placeholder = this.placeholderRenderers.get(id)
		if (placeholder) {
			if (allowPlaceholder) return placeholder
			else {
				// We only have a placeholder renderer, we want to try to spin up a real renderer at this point!
				console.log(`Spinning up renderer for ${id}...`)
				console.log('Connecting to CasparCG...')
				const casparcg = await this.getCasparCG()
				console.log('Spinning up Renderer')
				const url = `http://${this.config.scanner.host ?? 'localhost'}:${this.config.scanner.port}/renderer/?id=${placeholder.info.id}`
				console.log('Playing URL on CasparCG', url)
				await casparcg.playHtml({
					channel: placeholder.channel,
					layer: placeholder.layer,
					url,
				})

				console.log('Waiting for Renderer to initialize')

				// Now, we'll wait for the renderer to spin up and register itself:

				const newInstance = await new Promise<RendererInstance>((resolve, reject) => {
					const timeout = setTimeout(() => {
						clearInterval(checkInterval)
						reject(new Error('Renderer failed to start in time'))
					}, 10 * 1000)

					const checkInterval = setInterval(() => {
						const instance = this.registeredRenderers.get(id)
						if (instance) {
							clearTimeout(timeout)
							clearInterval(checkInterval)
							resolve(instance)
						} else {
							console.log('Waiting for renderer to register...', id)
						}
					}, 200)
				})
				console.log('Renderer is up!')
				return newInstance
			}
		}

		return undefined
	}

	private async getCasparCG() {
		if (this.casparcg) {
			if (this.casparcg.connected) return this.casparcg

			await this.casparcg.discard()
		}
		// else, setup a new connection:

		const casparcg = new CasparCG()
		this.casparcg = casparcg
		casparcg.connect(this.config.caspar.host, this.config.caspar.port)

		await new Promise<void>((resolve, reject) => {
			if (casparcg.connected) {
				resolve()
				return
			}
			const timeout = setTimeout(() => {
				reject(new Error('Connection to CasparCG timed out'))
			}, 5000)

			casparcg.on('connect', () => {
				clearTimeout(timeout)
				resolve()
			})
			casparcg.on('error', (err) => {
				clearTimeout(timeout)
				reject(err)
			})
		})

		if (this.casparcg.connected) return this.casparcg
		else throw new Error('Failed to connect to CasparCG')
	}
}

export class RendererInstance implements RendererAPI.MethodsOnServer {
	static RandomIndex = 0
	// static ID(): string {
	//     return `renderer-${RendererInstance._ID++}`
	// }

	public isStatic = false
	private isRegistered = false
	public info: RendererInfo | undefined
	// private _manifest: (RendererInfo & RendererManifest) | null = null

	/** Methods that can be called on the Renderer */
	public api: RendererAPI.MethodsOnRenderer

	constructor(
		private manager: RendererManager,
		private jsonRpcConnection: JSONRPCServerAndClient<void, void>
	) {
		// Register incoming methods:
		this.jsonRpcConnection.addMethod('unregister', this.unregister)
		this.jsonRpcConnection.addMethod('register', this.register)
		this.jsonRpcConnection.addMethod('onInfo', this.onInfo)
		this.jsonRpcConnection.addMethod('debug', this.debug)

		this.api = {
			// getManifest: async (payload) => jsonRpcConnection.request('getManifest', payload),
			// listGraphicInstances: async (payload) => jsonRpcConnection.request('listGraphicInstances', payload),
			getInfo: async (payload) => this.jsonRpcConnection.request('getInfo', payload),
			getTargetStatus: async (payload) => this.jsonRpcConnection.request('getTargetStatus', payload),
			invokeRendererAction: async (payload) => this.jsonRpcConnection.request('invokeRendererAction', payload),
			loadGraphic: async (payload) => this.jsonRpcConnection.request('loadGraphic', payload),
			clearGraphics: async (payload) => this.jsonRpcConnection.request('clearGraphics', payload),

			invokeGraphicUpdateAction: async (payload) =>
				this.jsonRpcConnection.request('invokeGraphicUpdateAction', payload),
			invokeGraphicPlayAction: async (payload) => this.jsonRpcConnection.request('invokeGraphicPlayAction', payload),
			invokeGraphicStopAction: async (payload) => this.jsonRpcConnection.request('invokeGraphicStopAction', payload),
			invokeGraphicCustomAction: async (payload) =>
				this.jsonRpcConnection.request('invokeGraphicCustomAction', payload),
		}
	}

	public register = async (payload: { info: RendererInfo }): Promise<{ rendererId: string } & VendorExtend> => {
		// JSONRPC METHOD, called by the Renderer
		this.isRegistered = true

		let id: string
		if (payload.info.id === undefined || payload.info.id === '') {
			id = `renderer:${RendererInstance.RandomIndex++}`
		} else {
			id = `${payload.info.id}`
		}

		this.info = {
			...payload.info,
			id,
		}
		if (!this.info.name) this.info.name = id

		this.manager.registerRenderer(this, this.info.id)

		console.log(`Renderer "${id}" registered`)

		setTimeout(() => {
			// Ask the renderer for its manifest and initial status
			// this.updateManifest().catch(console.error)
			this.updateInfo().catch(console.error)
		}, 10)
		return {
			rendererId: this.info.id,
		}
	}

	public unregister = async (): Promise<EmptyPayload> => {
		// JSONRPC METHOD, called by the Renderer
		this.isRegistered = false
		this.manager.closeRendererInstance(this)
		return {}
	}

	public onInfo = async (payload: { info: RendererInfo }): Promise<EmptyPayload> => {
		// JSONRPC METHOD, called by the Renderer
		if (!this.isRegistered) throw new Error('Renderer is not registered')

		this.info = {
			...payload.info,
			id: this.info?.id ?? 'N/A',
		}
		return {}
	}

	public debug = async (payload: { message: string }): Promise<EmptyPayload> => {
		// JSONRPC METHOD, called by the Renderer
		if (!this.isRegistered) throw new Error('Renderer is not registered')

		console.log('DEBUG Renderer', payload.message)
		return {}
	}

	// private async updateManifest() {
	// 	const result = await this.api.getManifest({})
	// 	this._manifest = result.rendererManifest
	// }
	public async updateInfo() {
		if (!this.api) throw new Error('API is not initialized')

		const result = await this.api.getInfo({})
		this.info = {
			...result.rendererInfo,
			id: this.info?.id ?? 'N/A',
		}
	}
}

export class RendererInstancePlaceholder {
	constructor(
		public info: RendererInfo,
		public channel: number,
		public layer: number
	) {}
	public async updateInfo() {
		// noop
	}
	getRenderTargetInfo(renderTarget: unknown): RendererAPI.RenderTargetInfo {
		return {
			renderTarget: renderTarget,
			name: 'Placeholder Target',
			graphicInstances: [],
		}
	}
}
