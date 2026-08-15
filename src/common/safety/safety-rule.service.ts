import { Injectable } from '@nestjs/common';

/**
 * 高風險語句安全規則。
 *
 * 交接規格 §4：「高風險語句命中不等 Pattern，立即通知並進人工佇列，
 * 不受安靜時段限制。」
 *
 * 刻意用規則比對而非 LLM 判斷：
 * SRS 第 11 節要求安全規則 Recall 目標 100%，LLM 的召回率無法保證且不可重現。
 * LLM 的觀察（concernHints）只作為額外訊號，不能取代這裡的規則。
 */

export type SafetyCategory = 'fall' | 'chest_pain' | 'breathing' | 'self_harm' | 'bleeding' | 'unconscious';

interface SafetyRule {
  category: SafetyCategory;
  keywords: string[];
  /** 給長者的第一句回應。不評估傷勢、不下診斷。 */
  responseHint: string;
}

const RULES: SafetyRule[] = [
  {
    category: 'fall',
    keywords: ['跌倒', '摔倒', '滑倒', '滑了一下', '跌了一跤', '站不起來'],
    responseHint: '先坐下來慢慢喘一下。你現在能自己站起來嗎？',
  },
  {
    category: 'chest_pain',
    keywords: ['胸口痛', '胸悶', '心臟很不舒服', '胸痛'],
    responseHint: '先坐著別動。如果會喘或冒冷汗，請馬上打 119。',
  },
  {
    category: 'breathing',
    keywords: ['喘不過氣', '呼吸困難', '吸不到氣'],
    responseHint: '先坐直、放鬆肩膀慢慢吸氣。如果沒有好轉，請馬上打 119。',
  },
  {
    category: 'self_harm',
    keywords: ['不想活', '想死', '活著沒意思', '傷害自己'],
    responseHint: '謝謝你願意跟我說。我現在就聯絡家人陪你，你可以撥 1925 安心專線。',
  },
  {
    category: 'bleeding',
    keywords: ['流血', '止不住血', '大量出血'],
    responseHint: '先找乾淨的布壓住。如果一直沒停，請馬上打 119。',
  },
  {
    category: 'unconscious',
    keywords: ['昏倒', '暈倒', '失去意識'],
    responseHint: '先找人陪在你身邊。請馬上打 119。',
  },
];

export interface SafetyHit {
  category: SafetyCategory;
  matchedKeyword: string;
  responseHint: string;
}

@Injectable()
export class SafetyRuleService {
  /**
   * 比對高風險語句。
   * 命中回傳全部類別 —— 一句話可能同時命中跌倒與流血，兩者都要進人工佇列。
   */
  evaluate(utterance: string): SafetyHit[] {
    const hits: SafetyHit[] = [];
    for (const rule of RULES) {
      const matched = rule.keywords.find((k) => utterance.includes(k));
      if (matched) {
        hits.push({ category: rule.category, matchedKeyword: matched, responseHint: rule.responseHint });
      }
    }
    return hits;
  }

  isHighRisk(utterance: string): boolean {
    return this.evaluate(utterance).length > 0;
  }
}
