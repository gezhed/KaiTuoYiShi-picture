export interface VariableExecContext {
  now(): number;
  randomString(len: number): string;
}

export const DEFAULT_EXEC_CTX: VariableExecContext = {
  now: () => Date.now(),
  randomString: (len) => Math.random().toString(36).slice(2, 2 + len),
};
