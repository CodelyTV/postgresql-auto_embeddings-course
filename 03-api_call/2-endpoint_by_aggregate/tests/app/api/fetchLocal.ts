export async function fetchLocal(
	path: string,
	options?: RequestInit,
	timeoutMs?: number,
): Promise<Response> {
	const baseUrl = "http://localhost:3000";
	const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 5000);

	try {
		return await fetch(url, {
			...options,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
		global.gc?.();
	}
}
