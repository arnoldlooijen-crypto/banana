export type BrowserLogger = (message: string) => void;

export interface CookieParam {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    url?: string;
}

export interface BrowserRunConfig {
    timeoutMs?: number;
    desiredModel?: string;
    inlineCookies?: CookieParam[];
    inlineCookiesSource?: string;
    cookieSync?: boolean;
}

export interface BrowserRunAttachment {
    path: string;
}

export interface BrowserRunOptions {
    prompt: string;
    log?: BrowserLogger;
    config?: BrowserRunConfig;
    attachments?: BrowserRunAttachment[];
}

export interface BrowserRunResult {
    answerText: string;
    answerMarkdown: string;
    tookMs: number;
    answerTokens: number;
    answerChars: number;
}
