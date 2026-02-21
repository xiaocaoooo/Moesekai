"use client";

import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import MainLayout from "@/components/MainLayout";
import CardFilters from "@/components/cards/CardFilters";
import SekaiCardThumbnail from "@/components/cards/SekaiCardThumbnail";
import { TranslatedText } from "@/components/common/TranslatedText";
import {
    ICardInfo,
    CardRarityType,
    CardAttribute,
    SupportUnit,
    getRarityNumber,
    CHARACTER_NAMES,
    isTrainableCard,
} from "@/types/types";
import { fetchMasterDataForServer } from "@/lib/fetch";
import { loadTranslations, TranslationData } from "@/lib/translations";
import {
    getAccounts,
    getActiveAccount,
    setActiveAccount,
    createAccount,
    verifyHarukiApi,
    getCharacterIconUrl,
    getTopCharacterId,
    SERVER_LABELS,
    type MoesekaiAccount,
    type ServerType,
} from "@/lib/account";
import Image from "next/image";
import ExternalLink from "@/components/ExternalLink";

const SERVER_OPTIONS: { value: ServerType; label: string }[] = [
    { value: "cn", label: "简中服" },
    { value: "jp", label: "日服" },
    { value: "tw", label: "繁中服" },
];

// ==================== Types ====================

interface UserCard {
    cardId: number;
    skillLevel: number;
    masterRank: number;
    level: number;
    specialTrainingStatus: string;
    duplicateCount: number;
    defaultImage: string;
    totalExp: number;
    episodes: {
        cardEpisodeId: number;
        scenarioStatus: string;
        isNotSkipped: boolean;
    }[];
}

interface CardSupply {
    id: number;
    cardSupplyType: string;
}

// ==================== Main Component ====================

function MyCardsContent() {
    // Account state
    const [accounts, setAccountsList] = useState<MoesekaiAccount[]>([]);
    const [activeAccount, setActiveAcc] = useState<MoesekaiAccount | null>(null);

    // Data state
    const [allCards, setAllCards] = useState<ICardInfo[]>([]);
    const [userCards, setUserCards] = useState<Map<number, UserCard>>(new Map());
    const [translations, setTranslations] = useState<TranslationData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetchingUser, setIsFetchingUser] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userError, setUserError] = useState<string | null>(null);
    const [isTwFallback, setIsTwFallback] = useState(false);
    const [uploadTime, setUploadTime] = useState<string | null>(null);

    // Filter states (same as /cards)
    const [selectedCharacters, setSelectedCharacters] = useState<number[]>([]);
    const [selectedAttrs, setSelectedAttrs] = useState<CardAttribute[]>([]);
    const [selectedRarities, setSelectedRarities] = useState<CardRarityType[]>([]);
    const [selectedSupplyTypes, setSelectedSupplyTypes] = useState<string[]>([]);
    const [selectedSupportUnits, setSelectedSupportUnits] = useState<SupportUnit[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState<string>("rarity");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    // Ownership filter
    const [ownershipFilter, setOwnershipFilter] = useState<"all" | "owned" | "missing">("all");

    // Pagination
    const [displayCount, setDisplayCount] = useState(30);

    // Load accounts
    useEffect(() => {
        const accs = getAccounts();
        setAccountsList(accs);
        const active = getActiveAccount();
        setActiveAcc(active);
    }, []);

    // Fetch masterdata when account changes
    useEffect(() => {
        if (!activeAccount) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        async function loadMasterData() {
            setIsLoading(true);
            setError(null);
            setIsTwFallback(false);

            try {
                const server = activeAccount!.server;

                // Fetch cards and supplies for the account's server
                const [cardsData, suppliesData, translationsData] = await Promise.all([
                    fetchCardsForServer(server),
                    fetchMasterDataForServer<CardSupply[]>(server, "cardSupplies.json").catch(() => []),
                    loadTranslations(),
                ]);

                if (cancelled) return;

                // Build supply type map
                const supplyTypeMap = new Map<number, string>();
                suppliesData.forEach((s) => supplyTypeMap.set(s.id, s.cardSupplyType));

                const enhanced = cardsData.map((card) => ({
                    ...card,
                    cardSupplyType: supplyTypeMap.get(card.cardSupplyId) || "normal",
                }));

                setAllCards(enhanced);
                setTranslations(translationsData);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "加载卡牌数据失败");
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        loadMasterData();
        return () => { cancelled = true; };
    }, [activeAccount]);

    // Fetch cards with TW fallback logic
    async function fetchCardsForServer(server: ServerType): Promise<ICardInfo[]> {
        if (server === "tw") {
            // TW: use CN masterdata, fallback to JP for missing cards
            const cnCards = await fetchMasterDataForServer<ICardInfo[]>("cn", "cards.json");
            const cnCardIds = new Set(cnCards.map((c) => c.id));

            try {
                const jpCards = await fetchMasterDataForServer<ICardInfo[]>("jp", "cards.json");
                const extraCards = jpCards.filter((c) => !cnCardIds.has(c.id));
                if (extraCards.length > 0) {
                    setIsTwFallback(true);
                    return [...cnCards, ...extraCards];
                }
            } catch {
                // JP fetch failed, just use CN
            }
            return cnCards;
        }

        return fetchMasterDataForServer<ICardInfo[]>(server, "cards.json");
    }

    // Fetch user cards from suite API
    useEffect(() => {
        if (!activeAccount) {
            setUserCards(new Map());
            return;
        }

        let cancelled = false;

        async function fetchUserCards() {
            setIsFetchingUser(true);
            setUserError(null);

            const { server, gameId } = activeAccount!;
            const url = `https://suite-api.haruki.seiunx.com/public/${server}/suite/${gameId}?key=userCards,upload_time`;

            try {
                const res = await fetch(url);
                if (res.status === 403) {
                    setUserError("API_NOT_PUBLIC");
                    if (!cancelled) setIsFetchingUser(false);
                    return;
                }
                if (res.status === 404) {
                    setUserError("NOT_FOUND");
                    if (!cancelled) setIsFetchingUser(false);
                    return;
                }
                if (!res.ok) {
                    setUserError("NETWORK_ERROR");
                    if (!cancelled) setIsFetchingUser(false);
                    return;
                }

                const data = await res.json();
                // API may return { userCards: [...] } or just [...] directly
                let cards: UserCard[];
                if (Array.isArray(data)) {
                    cards = data;
                } else if (data.userCards && Array.isArray(data.userCards)) {
                    cards = data.userCards;
                } else {
                    // Try to find any array property in the response
                    const arrayProp = Object.values(data).find(v => Array.isArray(v));
                    cards = (arrayProp as UserCard[]) || [];
                }
                // Extract upload_time
                if (data.upload_time) {
                    setUploadTime(data.upload_time);
                } else {
                    setUploadTime(null);
                }
                console.log(`[MyCards] Loaded ${cards.length} user cards from API`);
                const map = new Map<number, UserCard>();
                cards.forEach((c) => map.set(c.cardId, c));

                if (!cancelled) setUserCards(map);
            } catch {
                if (!cancelled) setUserError("NETWORK_ERROR");
            } finally {
                if (!cancelled) setIsFetchingUser(false);
            }
        }

        fetchUserCards();
        return () => { cancelled = true; };
    }, [activeAccount]);

    // Filter and sort
    const filteredCards = useMemo(() => {
        let result = [...allCards];

        if (selectedCharacters.length > 0) {
            result = result.filter((c) => selectedCharacters.includes(c.characterId));
        }
        if (selectedAttrs.length > 0) {
            result = result.filter((c) => selectedAttrs.includes(c.attr));
        }
        if (selectedRarities.length > 0) {
            result = result.filter((c) => selectedRarities.includes(c.cardRarityType));
        }
        if (selectedSupplyTypes.length > 0) {
            result = result.filter((c) => selectedSupplyTypes.includes(c.cardSupplyType));
        }
        if (selectedSupportUnits.length > 0) {
            result = result.filter((c) => {
                if (c.characterId < 21) return true;
                return selectedSupportUnits.includes(c.supportUnit);
            });
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            const qNum = parseInt(q, 10);
            result = result.filter((c) => {
                if (c.id === qNum) return true;
                if (c.prefix.toLowerCase().includes(q)) return true;
                const cn = translations?.cards?.prefix?.[c.prefix];
                if (cn && cn.toLowerCase().includes(q)) return true;
                return false;
            });
        }

        // Filter released only (no spoiler on progress page)
        const now = Date.now();
        result = result.filter((c) => (c.releaseAt || c.archivePublishedAt || 0) <= now);

        // Ownership filter
        if (ownershipFilter === "owned") {
            result = result.filter((c) => userCards.has(c.id));
        } else if (ownershipFilter === "missing") {
            result = result.filter((c) => !userCards.has(c.id));
        }

        // Sort: owned cards first, then by selected criteria
        result.sort((a, b) => {
            // Primary: owned cards first
            const aOwned = userCards.has(a.id) ? 1 : 0;
            const bOwned = userCards.has(b.id) ? 1 : 0;
            if (aOwned !== bOwned) return bOwned - aOwned;

            // Secondary: selected sort criteria
            let cmp = 0;
            const ucA = userCards.get(a.id);
            const ucB = userCards.get(b.id);
            switch (sortBy) {
                case "id": cmp = a.id - b.id; break;
                case "releaseAt": cmp = (a.releaseAt || 0) - (b.releaseAt || 0); break;
                case "rarity": cmp = getRarityNumber(a.cardRarityType) - getRarityNumber(b.cardRarityType); break;
                case "skillLevel": cmp = (ucA?.skillLevel || 0) - (ucB?.skillLevel || 0); break;
                case "masterRank": cmp = (ucA?.masterRank || 0) - (ucB?.masterRank || 0); break;
                case "level": cmp = (ucA?.level || 0) - (ucB?.level || 0); break;
            }
            if (cmp !== 0) return sortOrder === "asc" ? cmp : -cmp;

            // For user-data sorts, add rarity desc as secondary tiebreaker
            if (sortBy === "skillLevel" || sortBy === "masterRank" || sortBy === "level") {
                const rarityCmp = getRarityNumber(b.cardRarityType) - getRarityNumber(a.cardRarityType);
                if (rarityCmp !== 0) return rarityCmp;
            }

            // Final tiebreaker: ID desc
            return b.id - a.id;
        });

        return result;
    }, [allCards, selectedCharacters, selectedAttrs, selectedRarities, selectedSupplyTypes, selectedSupportUnits, searchQuery, sortBy, sortOrder, ownershipFilter, userCards, translations]);

    // Progress stats
    const progressStats = useMemo(() => {
        const total = filteredCards.length;
        const owned = filteredCards.filter((c) => userCards.has(c.id)).length;
        const pct = total > 0 ? Math.round((owned / total) * 1000) / 10 : 0;
        return { total, owned, pct };
    }, [filteredCards, userCards]);

    // Displayed cards (with pagination)
    const displayedCards = useMemo(() => {
        return filteredCards.slice(0, displayCount);
    }, [filteredCards, displayCount]);

    const loadMore = useCallback(() => {
        setDisplayCount((prev) => prev + 30);
    }, []);

    // Reset
    const resetFilters = useCallback(() => {
        setSelectedCharacters([]);
        setSelectedAttrs([]);
        setSelectedRarities([]);
        setSelectedSupplyTypes([]);
        setSelectedSupportUnits([]);
        setSearchQuery("");
        setSortBy("rarity");
        setSortOrder("desc");
        setOwnershipFilter("all");
        setDisplayCount(30);
    }, []);

    const handleSortChange = useCallback((newSortBy: string, newSortOrder: "asc" | "desc") => {
        setSortBy(newSortBy);
        setSortOrder(newSortOrder);
    }, []);

    // Extra sort options for my-cards (user card data based)
    const extraSortOptions = useMemo(() => [
        { id: "skillLevel", label: "技能等级" },
        { id: "masterRank", label: "专精等级" },
        { id: "level", label: "等级" },
    ], []);

    const handleAccountSelect = useCallback((acc: MoesekaiAccount) => {
        setActiveAccount(acc.id);
        setActiveAcc(acc);
    }, []);

    // No account state — show inline quick bind form
    if (accounts.length === 0) {
        return (
            <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
                <PageHeader />
                <QuickBindForm onAccountAdded={() => {
                    setAccountsList(getAccounts());
                    setActiveAcc(getActiveAccount());
                }} />
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 sm:px-6 py-8">
            <PageHeader />

            {/* Account Selector with Quick Add */}
            <AccountSelectorBar
                accounts={accounts}
                activeAccount={activeAccount}
                onSelect={handleAccountSelect}
                onAccountAdded={() => {
                    setAccountsList(getAccounts());
                    setActiveAcc(getActiveAccount());
                }}
            />

            {/* TW Warning */}
            {activeAccount?.server === "tw" && (
                <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200/50 text-xs text-amber-700 flex items-start gap-2">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <span>繁中服使用国服 masterdata{isTwFallback ? "，部分国服未实装卡牌已使用日服数据补充" : ""}，数据可能不准确</span>
                </div>
            )}

            {/* User Error */}
            {userError && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200/50">
                    <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p className="text-xs font-medium text-red-700">
                                {userError === "API_NOT_PUBLIC"
                                    ? "该用户的公开API未开启，请先前往 Haruki 工具箱勾选「公开API访问」"
                                    : userError === "NOT_FOUND"
                                        ? "用户数据未找到，请确认已在 Haruki 上传数据"
                                        : "网络错误，请稍后重试"}
                            </p>
                            <ExternalLink
                                href="https://haruki.seiunx.com"
                                className="text-xs text-miku hover:underline mt-1 inline-block"
                            >
                                前往 Haruki 工具箱 →
                            </ExternalLink>
                        </div>
                    </div>
                </div>
            )}

            {/* Progress Bar */}
            {!isLoading && !isFetchingUser && userCards.size > 0 && (
                <div className="mb-6 glass-card p-4 rounded-2xl">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-primary-text">收集进度</span>
                            {uploadTime && (
                                <span className="text-[11px] text-slate-400" title="数据上传时间">
                                    数据时间: {new Date(uploadTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                </span>
                            )}
                        </div>
                        <span className="text-sm font-mono font-bold text-miku">
                            {progressStats.owned} / {progressStats.total}
                            <span className="ml-2 text-xs text-slate-400">({progressStats.pct}%)</span>
                        </span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-miku to-miku-dark rounded-full transition-all duration-500"
                            style={{ width: `${progressStats.pct}%` }}
                        />
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                        {(["all", "owned", "missing"] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setOwnershipFilter(f)}
                                className={`text-xs font-medium px-2 py-1 rounded-lg transition-all ${ownershipFilter === f
                                    ? "bg-miku/10 text-miku"
                                    : "text-slate-500 hover:text-slate-700"
                                    }`}
                            >
                                {f === "all" ? "全部" : f === "owned" ? "已拥有" : "未持有"}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                    <p className="font-bold">加载失败</p>
                    <p>{error}</p>
                </div>
            )}

            {/* Two Column Layout */}
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Filters */}
                <div className="w-full lg:w-80 lg:shrink-0">
                    <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto custom-scrollbar">
                        <CardFilters
                            selectedCharacters={selectedCharacters}
                            onCharacterChange={setSelectedCharacters}
                            selectedAttrs={selectedAttrs}
                            onAttrChange={setSelectedAttrs}
                            selectedRarities={selectedRarities}
                            onRarityChange={setSelectedRarities}
                            selectedSupplyTypes={selectedSupplyTypes}
                            onSupplyTypeChange={setSelectedSupplyTypes}
                            selectedSupportUnits={selectedSupportUnits}
                            onSupportUnitChange={setSelectedSupportUnits}
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            sortBy={sortBy}
                            sortOrder={sortOrder}
                            onSortChange={handleSortChange}
                            extraSortOptions={extraSortOptions}
                            onReset={resetFilters}
                            totalCards={allCards.filter((c) => (c.releaseAt || c.archivePublishedAt || 0) <= Date.now()).length}
                            filteredCards={filteredCards.length}
                        />
                    </div>
                </div>

                {/* Card Grid */}
                <div className="flex-1 min-w-0">
                    {isLoading || isFetchingUser ? (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
                            {Array.from({ length: 12 }).map((_, i) => (
                                <div key={i} className="rounded-xl overflow-hidden bg-white border border-slate-100 shadow-sm animate-pulse">
                                    <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-200" />
                                    <div className="p-2 space-y-1.5">
                                        <div className="h-3 bg-slate-200 rounded w-3/4" />
                                        <div className="h-2.5 bg-slate-100 rounded w-1/2" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredCards.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <svg className="w-16 h-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                            <p className="text-slate-400 font-medium">没有找到符合条件的卡牌</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
                            {displayedCards.map((card) => {
                                const uc = userCards.get(card.id);
                                return (
                                    <MyCardItem
                                        key={card.id}
                                        card={card}
                                        userCard={uc || null}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {/* Load More Button */}
                    {!isLoading && displayedCards.length < filteredCards.length && (
                        <div className="mt-8 flex justify-center">
                            <button
                                onClick={loadMore}
                                className="px-8 py-3 bg-gradient-to-r from-miku to-miku-dark text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                            >
                                加载更多
                                <span className="ml-2 text-sm opacity-80">
                                    ({displayedCards.length} / {filteredCards.length})
                                </span>
                            </button>
                        </div>
                    )}

                    {/* All loaded indicator */}
                    {!isLoading && displayedCards.length > 0 && displayedCards.length >= filteredCards.length && (
                        <div className="mt-8 text-center text-slate-400 text-sm">
                            已显示全部 {filteredCards.length} 张卡牌
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ==================== Sub Components ====================

function PageHeader() {
    return (
        <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 border border-miku/30 bg-miku/5 rounded-full mb-4">
                <span className="text-miku text-xs font-bold tracking-widest uppercase">Card Progress</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-primary-text">
                卡牌<span className="text-miku">进度</span>
            </h1>
            <p className="text-slate-500 mt-2 text-sm">
                查看你的卡牌收集进度和详细信息
            </p>
        </div>
    );
}

interface MyCardItemProps {
    card: ICardInfo;
    userCard: UserCard | null;
}

function MyCardItem({ card, userCard }: MyCardItemProps) {
    const isOwned = !!userCard;
    const isTrained = userCard?.specialTrainingStatus === "done";
    const showTrained = isTrained && isTrainableCard(card) && card.cardRarityType !== "rarity_birthday";

    return (
        <Link href={`/cards/${card.id}`} className="group block">
            <div className={`relative cursor-pointer rounded-xl overflow-hidden transition-all bg-white ring-1 ${isOwned
                ? "ring-slate-200 hover:ring-miku hover:shadow-xl hover:-translate-y-1"
                : "ring-slate-100 opacity-50 grayscale hover:opacity-70 hover:grayscale-0"
                }`}>
                {/* Card Thumbnail */}
                <div className="w-full relative">
                    <SekaiCardThumbnail
                        card={card}
                        trained={showTrained}
                        mastery={userCard?.masterRank || 0}
                        className="w-full"
                    />

                    {/* Skill Level Badge */}
                    {isOwned && userCard && (
                        <div className="absolute top-0 right-0 m-0.5">
                            <span className="inline-block px-1 py-0.5 bg-indigo-500/90 text-white text-[8px] font-bold rounded leading-none backdrop-blur-sm">
                                Sk.{userCard.skillLevel}
                            </span>
                        </div>
                    )}

                    {/* Not Owned Overlay */}
                    {!isOwned && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="px-2 py-1 bg-black/50 text-white text-[10px] font-bold rounded-lg backdrop-blur-sm">
                                未持有
                            </span>
                        </div>
                    )}
                </div>

                {/* Card Info Footer */}
                <div className="px-2 py-1.5 bg-white border-t border-slate-100">
                    <div className="mb-0.5">
                        <TranslatedText
                            original={card.prefix}
                            category="cards"
                            field="prefix"
                            originalClassName="text-slate-800 text-[10px] font-bold truncate leading-tight group-hover:text-miku transition-colors block"
                            translationClassName="text-slate-400 text-[9px] truncate leading-tight block"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-1">
                        <p className="text-slate-400 text-[9px] truncate leading-tight flex-1">
                            {CHARACTER_NAMES[card.characterId] || `Character ${card.characterId}`}
                        </p>
                        {isOwned && userCard && (
                            <span className="flex-shrink-0 text-[8px] text-miku bg-miku/10 px-1 py-0.5 rounded leading-none font-mono">
                                Lv.{userCard.level}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </Link>
    );
}

// ==================== Quick Bind Form ====================

function QuickBindForm({ onAccountAdded }: { onAccountAdded: () => void }) {
    const [gameId, setGameId] = useState("");
    const [server, setServer] = useState<ServerType>("jp");
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = useCallback(async () => {
        if (!gameId.trim()) return;
        setIsVerifying(true);
        setError(null);

        const result = await verifyHarukiApi(server, gameId.trim());
        if (!result.success) {
            setError(
                result.error === "API_NOT_PUBLIC"
                    ? "该用户的公开API未开启，请先前往 Haruki 工具箱勾选「公开API访问」"
                    : result.error === "NOT_FOUND"
                        ? "用户数据未找到，请确认UID和服务器是否正确，并已在 Haruki 上传数据"
                        : "网络错误，请稍后重试"
            );
            setIsVerifying(false);
            return;
        }

        const chars = result.userCharacters || [];
        const topCharId = getTopCharacterId(chars);
        const nickname = result.userProfile?.word || "";
        createAccount(gameId.trim(), server, nickname, topCharId, chars, true);

        setGameId("");
        setIsVerifying(false);
        setError(null);
        onAccountAdded();
    }, [gameId, server, onAccountAdded]);

    return (
        <div className="glass-card p-6 sm:p-8 rounded-2xl">
            <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-miku/10 flex items-center justify-center">
                    <svg className="w-8 h-8 text-miku" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                </div>
                <h2 className="text-lg font-bold text-primary-text mb-1">快速绑定账号</h2>
                <p className="text-xs text-slate-400">输入游戏UID即可查看卡牌收集进度</p>
            </div>

            <div className="space-y-4 max-w-sm mx-auto">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        游戏UID <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="text"
                        value={gameId}
                        onChange={(e) => setGameId(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                        placeholder="输入游戏UID"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-miku/20 focus:border-miku transition-all text-sm"
                        disabled={isVerifying}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">服务器</label>
                    <div className="flex gap-2">
                        {SERVER_OPTIONS.map((s) => (
                            <button
                                key={s.value}
                                onClick={() => setServer(s.value)}
                                disabled={isVerifying}
                                className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all ${server === s.value
                                    ? "bg-miku text-white shadow-md shadow-miku/20"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    }`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200/50">
                        <div className="flex items-start gap-2">
                            <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div>
                                <p className="text-xs font-medium text-red-700">{error}</p>
                                <ExternalLink href="https://haruki.seiunx.com" className="text-xs text-miku hover:underline mt-1 inline-block">
                                    前往 Haruki 工具箱 →
                                </ExternalLink>
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={!gameId.trim() || isVerifying}
                    className="w-full px-6 py-3 bg-gradient-to-r from-miku to-miku-dark text-white rounded-xl font-bold text-sm shadow-lg shadow-miku/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {isVerifying ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            验证中...
                        </>
                    ) : (
                        "验证并绑定"
                    )}
                </button>

                <p className="text-[10px] text-slate-400 text-center">
                    需要先在{" "}
                    <ExternalLink href="https://haruki.seiunx.com" className="text-miku hover:underline">
                        Haruki 工具箱
                    </ExternalLink>
                    {" "}上传数据并开启公开API
                </p>
            </div>
        </div>
    );
}

// ==================== Account Selector Bar ====================

function AccountSelectorBar({
    accounts,
    activeAccount,
    onSelect,
    onAccountAdded,
}: {
    accounts: MoesekaiAccount[];
    activeAccount: MoesekaiAccount | null;
    onSelect: (acc: MoesekaiAccount) => void;
    onAccountAdded: () => void;
}) {
    const [showAddForm, setShowAddForm] = useState(false);
    const [gameId, setGameId] = useState("");
    const [server, setServer] = useState<ServerType>("jp");
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAdd = useCallback(async () => {
        if (!gameId.trim()) return;
        setIsVerifying(true);
        setError(null);

        const result = await verifyHarukiApi(server, gameId.trim());
        if (!result.success) {
            setError(
                result.error === "API_NOT_PUBLIC"
                    ? "公开API未开启"
                    : result.error === "NOT_FOUND"
                        ? "用户未找到"
                        : "网络错误"
            );
            setIsVerifying(false);
            return;
        }

        const chars = result.userCharacters || [];
        const topCharId = getTopCharacterId(chars);
        const nickname = result.userProfile?.word || "";
        createAccount(gameId.trim(), server, nickname, topCharId, chars, true);

        setGameId("");
        setIsVerifying(false);
        setError(null);
        setShowAddForm(false);
        onAccountAdded();
    }, [gameId, server, onAccountAdded]);

    return (
        <div className="mb-6">
            <div className="glass-card p-4 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-600">选择账号</span>
                    <button
                        onClick={() => { setShowAddForm(!showAddForm); setError(null); }}
                        className="text-xs font-medium text-miku hover:text-miku-dark transition-colors flex items-center gap-0.5"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        添加账号
                    </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                    {accounts.map((acc) => {
                        const isActive = activeAccount?.id === acc.id;
                        const charId = acc.avatarCharacterId || (acc.userCharacters ? getTopCharacterId(acc.userCharacters) : 21);
                        return (
                            <button
                                key={acc.id}
                                onClick={() => onSelect(acc)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${isActive
                                    ? "bg-miku/10 border-miku/40 text-miku shadow-sm"
                                    : "bg-white/60 border-slate-200/60 text-slate-600 hover:border-miku/30 hover:bg-miku/5"
                                    }`}
                            >
                                <div className="w-5 h-5 rounded-full overflow-hidden bg-slate-100 flex-shrink-0">
                                    <Image src={getCharacterIconUrl(charId)} alt="" width={20} height={20} className="object-cover" unoptimized />
                                </div>
                                <span className="font-mono">{acc.gameId}</span>
                                <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${isActive ? "bg-miku/20 text-miku" : "bg-slate-100 text-slate-500"}`}>
                                    {SERVER_LABELS[acc.server]}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Inline Add Form */}
                {showAddForm && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="flex flex-wrap items-end gap-2">
                            <div className="flex-1 min-w-[140px]">
                                <label className="block text-[10px] font-medium text-slate-500 mb-1">UID</label>
                                <input
                                    type="text"
                                    value={gameId}
                                    onChange={(e) => setGameId(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                                    placeholder="输入游戏UID"
                                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-miku/20 focus:border-miku transition-all text-xs"
                                    disabled={isVerifying}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-medium text-slate-500 mb-1">服务器</label>
                                <div className="flex gap-1">
                                    {SERVER_OPTIONS.map((s) => (
                                        <button
                                            key={s.value}
                                            onClick={() => setServer(s.value)}
                                            disabled={isVerifying}
                                            className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all ${server === s.value
                                                ? "bg-miku text-white"
                                                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                                }`}
                                        >
                                            {s.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <button
                                onClick={handleAdd}
                                disabled={!gameId.trim() || isVerifying}
                                className="px-4 py-1.5 bg-gradient-to-r from-miku to-miku-dark text-white rounded-lg font-bold text-xs shadow-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1.5"
                            >
                                {isVerifying ? (
                                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                                {isVerifying ? "验证中" : "添加"}
                            </button>
                            <button
                                onClick={() => { setShowAddForm(false); setError(null); }}
                                disabled={isVerifying}
                                className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                        </div>
                        {error && (
                            <p className="mt-2 text-[11px] text-red-500 flex items-center gap-1">
                                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" />
                                </svg>
                                {error}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ==================== Export ====================

export default function MyCardsClient() {
    return (
        <MainLayout activeNav="卡牌进度">
            <Suspense fallback={<div className="flex h-[50vh] w-full items-center justify-center text-slate-500">正在加载...</div>}>
                <MyCardsContent />
            </Suspense>
        </MainLayout>
    );
}
