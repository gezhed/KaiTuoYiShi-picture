export type ResourceProgress = (done: number, total: number) => void;

export interface LoadAllOrThrowInput<T, R> {
  items: readonly T[];
  fetchOne: (item: T) => Promise<R>;
  label: (item: T) => string;
  onProgress?: ResourceProgress;
  concurrency?: number;
}

export async function loadAllOrThrow<T, R>(input: LoadAllOrThrowInput<T, R>): Promise<R[]> {
  const { items, fetchOne, label, onProgress, concurrency = 4 } = input;
  const total = items.length;
  // 按下标回填而不是 push，否则并发完成顺序会打乱 items 顺序。
  const loaded = new Array<R>(total);
  const failures: string[] = [];
  let cursor = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      try {
        loaded[index] = await fetchOne(items[index]);
      } catch (error) {
        failures.push(`${label(items[index])}：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // 抛错也要计数，否则进度会停在中途。
        done += 1;
        onProgress?.(done, total);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  if (failures.length) {
    throw new Error(`内置预置资源不完整（${failures.length}/${total}）：${failures.join('；')}`);
  }
  return loaded;
}
