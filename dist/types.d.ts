export type Key = {
    [key: string]: string;
};
export interface PaginatedResult<T> {
    items: T[];
    lastEvaluatedKey?: Record<string, any>;
}
export type BatchReadItem = {
    tableName: string;
    key: Key;
};
export type BatchReadItems = BatchReadItem[];
//# sourceMappingURL=types.d.ts.map