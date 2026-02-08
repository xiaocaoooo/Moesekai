
import { Metadata } from "next";
import CardsClient from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 卡牌图鉴",
};

export default function CardsPage() {
    return <CardsClient />;
}
