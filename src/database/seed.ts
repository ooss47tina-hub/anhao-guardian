import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from 'src/app.module';
import { ConsentService } from 'src/common/consent/consent.service';
import { Elder, Guardian, GuardianLink, MedicalJourney } from 'src/database/entities';
import { PersonaService } from 'src/modules/persona/persona.service';

/**
 * 開發用種子資料。
 * 人物與設定取自介面原型（陳美玲 76 歲獨居、女兒陳怡君為主要守護者），
 * 方便把 API 回應直接對照畫面驗收。
 *
 *   npm run seed
 */
async function main(): Promise<void> {
  const logger = new Logger('seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error'] });

  try {
    const dataSource = app.get(DataSource);
    const consent = app.get(ConsentService);
    const persona = app.get(PersonaService);

    const elder = await dataSource.getRepository(Elder).save({
      lineUserId: 'U-dev-elder-meiling',
      displayName: '陳美玲',
      birthYear: 1950,
      livingAlone: true,
      locale: 'zh-TW',
      regionCode: '63000',
      status: 'active',
      // 健保卡認證 token（FakeMyHealthBankAdapter 只檢查非空與到期日）。
      // 有了它，health_record_sync 與 eligibility_check 才有東西可同步。
      healthCardToken: 'fake-health-card-token',
      healthCardTokenExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    });

    const guardian = await dataSource.getRepository(Guardian).save({
      lineUserId: 'U-dev-guardian-yijun',
      displayName: '陳怡君',
      notifyChannel: 'line',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:30',
    });

    await dataSource.getRepository(GuardianLink).save({
      elderId: elder.id,
      guardianId: guardian.id,
      relation: '女兒',
      isPrimary: true,
      boundAt: new Date(),
      revokedAt: null,
    });

    // 授權一律以長者本人身分建立 —— 種子資料也不例外，否則會繞過產品原則。
    for (const scope of ['core', 'pattern_share', 'medical'] as const) {
      await consent.grant({
        elderId: elder.id,
        scope,
        actorRole: 'elder',
        actorId: elder.id,
        evidenceRef: `seed-${scope}`,
      });
    }

    await persona.upsert({
      elderId: elder.id,
      actorRole: 'elder',
      actorId: elder.id,
      changes: {
        templateKey: 'companion',
        personaName: '小安',
        elderSalutation: '媽媽',
        initiativeLevel: 'medium',
        reminderStyle: 'gentle',
      },
    });

    // 回診行程（介面原型 G-04/ E-04 的示範內容）。
    const visitAt = new Date();
    visitAt.setDate(visitAt.getDate() + 4);
    visitAt.setHours(9, 30, 0, 0);
    await dataSource.getRepository(MedicalJourney).save({
      elderId: elder.id,
      visitAt,
      hospital: '慈濟醫院',
      department: '骨科',
      doctor: '王醫師',
      source: 'chat_extract',
      elderConfirmed: true,
      status: 'confirmed',
      completedNote: null,
    });

    logger.log(`種子資料建立完成：elder=${elder.id} guardian=${guardian.id}`);
    logger.log(`長者 id_token（FakeLineAdapter 格式）：Bearer id-token:${elder.lineUserId}`);
    logger.log(`守護者 id_token：Bearer id-token:${guardian.lineUserId}`);
  } finally {
    await app.close();
  }
}

void main();
