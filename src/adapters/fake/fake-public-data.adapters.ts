import { Injectable } from '@nestjs/common';
import { CommunityActivity, CommunityActivityPort } from 'src/ports/community-activity.port';
import { EligibilityResult, HpaEligibilityPort } from 'src/ports/hpa-eligibility.port';
import {
  HealthRecordSnapshot,
  MedicalVisitRecord,
  MyHealthBankPort,
} from 'src/ports/my-health-bank.port';
import { ObjectStoragePort } from 'src/ports/object-storage.port';

/**
 * 公部門資料與物件儲存的假實作。
 * 資料取自介面原型 E-06 與 G-04 的示範內容，方便對照畫面驗收。
 */

@Injectable()
export class FakeMyHealthBankAdapter implements MyHealthBankPort {
  /** 設為 true 可模擬串接失敗，測試降級路徑。 */
  shouldFail = false;

  async fetchHealthRecords(_elderToken: string): Promise<HealthRecordSnapshot[]> {
    if (this.shouldFail) throw new Error('MyHealthBank 暫時無法連線');
    return [
      {
        examDate: '2025-04-12',
        // 原樣呈現，不做判讀、不加「偏高／偏低」註記（交接規格 §5）。
        labs: [
          { name: '空腹血糖', value: '104', unit: 'mg/dL' },
          { name: '總膽固醇', value: '198', unit: 'mg/dL' },
          { name: '血壓', value: '132/78', unit: 'mmHg' },
        ],
        dataAsOf: '2025-04-12',
      },
    ];
  }

  async fetchMedicalVisits(_elderToken: string): Promise<MedicalVisitRecord[]> {
    if (this.shouldFail) throw new Error('MyHealthBank 暫時無法連線');
    return [{ visitAt: '2026-05-20T09:30:00+08:00', hospital: '慈濟醫院', department: '骨科' }];
  }

  isAuthorizationValid(elderToken: string, expiresAt: Date | null): boolean {
    if (!elderToken) return false;
    return expiresAt === null || expiresAt.getTime() > Date.now();
  }
}

@Injectable()
export class FakeHpaEligibilityAdapter implements HpaEligibilityPort {
  shouldFail = false;

  async checkEligibility(input: {
    elderToken: string;
    program: string;
    year: number;
  }): Promise<EligibilityResult> {
    if (this.shouldFail) {
      // 交接規格 §5：失敗時以「上次日期 + 1 年」推算並標 degraded。
      const lastUsedDate = '2025-04-12';
      const inferredNext = new Date(lastUsedDate);
      inferredNext.setFullYear(inferredNext.getFullYear() + 1);
      return {
        program: input.program,
        year: input.year,
        available: inferredNext.getTime() <= Date.now(),
        lastUsedDate,
        degraded: true,
      };
    }
    return {
      program: input.program,
      year: input.year,
      available: true,
      lastUsedDate: '2025-04-12',
      degraded: false,
    };
  }
}

@Injectable()
export class FakeCommunityActivityAdapter implements CommunityActivityPort {
  async fetchByRegion(regionCode: string): Promise<CommunityActivity[]> {
    return [
      {
        stationName: '大安區關懷據點',
        title: '長者健康操',
        startAt: '2026-08-18T09:00:00+08:00',
        geo: { lat: 25.0265, lng: 121.5435 },
        regionCode,
        sourceDataset: 'sfaa-community-care-stations',
      },
      {
        stationName: '龍門里活動中心',
        title: '共餐日',
        startAt: '2026-08-20T11:30:00+08:00',
        geo: { lat: 25.0301, lng: 121.5488 },
        regionCode,
        sourceDataset: 'sfaa-community-care-stations',
      },
    ];
  }
}

@Injectable()
export class FakeObjectStorageAdapter implements ObjectStoragePort {
  private readonly store = new Map<string, { data: Buffer; mimeType: string }>();

  async put(input: {
    key: string;
    data: Buffer;
    mimeType: string;
    retentionDays?: number;
  }): Promise<string> {
    this.store.set(input.key, { data: input.data, mimeType: input.mimeType });
    return input.key;
  }

  async get(ref: string): Promise<{ data: Buffer; mimeType: string }> {
    const found = this.store.get(ref);
    if (!found) throw new Error(`物件不存在：${ref}`);
    return found;
  }

  async delete(ref: string): Promise<void> {
    this.store.delete(ref);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
