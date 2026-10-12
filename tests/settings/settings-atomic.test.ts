import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteSetting, loadSetting, saveSettings } from '@/services/storage/settings';

describe('设备设置批量持久化', () => {
  it('任一设置无法写入时整批回滚', async () => {
    const firstKey = `atomic-first-${crypto.randomUUID()}`;
    const invalidKey = `atomic-invalid-${crypto.randomUUID()}`;

    await expect(saveSettings([
      [firstKey, { value: 'written-first' }],
      [invalidKey, { callback: () => undefined }],
    ])).rejects.toBeInstanceOf(Error);

    expect(await loadSetting(firstKey)).toBeNull();
    await deleteSetting(firstKey);
    await deleteSetting(invalidKey);
  });
});
