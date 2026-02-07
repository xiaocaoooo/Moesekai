// TypeScript types for event prediction data

export interface TimePoint {
    t: string;  // ISO timestamp
    y: number;  // score value
}

export interface RankChart {
    Rank: number;
    CurrentScore: number;
    PredictedScore: number;
    HistoryPoints: TimePoint[];
    PredictPoints: TimePoint[];
}

// PGAI K线数据 (全服积极指数beta)
export interface KLinePoint {
    t: string;  // 时间 "2026-01-31 15:00"
    o: number;  // 开盘
    c: number;  // 收盘
    l: number;  // 最低
    h: number;  // 最高
    v: number;  // 成交量
}

export interface TierKLine {
    Rank: number;
    Data: KLinePoint[];
    CurrentIndex: number;
    Speed: number;
    ChangePct: number;
}

export interface PredictionData {
    success: boolean;
    timestamp: number;
    data: {
        event_id: number;
        event_name: string;
        charts: RankChart[];
        global_kline: KLinePoint[];  // PGAI 全服K线
        tier_klines: TierKLine[];    // 各榜线K线
    };
}

export interface EventListItem {
    id: number;
    name: string;
    start_at?: number;
    end_at?: number;
    is_active?: boolean;
    has_data?: boolean;
}

export interface EventListResponse {
    success: boolean;
    timestamp: number;
    data: EventListItem[];
}

export type ServerType = 'cn' | 'jp';
