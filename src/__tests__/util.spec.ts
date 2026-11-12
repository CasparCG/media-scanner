import { describe, expect, it } from 'vitest'
import { findGDDScript } from '../util.js'

const find = (html: string) => findGDDScript(Buffer.from(html))

describe('findGDDScript', () => {
	it('finds an inline GDD', () => {
		expect(
			find(
				'<!DOCTYPE html><html><head><script name="graphics-data-definition" type="application/json+gdd">{"a":1}</script></head></html>'
			)
		).toEqual({ src: undefined, text: '{"a":1}' })
	})

	it('finds an external GDD', () => {
		expect(find('<script src="my gdd.json" name="graphics-data-definition"></script>')).toEqual({
			src: 'my gdd.json',
			text: '',
		})
	})

	it('accepts any attribute order, quoting and tag case', () => {
		expect(find(`<script type=x name='graphics-data-definition'>1</script>`)?.text).toBe('1')
		expect(find('<script name=graphics-data-definition>2</script>')?.text).toBe('2')
		expect(find('<SCRIPT\n\tNAME = "graphics-data-definition"\n>3</SCRIPT >')?.text).toBe('3')
		expect(find('<script name="graphics-data-definition">ção ✓</script>')?.text).toBe('ção ✓')
	})

	it('returns the first one', () => {
		expect(
			find('<script name="graphics-data-definition">1</script><script name="graphics-data-definition">2</script>')?.text
		).toBe('1')
	})

	it('returns undefined when there is none', () => {
		expect(find('')).toBeUndefined()
		expect(find('<html><body><script>var a = 1</script></body></html>')).toBeUndefined()
		expect(find('<script name="Graphics-Data-Definition">{}</script>')).toBeUndefined()
		expect(find('<script data-name="graphics-data-definition">{}</script>')).toBeUndefined()
		expect(find('<script name="other" name="graphics-data-definition">{}</script>')).toBeUndefined()
	})

	it('ignores what only looks like a tag', () => {
		const gdd = '<script name="graphics-data-definition">{}</script>'
		expect(find(`<!-- ${gdd} -->`)).toBeUndefined()
		expect(find(`<script>const html = '${gdd}'</script>`)).toBeUndefined()
		expect(find(`<style>/* ${gdd} */</style>`)).toBeUndefined()
		expect(find(`<textarea>${gdd}</textarea>`)).toBeUndefined()
		expect(find(`<div title='${gdd}'></div>`)).toBeUndefined()
		expect(find(`<img alt="<!--" src="data:image/png;base64,AAAA">${gdd}`)).toEqual({ src: undefined, text: '{}' })
		expect(find(`<!-- a --><script>if (a < b) c("</div>")</script><style>a > b {}</style>${gdd}`)).toEqual({
			src: undefined,
			text: '{}',
		})
	})

	it('follows the script escaping rules', () => {
		expect(find('<script name="graphics-data-definition">{"a":"</scripts>"}</script>')?.text).toBe('{"a":"</scripts>"}')
		expect(
			find(
				'<script>a = "<!--"; b = "<script>"; c = "</script>"; d = "-->"</script><script name="graphics-data-definition">1</script>'
			)?.text
		).toBe('1')
	})
})
