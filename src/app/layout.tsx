import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "FreezeShield - merchant freeze detection & resolution",
  description:
    "Monitor inbound payment risk, assemble the evidence pack and run the escalation ladder when a merchant account is frozen.",
};

const NAV = [
  { href: "/", label: "Overview", icon: "◱" },
  { href: "/statements", label: "Statements", icon: "≣" },
  { href: "/risk", label: "Risk monitor", icon: "⚠" },
  { href: "/cases", label: "Freeze cases", icon: "⚖" },
  { href: "/prevention", label: "Prevention", icon: "⛨" },
  { href: "/bridge", label: "Capital bridge", icon: "⇄" },
  { href: "/profile", label: "Verified profile", icon: "✓" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar no-print">
            <div className="brand">
              <div className="brand-mark">FS</div>
              <div>
                <div className="brand-name">FreezeShield</div>
                <div className="brand-sub">Merchant desk</div>
              </div>
            </div>
            <div className="nav-label">Workspace</div>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="nav-item">
                <span className="nav-icon">{n.icon}</span>
                {n.label}
              </Link>
            ))}
            <div className="sidebar-foot">
              Facts, evidence and deadlines are assembled automatically. Legal positions must be settled by a qualified advocate.
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
