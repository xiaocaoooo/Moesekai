
import { Metadata } from "next";
import MysekaiClient from "./client";

export const metadata: Metadata = {
    title: "Snowy SekaiViewer - 家具图鉴",
};

export default function MysekaiPage() {
    return <MysekaiClient />;
}
