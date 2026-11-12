import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import pino from 'pino'
import app from '../app.js'
import { findTemplateFile } from '../util.js'
import type { MediaDatabase } from '../db.js'

const GDD = { title: 'Lower third', type: 'object', properties: { name: { type: 'string' } } }

function htmlWithGdd(gdd: string): string {
	return `<html><head><script name="graphics-data-definition" type="application/json+gdd">${gdd}</script></head><body></body></html>`
}

describe('templates', () => {
	let rootDir: string
	let templateDir: string
	let server: Server
	let baseUrl: string

	beforeAll(async () => {
		rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanner-templates-'))
		templateDir = path.join(rootDir, 'template')

		await fs.mkdir(path.join(templateDir, 'news'), { recursive: true })
		await fs.writeFile(path.join(templateDir, 'news', 'lower-third.html'), htmlWithGdd(JSON.stringify(GDD)))
		await fs.writeFile(path.join(templateDir, 'news', 'broken.html'), htmlWithGdd('{ not json'))
		await fs.writeFile(path.join(templateDir, 'news', 'both.html'), '<html></html>')
		await fs.writeFile(path.join(templateDir, 'news', 'both.ft'), '')
		await fs.writeFile(path.join(templateDir, 'plain.html'), '<html></html>')
		await fs.writeFile(path.join(templateDir, 'flash.ft'), '')
		await fs.writeFile(path.join(templateDir, 'style.css'), 'body {}')
		// A file outside of the templates dir, which must never be served
		await fs.writeFile(path.join(rootDir, 'secret.html'), htmlWithGdd(JSON.stringify({ secret: true })))

		const logger = pino({ level: 'silent' })
		const config = { paths: { template: templateDir } }
		server = app(logger, {} as MediaDatabase, config).listen(0, '127.0.0.1')
		await new Promise((resolve) => server.once('listening', resolve))
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve))
		await fs.rm(rootDir, { recursive: true, force: true })
	})

	describe('GET /templates', () => {
		it('includes the GDD by default', async () => {
			const res = await fetch(`${baseUrl}/templates`)
			expect(res.status).toBe(200)

			const { templates } = await res.json()
			expect(templates.map((t: any) => t.id)).toEqual([
				'FLASH',
				'NEWS/BOTH',
				'NEWS/BOTH',
				'NEWS/BROKEN',
				'NEWS/LOWER-THIRD',
				'PLAIN',
			])

			const lowerThird = templates.find((t: any) => t.id === 'NEWS/LOWER-THIRD')
			expect(lowerThird).toEqual({
				id: 'NEWS/LOWER-THIRD',
				path: path.join(templateDir, 'news', 'lower-third.html'),
				type: 'html',
				gdd: GDD,
			})
			expect(templates.find((t: any) => t.id === 'NEWS/BROKEN').error).toMatch(/Failed to parse GDD/)
			expect(templates.find((t: any) => t.id === 'FLASH')).toEqual({
				id: 'FLASH',
				path: path.join(templateDir, 'flash.ft'),
				type: 'ft',
			})
		})

		it('skips the GDD with ?gdd=false', async () => {
			const res = await fetch(`${baseUrl}/templates?gdd=false`)
			expect(res.status).toBe(200)

			const { templates } = await res.json()
			expect(templates).toHaveLength(6)
			for (const template of templates) {
				expect(Object.keys(template).sort()).toEqual(['id', 'path', 'type'])
			}
		})
	})

	describe('GET /templates/<name>', () => {
		const expected = {
			id: 'NEWS/LOWER-THIRD',
			type: 'html',
			gdd: GDD,
		}

		it.each([
			['relative path', 'news/lower-third.html'],
			['id', 'NEWS/LOWER-THIRD'],
			['lowercase id', 'news/lower-third'],
			['url encoded id', 'NEWS%2FLOWER-THIRD'],
		])('finds a template by %s', async (_name, requested) => {
			const res = await fetch(`${baseUrl}/templates/${requested}`)
			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toMatch(/application\/json/)
			expect(await res.json()).toEqual({
				...expected,
				path: path.join(templateDir, 'news', 'lower-third.html'),
			})
		})

		it('returns a template without GDD', async () => {
			const res = await fetch(`${baseUrl}/templates/plain`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({
				id: 'PLAIN',
				path: path.join(templateDir, 'plain.html'),
				type: 'html',
			})
		})

		it('reports an invalid GDD', async () => {
			const res = await fetch(`${baseUrl}/templates/news/broken.html`)
			expect(res.status).toBe(200)

			const template = await res.json()
			expect(template.gdd).toBeUndefined()
			expect(template.error).toMatch(/Failed to parse GDD/)
		})

		it('prefers the html template when an id is ambiguous', async () => {
			const byId = await (await fetch(`${baseUrl}/templates/NEWS/BOTH`)).json()
			expect(byId.type).toBe('html')

			const byPath = await (await fetch(`${baseUrl}/templates/news/both.ft`)).json()
			expect(byPath.type).toBe('ft')
		})

		it.each([
			['unknown template', 'news/missing.html'],
			['wrong extension', 'plain.ft'],
			['non-template file', 'style.css'],
			['parent dir', '../secret.html'],
			['encoded parent dir', '..%2Fsecret.html'],
			['encoded dots', '%2e%2e/secret.html'],
			['backslash parent dir', '..%5Csecret.html'],
			['nested parent dir', 'news/../../secret.html'],
			['absolute path', encodeURIComponent(path.join(os.tmpdir(), 'secret.html'))],
		])('responds 404 for %s', async (_name, requested) => {
			const res = await fetch(`${baseUrl}/templates/${requested}`)
			expect(res.status).toBe(404)
			expect(await res.text()).not.toContain('secret":true')
		})
	})

	describe('findTemplateFile', () => {
		let dir: string
		let dotted: string
		let clock: string
		let nested: string

		beforeAll(async () => {
			dir = path.join(rootDir, 'find')
			dotted = path.join(dir, 'news', 'lower.third.html')
			clock = path.join(dir, 'news', 'clock.htm')
			nested = path.join(dir, 'Sport', 'hockey', 'season 2026', 'play-off', 'score.html')

			await fs.mkdir(path.dirname(nested), { recursive: true })
			await fs.mkdir(path.join(dir, 'news', 'folder.html'), { recursive: true })
			await fs.writeFile(dotted, '')
			await fs.writeFile(clock, '')
			await fs.writeFile(nested, '')
			await fs.writeFile(path.join(dir, 'news', 'image.png'), '')
			await fs.writeFile(path.join(dir, 'score.html'), '')
			await fs.writeFile(path.join(dir, 'news', 'logo.html.ft'), '')
		})

		it('matches ids which end like an extension', async () => {
			const logo = path.join(dir, 'news', 'logo.html.ft')
			expect(await findTemplateFile(dir, 'NEWS/LOGO.HTML')).toBe(logo)
			expect(await findTemplateFile(dir, 'news/logo.html.ft')).toBe(logo)
		})

		it('prefers the html template over the exact spelling for an id', async () => {
			await fs.mkdir(path.join(dir, 'mixed'))
			await fs.writeFile(path.join(dir, 'mixed', 'Score.ft'), '')
			await fs.writeFile(path.join(dir, 'mixed', 'score.html'), '')

			expect(await findTemplateFile(dir, 'mixed/Score')).toBe(path.join(dir, 'mixed', 'score.html'))
			expect(await findTemplateFile(dir, 'mixed/Score.ft')).toBe(path.join(dir, 'mixed', 'Score.ft'))
		})

		it.skipIf(process.platform === 'win32' || process.platform === 'darwin')(
			'prefers the exact spelling on case-sensitive file systems',
			async () => {
				await fs.mkdir(path.join(dir, 'case'))
				await fs.writeFile(path.join(dir, 'case', 'Clock.html'), '')
				await fs.writeFile(path.join(dir, 'case', 'clock.html'), '')

				expect(await findTemplateFile(dir, 'case/clock.html')).toBe(path.join(dir, 'case', 'clock.html'))
				expect(await findTemplateFile(dir, 'case/Clock.html')).toBe(path.join(dir, 'case', 'Clock.html'))
				expect(await findTemplateFile(dir, 'case/Clock')).toBe(path.join(dir, 'case', 'Clock.html'))
			}
		)

		it('matches ids containing a dot', async () => {
			expect(await findTemplateFile(dir, 'NEWS/LOWER.THIRD')).toBe(dotted)
			expect(await findTemplateFile(dir, 'news/lower.third.html')).toBe(dotted)
		})

		it('matches the requested extension', async () => {
			expect(await findTemplateFile(dir, 'news/clock.htm')).toBe(clock)
			expect(await findTemplateFile(dir, 'news/clock.html')).toBeUndefined()
		})

		it('ignores duplicate and mixed slashes', async () => {
			expect(await findTemplateFile(dir, '/news//clock')).toBe(clock)
			expect(await findTemplateFile(dir, 'news\\clock')).toBe(clock)
		})

		it('finds deeply nested templates by their full path only', async () => {
			expect(await findTemplateFile(dir, 'SPORT/HOCKEY/SEASON 2026/PLAY-OFF/SCORE')).toBe(nested)
			expect(await findTemplateFile(dir, 'sport/hockey/season 2026/play-off/score.html')).toBe(nested)
			expect(await findTemplateFile(dir, 'score')).toBe(path.join(dir, 'score.html'))
			expect(await findTemplateFile(dir, 'sport/score')).toBeUndefined()
			expect(await findTemplateFile(dir, 'hockey/season 2026/play-off/score')).toBeUndefined()
		})

		it('never matches anything which is not a template file', async () => {
			expect(await findTemplateFile(dir, 'news/image')).toBeUndefined()
			expect(await findTemplateFile(dir, 'news/image.png')).toBeUndefined()
			expect(await findTemplateFile(dir, 'news/folder')).toBeUndefined()
			expect(await findTemplateFile(dir, 'news/clock.htm/clock')).toBeUndefined()
			expect(await findTemplateFile(dir, 'missing/clock')).toBeUndefined()
			expect(await findTemplateFile(dir, '../template/plain')).toBeUndefined()
			expect(await findTemplateFile(dir, 'news/../news/clock')).toBeUndefined()
			expect(await findTemplateFile(dir, '')).toBeUndefined()
		})
	})
})
