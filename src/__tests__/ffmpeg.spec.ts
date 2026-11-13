import { generateInfo, generateThumb, thumbnailFilter, thumbnailSeekSeconds } from '../ffmpeg.js'
import { PouchDBMediaDocument } from '../db.js'
import path from 'path'
import os from 'node:os'
import cp from 'node:child_process'
import fs from 'node:fs/promises'
import moment from 'moment'
import { createRequire } from 'node:module'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const targetVersions = require('./ffmpegReleases.json')

const testMediaPath = path.join(__dirname, 'samples')

function runForFFmpegRelease(ffprobePath: string, ffmpegPath: string, ffmpegVersion: string) {
	const majorVersion = parseInt(ffmpegVersion.split('.')[0], 10)
	const minorVersion = parseInt(ffmpegVersion.split('.')[1] ?? '0', 10)
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
		const audioDuration = majorVersion >= 8 ? '28224000' : '28788480'
		expect(doc.cinf).toBe(`"AUDIOONLY"  AUDIO  45678 20231206123456 ${audioDuration} 1/14112000\r\n`)
	})
	test('audio_with_poster.mp3', async () => {
		const doc = createBareDoc('audio_with_poster.mp3')
		await generateInfo(defaultConfig, doc)
		const audioDuration = majorVersion >= 8 ? '28224000' : '28788480'
		expect(doc.cinf).toBe(`"AUDIO_WITH_POSTER"  AUDIO  45678 20231206123456 ${audioDuration} 1/14112000\r\n`)
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

	describe('thumbnails', () => {
		const thumbConfig = {
			...defaultConfig,
			thumbnails: { width: 256, height: -1, position: 0.1, frames: 50 },
		}

		/** Decodes a thumbnail to raw 8-bit planes with the same ffmpeg, so no image library is needed. */
		async function decodePlane(png: Buffer, filter: string): Promise<Buffer> {
			return new Promise((resolve, reject) => {
				const child = cp.execFile(
					ffmpegPath,
					[
						'-hide_banner',
						'-loglevel',
						'error',
						'-i',
						'pipe:0',
						'-vf',
						filter,
						'-f',
						'rawvideo',
						'-pix_fmt',
						'gray',
						'pipe:1',
					],
					{ encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
					(err, stdout) => (err ? reject(err as Error) : resolve(stdout))
				)
				child.stdin?.end(png)
			})
		}
		const mean = (plane: Buffer) => plane.reduce((sum, value) => sum + value, 0) / plane.length

		function pngSize(png: Buffer): { width: number; height: number } {
			expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
			return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
		}

		async function thumbOf(file: string): Promise<Buffer> {
			const doc = createBareDoc(file)
			const probe = await generateInfo(thumbConfig, doc)
			await generateThumb(thumbConfig, doc, probe)
			expect(doc.tinf).toMatch(/^".+" \d{8}T\d{6} \d+\r\n$/)
			const attachment = (doc as any)._attachments['thumb.png']
			expect(attachment.content_type).toBe('image/png')
			return attachment.data as Buffer
		}

		for (const file of [
			'grey.png',
			'Still_Jpeg.jpg',
			'Still_Gif.gif',
			'ExtractedStill.mov',
			'Movie_a0v1.mov',
			'MXF_OP1a.mxf',
		]) {
			test(`${file} gets a ${thumbConfig.thumbnails.width} px wide PNG`, async () => {
				expect(pngSize(await thumbOf(file)).width).toBe(256)
			})
		}

		test('audio with a poster image gets the poster', async () => {
			expect(pngSize(await thumbOf('audio_with_poster.mp3')).width).toBe(256)
		})

		test('an audio-only file gets no thumbnail and no error', async () => {
			const doc = createBareDoc('AudioOnly.mp3')
			await generateThumb(thumbConfig, doc, await generateInfo(thumbConfig, doc))
			expect((doc as any)._attachments).toBeUndefined()
			expect(doc.tinf).toBeUndefined()
		})

		test('a file that cannot be probed still gets a thumbnail from its start', async () => {
			const doc = createBareDoc('Movie_a0v1.mov')
			await generateThumb(thumbConfig, doc, undefined)
			expect(pngSize((doc as any)._attachments['thumb.png'].data).width).toBe(256)
		})

		// Regression fixtures, made with the ffmpeg under test: 1 s that must not become the
		// thumbnail, then 4 s of picture.
		const fixtures = path.join(os.tmpdir(), `media-scanner-thumbs-${ffmpegVersion}-${process.pid}`)
		const run = async (args: string[]) =>
			new Promise<void>((resolve, reject) =>
				cp.execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], (err) =>
					err ? reject(err as Error) : resolve()
				)
			)
		beforeAll(async () => {
			await fs.mkdir(fixtures, { recursive: true })
			// Fades up from black: the old scanner took the black first frame.
			await run([
				'-f',
				'lavfi',
				'-i',
				'color=c=black:s=320x180:r=25:d=1',
				'-f',
				'lavfi',
				'-i',
				'testsrc=s=320x180:r=25:d=4',
				'-filter_complex',
				'[0:v][1:v]concat=n=2:v=1[v]',
				'-map',
				'[v]',
				'-c:v',
				'mpeg4',
				'-q:v',
				'2',
				path.join(fixtures, 'from_black.mov'),
			])
			// A lower third with alpha that opens fully transparent, as rendered graphics do.
			await run([
				'-f',
				'lavfi',
				'-i',
				'color=c=black@0.0:s=320x180:r=25:d=1,format=rgba',
				'-f',
				'lavfi',
				'-i',
				"color=c=white:s=320x180:r=25:d=4,format=rgba,geq=r='255':g='255':b='255':a='if(between(Y,120,159),255,0)'",
				'-filter_complex',
				'[0:v][1:v]concat=n=2:v=1[v]',
				'-map',
				'[v]',
				'-c:v',
				'qtrle',
				'-pix_fmt',
				'argb',
				path.join(fixtures, 'lower_third.mov'),
			])
		}, 60_000)
		afterAll(async () => fs.rm(fixtures, { recursive: true, force: true }))

		function fixtureDoc(file: string): PouchDBMediaDocument {
			return { ...createBareDoc(file), mediaPath: path.join(fixtures, file) }
		}

		test('a clip that fades up from black does not get a black thumbnail', async () => {
			const doc = fixtureDoc('from_black.mov')
			await generateThumb(thumbConfig, doc, await generateInfo(thumbConfig, doc))
			const luma = mean(await decodePlane((doc as any)._attachments['thumb.png'].data, 'null'))
			// Limited-range black is 16; the test card averages well above 60.
			expect(luma).toBeGreaterThan(40)
		})

		async function lowerThirdThumb(): Promise<Buffer> {
			const doc = fixtureDoc('lower_third.mov')
			await generateThumb(thumbConfig, doc, await generateInfo(thumbConfig, doc))
			const png = (doc as any)._attachments['thumb.png'].data as Buffer
			expect(pngSize(png)).toEqual({ width: 256, height: 144 })
			return png
		}

		// Measured: FFmpeg 4.1.4, 4.2.2 and 4.3.1 (win32) drop alpha in the thumbnail filter and give
		// RGB; 4.4.1 (linux) and every release from 5 keep it. Visibility is checked for all.
		const keepsAlpha = majorVersion > 4 || (majorVersion === 4 && minorVersion >= 4)

		test('a graphic that opens transparent gets a visible thumbnail', async () => {
			const png = await lowerThirdThumb()
			// Read as grey, alpha ignored: the white bar on black lifts the mean well above black.
			// The old first-frame thumbnail of this file is all zeros.
			expect(mean(await decodePlane(png, 'null'))).toBeGreaterThan(30)
		})

		test.runIf(keepsAlpha)("the thumbnail keeps the graphic's alpha channel", async () => {
			const png = await lowerThirdThumb()
			// PNG colour type 6 is RGBA.
			expect(png[25]).toBe(6)
			// The bar covers 40 of 180 lines: about 22 % opaque.
			// Planar first: older ffmpeg cannot extract alpha from packed RGBA.
			const alpha = mean(await decodePlane(png, 'format=yuva444p,alphaextract'))
			expect(alpha).toBeGreaterThan(30)
			expect(alpha).toBeLessThan(90)
		})

		test('position 0 restores the first-frame behaviour', async () => {
			const doc = fixtureDoc('from_black.mov')
			const firstFrame = { ...thumbConfig, thumbnails: { ...thumbConfig.thumbnails, position: 0, frames: 1 } }
			await generateThumb(firstFrame, doc, await generateInfo(firstFrame, doc))
			expect(mean(await decodePlane((doc as any)._attachments['thumb.png'].data, 'null'))).toBeLessThan(20)
		})
	})
}

describe('thumbnail parameters', () => {
	const config = { thumbnails: { width: 256, height: -1, position: 0.1, frames: 50 } }
	const movie = {
		format: { duration: '10.000000' },
		streams: [{ codec_type: 'video', codec_name: 'prores', duration: '10.000000', disposition: { attached_pic: 0 } }],
	}

	test('a moving picture is searched from the configured fraction of its duration', () => {
		expect(thumbnailSeekSeconds(config, movie)).toBeCloseTo(1)
	})
	test('stills, posters, GIFs and unprobed files start at the beginning', () => {
		expect(thumbnailSeekSeconds(config, undefined)).toBe(0)
		expect(thumbnailSeekSeconds(config, { format: { duration: 'N/A' }, streams: movie.streams })).toBe(0)
		expect(
			thumbnailSeekSeconds(config, {
				format: { duration: '180' },
				streams: [
					{ codec_type: 'audio', duration: '180' },
					{ codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
				],
			})
		).toBe(0)
		expect(
			thumbnailSeekSeconds(config, {
				format: { duration: '3' },
				streams: [{ codec_type: 'video', codec_name: 'gif', duration: '3', disposition: {} }],
			})
		).toBe(0)
	})
	test('a position outside 0..1 or a non-number disables seeking', () => {
		for (const position of [0, 1, -0.5, 2, 'x', undefined]) {
			expect(thumbnailSeekSeconds({ thumbnails: { ...config.thumbnails, position } }, movie)).toBe(0)
		}
		// nconf passes environment and argument values as strings.
		expect(thumbnailSeekSeconds({ thumbnails: { ...config.thumbnails, position: '0.25' } }, movie)).toBeCloseTo(2.5)
	})
	test('the filter scales before picking a frame, in a single -vf chain', () => {
		expect(thumbnailFilter(config)).toBe('scale=256:-1,thumbnail=50')
		// ffmpeg's thumbnail filter needs at least two frames; one or none means "take this frame".
		for (const frames of [1, '1', 0, '0', undefined]) {
			expect(thumbnailFilter({ thumbnails: { width: 256, height: -1, frames } })).toBe('scale=256:-1')
		}
		expect(thumbnailFilter({ thumbnails: { width: 256, height: -1, frames: '2' } })).toBe('scale=256:-1,thumbnail=2')
	})
})

const ffmpegRootPath = path.join(__dirname, '../../.ffmpeg')
for (const version of targetVersions[`${process.platform}-${process.arch}`]) {
	describe(`FFmpeg ${version.id}`, () => {
		// Newer builds have different path requirements
		let ffprobeFilename = process.platform === 'win32' ? 'bin/ffprobe.exe' : 'ffprobe'
		let ffmpegFilename = process.platform === 'win32' ? 'bin/ffmpeg.exe' : 'ffmpeg'
		if (process.platform === 'linux') {
			if (!existsSync(path.join(ffmpegRootPath, version.id, ffprobeFilename))) {
				ffprobeFilename = 'bin/ffprobe'
				ffmpegFilename = 'bin/ffmpeg'
			}
		}

		runForFFmpegRelease(
			path.join(ffmpegRootPath, version.id, ffprobeFilename),
			path.join(ffmpegRootPath, version.id, ffmpegFilename),
			version.id
		)
	})
}
