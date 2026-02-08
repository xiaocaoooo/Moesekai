
import { Metadata } from "next";
import MusicContent from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 音乐图鉴",
};

export default function MusicPage() {
    return <MusicContent />;
}
