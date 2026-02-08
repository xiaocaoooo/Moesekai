
import { Metadata } from "next";
import MusicMetaClient from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 歌曲Meta",
};

export default function MusicMetaPage() {
    return <MusicMetaClient />;
}
