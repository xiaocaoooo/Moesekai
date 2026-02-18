/**
 * Shared Data Provider for sekai-calculator workers
 * Used by both deck-recommend worker and score-control deck-builder worker
 *
 * 组卡代码来源: sekai-calculator (https://github.com/pjsek-ai/sekai-calculator)
 * 部分算法优化修改于: https://github.com/NeuraXmy/sekai-deck-recommend-cpp  作者: luna茶
 */
import {
    CachedDataProvider,
    DataProvider,
    MusicMeta,
} from "sekai-calculator";

// ==================== Types ====================

export type HarukiServer = "jp" | "cn" | "tw";

// ==================== Constants ====================

// Music meta URL
export const MUSIC_META_URL = "https://assets.exmeaning.com/musicmeta/music_metas.json";

// Master data URLs - use project's self-hosted official source
export const MASTER_DATA_BASES: Record<string, string> = {
    jp: "https://sekaimaster.exmeaning.com/master",
    cn: "https://sekaimaster-cn.exmeaning.com/master",
};

// Haruki suite API base
export const HARUKI_SUITE_API = "https://suite-api.haruki.seiunx.com/public";

// User data keys needed for deck recommendation
export const USER_DATA_KEYS = [
    "userCards", "userBonds", "userDecks", "userGamedata", "userMusics",
    "userMusicResults", "userMysekaiMaterials", "userAreas",
    "userChallengeLiveSoloDecks", "userCharacters",
    "userCharacterMissionV2Statuses", "userMysekaiCanvases",
    "userCharacterMissionV2s", "userMysekaiFixtureGameCharacterPerformanceBonuses",
    "userMysekaiGates", "userWorldBloomSupportDecks", "userHonors",
    "userMysekaiCharacterTalks", "userChallengeLiveSoloResults",
    "userChallengeLiveSoloStages", "userChallengeLiveSoloHighScoreRewards",
    "userEvents", "userWorldBlooms", "userMusicAchievements",
    "userPlayerFrames", "userMaterials", "upload_time",
].join(",");

// Master data keys needed for preloading
export const PRELOAD_MASTER_KEYS = [
    "areaItemLevels", "cards", "cardMysekaiCanvasBonuses", "cardRarities",
    "characterRanks", "cardEpisodes", "events", "eventCards",
    "eventRarityBonusRates", "eventDeckBonuses", "gameCharacters",
    "gameCharacterUnits", "honors", "masterLessons", "mysekaiGates",
    "mysekaiGateLevels", "skills", "worldBloomDifferentAttributeBonuses",
    "worldBloomSupportDeckBonuses", "worldBloomSupportDeckUnitEventLimitedBonuses",
];

// ==================== Helper Functions ====================

/**
 * Transform official cardParameters format to sekai-calculator expected format.
 * Official: { param1: number[], param2: number[], param3: number[] }
 * sekai-calculator expects: Array<{ id, cardId, cardLevel, cardParameterType, power }>
 */
export function transformCards(cards: any[]): any[] {
    return cards.map((card: any) => {
        if (!card.cardParameters || Array.isArray(card.cardParameters)) {
            return card;
        }
        const params = card.cardParameters as Record<string, number[]>;
        const transformed: any[] = [];
        for (const [paramType, powers] of Object.entries(params)) {
            powers.forEach((power: number, index: number) => {
                const cardLevel = index + 1;
                const paramIndex = paramType === "param1" ? 1 : paramType === "param2" ? 2 : 3;
                const id = paramIndex * 10000 + (card.id % 10000) * 100 + cardLevel;
                transformed.push({
                    id,
                    cardId: card.id,
                    cardLevel,
                    cardParameterType: paramType,
                    power,
                });
            });
        }
        return { ...card, cardParameters: transformed };
    });
}

export function calcDuration() {
    const startAt = performance.now();
    return {
        startAt,
        done() {
            return performance.now() - startAt;
        },
    };
}

// ==================== Data Provider ====================

export class SnowyDataProvider implements DataProvider {
    private userDataCache: Record<string, any> | null = null;

    constructor(
        private userId: string,
        private server: HarukiServer = "jp"
    ) {
        if (!["jp", "cn", "tw"].includes(server)) {
            throw new Error(`Unsupported server: ${server}. Only JP, CN, and TW are supported.`);
        }
    }

    public static getCachedInstance(userId: string, server: HarukiServer = "jp"): CachedDataProvider {
        return new CachedDataProvider(new SnowyDataProvider(userId, server));
    }

    private async fetchMasterJson(base: string, key: string): Promise<any[] | null> {
        try {
            const response = await fetch(`${base}/${key}.json`);
            if (!response.ok) return null;
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("text/html")) return null;
            const text = await response.text();
            if (text.trimStart().startsWith("<")) return null;
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    async getMasterData<T>(key: string): Promise<T[]> {
        const base = MASTER_DATA_BASES["jp"];
        let data = await this.fetchMasterJson(base, key);
        if (data === null) {
            console.warn(`[DeckRecommend] Master data "${key}" not available, using empty array`);
            return [] as any;
        }
        if (key === "cards") {
            data = transformCards(data);
        }
        return data as T[];
    }

    async getMusicMeta(): Promise<MusicMeta[]> {
        const response = await fetch(MUSIC_META_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch music meta (${response.status})`);
        }
        return response.json();
    }

    async getUserData<T>(key: string): Promise<T> {
        const all = await this.getUserDataAll();
        if (!(key in all)) {
            throw new Error(`User data key not found: ${key}`);
        }
        return all[key];
    }

    async getUserDataAll(): Promise<Record<string, any>> {
        if (this.userDataCache) return this.userDataCache;

        const url = `${HARUKI_SUITE_API}/${this.server}/suite/${this.userId}?key=${USER_DATA_KEYS}`;
        const response = await fetch(url);

        if (response.status === 404) {
            throw new Error("USER_NOT_FOUND");
        }
        if (response.status === 403) {
            throw new Error("API_NOT_PUBLIC");
        }
        if (!response.ok) {
            throw new Error(`Failed to fetch user data (${response.status})`);
        }

        const data = await response.json();

        // Filter userCards to ensure only cards existing in JP master data are returned
        if (data.userCards && Array.isArray(data.userCards)) {
            try {
                const masterCards = await this.getMasterData<any>("cards");
                const masterCardIds = new Set(masterCards.map((c) => c.id));
                const originalCount = data.userCards.length;
                data.userCards = data.userCards.filter((uc: any) => masterCardIds.has(uc.cardId));
                console.log(`[DeckRecommend] Filtered userCards: ${originalCount} -> ${data.userCards.length}`);
            } catch (e) {
                console.error("[DeckRecommend] Failed to filter userCards", e);
            }
        }

        // Filter userHonors
        if (data.userHonors && Array.isArray(data.userHonors)) {
            try {
                const masterHonors = await this.getMasterData<any>("honors");
                const masterHonorIds = new Set(masterHonors.map((h) => h.id));
                const originalCount = data.userHonors.length;
                data.userHonors = data.userHonors.filter((h: any) => masterHonorIds.has(h.honorId));
                console.log(`[DeckRecommend] Filtered userHonors: ${originalCount} -> ${data.userHonors.length}`);
            } catch (e) {
                console.error("[DeckRecommend] Failed to filter userHonors", e);
            }
        }

        this.userDataCache = data;
        return data;
    }
}
