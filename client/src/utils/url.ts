/**
 * Converts an HTTP/HTTPS URL to its corresponding WebSocket (WS/WSS) URL.
 * @param url The base HTTP/HTTPS URL
 * @returns The converted WebSocket URL
 */
export const convertToWsUrl = (url: string): string => {
    return url.replace(/^http/, 'ws');
};
