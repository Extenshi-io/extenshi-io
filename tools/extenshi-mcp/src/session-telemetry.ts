/** Request-auth snapshots can outlive a session's current analytics consent. */
const guards = new WeakMap<object, () => boolean>()

export function bindSessionTelemetryGuard(auth: object, allowed: () => boolean): void {
	guards.set(auth, allowed)
}

export function canCaptureSessionTelemetry(auth: unknown): boolean {
	if (!auth || typeof auth !== 'object') return true // Local stdio stays anonymous.
	if ((auth as { telemetry?: unknown }).telemetry === false) return false
	return guards.get(auth)?.() ?? true
}
