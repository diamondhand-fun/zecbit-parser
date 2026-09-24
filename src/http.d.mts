export function readText(message: Pick<Request | Response, "body">, limit: number, options?: { signal?: AbortSignal; fatal?: boolean }): Promise<string>;
