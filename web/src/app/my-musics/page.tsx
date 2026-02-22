import { Metadata } from "next";
import MyMusicsClient from "./client";

export const metadata: Metadata = {
    title: "Moesekai - 歌曲进度",
};

export default function MyMusicsPage() {
    return <MyMusicsClient />;
}
