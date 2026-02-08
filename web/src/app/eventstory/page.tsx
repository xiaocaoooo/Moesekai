
import { Metadata } from "next";
import StoryListClient from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 活动剧情",
};

export default function StoryListPage() {
    return <StoryListClient />;
}
