import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from 'src/database/entities';
import { AuditService } from './audit/audit.service';
import { LineAuthGuard } from './auth/line-auth.guard';
import { ConsentService } from './consent/consent.service';
import { DiagnosticLanguageFilter } from './safety/diagnostic-language.filter';
import { SafetyRuleService } from './safety/safety-rule.service';

/**
 * 橫切關注點。
 *
 * 這個模組是 @Global 的，理由是它匯出的東西都是「每個模組都必須遵守的規則」——
 * 稽核、授權閘門、安全規則、診斷語言過濾。讓它們需要被逐一 import
 * 只會增加漏掉的機會，而漏掉任何一個都是違反交接規格 §6。
 *
 * TypeOrmModule.forFeature(ALL_ENTITIES) 也在這裡統一匯出。
 * 領域模組不需要各自宣告 entity，減少「新增欄位後忘了註冊」這類錯誤。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES)],
  providers: [AuditService, ConsentService, DiagnosticLanguageFilter, SafetyRuleService, LineAuthGuard],
  exports: [
    TypeOrmModule,
    AuditService,
    ConsentService,
    DiagnosticLanguageFilter,
    SafetyRuleService,
    LineAuthGuard,
  ],
})
export class CoreModule {}
