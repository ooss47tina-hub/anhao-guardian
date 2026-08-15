import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Actor, CurrentActor } from 'src/common/auth/actor';
import { LineAuthGuard } from 'src/common/auth/line-auth.guard';
import { Elder, Guardian, GuardianLink } from 'src/database/entities';

/**
 * GET /v1/me — 目前身分與可存取的對象。
 *
 * 前端（LIFF / Web）登入後的第一個呼叫：拿到自己是誰、能看哪些長者。
 * 守護者可對應多位長者（交接規格 §2.1），所以回傳陣列；
 * MVP 前端先取第一位即可。
 */
@Controller('v1')
@UseGuards(LineAuthGuard)
export class MeController {
  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(GuardianLink) private readonly links: Repository<GuardianLink>,
  ) {}

  @Get('me')
  async me(@CurrentActor() actor: Actor) {
    if (actor.role === 'guardian') {
      const guardian = await this.guardians.findOneByOrFail({ id: actor.id });
      const links = await this.links.find({
        where: { guardianId: actor.id, revokedAt: IsNull() },
      });
      const elders = links.length
        ? await this.elders.findByIds(links.map((l) => l.elderId))
        : [];

      return {
        role: 'guardian' as const,
        id: guardian.id,
        displayName: guardian.displayName,
        elders: links.map((link) => {
          const elder = elders.find((e) => e.id === link.elderId);
          return {
            id: link.elderId,
            displayName: elder?.displayName ?? '',
            relation: link.relation,
            isPrimary: link.isPrimary,
            birthYear: elder?.birthYear ?? null,
            livingAlone: elder?.livingAlone ?? false,
          };
        }),
      };
    }

    const elder = await this.elders.findOneByOrFail({ id: actor.id });
    return {
      role: 'elder' as const,
      id: elder.id,
      displayName: elder.displayName,
      elders: [],
    };
  }
}
