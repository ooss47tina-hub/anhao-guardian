import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Elder, GuardianLink, LifeSignal, Message } from 'src/database/entities';
import { BaselineService } from 'src/modules/baseline/baseline.service';

/**
 * 長者總覽的一列。
 *
 * 刻意沒有可以放對話內容的欄位 —— 設計規格 §2.1 的界線寫在型別上，
 * 不是靠實作者記得。要加欄位前先確認它不是聊天原文。
 */
export interface ElderOverviewRow {
  elderId: string;
  displayName: string;
  status: string;
  messageCount: number;
  signalCount: number;
  effectiveDays: number;
  requiredDays: number;
  canDetect: boolean;
  guardianCount: number;
  lastInteractionAt: string | null;
}

/** GET /admin/elders 的資料來源。 */
@Injectable()
export class AdminOverviewService {
  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(LifeSignal) private readonly signals: Repository<LifeSignal>,
    @InjectRepository(GuardianLink) private readonly links: Repository<GuardianLink>,
    private readonly baseline: BaselineService,
  ) {}

  async listElders(): Promise<ElderOverviewRow[]> {
    const elders = await this.elders.find({ order: { createdAt: 'ASC' } });
    const asOf = new Date();

    return Promise.all(
      elders.map(async (elder): Promise<ElderOverviewRow> => {
        // 一律用 count —— find 會把整列（含 text_encrypted）撈進記憶體。
        const [messageCount, signalCount, guardianCount, gate, latest] = await Promise.all([
          this.messages.count({ where: { elderId: elder.id } }),
          this.signals.count({ where: { elderId: elder.id } }),
          this.links.count({ where: { elderId: elder.id, revokedAt: IsNull() } }),
          this.baseline.gate(elder.id, asOf),
          this.messages.findOne({
            where: { elderId: elder.id },
            order: { createdAt: 'DESC' },
            select: { createdAt: true },
          }),
        ]);

        return {
          elderId: elder.id,
          displayName: elder.displayName,
          status: elder.status,
          messageCount,
          signalCount,
          effectiveDays: gate.effectiveDays,
          requiredDays: gate.requiredDays,
          canDetect: gate.canDetect,
          guardianCount,
          lastInteractionAt: latest?.createdAt?.toISOString() ?? null,
        };
      }),
    );
  }
}
