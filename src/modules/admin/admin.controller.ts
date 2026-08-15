import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AdminAuthGuard } from 'src/common/auth/admin-auth.guard';
import { VERSIONS } from 'src/common/versioning/versions';
import { Notification, ReviewVerdict } from 'src/database/entities';
import { SignalExtractionService } from 'src/modules/extract/signal-extraction.service';
import { MedicationService } from 'src/modules/medical/medication.service';

class ReviewDto {
  @IsUUID()
  reviewerId: string;

  @IsIn(['correct', 'corrected', 'discarded'])
  verdict: ReviewVerdict;

  @IsOptional()
  @IsString()
  correctedValue?: string;
}

class VerifyMedicationDto {
  @IsUUID()
  reviewerId: string;

  @IsString()
  @IsNotEmpty()
  drugName: string;

  @IsString()
  @IsNotEmpty()
  dosage: string;
}

/**
 * 營運 / AI Review Console（交接規格 §3、SRS 第 5 節）。
 * 不含派單與拆帳。
 *
 * guard 掛在類別層而非逐個端點 —— 少掛一個端點不會有任何錯誤訊息，
 * 只會安靜地開一個洞。頁面與登入放在 AdminConsoleController。
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly extraction: SignalExtractionService,
    private readonly medication: MedicationService,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly config: ConfigService,
  ) {}

  /** GET /admin/review/queue — 低信心訊號抽查佇列。 */
  @Get('review/queue')
  async queue(@Query('limit') limit?: string) {
    const signals = await this.extraction.reviewQueue(limit ? Number.parseInt(limit, 10) : 50);
    return {
      threshold: this.config.get<number>('rules.signalReviewConfidenceThreshold'),
      count: signals.length,
      signals,
    };
  }

  /** POST /admin/review/:signalId — 正確／修正，寫 signal_review 與 audit_log。 */
  @Post('review/:signalId')
  async review(@Param('signalId') signalId: string, @Body() dto: ReviewDto) {
    return this.extraction.review({
      signalId,
      reviewerId: dto.reviewerId,
      verdict: dto.verdict,
      correctedValue: dto.correctedValue,
    });
  }

  /** 藥品人工確認佇列 —— 未確認前不得建立用藥提醒（交接規格 §6）。 */
  @Post('medications/:itemId/verify')
  async verifyMedication(@Param('itemId') itemId: string, @Body() dto: VerifyMedicationDto) {
    return this.medication.verify({
      itemId,
      reviewerId: dto.reviewerId,
      drugName: dto.drugName,
      dosage: dto.dosage,
    });
  }

  /**
   * GET /admin/integrations — 外部來源狀態、成功率、同步紀錄。
   * 目前回報設定中的 provider 與版本；同步成功率待接上真實 adapter 後由其回報。
   */
  @Get('integrations')
  async integrations() {
    return {
      versions: VERSIONS,
      sources: [
        { name: '健康存摺 MyHealthBank', agency: '健保署', provider: this.config.get('myHealthBank.provider'), method: 'OAuth 2.0 + FHIR R4' },
        { name: '成人預防保健資格', agency: '國健署', provider: this.config.get('hpa.provider'), method: 'REST + API Key' },
        { name: '社區照顧關懷據點活動', agency: '社家署／地方衛生局', provider: this.config.get('communityActivity.provider'), method: 'Open Data CSV / JSON' },
        { name: 'LINE Messaging API', agency: 'LINE', provider: this.config.get('line.provider'), method: 'Channel access token + Webhook 簽章' },
      ],
    };
  }

  /**
   * 品質 Dashboard。
   *
   * North Star 為「每位活躍長者每週有效生活天數」。
   * 這裡刻意不提供聊天次數與 Dashboard 瀏覽量 —— 交接規格 §6 明列不以此為指標，
   * 提供了就會有人拿去看。
   */
  @Get('quality')
  async quality() {
    const precision = await this.extraction.signalPrecision();
    // Not(IsNull()) 而非 Not(undefined)：TypeORM 會把 undefined 條件整個略過。
    const sent = await this.notifications.count({ where: { sentAt: Not(IsNull()) } });
    const suppressed = await this.notifications.count({
      where: { suppressedReason: Not(IsNull()) },
    });

    return {
      signalPrecision: { ...precision, target: 0.85 },
      notifications: { sent, suppressed },
      note: 'North Star 為每位活躍長者每週有效生活天數，不追蹤聊天次數與 Dashboard 瀏覽量。',
    };
  }
}
