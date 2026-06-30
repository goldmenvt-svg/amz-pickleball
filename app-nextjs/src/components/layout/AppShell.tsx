import AppNav from './AppNav';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <AppNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-white/7 py-8 text-center text-xs text-muted">
        <p>© {new Date().getFullYear()} AMZ Pickle Ball Club · 179 Thống Nhất, TP.HCM · 0914 859 927</p>
      </footer>
    </div>
  );
}
