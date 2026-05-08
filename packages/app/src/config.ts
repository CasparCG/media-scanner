import nconf from 'nconf'
import fs from 'node:fs'
import xml2js from 'xml2js'

import type { Config } from '@helper/shared'

const defaults: Config = {
	caspar: {
		config: './casparcg.config',
		channelCount: 0,
		host: 'localhost', // set later
		port: 5250, // set later
	},
	paths: {
		template: './template',
		media: './media',
		font: './font',
		ffmpeg: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
		ffprobe: process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
	},
	scanner: {
		paths: '', // set later
		// Note: See https://www.npmjs.com/package/chokidar#api.

		host: 'localhost', // set later
		port: 8000, // set later
	},
	thumbnails: {
		width: 256,
		height: -1,
	},
	metadata: {
		fieldOrder: false, // This is an expensive check, as it requires decoding the beginning of the video
		fieldOrderScanDuration: 200, // Frames. Note: Needs sufficient motion (Not titlecard)
	},
	isProduction: process.env.NODE_ENV === 'production',
	logger: {
		level: process.env.NODE_ENV === 'production' ? 'info' : 'error',
		name: 'casparcg-helper',
		print: process.env.NODE_ENV !== 'production',
	},
	http: {
		port: 8000,
		host: undefined,
	},
	enable: {
		scanning: true,
		ograf: true,
	},
	ograf: {
		rendererLayers: [],
	},
}

export function getConfig(): Config {
	const config: Config = nconf.argv().env('__').defaults(defaults).get()
	if (config.caspar && config.caspar.config) {
		const parser = new xml2js.Parser()
		const data = fs.readFileSync(config.caspar.config)
		parser.parseString(data, (err, result) => {
			if (err) {
				throw err
			}
			for (const path in result.configuration.paths[0]) {
				const key = path.split('-')[0] as keyof Config['paths']
				config.paths[key] = result.configuration.paths[0][path][0]
			}

			let channels = result.configuration.channels
			if (!Array.isArray(channels)) channels = [channels]
			config.caspar.channelCount = channels[0].channel.length

			let amcp = result.configuration.amcp
			if (!Array.isArray(amcp)) amcp = [amcp]
			let mediaServer = amcp[0] && amcp[0]['media-server']
			if (Array.isArray(mediaServer)) mediaServer = mediaServer[0]

			if (mediaServer) {
				let scanning = mediaServer.scanning
				if (Array.isArray(scanning)) scanning = scanning[0]
				let ograf = mediaServer.ograf
				if (Array.isArray(ograf)) ograf = ograf[0]

				if (scanning.trim() === 'false') {
					config.enable.scanning = false
				}
				if (ograf.trim() === 'false') {
					config.enable.ograf = false
				}
				let casparCGHost = mediaServer['casparcg-host']
				if (Array.isArray(casparCGHost)) casparCGHost = casparCGHost[0]

				let host = mediaServer.host
				if (Array.isArray(host)) host = host[0]
				if (host) config.scanner.host = host

				let port = mediaServer.port
				if (Array.isArray(port)) port = port[0]
				if (port !== undefined) port = parseInt(port, 10)
				if (port && !isNaN(port)) config.scanner.port = port

				if (casparCGHost) config.caspar.host = casparCGHost
			}

			let controllers = result.configuration.controllers
			if (Array.isArray(controllers)) controllers = [controllers]
			for (const controller of controllers) {
				let tcp = controller.tcp
				if (Array.isArray(tcp)) tcp = tcp[0]
				if (tcp) {
					let port = tcp.port
					if (Array.isArray(port)) port = port[0]
					if (port !== undefined) {
						port = parseInt(port, 10)
						if (!isNaN(port)) {
							config.caspar.port = parseInt(port, 10)
							break
						}
					}
				}
			}

			let ograf = result.configuration.ograf
			if (!Array.isArray(ograf)) ograf = [ograf]

			let rendererLayers = ograf[0].rendererLayers
			if (!Array.isArray(rendererLayers)) rendererLayers = [rendererLayers]

			let rendererLayer = rendererLayers[0].rendererLayer

			for (const rl of rendererLayer) {
				const layer = parseInt(rl, 10)
				if (!isNaN(layer)) config.ograf.rendererLayers.push(layer)
			}
		})
	}

	if (!config.scanner.paths) {
		config.scanner.paths = config.paths.media
	}
	return config
}
