import { describe, expect, it } from 'vitest'
import { shapeLandingRead, summarizeLandingForm } from './landing-read.js'

const form = {
	schemaVersion: 2,
	extensionName: 'Reading Ruler',
	tagline: 'Read line by line',
	theme: 'dark',
	accentColor: '#225588',
	defaultLocale: 'en',
	chromeUrl: 'https://chromewebstore.google.com/detail/x',
	firefoxUrl: '',
	termsUrl: 'https://dojo.extenshi.io/license-terms/abc',
	logoUrl: `data:image/png;base64,${'A'.repeat(3000)}`,
	features: [{ title: 'Ruler', description: '' }],
	sections: [
		{ id: 'hero', type: 'hero' },
		{ id: 'faq', type: 'faq', hidden: true, items: [] },
	],
	locales: { de: { tagline: 'Zeile für Zeile' }, pt_BR: { tagline: 'Linha por linha' } },
}
const result = { page: { publicCode: 'zn53kyn66' }, url: 'https://page.extenshi.io/zn53kyn66', form }

describe('summarizeLandingForm', () => {
	const summary = summarizeLandingForm(form)

	it('names what exists without the bodies', () => {
		expect(summary).toMatchObject({
			schemaVersion: 2,
			extensionName: 'Reading Ruler',
			defaultLocale: 'en',
			links: {
				chromeUrl: 'https://chromewebstore.google.com/detail/x',
				termsUrl: 'https://dojo.extenshi.io/license-terms/abc',
			},
			features: 1,
			screenshots: 0,
		})
		expect(summary.links).not.toHaveProperty('firefoxUrl')
		expect(summary.sections).toEqual([
			{ index: 0, id: 'hero', type: 'hero', bytes: expect.any(Number) },
			{ index: 1, id: 'faq', type: 'faq', hidden: true, bytes: expect.any(Number) },
		])
		expect(summary.translations.map((t) => t.locale)).toEqual(['de', 'pt_BR'])
		expect(JSON.stringify(summary)).not.toContain('AAAA')
	})

	it('reports the logo kind and the largest fields first', () => {
		// One measure everywhere (JSON, quotes included), so logo and fields compare.
		expect(summary.logo).toEqual({ kind: 'data-url', bytes: form.logoUrl.length + 2 })
		expect(summary.fields[0]).toEqual({ field: 'logoUrl', bytes: summary.logo.bytes })
		expect(summary.bytes).toBe(Buffer.byteLength(JSON.stringify(form)))
	})
})

describe('shapeLandingRead', () => {
	it('summarizes by default', () => {
		const out = shapeLandingRead(result) as Record<string, unknown>
		expect(out).not.toHaveProperty('form')
		expect(out).toMatchObject({ page: result.page, url: result.url, view: 'summary' })
		expect(out.next).toMatch(/view "full"/)
	})

	it('returns the full response unchanged for view full', () => {
		expect(shapeLandingRead(result, { view: 'full' })).toEqual(result)
	})

	it('narrows the form to fields and translations, matching locale spellings', () => {
		const out = shapeLandingRead(result, { view: 'full', fields: ['tagline', 'locales'], locales: ['pt-BR'] })
		expect(out).toMatchObject({
			form: {
				schemaVersion: 2,
				tagline: 'Read line by line',
				locales: { pt_BR: { tagline: 'Linha por linha' } },
			},
			formBytes: { full: Buffer.byteLength(JSON.stringify(form)) },
		})
		expect(Object.keys((out as { form: object }).form).sort()).toEqual([
			'locales',
			'schemaVersion',
			'tagline',
		])
	})

	it('keeps the requested translations when fields leaves out locales', () => {
		const out = shapeLandingRead(result, { view: 'full', fields: ['sections'], locales: ['de'] }) as {
			form: Record<string, unknown>
		}
		expect(out.form).toEqual({
			schemaVersion: 2,
			sections: form.sections,
			locales: { de: { tagline: 'Zeile für Zeile' } },
		})
	})

	it('drops every translation for locales []', () => {
		const out = shapeLandingRead(result, { view: 'full', locales: [] }) as { form: Record<string, unknown> }
		expect(out.form.locales).toEqual({})
		expect(out.form.extensionName).toBe('Reading Ruler')
	})

	it('passes through anything that is not a landing read', () => {
		expect(shapeLandingRead(null)).toBeNull()
		expect(shapeLandingRead({ error: 'x' })).toEqual({ error: 'x' })
		expect(shapeLandingRead({ page: null, url: null, form: null }, { view: 'full' })).toEqual({
			page: null,
			url: null,
			form: null,
		})
	})
})
