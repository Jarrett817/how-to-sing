// 路由：HashRouter 避免 GitHub Pages 刷新 404
import { HashRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/lib/session-store';
import Home from '@/pages/Home';
import Session from '@/pages/Session';
import Report from '@/pages/Report';
import Sing from '@/pages/Sing';
import SongReport from '@/pages/SongReport';

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <div className="bg-background text-foreground min-h-screen">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/session" element={<Session />} />
            <Route path="/report" element={<Report />} />
            <Route path="/sing" element={<Sing />} />
            <Route path="/song-report" element={<SongReport />} />
          </Routes>
        </div>
      </SessionProvider>
    </HashRouter>
  );
}
