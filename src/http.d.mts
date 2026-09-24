export function readText(message: Pick<Request | Response, "body">, limit: number): Promise<string>;
