/** Request-auth snapshots can outlive a session's current analytics consent. */
const guards = new WeakMap<object, () => boolean>()

export function bindSessionTelemetryGuard(auth: object, allowed: () => boolean): void {
	guards.set(auth, allowed)
}

export function canCaptureSessionTelemetry(auth: unknown): boolean {
	// Local stdio has no session auth: the saved answer in telemetry.ts decides.
	if (!auth || typeof auth !== 'object') return true
	if ((auth as { telemetry?: unknown }).telemetry === false) return false
	return guards.get(auth)?.() ?? true
}
