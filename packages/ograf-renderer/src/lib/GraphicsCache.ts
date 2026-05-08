import { ServerApi } from 'ograf'
import { GraphicInfo } from './GraphicInstance.js'

export class GraphicCache {
	private cachedGraphicInfo: Record<
		string,
		ServerApi.paths['/graphics/{graphicId}']['get']['responses']['200']['content']['application/json']
	> = {}
	constructor(private serverApiUrl: string) {}
	async loadGraphic(graphicId: string): Promise<{
		elementName: string
		graphicInfo: GraphicInfo
	}> {
		const elementName = this.getElementName(graphicId)
		// Check if the Graphic is already registered:
		const cachedGraphic = customElements.get(elementName)
		const cachedGraphicInfo = this.cachedGraphicInfo[graphicId]
		if (cachedGraphic && cachedGraphicInfo) return { elementName, graphicInfo: cachedGraphicInfo }

		console.log(`Loading Graphic "${graphicId}"`)

		// console.log(`Loading manifest...`)
		const graphicInfo = await this.fetchGraphicInfo(graphicId)

		this.cachedGraphicInfo[graphicId] = graphicInfo

		// Load the Graphic:
		// console.log(`Loading Graphic...`, graphicInfo)
		const webComponent = await this.fetchModule(graphicId, graphicInfo.graphic)

		// register the web component
		// console.log('Define element', graphicId, webComponent)
		customElements.define(elementName, webComponent)

		return {
			elementName,
			graphicInfo,
		}
	}
	getElementName(graphicId: string): string {
		// https://developer.mozilla.org/en-US/docs/Web/API/CustomElementRegistry/define#valid_custom_element_names
		return 'graphic-' + graphicId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
	}
	private async fetchGraphicInfo(graphicId: string): Promise<GraphicInfo> {
		const url = `${this.serverApiUrl}/ograf/v1/graphics/${graphicId}`

		const response = await fetch(url)
		if (response.status === 200) {
			const responseData = await response.json()

			if (!responseData.graphic) throw new Error('No "graphic" property found in response')
			if (!responseData.metadata) throw new Error('No "metadata" property found in response')

			return responseData
		} else {
			throw new Error(`Failed to load manifest from ${url}: [${response.status}] ${JSON.stringify(response.body)}`)
		}
	}
	async fetchModule(
		id: string,
		manifest: ServerApi.components['schemas']['schema-2']
	): Promise<CustomElementConstructor> {
		// console.log('this.serverApiUrl', this.serverApiUrl)
		const modulePath = `${this.serverApiUrl}/graphic/${id}/${manifest.main ?? 'graphic.mjs'}`

		// Load the Graphic module:
		const module = await import(modulePath)

		if (!module.default) {
			const exportKeys = Object.keys(module)

			if (exportKeys.length) {
				throw new Error(
					`The Graphic is expected to export a class as a default export. ${
						exportKeys.length === 1
							? `Instead there is a export called "${exportKeys[0]}". Change this to be "export default ${exportKeys[0]}".`
							: `Instead there are named exports: ${exportKeys.join(', ')}.`
					}`
				)
			} else {
				throw new Error('Module expected to export a class as a default export (no exports found)')
			}
		}
		if (typeof module.default !== 'function') {
			throw new Error('The Graphic is expected to default export a class')
		}

		return module.default
	}
}
