/**
 * PNG output for store artwork and screenshots: 24-bit RGB when every pixel is
 * opaque, RGBA otherwise.
 *
 * resvg and Chromium both write RGBA (colour type 6) even for a fully opaque
 * image, and the Chrome Web Store asks for screenshots and promo tiles as
 * 24-bit PNGs with no alpha. Re-encoding is lossless — the pixels are the same,
 * only the unused alpha byte goes.
 *
 * Deliberately small: 8-bit, non-interlaced, colour types 2 and 6 — exactly
 * what resvg and Chromium produce. Anything else passes through untouched.
 */

import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const COLOR_RGB = 2
const COLOR_RGBA = 6

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

// zlib.crc32 needs Node 20.15/22.2; the CLI supports Node 20.0.
function crc32(buf: Uint8Array): number {
	let c = 0xffffffff
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
	const head = Buffer.alloc(8)
	head.writeUInt32BE(data.length, 0)
	head.write(type, 4, 'ascii')
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
	return Buffer.concat([head, data, crc])
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c
	const pa = Math.abs(p - a)
	const pb = Math.abs(p - b)
	const pc = Math.abs(p - c)
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** A filtered byte's cost for the filter heuristic: its absolute value as a signed byte. */
const COST = (() => {
	const table = new Uint8Array(256)
	for (let v = 0; v < 256; v++) table[v] = v < 128 ? v : 256 - v
	return table
})()

/**
 * Write the scanline for the row at `data[r]`: its filter type byte, then the
 * row filtered with it. `prev[p]` is the row above — a zero row for the first.
 * Typed-array stores wrap, so a negative difference lands as its byte value.
 */
function filterRow(
	out: Uint8Array,
	o: number,
	type: number,
	data: Uint8Array,
	r: number,
	prev: Uint8Array,
	p: number,
	stride: number,
	channels: number,
): void {
	out[o++] = type
	if (type === 0) {
		out.set(data.subarray(r, r + stride), o)
	} else if (type === 1) {
		for (let i = 0; i < channels; i++) out[o + i] = data[r + i]
		for (let i = channels; i < stride; i++) out[o + i] = data[r + i] - data[r + i - channels]
	} else if (type === 2) {
		for (let i = 0; i < stride; i++) out[o + i] = data[r + i] - prev[p + i]
	} else if (type === 3) {
		for (let i = 0; i < channels; i++) out[o + i] = data[r + i] - (prev[p + i] >> 1)
		for (let i = channels; i < stride; i++)
			out[o + i] = data[r + i] - ((data[r + i - channels] + prev[p + i]) >> 1)
	} else {
		// Paeth with no left neighbour (a = c = 0) predicts b.
		for (let i = 0; i < channels; i++) out[o + i] = data[r + i] - prev[p + i]
		for (let i = channels; i < stride; i++) {
			const a = data[r + i - channels]
			const b = prev[p + i]
			const c = prev[p + i - channels]
			const pa = Math.abs(b - c)
			const pb = Math.abs(a - c)
			const pc = Math.abs(a + b - c - c)
			out[o + i] = data[r + i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
		}
	}
}

/**
 * Encode raw 8-bit pixels; each row gets the filter with the smallest sum of
 * absolute values. `keep` are whole chunks (colour space, pixel density) copied
 * from a source PNG so the re-encoded image renders the same.
 */
export function encodePng(
	data: Uint8Array,
	width: number,
	height: number,
	channels: 3 | 4,
	keep: readonly Buffer[] = [],
): Buffer {
	const stride = width * channels
	const out = new Uint8Array((stride + 1) * height)
	const zero = new Uint8Array(stride)
	for (let y = 0; y < height; y++) {
		const r = y * stride
		const prev = y > 0 ? data : zero
		const p = y > 0 ? r - stride : 0
		// Score all five filters in one pass over the row, then write only the
		// winner: about 3× faster than filtering the row five times over.
		let none = 0
		let sub = 0
		let up = 0
		let average = 0
		let paethCost = 0
		for (let i = 0; i < channels; i++) {
			const x = data[r + i]
			const b = prev[p + i]
			none += COST[x]
			sub += COST[x]
			up += COST[(x - b) & 0xff]
			average += COST[(x - (b >> 1)) & 0xff]
			paethCost += COST[(x - b) & 0xff]
		}
		for (let i = channels; i < stride; i++) {
			const x = data[r + i]
			const a = data[r + i - channels]
			const b = prev[p + i]
			const c = prev[p + i - channels]
			const pa = Math.abs(b - c)
			const pb = Math.abs(a - c)
			const pc = Math.abs(a + b - c - c)
			none += COST[x]
			sub += COST[(x - a) & 0xff]
			up += COST[(x - b) & 0xff]
			average += COST[(x - ((a + b) >> 1)) & 0xff]
			paethCost += COST[(x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff]
		}
		// A tie keeps the lower filter type.
		const costs = [none, sub, up, average, paethCost]
		let type = 0
		for (let t = 1; t <= 4; t++) if (costs[t] < costs[type]) type = t
		filterRow(out, y * (stride + 1), type, data, r, prev, p, stride, channels)
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8
	ihdr[9] = channels === 3 ? COLOR_RGB : COLOR_RGBA
	return Buffer.concat([
		SIGNATURE,
		chunk('IHDR', ihdr),
		...keep,
		// Level 6 (zlib's default), not 9: 5–8× faster on store-size screenshots
		// for 3–4 % more bytes, and the stores have no tight size limit.
		chunk('IDAT', deflateSync(out, { level: 6 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}

export interface DecodedPng {
	width: number
	height: number
	/** 3 for RGB, 4 for RGBA. */
	channels: 3 | 4
	data: Uint8Array
	/** Colour-space and density chunks, verbatim, for a faithful re-encode. */
	keep: Buffer[]
}

/** Ancillary chunks that change how the pixels are displayed — carried over on re-encode. */
const KEPT_CHUNKS = new Set(['sRGB', 'iCCP', 'gAMA', 'cHRM', 'pHYs'])

/** Decompression-bomb caps: IHDR width/height are attacker-settable u32s. Store
 *  assets never exceed a few thousand pixels per side; 16 Mpx (≤64 MB expanded
 *  RGBA) leaves orders of magnitude of headroom while keeping `inflateSync`
 *  from allocating unbounded output for a tiny, highly-compressible file. */
const MAX_PNG_DIMENSION = 16_384
const MAX_PNG_PIXELS = 16_777_216

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG; null for anything else. */
export function decodePng(png: Uint8Array): DecodedPng | null {
	const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
	if (b.length < 33 || !b.subarray(0, 8).equals(SIGNATURE)) return null
	let width = 0
	let height = 0
	let channels: 3 | 4 | 0 = 0
	const idat: Buffer[] = []
	const keep: Buffer[] = []
	for (let at = 8; at + 8 <= b.length; ) {
		const length = b.readUInt32BE(at)
		const type = b.toString('ascii', at + 4, at + 8)
		const data = b.subarray(at + 8, at + 8 + length)
		if (type === 'IHDR') {
			// A truncated IHDR would make the reads below throw; null keeps the pass-through contract.
			if (data.length < 13) return null
			width = data.readUInt32BE(0)
			height = data.readUInt32BE(4)
			const [depth, color, , , interlace] = data.subarray(8, 13)
			if (depth !== 8 || interlace !== 0 || (color !== COLOR_RGB && color !== COLOR_RGBA)) return null
			channels = color === COLOR_RGB ? 3 : 4
		} else if (type === 'IDAT') idat.push(data)
		else if (type === 'IEND') break
		else if (KEPT_CHUNKS.has(type)) keep.push(Buffer.from(b.subarray(at, at + 12 + length)))
		at += 12 + length
	}
	if (!channels || !width || !height || idat.length === 0) return null
	if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || width * height > MAX_PNG_PIXELS) return null
	const stride = width * channels
	const expectedRaw = (stride + 1) * height
	let raw: Buffer
	try {
		// maxOutputLength makes an over-large expansion throw (caught → null
		// pass-through) instead of OOM-killing the process.
		raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedRaw })
	} catch {
		// Truncated or corrupt pixel data: not a PNG this module can read, so the
		// caller passes the original through instead of failing the run.
		return null
	}
	if (raw.length < expectedRaw) return null
	const pixels = new Uint8Array(stride * height)
	for (let y = 0; y < height; y++) {
		const type = raw[y * (stride + 1)]
		if (type > 4) return null
		const src = y * (stride + 1) + 1
		const row = y * stride
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? pixels[row + i - channels] : 0
			const up = y > 0 ? pixels[row - stride + i] : 0
			const c = y > 0 && i >= channels ? pixels[row - stride + i - channels] : 0
			const x = raw[src + i]
			pixels[row + i] =
				(type === 0
					? x
					: type === 1
						? x + a
						: type === 2
							? x + up
							: type === 3
								? x + ((a + up) >> 1)
								: x + paeth(a, up, c)) & 0xff
		}
	}
	return { width, height, channels, data: pixels, keep }
}

/** RGBA pixels → an RGB PNG when every pixel is opaque, null when any is not. */
export function rgbPngIfOpaque(
	rgba: Uint8Array,
	width: number,
	height: number,
	keep: readonly Buffer[] = [],
): Buffer | null {
	const rgb = new Uint8Array(width * height * 3)
	for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
		if (rgba[p + 3] !== 255) return null
		rgb[q] = rgba[p]
		rgb[q + 1] = rgba[p + 1]
		rgb[q + 2] = rgba[p + 2]
	}
	return encodePng(rgb, width, height, 3, keep)
}

/**
 * The same image as a 24-bit PNG when it is fully opaque; the input unchanged
 * when it has transparency, is already RGB, or is a format this module does
 * not read.
 */
export function opaquePngAsRgb(png: Uint8Array): Buffer {
	const decoded = decodePng(png)
	const original = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
	if (!decoded || decoded.channels === 3) return original
	return rgbPngIfOpaque(decoded.data, decoded.width, decoded.height, decoded.keep) ?? original
}

/** The PNG colour type from IHDR (2 = RGB, 6 = RGBA). */
export function pngColorType(png: Uint8Array): number {
	return Buffer.from(png.buffer, png.byteOffset, png.byteLength)[25]
}
