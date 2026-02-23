"use client";

import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import MainLayout from "@/components/MainLayout";
import ExternalLink from "@/components/ExternalLink";
import MyMusicFilters from "@/components/music/MyMusicFilters";
import { TranslatedText } from "@/components/common/TranslatedText";
import { fetchMasterDataForServer } from "@/lib/fetch";
import { loadTranslations, TranslationData } from "@/lib/translations";
import { useTheme } from "@/contexts/ThemeContext";
import { getMusicJacketUrl } from "@/lib/assets";
import type { AssetSourceType } from "@/contexts/ThemeContext";
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
import {
    MusicTagType,
    MusicCategoryType,
    IMusicTagInfo,
} from "@/types/music";
import { useScrollRestore } from "@/hooks/useScrollRestore";

const SERVER_OPTIONS: { value: ServerType; label: string }[] = [
    { value: "cn", label: "简中服" },
    { value: "jp", label: "日服" },
    { value: "tw", label: "繁中服" },
];

// ==================== Types ====================

interface Music {
    id: number;
    title: string;
    publishedAt: number;
    assetbundleName: string;
    composer: string;
    pronunciation: string;
    categories: string[];
}

interface MusicDifficulty {
    musicId: number;
    musicDifficulty: string;
    playLevel: number;
}

interface UserMusicResult {
    musicId: number;
    musicDifficultyType: string;
    playResult: string;
    highScore: number;
    playType: string;
}

type PlayResult = "AP" | "FC" | "C" | "";

// Format upload time in a way that's consistent between server and client
function formatUploadTime(uploadTime: string): string {
    try {
        const date = new Date(uploadTime);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        return `${month}-${day} ${hour}:${minute}`;
    } catch {
        return uploadTime;
    }
}

// ==================== Main Component ====================

function MyMusicsContent() {
    // Theme context for asset source
    const { assetSource } = useTheme();
    const router = useRouter();
    const searchParams = useSearchParams();

    // Account state
    const [accounts, setAccountsList] = useState<MoesekaiAccount[]>([]);
    const [activeAccount, setActiveAcc] = useState<MoesekaiAccount | null>(null);

    // Data state
    const [allMusics, setAllMusics] = useState<Music[]>([]);
    const [musicDifficulties, setMusicDifficulties] = useState<MusicDifficulty[]>([]);
    const [musicTags, setMusicTags] = useState<IMusicTagInfo[]>([]);
    const [userMusicResults, setUserMusicResults] = useState<Map<number, Record<string, PlayResult>>>(new Map());
    const [translations, setTranslations] = useState<TranslationData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetchingUser, setIsFetchingUser] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userError, setUserError] = useState<string | null>(null);
    const [uploadTime, setUploadTime] = useState<string | null>(null);
    const [isTwFallback, setIsTwFallback] = useState(false);
    const [filtersInitialized, setFiltersInitialized] = useState(false);

    // Filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDifficulty, setSelectedDifficulty] = useState<string>("master");
    const [selectedTag, setSelectedTag] = useState<MusicTagType>("all");
    const [selectedCategories, setSelectedCategories] = useState<MusicCategoryType[]>([]);
    const [sortBy, setSortBy] = useState<"publishedAt" | "id" | "level" | "completion">("level");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [completionFilter, setCompletionFilter] = useState<"all" | "no_fc" | "no_ap">("all");

    // Pagination with scroll restoration
    const { displayCount, loadMore, resetDisplayCount } = useScrollRestore({
        storageKey: "my-musics",
        defaultDisplayCount: 30,
        increment: 30,
        isReady: !isLoading && !isFetchingUser,
    });

    const allDifficulties = ["easy", "normal", "hard", "expert", "master", "append"];

    // Storage key
    const STORAGE_KEY = "my_musics_filters";

    // Initialize from URL params first, then fallback to sessionStorage
    useEffect(() => {
        const tag = searchParams.get("tag");
        const categories = searchParams.get("categories");
        const difficulty = searchParams.get("difficulty");
        const search = searchParams.get("search");
        const sort = searchParams.get("sortBy");
        const order = searchParams.get("sortOrder");
        const completion = searchParams.get("completion");

        const hasUrlParams = tag || categories || difficulty || search || sort || order || completion;

        if (hasUrlParams) {
            if (tag) setSelectedTag(tag as MusicTagType);
            if (categories) setSelectedCategories(categories.split(",") as MusicCategoryType[]);
            if (difficulty) setSelectedDifficulty(difficulty);
            if (search) setSearchQuery(search);
            if (sort) setSortBy(sort as any);
            if (order) setSortOrder(order as "asc" | "desc");
            if (completion) setCompletionFilter(completion as any);
        } else {
            try {
                const saved = sessionStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const filters = JSON.parse(saved);
                    if (filters.tag) setSelectedTag(filters.tag);
                    if (filters.categories?.length) setSelectedCategories(filters.categories);
                    if (filters.difficulty) setSelectedDifficulty(filters.difficulty);
                    if (filters.search) setSearchQuery(filters.search);
                    if (filters.sortBy) setSortBy(filters.sortBy);
                    if (filters.sortOrder) setSortOrder(filters.sortOrder);
                    if (filters.completionFilter) setCompletionFilter(filters.completionFilter);
                }
            } catch (e) {
                console.log("Could not restore filters from sessionStorage");
            }
        }
        setFiltersInitialized(true);
    }, []);

    // Save to sessionStorage and update URL when filters change
    useEffect(() => {
        if (!filtersInitialized) return;

        const filters = {
            tag: selectedTag,
            categories: selectedCategories,
            difficulty: selectedDifficulty,
            search: searchQuery,
            sortBy,
            sortOrder,
            completionFilter,
        };

        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
        } catch (e) {
            console.log("Could not save filters to sessionStorage");
        }

        const params = new URLSearchParams();
        if (selectedTag !== "all") params.set("tag", selectedTag);
        if (selectedCategories.length > 0) params.set("categories", selectedCategories.join(","));
        if (selectedDifficulty !== "master") params.set("difficulty", selectedDifficulty);
        if (searchQuery) params.set("search", searchQuery);
        if (sortBy !== "level") params.set("sortBy", sortBy);
        if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
        if (completionFilter !== "all") params.set("completion", completionFilter);

        const queryString = params.toString();
        const newUrl = queryString ? `/my-musics?${queryString}` : "/my-musics";
        router.replace(newUrl, { scroll: false });
    }, [selectedTag, selectedCategories, selectedDifficulty, searchQuery, sortBy, sortOrder, completionFilter, filtersInitialized, router]);

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
                
                // 台服和国服都使用国服数据
                let dataServer: ServerType = server === "tw" || server === "cn" ? "cn" : "jp";

                const [musicsData, difficultiesData, tagsData, translationsData] = await Promise.all([
                    fetchMasterDataForServer<Music[]>(dataServer, "musics.json"),
                    fetchMasterDataForServer<MusicDifficulty[]>(dataServer, "musicDifficulties.json"),
                    fetchMasterDataForServer<IMusicTagInfo[]>(dataServer, "musicTags.json"),
                    loadTranslations(),
                ]);

                if (cancelled) return;

                // 如果是台服，检查是否需要从日服补充数据
                if (server === "tw") {
                    const cnMusicIds = new Set(musicsData.map(m => m.id));
                    try {
                        const jpMusics = await fetchMasterDataForServer<Music[]>("jp", "musics.json");
                        const jpDifficulties = await fetchMasterDataForServer<MusicDifficulty[]>("jp", "musicDifficulties.json");
                        
                        const extraMusics = jpMusics.filter(m => !cnMusicIds.has(m.id));
                        const extraDifficulties = jpDifficulties.filter(d => !cnMusicIds.has(d.musicId));
                        
                        if (extraMusics.length > 0) {
                            setIsTwFallback(true);
                            setAllMusics([...musicsData, ...extraMusics]);
                            setMusicDifficulties([...difficultiesData, ...extraDifficulties]);
                        } else {
                            setAllMusics(musicsData);
                            setMusicDifficulties(difficultiesData);
                        }
                    } catch {
                        // 日服数据获取失败，仅使用国服数据
                        setAllMusics(musicsData);
                        setMusicDifficulties(difficultiesData);
                    }
                } else {
                    setAllMusics(musicsData);
                    setMusicDifficulties(difficultiesData);
                }
                
                setMusicTags(tagsData);
                setTranslations(translationsData);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "加载歌曲数据失败");
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        loadMasterData();
        return () => { cancelled = true; };
    }, [activeAccount]);

    // Fetch user music results from suite API
    useEffect(() => {
        if (!activeAccount) {
            setUserMusicResults(new Map());
            return;
        }

        let cancelled = false;

        async function fetchUserMusics() {
            setIsFetchingUser(true);
            setUserError(null);

            const { server, gameId } = activeAccount!;
            const url = `https://suite-api.haruki.seiunx.com/public/${server}/suite/${gameId}?key=userMusics,upload_time`;

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
                
                if (data.upload_time) {
                    setUploadTime(data.upload_time);
                } else {
                    setUploadTime(null);
                }

                // Parse nested suite API structure
                const userMusics = data.userMusics || [];
                const results: Array<{
                    musicId: number;
                    musicDifficulty: string;
                    playResult: string;
                }> = [];

                // Flatten nested structure: userMusics[].userMusicDifficultyStatuses[].userMusicResults[]
                for (const music of userMusics) {
                    const musicId = music.musicId;
                    const diffStatuses = music.userMusicDifficultyStatuses || [];
                    
                    for (const diffStatus of diffStatuses) {
                        const userResults = diffStatus.userMusicResults || [];
                        
                        for (const result of userResults) {
                            results.push({
                                musicId: musicId,
                                musicDifficulty: result.musicDifficulty,
                                playResult: result.playResult
                            });
                        }
                    }
                }

                // Parse results similar to MusicsView.vue
                const resultsMap = new Map<number, Record<string, PlayResult>>();
                for (const r of results) {
                    if (!resultsMap.has(r.musicId)) {
                        resultsMap.set(r.musicId, {});
                    }
                    const entry = resultsMap.get(r.musicId)!;
                    const diff = r.musicDifficulty;
                    const current = entry[diff] || "";
                    
                    let rank: PlayResult = "";
                    if (r.playResult === "full_perfect") rank = "AP";
                    else if (r.playResult === "full_combo") rank = "FC";
                    else if (r.playResult === "clear") rank = "C";
                    
                    if (!rank) continue;
                    
                    // Priority: AP > FC > C
                    const priority: Record<string, number> = { "AP": 3, "FC": 2, "C": 1, "": 0 };
                    if ((priority[rank] || 0) > (priority[current] || 0)) {
                        entry[diff] = rank;
                    }
                }

                console.log(`[MyMusics] Loaded ${resultsMap.size} music results from API`);
                if (!cancelled) setUserMusicResults(resultsMap);
            } catch {
                if (!cancelled) setUserError("NETWORK_ERROR");
            } finally {
                if (!cancelled) setIsFetchingUser(false);
            }
        }

        fetchUserMusics();
        return () => { cancelled = true; };
    }, [activeAccount]);

    // Build difficulty map
    const musicDifficultiesMap = useMemo(() => {
        const map: Record<number, Record<string, number>> = {};
        musicDifficulties.forEach(d => {
            if (!map[d.musicId]) map[d.musicId] = {};
            map[d.musicId]![d.musicDifficulty] = d.playLevel;
        });
        return map;
    }, [musicDifficulties]);

    // Filter and sort
    const filteredMusics = useMemo(() => {
        let result = [...allMusics];
        const now = Date.now();

        // Filter released only
        result = result.filter(m => m.publishedAt <= now);

        // Tag filter
        if (selectedTag !== "all") {
            const musicIdsWithTag = new Set(
                musicTags
                    .filter((mt) => mt.musicTag === selectedTag)
                    .map((mt) => mt.musicId)
            );
            result = result.filter((m) => musicIdsWithTag.has(m.id));
        }

        // Category filter
        if (selectedCategories.length > 0) {
            result = result.filter((m) =>
                selectedCategories.every((cat) => m.categories.includes(cat))
            );
        }

        // Search filter
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            const qNum = parseInt(q, 10);
            result = result.filter(m => {
                if (m.id === qNum) return true;
                if (m.title.toLowerCase().includes(q)) return true;
                const cn = translations?.music?.title?.[m.id.toString()];
                if (cn && cn.toLowerCase().includes(q)) return true;
                return false;
            });
        }

        // Completion filter
        if (completionFilter !== "all" && userMusicResults.size > 0) {
            const diff = selectedDifficulty;
            result = result.filter(m => {
                const rank = userMusicResults.get(m.id)?.[diff] || "";
                if (completionFilter === "no_fc") return rank !== "AP" && rank !== "FC";
                if (completionFilter === "no_ap") return rank !== "AP";
                return true;
            });
        }

        // Sort
        result.sort((a, b) => {
            let cmp = 0;
            if (sortBy === "level") {
                // Sort by level first, then by completion
                const levelA = musicDifficultiesMap[a.id]?.[selectedDifficulty] || 0;
                const levelB = musicDifficultiesMap[b.id]?.[selectedDifficulty] || 0;
                cmp = levelA - levelB;
                if (cmp === 0) {
                    // Same level, sort by completion (AP > FC > C > 未完成)
                    const rankA = userMusicResults.get(a.id)?.[selectedDifficulty] || "";
                    const rankB = userMusicResults.get(b.id)?.[selectedDifficulty] || "";
                    const priority: Record<string, number> = { "": 0, "C": 1, "FC": 2, "AP": 3 };
                    cmp = priority[rankB] - priority[rankA]; // Reverse for high to low
                }
            } else if (sortBy === "completion") {
                // Sort by completion status (AP > FC > C > 未完成)
                const rankA = userMusicResults.get(a.id)?.[selectedDifficulty] || "";
                const rankB = userMusicResults.get(b.id)?.[selectedDifficulty] || "";
                const priority: Record<string, number> = { "": 0, "C": 1, "FC": 2, "AP": 3 };
                cmp = priority[rankA] - priority[rankB];
                if (cmp === 0) cmp = a.publishedAt - b.publishedAt;
            } else if (sortBy === "publishedAt") {
                cmp = a.publishedAt - b.publishedAt;
                if (cmp === 0) cmp = a.id - b.id;
            } else if (sortBy === "id") {
                cmp = a.id - b.id;
            }
            return sortOrder === "asc" ? cmp : -cmp;
        });

        return result;
    }, [allMusics, searchQuery, completionFilter, selectedDifficulty, sortBy, sortOrder, userMusicResults, musicDifficultiesMap, translations]);

    // Progress stats
    const progressStats = useMemo(() => {
        if (userMusicResults.size === 0) return null;
        
        const diff = selectedDifficulty;
        let ap = 0, fc = 0, clear = 0, total = 0;
        
        for (const music of filteredMusics) {
            if (musicDifficultiesMap[music.id]?.[diff] !== undefined) {
                total++;
                const rank = userMusicResults.get(music.id)?.[diff] || "";
                if (rank === "AP") { ap++; fc++; clear++; }
                else if (rank === "FC") { fc++; clear++; }
                else if (rank === "C") { clear++; }
            }
        }
        
        return { ap, fc, clear, total };
    }, [filteredMusics, selectedDifficulty, userMusicResults, musicDifficultiesMap]);

    // Displayed musics with level separators
    const displayedMusicsWithSeparators = useMemo(() => {
        const musics = filteredMusics.slice(0, displayCount);
        if (sortBy !== "level") {
            return musics.map(m => ({ type: 'music' as const, data: m }));
        }

        // Group by level and insert separators
        const result: Array<{ type: 'music' | 'separator', data: Music | { level: number, difficulty: string } }> = [];
        let lastLevel: number | null = null;

        for (const music of musics) {
            const level = musicDifficultiesMap[music.id]?.[selectedDifficulty] || 0;

            if (level !== lastLevel) {
                result.push({
                    type: 'separator',
                    data: { level, difficulty: selectedDifficulty.toUpperCase() }
                });
                lastLevel = level;
            }

            result.push({ type: 'music', data: music });
        }

        return result;
    }, [filteredMusics, displayCount, sortBy, musicDifficultiesMap, selectedDifficulty]);

    const resetFilters = useCallback(() => {
        setSearchQuery("");
        setSelectedDifficulty("master");
        setSelectedTag("all");
        setSelectedCategories([]);
        setSortBy("level");
        setSortOrder("desc");
        setCompletionFilter("all");
        resetDisplayCount();
    }, [resetDisplayCount]);

    const handleAccountSelect = useCallback((acc: MoesekaiAccount) => {
        setActiveAccount(acc.id);
        setActiveAcc(acc);
    }, []);

    const getMusicThumbnailUrl = useCallback((music: Music): string => {
        // Determine asset source based on server
        let finalAssetSource: AssetSourceType = assetSource;
        
        // For CN/TW servers, force CN assets (ignore settings)
        if (activeAccount && (activeAccount.server === "cn" || activeAccount.server === "tw")) {
            // Map JP sources to CN equivalents
            const cnSourceMap: Record<AssetSourceType, AssetSourceType> = {
                "snowyassets": "snowyassets_cn",
                "haruki": "haruki_cn",
                "uni": "snowyassets_cn", // uni doesn't have CN, default to snowyassets_cn
                "snowyassets_cn": "snowyassets_cn",
                "haruki_cn": "haruki_cn",
            };
            finalAssetSource = cnSourceMap[assetSource] || "snowyassets_cn";
        }
        
        return getMusicJacketUrl(music.assetbundleName, finalAssetSource);
    }, [assetSource, activeAccount]);

    // No account state
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

            {/* Account Selector */}
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
            {activeAccount?.server === "tw" && isTwFallback && (
                <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200/50 text-xs text-amber-700 flex items-start gap-2">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <span>繁中服使用国服数据，部分国服未实装歌曲已使用日服数据补充，可能存在兼容性问题</span>
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
                            <ExternalLink href="https://haruki.seiunx.com" className="text-xs text-miku hover:underline mt-1 inline-block">
                                前往 Haruki 工具箱 →
                            </ExternalLink>
                        </div>
                    </div>
                </div>
            )}

            {/* Progress Bar */}
            {!isLoading && !isFetchingUser && userMusicResults.size > 0 && progressStats && (
                <div className="mb-6 glass-card p-4 rounded-2xl">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-primary-text">
                                {selectedDifficulty.toUpperCase()} 完成度
                            </span>
                            {uploadTime && (
                                <span className="text-[11px] text-slate-400" title="数据上传时间">
                                    数据时间: {formatUploadTime(uploadTime)}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-4 text-sm font-bold mb-2">
                        <div className="flex items-center gap-1">
                            <Image src="/data/music/icon_clear.png" alt="Clear" width={20} height={20} className="drop-shadow-sm" />
                            <span>{progressStats.clear} / {progressStats.total}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Image src="/data/music/icon_fullCombo.png" alt="FC" width={20} height={20} className="drop-shadow-sm" />
                            <span>{progressStats.fc} / {progressStats.total}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Image src="/data/music/icon_allPerfect.png" alt="AP" width={20} height={20} className="drop-shadow-sm" />
                            <span>{progressStats.ap} / {progressStats.total}</span>
                        </div>
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

            {/* Two Column Layout: Filters + Content */}
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Sidebar Filters */}
                <aside className="lg:w-80 flex-shrink-0">
                    <MyMusicFilters
                        selectedTag={selectedTag}
                        onTagChange={setSelectedTag}
                        selectedCategories={selectedCategories}
                        onCategoryChange={setSelectedCategories}
                        selectedDifficulty={selectedDifficulty}
                        onDifficultyChange={setSelectedDifficulty}
                        completionFilter={completionFilter}
                        onCompletionFilterChange={setCompletionFilter}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSortChange={(newSortBy, newSortOrder) => {
                            setSortBy(newSortBy);
                            setSortOrder(newSortOrder);
                            resetDisplayCount();
                        }}
                        onReset={resetFilters}
                        totalMusics={allMusics.length}
                        filteredMusics={filteredMusics.length}
                        hasUserData={userMusicResults.size > 0}
                    />
                </aside>

                {/* Main Content */}
                <div className="flex-1 min-w-0">
                {isLoading || isFetchingUser ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div key={i} className="rounded-xl overflow-hidden bg-white border border-slate-100 shadow-sm animate-pulse">
                                <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-200" />
                            </div>
                        ))}
                    </div>
                ) : filteredMusics.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <svg className="w-16 h-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        <p className="text-slate-400 font-medium">没有找到符合条件的歌曲</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
                        {displayedMusicsWithSeparators.map((item, index) => {
                            if (item.type === 'separator') {
                                const sepData = item.data as { level: number, difficulty: string };
                                return (
                                    <LevelSeparatorCard
                                        key={`sep-${sepData.difficulty}-${sepData.level}`}
                                        level={sepData.level}
                                        difficulty={sepData.difficulty}
                                    />
                                );
                            } else {
                                const music = item.data as Music;
                                return (
                                    <MusicItem
                                        key={music.id}
                                        music={music}
                                        difficulties={musicDifficultiesMap[music.id] || {}}
                                        results={userMusicResults.get(music.id) || {}}
                                        thumbnailUrl={getMusicThumbnailUrl(music)}
                                        hasUserData={userMusicResults.size > 0}
                                        selectedDifficulty={selectedDifficulty}
                                    />
                                );
                            }
                        })}
                    </div>
                )}

                {/* Load More Button */}
                {!isLoading && displayedMusicsWithSeparators.filter(i => i.type === 'music').length < filteredMusics.length && (
                    <div className="mt-8 flex justify-center">
                        <button
                            onClick={loadMore}
                            className="px-8 py-3 bg-gradient-to-r from-miku to-miku-dark text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                        >
                            加载更多
                            <span className="ml-2 text-sm opacity-80">
                                ({displayedMusicsWithSeparators.filter(i => i.type === 'music').length} / {filteredMusics.length})
                            </span>
                        </button>
                    </div>
                )}

                {/* All loaded indicator */}
                {!isLoading && displayedMusicsWithSeparators.filter(i => i.type === 'music').length > 0 && displayedMusicsWithSeparators.filter(i => i.type === 'music').length >= filteredMusics.length && (
                    <div className="mt-8 text-center text-slate-400 text-sm">
                        已显示全部 {filteredMusics.length} 首歌曲
                    </div>
                )}
                </div>
            </div>
        </div>
    );
}

// ==================== Sub Components ====================

function LevelSeparatorCard({ level, difficulty }: { level: number; difficulty: string }) {
    // Difficulty color mapping
    const difficultyColors: Record<string, string> = {
        EASY: "from-green-400 to-green-500",
        NORMAL: "from-blue-400 to-blue-500",
        HARD: "from-yellow-400 to-yellow-500",
        EXPERT: "from-red-400 to-red-500",
        MASTER: "from-purple-500 to-purple-600",
        APPEND: "from-pink-500 to-pink-600",
    };
    
    const gradientClass = difficultyColors[difficulty] || "from-slate-400 to-slate-500";
    
    return (
        <div className={`aspect-square rounded-xl bg-gradient-to-br ${gradientClass} flex flex-col items-center justify-center shadow-lg`}>
            <div className="text-white text-center px-2">
                <div className="text-[10px] sm:text-xs font-bold opacity-90 mb-0.5">
                    {difficulty}
                </div>
                <div className="text-2xl sm:text-3xl md:text-4xl font-black">
                    {level}
                </div>
            </div>
        </div>
    );
}

function PageHeader() {
    return (
        <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 border border-miku/30 bg-miku/5 rounded-full mb-4">
                <span className="text-miku text-xs font-bold tracking-widest uppercase">Music Progress</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-primary-text">
                歌曲<span className="text-miku">进度</span>
            </h1>
            <p className="text-slate-500 mt-2 text-sm">
                查看你的歌曲完成进度和成绩
            </p>
        </div>
    );
}

interface MusicItemProps {
    music: Music;
    difficulties: Record<string, number>;
    results: Record<string, PlayResult>;
    thumbnailUrl: string;
    hasUserData: boolean;
    selectedDifficulty: string;
}

function MusicItem({ music, difficulties, results, thumbnailUrl, hasUserData, selectedDifficulty }: MusicItemProps) {
    const allDiffs = ["easy", "normal", "hard", "expert", "master", "append"];
    const currentLevel = difficulties[selectedDifficulty];
    
    return (
        <Link href={`/music/${music.id}`} className="group block">
            <div className="relative cursor-pointer rounded-xl overflow-hidden transition-all bg-white/60 ring-1 ring-slate-200/60 hover:ring-miku hover:shadow-xl hover:-translate-y-1">
                {/* Music Thumbnail */}
                <div className="w-full aspect-square relative">
                    <Image
                        src={thumbnailUrl}
                        alt={music.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        unoptimized
                    />
                    
                    {/* Level Badge - top right corner */}
                    {currentLevel !== undefined && (
                        <div className="absolute top-1 right-1 bg-black/70 text-white text-xs font-bold px-1.5 py-0.5 rounded">
                            {currentLevel}
                        </div>
                    )}
                    
                    {/* Completion Badges - bottom left corner */}
                    {hasUserData && (
                        <div className="absolute bottom-1 left-1 flex gap-0.5">
                            {allDiffs.map(diff => {
                                if (difficulties[diff] === undefined) return null;
                                const result = results[diff] || "";
                                
                                return (
                                    <div key={diff} className="flex-shrink-0">
                                        {result === "AP" && (
                                            <Image src="/data/music/icon_allPerfect.png" alt="AP" width={12} height={12} className="drop-shadow-md" />
                                        )}
                                        {result === "FC" && (
                                            <Image src="/data/music/icon_fullCombo.png" alt="FC" width={12} height={12} className="drop-shadow-md" />
                                        )}
                                        {result === "C" && (
                                            <Image src="/data/music/icon_clear.png" alt="C" width={12} height={12} className="drop-shadow-md" />
                                        )}
                                        {!result && (
                                            <Image src="/data/music/icon_notClear.png" alt="NC" width={12} height={12} className="opacity-50 drop-shadow-md" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Title Info */}
                <div className="p-3">
                    <h3 className="text-sm font-bold text-primary-text group-hover:text-miku transition-colors">
                        <TranslatedText
                            original={music.title}
                            category="music"
                            field="title"
                            originalClassName="truncate block"
                            translationClassName="text-xs font-medium text-slate-400 truncate block"
                        />
                    </h3>
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
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                </div>
                <h2 className="text-lg font-bold text-primary-text mb-1">快速绑定账号</h2>
                <p className="text-xs text-slate-400">输入游戏UID即可查看歌曲进度</p>
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

export default function MyMusicsClient() {
    return (
        <MainLayout>
            <Suspense fallback={<div className="flex h-[50vh] w-full items-center justify-center text-slate-500">正在加载...</div>}>
                <MyMusicsContent />
            </Suspense>
        </MainLayout>
    );
}
