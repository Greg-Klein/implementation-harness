import type { Metadata } from "next";
import { SettingsPanel } from "@/components/settings-panel";

export const metadata: Metadata = { title: "Réglages — Implementation Harness" };

export default function SettingsPage() { return <SettingsPanel />; }
