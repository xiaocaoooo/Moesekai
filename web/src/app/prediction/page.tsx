
import { Metadata } from "next";
import PredictionClient from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 活动预测",
};

export default function PredictionPage() {
    return <PredictionClient />;
}
