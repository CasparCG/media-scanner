import type { ServerApi } from 'ograf'

export const renderLayers = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export const renderTargetSchema: ServerApi.components['schemas']['RenderTargetSchema'] = {
	type: 'object',
	properties: {
		layerId: {
			/**
			 * This Renderer uses a string to identify its layers:
			 * Using the GDD Select to define the layer.
			 * @see https://superflytv.github.io/GraphicsDataDefinition/#select
			 */
			type: 'number',
			title: 'Render-Layer',
			enum: renderLayers,
			gddType: 'select',
			gddOptions: {
				labels: Object.fromEntries(renderLayers.map((layerId) => [layerId, `Layer ${layerId}`])),
			},
		},
	},
	default: {
		layerId: 1,
	},
}
// console.log('renderTargetSchema', renderTargetSchema.properties.layerId)
