import { Suspense } from "react";
import { IMysekaiFixtureInfo } from "@/types/mysekai";
import MysekaiFixtureDetailClient from "./client";

const FIXTURES_DATA_URL = "https://sekaimaster.exmeaning.com/master/mysekaiFixtures.json";

export async function generateStaticParams() {
    try {
        const fixtures: IMysekaiFixtureInfo[] = await fetch(FIXTURES_DATA_URL).then((res) => res.json());
        return fixtures.map((fixture) => ({
            id: fixture.id.toString(),
        }));
    } catch (e) {
        console.error("Error generating static params for mysekai fixtures:", e);
        return [];
    }
}

export default function MysekaiFixtureDetailPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="loading-spinner"></div></div>}>
            <MysekaiFixtureDetailClient />
        </Suspense>
    );
}
