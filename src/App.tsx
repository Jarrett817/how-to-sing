// 路由：HashRouter 避免 GitHub Pages 刷新 404
import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { loadGender, SessionProvider } from '@/lib/session-store';
import Home from '@/pages/Home';
import Sing from '@/pages/Sing';
import SongReport from '@/pages/SongReport';

function RequireGender({ children }: { children: ReactNode }) {
  return loadGender() ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <div className="bg-background text-foreground min-h-screen">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/sing"
              element={
                <RequireGender>
                  <Sing />
                </RequireGender>
              }
            />
            <Route
              path="/song-report"
              element={
                <RequireGender>
                  <SongReport />
                </RequireGender>
              }
            />
          </Routes>
        </div>
      </SessionProvider>
    </HashRouter>
  );
}
