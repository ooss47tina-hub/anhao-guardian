export const OBJECT_STORAGE_PORT = Symbol('ObjectStoragePort');

/**
 * 語音與照片儲存。
 *
 * 交接規格第 7 節：「物件儲存放語音與照片，設生命週期規則配合 voice_retention
 * 授權自動刪除。」audio_ref 僅在 voice_retention 授權時保留（交接規格 2.2）。
 */
export interface ObjectStoragePort {
  put(input: { key: string; data: Buffer; mimeType: string; retentionDays?: number }): Promise<string>;

  get(ref: string): Promise<{ data: Buffer; mimeType: string }>;

  /** 硬刪。長者行使刪除權時不得保留可還原副本（交接規格第 6 節）。 */
  delete(ref: string): Promise<void>;

  /** 依 elder 前綴批次刪除，供 POST /v1/elders/:id/erase 使用。 */
  deleteByPrefix(prefix: string): Promise<number>;
}
