
import { Metadata } from "next";
import ComicContent from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 漫画图鉴",
};

export default function ComicPage() {
    return <ComicContent />;
}
