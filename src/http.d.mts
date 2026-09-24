export function readText(message: Pick<Request | Response, "body">, limit: number, options?: { signal?: AbortSignal }): Promise<string>;
