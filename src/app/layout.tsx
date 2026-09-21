import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { AppDirectionProvider } from "@/components/shared/app-direction-provider";
import { AppThemeInit } from "@/components/shared/app-theme-init";

export const metadata: Metadata = {
  title: "نظام مدیریت دارویی — نسخه حرفه‌ای",
  description:
    "سیستم جامع مدیریت واردات، عمده‌فروشی، انبار، فروش و حسابداری شرکت دارویی افغانستان",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

// اعمال تم و رنگ سفارشی ذخیره‌شده پیش از اولین رندر (جلوگیری از فلش رنگ پیش‌فرض)
const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var p=localStorage.getItem("pharma_theme_preset");if(p)d.setAttribute("data-app-theme",p);var c=localStorage.getItem("pharma_item_color");if(c&&/^#[0-9a-fA-F]{3,6}$/.test(c)){var h=c.replace("#","");if(h.length===3)h=h.split("").map(function(x){return x+x}).join("");var ch=[0,2,4].map(function(i){var v=parseInt(h.slice(i,i+2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});var L=0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];var f=L>0.45?"#1a1a1a":"#ffffff";d.style.setProperty("--brand",c);d.style.setProperty("--brand-foreground",f);d.style.setProperty("--primary-foreground",f)}}catch(e){}})();`;

// در حالت توسعه: حذف Service Worker و کش‌های قدیمی مرورگر که باعث گیر کردن صفحه روی
// «در حال بارگذاری» می‌شوند (HTML/چانک‌های کهنه پس از هر کامپایل مجدد نامعتبر می‌شوند).
// این اسکریپت پیش از هیدریشن اجرا می‌شود تا حتی وقتی چانک‌های React شکسته‌اند هم شفادهد.
const DEV_SW_CLEANUP_SCRIPT = `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){for(var i=0;i<rs.length;i++){rs[i].unregister();}}).catch(function(){});}if(window.caches&&caches.keys){caches.keys().then(function(ks){for(var i=0;i<ks.length;i++){caches.delete(ks[i]);}}).catch(function(){});}`;

// ریکاوری خودکار بوت: اگر بعد از ۷ ثانیه React هنوز hydrate نشده باشد (چانک کهنه/شکسته،
// قطعی موقت شبکه)، یک بار صفحه را با cache-bust رفرش می‌کند.
// با sessionStorage محافظت می‌شود تا هرگز لوپ بی‌نهایت رفرش ساخته نشود.
const BOOT_RECOVERY_SCRIPT = `(function(){try{var K="pharma_boot_ts";var now=Date.now();var prev=parseInt(sessionStorage.getItem(K)||"0",10);sessionStorage.setItem(K,String(now));if(prev&&now-prev<15000)return;setTimeout(function(){if(window.__PHARMA_READY__)return;var s=location.search?"&":"?";location.replace(location.pathname+location.search+s+"_boot="+now);},7000);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* فونت وزیرمتن به‌صورت محلی از /fonts بارگذاری می‌شود (@font-face در globals.css)
            — هیچ منبع خارجی وجود ندارد تا سیستم در حالت آفلاین/لوکال هم فوراً رندر شود */}
        <link
          rel="preload"
          href="/fonts/Vazirmatn-Variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_RECOVERY_SCRIPT }} />
        {process.env.NODE_ENV !== "production" && (
          <script dangerouslySetInnerHTML={{ __html: DEV_SW_CLEANUP_SCRIPT }} />
        )}
      </head>
      <body className="antialiased bg-background text-foreground font-sans">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <AppThemeInit />
          <AppDirectionProvider>
            {children}
            <Toaster richColors position="bottom-left" />
          </AppDirectionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
