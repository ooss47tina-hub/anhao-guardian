import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, IsNull, Not } from 'typeorm';
import { AppModule } from 'src/app.module';
import { ConsentService } from 'src/common/consent/consent.service';
import { Elder, Guardian, GuardianLink } from 'src/database/entities';
import { PersonaService } from 'src/modules/persona/persona.service';

/**
 * 把「真實 LINE 帳號」變成故事示範長者（demo 用，開發環境限定）。
 *
 *   npm run demo:elder -- <長者 LINE user id> [守護者 LINE user id]
 *
 * 做四件事（可重複執行）：
 * 1. 長者資料改為故事設定：王伯伯、74 歲、獨居；AI 稱呼改「伯伯」。
 * 2. 建立「主要守護者」= 第二個參數的 LINE id（未給則用長者自己的 id）。
 *    通知推播只認 line id、不查表，所以指到自己的手機也收得到 ——
 *    正式排練時換成家人手機，重跑本指令帶第二個參數即可。
 * 3. 建立「網頁檢視守護者」（假 id `U-demo-guardian-web`）為次要綁定。
 *    LineAuthGuard 先查 elder 表，真實帳號的 token 永遠是長者身分，
 *    所以守護者網頁（:3001）要用這個假 id 的 dev token 登入
 *    （web/.env.local 的 NEXT_PUBLIC_DEV_TOKEN）。
 * 4. 以長者本人身分授予 core / pattern_share / medical（產品原則：
 *    授權一律由長者本人建立，種子與示範資料不例外）。
 *
 * 之後接著跑：
 *   npm run seed:history -- worth_attention <長者 LINE user id>
 *   npm run job -- baseline_rebuild
 *   npm run job -- pattern_detect
 */
const STORY = {
  displayName: '王文利',
  birthYear: 1952, // 七十多歲
  livingAlone: true,
  salutation: '王阿姨',
  guardianName: '王怡婷', // 故事中的女兒
  relation: '女兒',
  webGuardianLineId: 'U-demo-guardian-web',
};

async function main(): Promise<void> {
  const logger = new Logger('demo:elder');
  const elderLineId = process.argv[2];
  const guardianLineId = process.argv[3] ?? elderLineId;

  if (!elderLineId) {
    logger.error('用法：npm run demo:elder -- <長者 LINE user id> [守護者 LINE user id]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error'] });

  try {
    const dataSource = app.get(DataSource);
    const consent = app.get(ConsentService);
    const persona = app.get(PersonaService);
    const elders = dataSource.getRepository(Elder);
    const guardians = dataSource.getRepository(Guardian);
    const links = dataSource.getRepository(GuardianLink);

    const elder = await elders.findOne({ where: { lineUserId: elderLineId } });
    if (!elder) {
      logger.error(`找不到長者（lineUserId=${elderLineId}）。請先用該帳號加機器人好友。`);
      process.exit(1);
    }

    // ── 1. 長者資料照故事設定 ──
    elder.displayName = STORY.displayName;
    elder.birthYear = STORY.birthYear;
    elder.livingAlone = STORY.livingAlone;
    await elders.save(elder);

    await persona.upsert({
      elderId: elder.id,
      actorRole: 'elder',
      actorId: elder.id,
      changes: { elderSalutation: STORY.salutation },
    });

    // ── 2 + 3. 兩個守護者：主要（收 LINE 推播）與網頁檢視（假 id） ──
    const upsertGuardian = async (lineUserId: string, displayName: string): Promise<Guardian> => {
      const existing = await guardians.findOne({ where: { lineUserId } });
      if (existing) return existing;
      return guardians.save(
        guardians.create({
          lineUserId,
          displayName,
          notifyChannel: 'line',
          quietHoursStart: '22:00',
          quietHoursEnd: '07:30',
        }),
      );
    };

    const upsertLink = async (guardianId: string, isPrimary: boolean): Promise<void> => {
      if (isPrimary) {
        // 每位長者僅一位 is_primary（DB 部分唯一索引）。先讓位再指定。
        await links.update(
          { elderId: elder.id, isPrimary: true, guardianId: Not(guardianId), revokedAt: IsNull() },
          { isPrimary: false },
        );
      }
      const existing = await links.findOne({ where: { elderId: elder.id, guardianId } });
      if (existing) {
        existing.relation = STORY.relation;
        existing.isPrimary = isPrimary;
        existing.revokedAt = null;
        await links.save(existing);
        return;
      }
      await links.save(
        links.create({
          elderId: elder.id,
          guardianId,
          relation: STORY.relation,
          isPrimary,
          boundAt: new Date(),
          revokedAt: null,
        }),
      );
    };

    const notifyGuardian = await upsertGuardian(guardianLineId, STORY.guardianName);
    await upsertLink(notifyGuardian.id, true);

    const webGuardian = await upsertGuardian(STORY.webGuardianLineId, STORY.guardianName);
    if (webGuardian.id !== notifyGuardian.id) {
      await upsertLink(webGuardian.id, false);
    }

    // ── 4. 授權（已授予者不重複灌） ──
    for (const scope of ['core', 'pattern_share', 'medical'] as const) {
      if (await consent.has(elder.id, scope)) continue;
      await consent.grant({
        elderId: elder.id,
        scope,
        actorRole: 'elder',
        actorId: elder.id,
        evidenceRef: `demo-${scope}`,
      });
    }

    logger.log(`長者 ${elder.displayName}（${elder.id}）設定完成`);
    logger.log(`主要守護者（收 LINE 通知）：${guardianLineId}`);
    logger.log(`網頁檢視 token：Bearer id-token:${STORY.webGuardianLineId}`);
    logger.log('接著執行：');
    logger.log(`  npm run seed:history -- worth_attention ${elderLineId}`);
    logger.log('  npm run job -- baseline_rebuild');
    logger.log('  npm run job -- pattern_detect');
  } finally {
    await app.close();
  }
}

void main();
