import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConsentService } from 'src/common/consent/consent.service';
import {
  Elder,
  Guardian,
  LifeSignal,
  Notification,
  PatternAlert,
} from 'src/database/entities';
import { applyScenario, Scenario, SCENARIOS } from 'src/database/seed-history.lib';
import { GuardianViewService } from 'src/modules/guardian/guardian-view.service';
import { SignalExtractionService } from 'src/modules/extract/signal-extraction.service';
import { JobsService } from 'src/scheduler/jobs.service';
import { DEV_CONSOLE_HTML } from './dev-console.html';

/**
 * 開發用檢視頁（http://localhost:3000/dev）。
 *
 * 目的：把純後端的資料流變成看得到的畫面，對照介面原型（G-01/G-02/G-03）驗收。
 * 不是正式前端 —— 正式的守護者端是 LIFF/Web，另案開發。
 *
 * 邊界：
 * - 僅開發環境。production 一律 404（AppModule 也不載入此模組，雙保險）。
 * - 守護者視角的資料一律經 GuardianViewService 取得，consent 過濾照常生效 ——
 *   這個頁面本身就是用來「看見」那些閘門的，繞過它們就失去意義。
 * - 「AI 萃取檢視」區塊對應原型長者端的開發用檢視（原型註明：長者實際畫面
 *   不會看到信心值與訊號標籤）。
 */
@Controller('dev')
export class DevController {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly guardianView: GuardianViewService,
    private readonly extraction: SignalExtractionService,
    private readonly consent: ConsentService,
    private readonly jobs: JobsService,
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(PatternAlert) private readonly alerts: Repository<PatternAlert>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(LifeSignal) private readonly signals: Repository<LifeSignal>,
  ) {}

  private assertDev(): void {
    if (this.config.get<string>('env') === 'production') {
      throw new NotFoundException();
    }
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    this.assertDev();
    return DEV_CONSOLE_HTML;
  }

  /** 一次撈齊頁面所需的狀態。 */
  @Get('api/state')
  async state() {
    this.assertDev();

    const elder = await this.elders.findOne({ where: { lineUserId: 'U-dev-elder-meiling' } });
    const guardian = await this.guardians.findOne({
      where: { lineUserId: 'U-dev-guardian-yijun' },
    });
    if (!elder || !guardian) {
      return { seeded: false, hint: '請先執行 npm run seed' };
    }

    const status = await this.guardianView.status(guardian.id, elder.id);
    const digest = await this.guardianView.digest(guardian.id, elder.id);

    // 含 internal_only 的最新 alert —— 開發頁要能看到「有 alert 但沒通知」的狀態。
    const latestAlert = await this.alerts.findOne({
      where: { elderId: elder.id },
      order: { createdAt: 'DESC' },
    });
    const alertDetail = latestAlert
      ? {
          ...(await this.guardianView.alertDetail(guardian.id, latestAlert.id)),
          internalOnly: latestAlert.internalOnly,
        }
      : null;

    const recentNotifications = await this.notifications.find({
      order: { createdAt: 'DESC' },
      take: 8,
    });
    const recentSignals = await this.signals.find({
      where: { elderId: elder.id },
      order: { createdAt: 'DESC' },
      take: 8,
    });

    return {
      seeded: true,
      elder: { id: elder.id, displayName: elder.displayName },
      guardian: { id: guardian.id, displayName: guardian.displayName },
      grantedScopes: await this.consent.grantedScopes(elder.id),
      status,
      digest,
      alertDetail,
      notifications: recentNotifications,
      recentSignals,
      quality: await this.extraction.signalPrecision(),
      reviewQueue: await this.extraction.reviewQueue(5),
    };
  }

  /** 切換情境並重跑 baseline + pattern，等同 CLI 的三個指令。 */
  @Post('api/scenario/:name')
  async scenario(@Param('name') name: string) {
    this.assertDev();

    if (!SCENARIOS.includes(name as Scenario)) {
      throw new NotFoundException(`未知情境：${name}`);
    }
    const elder = await this.elders.findOneOrFail({
      where: { lineUserId: 'U-dev-elder-meiling' },
    });

    const seeded = await applyScenario(this.dataSource, elder.id, name as Scenario);
    await this.jobs.baselineRebuild();
    // 用日間時間跑，避免真實時刻落在安靜時段而讓 P2 被抑制，混淆示範重點。
    const daytime = new Date();
    daytime.setHours(9, 0, 0, 0);
    const detect = await this.jobs.patternDetect(daytime);

    return { seeded, detect };
  }
}
