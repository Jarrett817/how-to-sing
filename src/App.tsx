// 路由：HashRouter 避免 GitHub Pages 刷新 404
import { HashRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/lib/session-store';
import Home from '@/pages/Home';
import Session from '@/pages/Session';
import Report from '@/pages/Report';

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <div className="bg-background text-foreground min-h-screen">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/session" element={<Session />} />
            <Route path="/report" element={<Report />} />
          </Routes>
        </div>
      </SessionProvider>
    </HashRouter>
  );
}
