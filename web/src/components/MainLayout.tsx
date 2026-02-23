"use client";
import React, { useState, useEffect } from "react";
import MainNavbar from "./MainNavbar";
import Sidebar from "./Sidebar";
import MainFooter from "./MainFooter";
import ScrollToTop from "./ScrollToTop";
import SekaiLoader from "./SekaiLoader";
import BackgroundPattern from "./BackgroundPattern";

interface MainLayoutProps {
    children: React.ReactNode;
    showLoader?: boolean;
}

export default function MainLayout({
    children,
    showLoader = false
}: MainLayoutProps) {
    // 同步读取 sessionStorage 初始化侧边栏状态，避免动画闪烁
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
        if (typeof window === 'undefined') return false;
        const saved = sessionStorage.getItem('sidebar_open');
        if (saved !== null) return saved === 'true';
        // 首次访问，PC 端默认打开
        return window.innerWidth >= 768;
    });
    const [isDesktop, setIsDesktop] = useState(false);

    // 检测屏幕尺寸
    useEffect(() => {
        const checkDesktop = () => {
            setIsDesktop(window.innerWidth >= 768);
        };

        checkDesktop();
        window.addEventListener('resize', checkDesktop);

        return () => window.removeEventListener('resize', checkDesktop);
    }, []);

    const handleMenuToggle = () => {
        const newState = !isSidebarOpen;
        setIsSidebarOpen(newState);
        sessionStorage.setItem('sidebar_open', String(newState));
    };

    const handleSidebarClose = () => {
        setIsSidebarOpen(false);
        sessionStorage.setItem('sidebar_open', 'false');
    };

    return (
        <main className="min-h-screen relative selection:bg-miku selection:text-white font-sans flex flex-col">
            {/* Loading Animation */}
            {showLoader && <SekaiLoader />}

            {/* Background Pattern */}
            <BackgroundPattern />

            {/* Navbar */}
            <MainNavbar onMenuToggle={handleMenuToggle} />

            {/* Layout with Sidebar */}
            <div className="flex flex-grow pt-[4.5rem] relative">
                {/* Sidebar */}
                <Sidebar isOpen={isSidebarOpen} onClose={handleSidebarClose} />

                {/* Main Content - 添加左边距以适应桌面端侧边栏 */}
                <div className={`flex-grow relative z-10 w-full min-w-0 transition-all duration-300 ${isSidebarOpen ? 'md:pl-64' : 'md:pl-0'
                    }`}>
                    {children}
                </div>
            </div>

            {/* Footer */}
            <div className={`relative z-[5] transition-all duration-300 ${isSidebarOpen ? 'md:pl-64' : 'md:pl-0'
                }`}>
                <MainFooter />
            </div>

            {/* Scroll To Top */}
            <ScrollToTop />
        </main>
    );
}
