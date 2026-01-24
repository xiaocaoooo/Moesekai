import { Suspense } from "react";
import { fetchMasterData } from "@/lib/fetch";
import { IEventStory } from "@/types/story";
import StoryReaderClient from "./client";

export async function generateStaticParams() {
    try {
        const eventStories = await fetchMasterData<IEventStory[]>("eventStories.json");
        const params: { eventId: string; episodeNo: string }[] = [];

        for (const story of eventStories) {
            for (const episode of story.eventStoryEpisodes) {
                params.push({
                    eventId: story.eventId.toString(),
                    episodeNo: episode.episodeNo.toString(),
                });
            }
        }

        return params;
    } catch (e) {
        console.error("Error generating static params for story episodes:", e);
        return [];
    }
}

export default function StoryEpisodePage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="loading-spinner"></div></div>}>
            <StoryReaderClient />
        </Suspense>
    );
}
