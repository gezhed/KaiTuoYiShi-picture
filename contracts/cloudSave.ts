import type { 存档数据 } from '@/models/settings';
import type { SaveAssetRecord } from '@/utils/saveAssetStorage';

export interface CloudTransferSaveBundle {
  save: 存档数据;
  assetRecords: SaveAssetRecord[];
}
