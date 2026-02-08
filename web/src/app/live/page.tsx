
import { Metadata } from "next";
import VirtualLiveContent from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 演唱会",
};

export default function LivePage() {
    return <VirtualLiveContent />;
}
