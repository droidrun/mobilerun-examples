/** What the browser and this server exchange. */
export type SessionView = { id: string; expiresInSeconds: number };
export type StreamView = { streamUrl: string; streamToken?: string };
export type ErrorBody = { error: string; message: string };
