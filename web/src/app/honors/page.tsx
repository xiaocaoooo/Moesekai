import { Metadata } from "next";
import HonorsClient from "./client";

export const metadata: Metadata = {
    title: "Moesekai - 称号成就",
};

export default function HonorsPage() {
    return <HonorsClient />;
}
