// API utilities for event prediction data

import { PredictionData, EventListItem, EventListResponse, ServerType } from '@/types/prediction';

const BASE_URL = 'https://sekaibangdan.exmeaning.com';

export async function fetchPredictionData(eventId: number, server: ServerType): Promise<PredictionData> {
    const path = server === 'jp'
        ? `/api/public/v1/jp/data/${eventId}`
        : `/api/public/v1/data/${eventId}`;

    const response = await fetch(`${BASE_URL}${path}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch prediction data: ${response.status}`);
    }
    return response.json();
}

export async function fetchEventList(server: ServerType): Promise<EventListItem[]> {
    const path = server === 'jp'
        ? '/api/public/v1/jp/events'
        : '/api/public/v1/events';

    const response = await fetch(`${BASE_URL}${path}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch event list: ${response.status}`);
    }
    const result: EventListResponse = await response.json();

    // Handle wrapped response format { success, timestamp, data: [...] }
    if (result.success && Array.isArray(result.data)) {
        return result.data;
    }

    // Fallback for direct array response
    if (Array.isArray(result)) {
        return result as unknown as EventListItem[];
    }

    return [];
}
