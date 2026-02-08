
import { Suspense } from "react";
import { ICardInfo, CHARACTER_NAMES } from "@/types/types";
import CardDetailClient from "./client";
import { fetchMasterData } from "@/lib/fetch";
import { Metadata } from "next";

type Props = {
    params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    try {
        const cards = await fetchMasterData<ICardInfo[]>("cards.json");
        const card = cards.find((c) => c.id.toString() === id);

        if (card) {
            return {
                title: `Snowy SekaiViewer - ${card.prefix}`,
            };
        }
    } catch (e) {
        console.error("Error generating metadata for card:", e);
    }
    return {
        title: "Snowy SekaiViewer - 卡牌详情",
    };
}

export async function generateStaticParams() {
    try {
        const cards = await fetchMasterData<ICardInfo[]>("cards.json");
        return cards.map((card) => ({
            id: card.id.toString(),
        }));
    } catch (e) {
        console.error("Error generating static params for cards:", e);
        return [];
    }
}

export default function CardDetailPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="loading-spinner"></div></div>}>
            <CardDetailClient />
        </Suspense>
    );
}
