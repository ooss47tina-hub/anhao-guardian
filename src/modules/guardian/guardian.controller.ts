import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Actor, CurrentActor } from 'src/common/auth/actor';
import { LineAuthGuard } from 'src/common/auth/line-auth.guard';
import { AuditService } from 'src/common/audit/audit.service';
import { AckAction, AckFeedback, AlertAck } from 'src/database/entities';
import { GuardianViewService } from './guardian-view.service';

class AckAlertDto {
  action: AckAction;
  feedback?: AckFeedback;
}

/**
 * 守護者端 API（交接規格 §3）。
 *
 * 這個 controller 的每個端點都先確認呼叫者是守護者本人。
 * 長者呼叫守護者端點一律 403 —— 不是權限問題，是資料流方向的問題：
 * 守護者視圖是「經過摘要與授權過濾的結果」，長者要看自己的資料應走長者端。
 */
@Controller('v1')
@UseGuards(LineAuthGuard)
export class GuardianController {
  constructor(
    private readonly view: GuardianViewService,
    @InjectRepository(AlertAck) private readonly acks: Repository<AlertAck>,
    private readonly audit: AuditService,
  ) {}

  /** GET /v1/elders/:id/status — G-01 首頁：一個狀態、一句摘要、近期事件。 */
  @Get('elders/:elderId/status')
  async status(@CurrentActor() actor: Actor, @Param('elderId') elderId: string) {
    this.assertGuardian(actor);
    return this.view.status(actor.id, elderId);
  }

  /** GET /v1/elders/:id/digest — G-02 週摘要與四維度對照。 */
  @Get('elders/:elderId/digest')
  async digest(@CurrentActor() actor: Actor, @Param('elderId') elderId: string) {
    this.assertGuardian(actor);
    return this.view.digest(actor.id, elderId);
  }

  /** GET /v1/alerts/:id — G-03 變化詳情，含 baseline 對照與 supporting signals。 */
  @Get('alerts/:alertId')
  async alert(@CurrentActor() actor: Actor, @Param('alertId') alertId: string) {
    this.assertGuardian(actor);
    return this.view.alertDetail(actor.id, alertId);
  }

  /** POST /v1/alerts/:id/ack — 已聯絡／判斷不準／不用再提醒。 */
  @Post('alerts/:alertId/ack')
  async ack(
    @CurrentActor() actor: Actor,
    @Param('alertId') alertId: string,
    @Body() dto: AckAlertDto,
  ) {
    this.assertGuardian(actor);

    const ack = await this.acks.save(
      this.acks.create({
        alertId,
        guardianId: actor.id,
        action: dto.action,
        feedback: dto.feedback ?? null,
        ackedAt: new Date(),
      }),
    );

    // 回饋門檻調整的依據，需可追溯（交接規格 §2.3）。
    await this.audit.record({
      actorType: 'guardian',
      actorId: actor.id,
      action: 'alert.ack',
      targetTable: 'pattern_alert',
      targetId: alertId,
      after: { action: dto.action, feedback: dto.feedback ?? null },
    });

    return ack;
  }

  /** G-04 醫療行程。只有完成狀態與必要摘要，不做全程定位。 */
  @Get('elders/:elderId/journeys')
  async journeys(@CurrentActor() actor: Actor, @Param('elderId') elderId: string) {
    this.assertGuardian(actor);
    return this.view.upcomingJourneys(actor.id, elderId);
  }

  private assertGuardian(actor: Actor): void {
    if (actor.role !== 'guardian') {
      throw new ForbiddenException('此端點僅供守護者使用');
    }
  }
}
