import { generateInfo } from '../ffmpeg'
import { PouchDBMediaDocument } from '../db'
import path from 'path'
import moment from 'moment'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const targetVersions = require('./ffmpegReleases.json')

const testMediaPath = path.join(__dirname, 'samples')

function runForFFmpegRelease(ffprobePath: string, ffmpegPath: string, _ffmpegVersion: string) {
	function createBareDoc(filename: string): PouchDBMediaDocument {
		return {
			_id: 'test',
			_rev: '0',
			mediaPath: path.join(testMediaPath, filename),
			mediaSize: 45678,
			mediaTime: moment('2023-12-06 12:34:56').unix() * 1000,
		}
	}
	const defaultConfig = {
		metadata: null,
		paths: {
			media: testMediaPath,
			ffprobe: ffprobePath,
			ffmpeg: ffmpegPath,
		},
	}

	test('grey.png', async () => {
		const doc = createBareDoc('grey.png')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"GREY"  STILL  45678 20231206123456 0 0/1\r\n')
	})
	test('Still_Gif.gif', async () => {
		const doc = createBareDoc('Still_Gif.gif')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"STILL_GIF"  STILL  45678 20231206123456 0 0/1\r\n')
	})
	test('Still_Jpeg.jpg', async () => {
		const doc = createBareDoc('Still_Jpeg.jpg')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"STILL_JPEG"  STILL  45678 20231206123456 0 0/1\r\n')
	})
	test('ExtractedStill.mov', async () => {
		const doc = createBareDoc('ExtractedStill.mov')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"EXTRACTEDSTILL"  STILL  45678 20231206123456 0 0/1\r\n')
	})

	test('AudioOnly.mp3', async () => {
		const doc = createBareDoc('AudioOnly.mp3')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"AUDIOONLY"  AUDIO  45678 20231206123456 28788480 1/14112000\r\n')
	})
	test('audio_with_poster.mp3', async () => {
		const doc = createBareDoc('audio_with_poster.mp3')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"AUDIO_WITH_POSTER"  AUDIO  45678 20231206123456 28788480 1/14112000\r\n')
	})

	test('Movie_a0v1.mov', async () => {
		const doc = createBareDoc('Movie_a0v1.mov')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"MOVIE_A0V1"  MOVIE  45678 20231206123456 50 1/25\r\n')
	})
	test('Movie_v0a1.mov', async () => {
		const doc = createBareDoc('Movie_v0a1.mov')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"MOVIE_V0A1"  MOVIE  45678 20231206123456 50 1/25\r\n')
	})
	test('Mute_Video.mov', async () => {
		const doc = createBareDoc('Mute_Video.mov')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"MUTE_VIDEO"  MOVIE  45678 20231206123456 50 1/25\r\n')
	})
	test('MXF_OP1a.mxf', async () => {
		const doc = createBareDoc('MXF_OP1a.mxf')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"MXF_OP1A"  MOVIE  45678 20231206123456 50 1/25\r\n')
	})
}

const ffprobeFilename = process.platform === 'win32' ? 'bin/ffprobe.exe' : 'ffprobe'
const ffmpegFilename = process.platform === 'win32' ? 'bin/ffmpeg.exe' : 'ffmpeg'

const ffmpegRootPath = path.join(__dirname, '../../.ffmpeg')
for (const version of targetVersions[`${process.platform}-${process.arch}`]) {
	describe(`FFmpeg ${version.id}`, () => {
		runForFFmpegRelease(
			path.join(ffmpegRootPath, version.id, ffprobeFilename),
			path.join(ffmpegRootPath, version.id, ffmpegFilename),
			version.id
		)
	})
}
