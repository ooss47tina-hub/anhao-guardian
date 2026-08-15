export const COMMUNITY_ACTIVITY_PORT = Symbol('CommunityActivityPort');

/**
 * 社區照顧關懷據點與活動（社家署／地方衛生局）。
 * Open Data CSV / JSON，公開資料無個資。
 *
 * 交接規格第 5 節：以住家 1.5 公里、步行 20 分鐘內過濾；快取超過 14 天不顯示。
 * TODO(business)：各地方衛生局開放資料的更新頻率差異待確認。
 */
export interface CommunityActivity {
  stationName: string;
  title: string;
  startAt: string;
  geo: { lat: number; lng: number };
  regionCode: string;
  sourceDataset: string;
}

export interface CommunityActivityPort {
  /** 依縣市代碼抓取公開資料。回傳資料不含任何個資。 */
  fetchByRegion(regionCode: string): Promise<CommunityActivity[]>;
}

/** 交接規格第 5 節的距離門檻。 */
export const ACTIVITY_MAX_DISTANCE_KM = 1.5;
export const ACTIVITY_MAX_WALK_MINUTES = 20;
