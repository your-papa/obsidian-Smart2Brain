import {
    calculateAliasBoost,
    calculatePathBoost,
    calculateTagBoost,
    calculateTitleBoost,
    getAliasMatchKind,
    getTitleMatchKind,
    type AliasMatchKind,
    type TitleMatchKind,
    type TitleBoostScale,
} from "./searchRanking";
import type { QueryPlan } from "./queryPlan";
import { isNumericSearchTerm, normalizeSearchText } from "./searchTermUtils";

const MATCH_TIER_CONTENT = 0;
const MATCH_TIER_ALIAS_CONTAINS = 2;
const MATCH_TIER_ALIAS_PREFIX = 4;
const MATCH_TIER_ALIAS_TOKEN = 5;
const MATCH_TIER_ALIAS_EXACT = 6;
const MATCH_TIER_TITLE_ALL_TERMS = 2;
const MATCH_TIER_TITLE_CONTAINS = 3;
const MATCH_TIER_TITLE_PREFIX = 4;
const MATCH_TIER_TITLE_PREFIX_NUMERIC = 6;
const MATCH_TIER_TITLE_EXACT = 7;
const NUMERIC_TITLE_SUFFIX_REGEX = /(?:[\s_-]+)\d+$/u;

export interface LexicalCandidateEvidence {
    identityScore: number;
    contentScore: number;
    priorityScore: number;
}

export interface LexicalRankingFeatures {
    matchTier: number;
    titleMatchKind?: TitleMatchKind;
    aliasMatchKind?: AliasMatchKind;
    baseScore: number;
    identityScore: number;
    contentScore: number;
    priorityScore: number;
    titleBoost: number;
    aliasBoost: number;
    tagBoost: number;
    pathBoost: number;
    numericSuffixPenalty: number;
    adjustedScore: number;
}

export interface LexicalScoringConfig {
    titleScale: TitleBoostScale;
    aliasMax: number;
    tagMax: number;
    pathMax: number;
    numericSuffixBasePenalty: number;
}

function getBaseTitle(title: string): string {
    return title.replace(NUMERIC_TITLE_SUFFIX_REGEX, "").trim();
}

function getNumericSuffixPenalty(queryPlan: QueryPlan, title: string, penalty: number): number {
    const queryTerms = queryPlan.significantTokens;
    if (queryTerms.length === 0 || queryTerms.some((term) => isNumericSearchTerm(term))) {
        return 0;
    }

    const baseTitle = getBaseTitle(title);
    if (!baseTitle || baseTitle === title) {
        return 0;
    }

    const normalizedBaseTitle = normalizeSearchText(baseTitle);
    if (!normalizedBaseTitle) {
        return 0;
    }

    return queryTerms.every((term) => normalizedBaseTitle.includes(term)) ? penalty : 0;
}

function getTitleMatchTier(matchKind: TitleMatchKind | undefined): number {
    switch (matchKind) {
        case "exact":
            return MATCH_TIER_TITLE_EXACT;
        case "leading-prefix-numeric":
            return MATCH_TIER_TITLE_PREFIX_NUMERIC;
        case "leading-prefix":
        case "starts-with":
            return MATCH_TIER_TITLE_PREFIX;
        case "contains":
            return MATCH_TIER_TITLE_CONTAINS;
        case "all-terms":
            return MATCH_TIER_TITLE_ALL_TERMS;
        default:
            return MATCH_TIER_CONTENT;
    }
}

function getAliasTier(matchKind: AliasMatchKind | undefined): number {
    switch (matchKind) {
        case "exact":
            return MATCH_TIER_ALIAS_EXACT;
        case "token":
            return MATCH_TIER_ALIAS_TOKEN;
        case "prefix":
            return MATCH_TIER_ALIAS_PREFIX;
        case "contains":
            return MATCH_TIER_ALIAS_CONTAINS;
        default:
            return MATCH_TIER_CONTENT;
    }
}

export function getLexicalMatchTier(
    titleMatchKind: TitleMatchKind | undefined,
    aliasMatchKind: AliasMatchKind | undefined,
): number {
    return Math.max(getTitleMatchTier(titleMatchKind), getAliasTier(aliasMatchKind));
}

export function scoreLexicalCandidate(
    queryPlan: QueryPlan,
    rawQuery: string,
    title: string,
    aliases: string[],
    tags: string[],
    pathSegments: string[],
    evidence: LexicalCandidateEvidence,
    config: LexicalScoringConfig,
): LexicalRankingFeatures {
    const titleBoost = calculateTitleBoost(queryPlan, title, config.titleScale);
    const aliasBoost = calculateAliasBoost(queryPlan, aliases, config.aliasMax);
    const tagBoost = calculateTagBoost(rawQuery, tags, config.tagMax);
    const pathBoost = calculatePathBoost(rawQuery, pathSegments, config.pathMax);
    const numericSuffixPenalty = getNumericSuffixPenalty(queryPlan, title, config.numericSuffixBasePenalty);
    const baseScore = Math.max(evidence.identityScore, evidence.contentScore, evidence.priorityScore);
    const titleMatchKind = getTitleMatchKind(queryPlan, title);
    const aliasMatchKind = getAliasMatchKind(queryPlan, aliases);
    const matchTier = getLexicalMatchTier(titleMatchKind, aliasMatchKind);
    const adjustedScore = baseScore + titleBoost + aliasBoost + tagBoost + pathBoost - numericSuffixPenalty;

    return {
        matchTier,
        titleMatchKind,
        aliasMatchKind,
        baseScore,
        identityScore: evidence.identityScore,
        contentScore: evidence.contentScore,
        priorityScore: evidence.priorityScore,
        titleBoost,
        aliasBoost,
        tagBoost,
        pathBoost,
        numericSuffixPenalty,
        adjustedScore,
    };
}

export function hasLexicalTitleSignal(features: LexicalRankingFeatures | undefined): boolean {
    return (features?.titleBoost ?? 0) > 0;
}

export function hasLexicalAliasSignal(features: LexicalRankingFeatures | undefined): boolean {
    return (features?.aliasBoost ?? 0) > 0;
}

export function hasLexicalTagSignal(features: LexicalRankingFeatures | undefined): boolean {
    return (features?.tagBoost ?? 0) > 0;
}

export function hasLexicalPathSignal(features: LexicalRankingFeatures | undefined): boolean {
    return (features?.pathBoost ?? 0) > 0;
}

export function hasLexicalContentSignal(features: LexicalRankingFeatures | undefined): boolean {
    return (features?.contentScore ?? 0) > 0;
}
