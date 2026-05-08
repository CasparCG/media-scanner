export interface Config {
	caspar: {
		config: string
		channelCount: number
		host: string
		port: number
	}
	paths: {
		template: string
		media: string
		font: string
		ffmpeg: string
		ffprobe: string
	}
	scanner: {
		paths: string
		// Note: See https://www.npmjs.com/package/chokidar#api.

		host: string
		port: number
	}
	thumbnails: {
		width: 256
		height: -1
	}
	metadata: {
		fieldOrder: false // This is an expensive check, as it requires decoding the beginning of the video
		fieldOrderScanDuration: 200 // Frames. Note: Needs sufficient motion (Not titlecard)
	}
	isProduction: boolean
	logger: {
		level: string
		name: string
		print: boolean
	}
	http: {
		port: number
		host: string | undefined
	}
	enable: {
		scanning: boolean
		ograf: boolean
	}
	ograf: {
		rendererLayers: number[]
	}
}
