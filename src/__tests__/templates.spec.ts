import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TemplateLister } from '../templates.js'

const gddScript = (content: string) => `<script name="graphics-data-definition">${content}</script>`

describe('TemplateLister', () => {
	let dir: string
	let lister: TemplateLister
	let mtime = Date.now() / 1000

	async function write(name: string, content: string) {
		const filePath = path.join(dir, name)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content)
		// Make sure that the modification time differs, whatever the resolution of the file system
		mtime += 10
		await fs.utimes(filePath, mtime, mtime)
		return filePath
	}
	async function list() {
		return JSON.parse(await lister.getJSON()).templates
	}

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'templates-'))
		lister = new TemplateLister(dir)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
	})
	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('lists templates sorted by id', async () => {
		const b = await write('b.html', `<html><head>${gddScript('{"title":"B"}')}</head></html>`)
		const a = await write('sub/a.htm', '<html></html>')
		const c = await write('c.ft', '')
		await write('readme.txt', '')

		expect(await list()).toEqual([
			{ id: 'B', path: b, type: 'html', gdd: { title: 'B' } },
			{ id: 'C', path: c, type: 'ft' },
			{ id: 'SUB/A', path: a, type: 'html' },
		])
	})

	it('reports invalid GDDs', async () => {
		const a = await write('a.html', gddScript('{ nope'))
		const b = await write('b.html', '<script name="graphics-data-definition" src="missing.json"></script>')

		const expected = [
			{ id: 'A', path: a, type: 'html', error: `Error: Failed to parse GDD from "${a}", is it valid JSON?` },
			{
				id: 'B',
				path: b,
				type: 'html',
				error: `Error: Failed to read external GDD "missing.json" from "${b}", does the file exist?`,
			},
		]
		expect(await list()).toEqual(expected)
		expect(await list()).toEqual(expected)
	})

	it('only reads templates again when they change', async () => {
		const a = await write('a.html', gddScript('{"v":1}'))
		await write('b.html', gddScript('{"v":1}'))
		const readFile = vi.spyOn(fs, 'readFile')

		expect((await list()).map((t: any) => t.gdd.v)).toEqual([1, 1])
		expect(readFile).toHaveBeenCalledTimes(2)

		await list()
		expect(readFile).toHaveBeenCalledTimes(2)

		await write('a.html', gddScript('{"v":2}'))
		expect((await list()).map((t: any) => t.gdd.v)).toEqual([2, 1])
		expect(readFile).toHaveBeenCalledTimes(3)

		await fs.rm(a)
		expect((await list()).map((t: any) => t.id)).toEqual(['B'])
	})

	it('follows changes of an external GDD', async () => {
		await write('a.html', '<script name="graphics-data-definition" src="gdd/a.json"></script>')
		expect((await list())[0].error).toMatch(/Failed to read external GDD/)

		await write('gdd/a.json', '{"v":1}')
		expect((await list())[0].gdd).toEqual({ v: 1 })

		await write('gdd/a.json', '{"v":2}')
		expect((await list())[0].gdd).toEqual({ v: 2 })
	})

	it('shares the scan between simultaneous requests', async () => {
		await write('a.html', gddScript('{}'))
		const readFile = vi.spyOn(fs, 'readFile')

		const [first, second] = await Promise.all([lister.getJSON(), lister.getJSON()])
		expect(second).toBe(first)
		expect(readFile).toHaveBeenCalledTimes(1)
	})
})
