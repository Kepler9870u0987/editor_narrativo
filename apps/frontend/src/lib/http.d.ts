export declare class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare function apiFetch<T>(input: string, options?: {
    method?: string;
    body?: unknown;
    accessToken?: string | null;
    credentials?: RequestCredentials;
}): Promise<T>;
//# sourceMappingURL=http.d.ts.map