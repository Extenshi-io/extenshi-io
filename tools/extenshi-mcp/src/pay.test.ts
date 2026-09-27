import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { makeBff } from './bff.js'
import { PAY_OPERATIONS, paySchemas, payWireInput } from './pay.js'
import { registerTools } from './tools.js'

vi.mock('./telemetry.js', async (original) => ({
	...(await original<typeof import('./telemetry.js')>()),
	captureEvent: vi.fn(),
	captureError: vi.fn(),
}))
const appId = '11111111-1111-4111-8111-111111111111'

// Gate on the shared-types workspace, not on the CLI file under comparison: the
// CLI package is absent when this package is extracted standalone (the npm
// tarball, and the isolated copy mirror-mcp.yml builds). Inside the monorepo the
// comparison always runs, so a rename or drift still fails here.
const inMonorepo = existsSync(resolve(__dirname, '../../../shared-types/package.json'))

it.skipIf(!inMonorepo)(
	'keeps standalone CLI and MCP contract schemas synchronized across package boundaries',
	() => {
		expect(readFileSync(resolve(__dirname, '../../extenshi-cli/src/pay-contract.ts'), 'utf8')).toBe(
			readFileSync(resolve(__dirname, 'pay.ts'), 'utf8'),
		)
	},
)
it('forbids secrets and legal acceptance in Pay inputs', () => {
	expect(paySchemas.createPayApp.parse({ name: 'Standalone' })).toEqual({ name: 'Standalone' })
	expect(() => paySchemas.createPayApp.parse({ name: 'Standalone', stripeSecret: 'secret' })).toThrow()
	expect(() => paySchemas.connectPaySeller.parse({ appId, acceptAgreement: true })).toThrow()
	expect(PAY_OPERATIONS.map((operation) => operation[3]).join(' ')).not.toMatch(
		/acceptAgreement|connectPlatform/,
	)
	expect(payWireInput('linkPayApp', { appId, projectId: 'optional-project' })).toEqual({
		appId,
		projectId: 'optional-project',
	})
	expect(payWireInput('getPaySeller', { appId })).toEqual({ projectId: appId })
})
it('registers Pay operations with correct mutation annotations and permission descriptions', async () => {
	const tools: any[] = []
	const method = vi.fn(async () => ({ id: appId }))
	registerTools({ addTool: (tool: unknown) => tools.push(tool) } as never, {
		cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
		capabilities: new Set(['read']),
		getBff: () => ({ createPayApp: method }) as never,
	})
	for (const [, name, , , mutation] of PAY_OPERATIONS) {
		const tool = tools.find((tool) => tool.name === name)
		expect(tool.annotations.readOnlyHint).toBe(!mutation)
		expect(tool.description).toContain(mutation ? 'pay.write' : 'pay.read')
	}
	await tools.find((tool) => tool.name === 'create_pay_app').execute({ name: 'Standalone' }, {})
	expect(method).toHaveBeenCalledWith({ name: 'Standalone' })
})
it('sends Pay requests to the correct tRPC paths with authenticated headers and app IDs', async () => {
	const calls: Array<{ url: string; input: unknown; authorization?: string }> = []
	const server = createServer(async (request, response) => {
		let body = ''
		for await (const chunk of request) body += chunk
		const url = new URL(request.url ?? '/', 'http://localhost')
		calls.push({
			url: url.pathname,
			input: JSON.parse(body || url.searchParams.get('input') || '{}'),
			authorization: request.headers.authorization,
		})
		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify([{ result: { data: { ok: true } } }]))
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	try {
		const address = server.address() as { port: number }
		const bff = makeBff(`http://127.0.0.1:${address.port}`, 'ek_test_secret')
		await bff.createPayApp({ name: 'Standalone' })
		await bff.getPaySeller({ appId })
		await bff.exportPayData({ appId, resource: 'payments', limit: 10 })
		expect(calls.map((call) => call.url)).toEqual([
			'/api/trpc/payApp.create',
			'/api/trpc/paySeller.get',
			'/api/trpc/payApp.export',
		])
		expect(calls[0].input).toEqual({ '0': { name: 'Standalone' } })
		expect(calls[1].input).toEqual({ '0': { projectId: appId } })
		expect(calls[2].input).toEqual({ '0': { appId, resource: 'payments', limit: 10 } })
		expect(calls.every((call) => call.authorization === 'Bearer ek_test_secret')).toBe(true)
	} finally {
		server.closeAllConnections()
		await new Promise<void>((done) => server.close(() => done()))
	}
})

it('never echoes provider credentials or private payment data from a failed tool', async () => {
	const tools: any[] = []
	registerTools({ addTool: (tool: unknown) => tools.push(tool) } as never, {
		cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
		capabilities: new Set(['read']),
		getBff: () =>
			({
				getPaySeller: async () => {
					throw new Error('sk_live_secret buyer@example.com')
				},
			}) as never,
	})
	await expect(tools.find((tool) => tool.name === 'get_pay_seller').execute({ appId }, {})).rejects.toThrow(
		'Pay request failed',
	)
	await expect(
		tools.find((tool) => tool.name === 'get_pay_seller').execute({ appId }, {}),
	).rejects.not.toThrow('sk_live_secret')
})
