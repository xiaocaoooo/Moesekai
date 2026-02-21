import { Metadata } from "next";
import MyCardsClient from "./client";

export const metadata: Metadata = {
    title: "Moesekai - 卡牌进度",
};

export default function MyCardsPage() {
    return <MyCardsClient />;
}
