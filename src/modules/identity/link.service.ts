import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { GuardianLink, LinkInvite } from 'src/database/entities';

/**
 * M1 綁定。
 * 交接規格 §3：「邀請碼一次性、24 小時失效」。
 */
@Injectable()
export class LinkService {
  constructor(
    @InjectRepository(LinkInvite) private readonly invites: Repository<LinkInvite>,
    @InjectRepository(GuardianLink) private readonly links: Repository<GuardianLink>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async createInvite(input: {
    createdByRole: 'elder' | 'guardian';
    elderId?: string;
    guardianId?: string;
  }): Promise<LinkInvite> {
    const ttlHours = this.config.get<number>('rules.inviteCodeTtlHours') ?? 24;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    return this.invites.save(
      this.invites.create({
        code: randomBytes(4).toString('hex').toUpperCase(),
        elderId: input.elderId ?? null,
        guardianId: input.guardianId ?? null,
        createdByRole: input.createdByRole,
        expiresAt,
        consumedAt: null,
      }),
    );
  }

  /**
   * 接受邀請並建立綁定。
   *
   * 一次性由 consumed_at 保證。過期與已用的邀請碼給相同錯誤訊息，
   * 避免洩漏「這個碼存在但已被用掉」。
   */
  async accept(input: {
    code: string;
    elderId?: string;
    guardianId?: string;
    relation: string;
  }): Promise<GuardianLink> {
    const invite = await this.invites.findOne({ where: { code: input.code } });

    if (!invite || invite.consumedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('邀請碼無效或已過期');
    }

    const elderId = invite.elderId ?? input.elderId;
    const guardianId = invite.guardianId ?? input.guardianId;
    if (!elderId || !guardianId) {
      throw new BadRequestException('邀請碼缺少對應的長者或守護者');
    }

    // 第一位綁定的守護者成為主要守護者。
    // 每位長者僅一位 is_primary，由 guardian_link_one_primary_idx 部分唯一索引保證。
    const hasPrimary = await this.links.exists({
      where: { elderId, isPrimary: true, revokedAt: IsNull() },
    });

    const link = await this.links.save(
      this.links.create({
        elderId,
        guardianId,
        relation: input.relation,
        isPrimary: !hasPrimary,
        invitedBy: invite.createdByRole === 'elder' ? elderId : guardianId,
        boundAt: new Date(),
        revokedAt: null,
      }),
    );

    invite.consumedAt = new Date();
    await this.invites.save(invite);

    await this.audit.record({
      actorType: invite.createdByRole,
      actorId: invite.createdByRole === 'elder' ? elderId : guardianId,
      action: 'link.accept',
      targetTable: 'guardian_link',
      targetId: link.id,
      after: { elderId, guardianId, isPrimary: link.isPrimary },
    });

    return link;
  }

  /** 解除綁定。以 revoked_at 標記，不硬刪（交接規格 §2.1）。 */
  async revoke(linkId: string, actorId: string): Promise<void> {
    await this.links.update({ id: linkId }, { revokedAt: new Date(), isPrimary: false });
    await this.audit.record({
      actorType: 'elder',
      actorId,
      action: 'link.revoke',
      targetTable: 'guardian_link',
      targetId: linkId,
    });
  }
}
