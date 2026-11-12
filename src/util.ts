import path from 'node:path'

export function getId(fileDir: string, filePath: string): string {
	return path
		.relative(fileDir, filePath) /* take file name without path */
		.replace(/\.[^/.]+$/, '') /* remove last extension */
		.replace(/\\+/g, '/') /* replace (multiple)backslashes with forward slashes */
		.toUpperCase()
}

export interface GDDScript {
	/** Value of the "src" attribute, set when the GDD lives in a separate file */
	src: string | undefined
	/** Content of the script element */
	text: string
}

const GDD_SCRIPT_NAME = 'graphics-data-definition'

const LT = 0x3c // <
const GT = 0x3e // >
const SLASH = 0x2f
const BANG = 0x21
const QUESTION = 0x3f
const EQUALS = 0x3d
const DOUBLE_QUOTE = 0x22
const SINGLE_QUOTE = 0x27
const DASH = 0x2d

/** Elements whose content is text rather than markup (script is handled on its own) */
const RAW_TEXT_ELEMENTS = new Set(['style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'])

function isSpace(c: number | undefined): boolean {
	return c === 0x20 || c === 0x0a || c === 0x09 || c === 0x0c || c === 0x0d
}
function isAlpha(c: number | undefined): boolean {
	if (c === undefined) return false
	const lower = c | 0x20
	return lower >= 0x61 && lower <= 0x7a
}

/**
 * Parse a tag, starting at its name.
 * Attributes are only collected for script elements. Returns undefined if the document ends inside the tag.
 */
function readTag(
	html: Buffer,
	nameStart: number
): { name: string; attributes: Map<string, string> | undefined; end: number } | undefined {
	const len = html.length
	let p = nameStart
	while (p < len && !isSpace(html[p]) && html[p] !== SLASH && html[p] !== GT) p++
	const name = html.toString('latin1', nameStart, p).toLowerCase()
	const attributes = name === 'script' ? new Map<string, string>() : undefined

	for (;;) {
		while (p < len && (isSpace(html[p]) || html[p] === SLASH)) p++
		if (p >= len) return undefined
		if (html[p] === GT) return { name, attributes, end: p + 1 }

		const attrStart = p++ // The first character always belongs to the name, even "="
		while (p < len && !isSpace(html[p]) && html[p] !== SLASH && html[p] !== GT && html[p] !== EQUALS) p++
		const attrEnd = p
		while (p < len && isSpace(html[p])) p++

		let valueStart = p
		let valueEnd = p
		if (html[p] === EQUALS) {
			p++
			while (p < len && isSpace(html[p])) p++
			const quote = html[p]
			if (quote === DOUBLE_QUOTE || quote === SINGLE_QUOTE) {
				valueStart = p + 1
				valueEnd = html.indexOf(quote, valueStart)
				if (valueEnd === -1) return undefined
				p = valueEnd + 1
			} else {
				valueStart = p
				while (p < len && !isSpace(html[p]) && html[p] !== GT) p++
				valueEnd = p
			}
		}

		if (attributes) {
			const attrName = html.toString('latin1', attrStart, attrEnd).toLowerCase()
			// As in HTML, the first occurrence of an attribute wins
			if (!attributes.has(attrName)) attributes.set(attrName, html.toString('utf8', valueStart, valueEnd))
		}
	}
}

/** Whether `name` (lowercase), followed by the end of a tag name, is at `pos`. */
function isTagNameAt(html: Buffer, pos: number, name: string): boolean {
	for (let i = 0; i < name.length; i++) {
		const c = html[pos + i]
		if (c === undefined || (c | 0x20) !== name.charCodeAt(i)) return false
	}
	const c = html[pos + name.length]
	return isSpace(c) || c === SLASH || c === GT
}

/** Find the `</name` closing a raw text element, or -1. */
function findRawTextEnd(html: Buffer, from: number, name: string): number {
	let p = from
	for (;;) {
		const i = html.indexOf('</', p)
		if (i === -1) return -1
		if (isTagNameAt(html, i + 2, name)) return i
		p = i + 2
	}
}

/**
 * Find the `</script` closing a script element, or -1.
 * Inside a script, `<!-- <script> </script> -->` does not close the element.
 */
function findScriptEnd(html: Buffer, from: number): number {
	let state: 'data' | 'escaped' | 'double-escaped' = 'data'
	let p = from
	let escapeEnd = -2 // Position of the next "-->". -2: not searched yet
	for (;;) {
		const lt = html.indexOf(LT, p)
		if (state !== 'data') {
			if (escapeEnd !== -1 && escapeEnd < p) escapeEnd = html.indexOf('-->', p)
			if (escapeEnd !== -1 && (lt === -1 || escapeEnd < lt)) {
				state = 'data'
				p = escapeEnd + 3
				continue
			}
		}
		if (lt === -1) return -1
		p = lt + 1

		if (html[p] === SLASH && isTagNameAt(html, p + 1, 'script')) {
			if (state !== 'double-escaped') return lt
			state = 'escaped'
		} else if (state === 'data' && html[p] === BANG && html[p + 1] === DASH && html[p + 2] === DASH) {
			state = 'escaped'
			p = lt + 2 // So that "<!-->" ends the escape straight away
			escapeEnd = -2
		} else if (state === 'escaped' && isTagNameAt(html, p, 'script')) {
			state = 'double-escaped'
		}
	}
}

/**
 * Find the first `<script name="graphics-data-definition">` of a HTML template.
 *
 * Templates are commonly megabytes of inlined scripts and assets, so instead of building a DOM, this scans
 * the raw bytes (HTML syntax is ASCII, so that is safe for UTF-8) and only follows the rules that decide whether
 * a "<script" is really a tag: comments, quoted attribute values and elements whose content is text are skipped.
 */
export function findGDDScript(html: Buffer): GDDScript | undefined {
	// Quick way out for templates without a GDD
	if (!html.includes(GDD_SCRIPT_NAME)) return undefined

	const len = html.length
	let pos = 0
	for (;;) {
		const lt = html.indexOf(LT, pos)
		if (lt === -1) return undefined
		const c = html[lt + 1]

		if (c === BANG && html[lt + 2] === DASH && html[lt + 3] === DASH) {
			// A comment, ended by "-->" or "--!>"
			const end = html.indexOf('-->', lt + 2)
			const endBang = html.indexOf('--!>', lt + 4)
			if (end === -1 && endBang === -1) return undefined
			pos = endBang !== -1 && (end === -1 || endBang < end) ? endBang + 4 : end + 3
		} else if (c === BANG || c === QUESTION || (c === SLASH && lt + 2 < len && !isAlpha(html[lt + 2]))) {
			// Doctype, "<![CDATA[", "<?xml" and such are skipped up to the next ">"
			const end = html.indexOf(GT, lt + 2)
			if (end === -1) return undefined
			pos = end + 1
		} else if (c === SLASH) {
			const tag = readTag(html, lt + 2)
			if (!tag) return undefined
			pos = tag.end
		} else if (isAlpha(c)) {
			const tag = readTag(html, lt + 1)
			if (!tag) return undefined
			pos = tag.end

			if (tag.attributes) {
				const end = findScriptEnd(html, pos)
				if (tag.attributes.get('name') === GDD_SCRIPT_NAME) {
					return {
						src: tag.attributes.get('src'),
						text: html.toString('utf8', pos, end === -1 ? len : end),
					}
				}
				if (end === -1) return undefined
				pos = end
			} else if (tag.name === 'plaintext') {
				return undefined
			} else if (RAW_TEXT_ELEMENTS.has(tag.name)) {
				pos = findRawTextEnd(html, pos, tag.name)
				if (pos === -1) return undefined
			}
		} else {
			pos = lt + 1 // A literal "<"
		}
	}
}

export function parseGDDJSON(filePath: string, gddContent: string): unknown {
	try {
		return JSON.parse(gddContent)
	} catch (_error) {
		throw new Error(`Failed to parse GDD from "${filePath}", is it valid JSON?`)
	}
}
