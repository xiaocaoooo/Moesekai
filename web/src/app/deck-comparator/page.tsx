import { Metadata } from "next";
import DeckComparatorClient from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 组卡比较器",
    description: "多人Live PT简易计算器，快速比较不同歌曲和配置的得分差异",
};

export default function DeckComparatorPage() {
    return <DeckComparatorClient />;
}
