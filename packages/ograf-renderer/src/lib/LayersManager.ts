import * as OGraf from 'ograf'
import { GraphicCache } from './GraphicsCache.js'
import { LayerHandler } from './LayerHandler.js'
import { renderLayers } from '@helper/shared'

export class LayersManager {
	private layers: Record<string, LayerHandler> = {}
	constructor(private graphicCache: GraphicCache) {
		// Create the layers:
		for (const layerId of renderLayers) {
			const renderTarget: RenderTarget = {
				layerId: layerId,
			}

			this.layers[`${renderTarget.layerId}`] = new LayerHandler(
				this,
				this.graphicCache,
				renderTarget,
				`Layer ${layerId}`,
				layerId
			)
		}

		// setup frameRate tracker:

		this.trackFrame()

		setInterval(() => {
			this.checkAccessToPublicInternet()
		}, 60 * 1000)
		this.checkAccessToPublicInternet()
	}

	getLayer(renderTarget: RenderTarget): LayerHandler | undefined {
		if (typeof renderTarget === 'string') {
			renderTarget = JSON.parse(renderTarget) as RenderTarget
		}

		const layer = this.layers[`${renderTarget.layerId}`]

		return layer
	}
	getAllLayers(): LayerHandler[] {
		return Object.values<LayerHandler>(this.layers)
	}

	public getRenderCharacteristics(): OGraf.RenderCharacteristics {
		return {
			// accessToPublicInternet:
			resolution: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			frameRate: this.fps,
			accessToPublicInternet: this.isOnline,
		} satisfies OGraf.RenderCharacteristics
	}

	private lastFrameTime = 0
	private frameTimeSum = 0
	private frameTimeCount = 0
	public fps = 0

	private trackFrame = () => {
		// This is called every frame, calculates and updates this.fps

		const now = performance.now()
		if (this.lastFrameTime > 0) {
			const deltaTime = now - this.lastFrameTime

			this.frameTimeSum += deltaTime
			this.frameTimeCount += 1

			this.fps = (1000 * this.frameTimeCount) / this.frameTimeSum

			if (this.frameTimeCount >= 50) {
				this.frameTimeSum *= 0.5
				this.frameTimeCount *= 0.5
			}
		}
		this.lastFrameTime = now

		window.requestAnimationFrame(this.trackFrame)
	}
	private isOnline = false
	private checkAccessToPublicInternet = () => {
		// Load an image to detect if we're online
		const img = new Image()
		img.src = `https://ograf.ebu.io/docs/logo/ograf-logo-colour.svg?t=${Date.now()}`
		img.onload = () => {
			this.isOnline = true
		}
		img.onerror = () => {
			this.isOnline = false
		}
	}
}

export interface RenderTarget {
	layerId: number
}
