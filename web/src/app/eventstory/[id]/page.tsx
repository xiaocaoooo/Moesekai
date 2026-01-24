import { Suspense } from "react";
import EventStorySummaryClient from "./client";
import { fetchMasterData } from "@/lib/fetch";
import { IEventInfo } from "@/types/events";

export async function generateStaticParams() {
    try {
        const events = await fetchMasterData<IEventInfo[]>("events.json");
        return events.map((event) => ({
            id: event.id.toString(),
        }));
    } catch (e) {
        console.error("Error generating static params for event story summary:", e);
        return [];
    }
}

export default function EventStorySummaryPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="loading-spinner"></div></div>}>
            <EventStorySummaryClient />
        </Suspense>
    );
}
