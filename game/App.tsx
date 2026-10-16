import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { env } from './env';

import { RoleSelect } from './pages/RoleSelect';
import { AdminPage } from './pages/AdminPage';
import { TeamLayout } from './pages/TeamLayout';
import { IntroPage } from './pages/IntroPage';
import { DeskPage, CasePage } from './pages/DeskPages';
import { LevelPage } from './pages/LevelPage';
import { MarketPage } from './pages/MarketPage';
import { InboxPage } from './pages/InboxPage';
import { PhonePage } from './pages/PhonePage';
import { ShopPage } from './pages/ShopPage';
import { NotFound } from './pages/NotFound';

// Static hosts that can't rewrite deep paths to index.html build with NEXT_PUBLIC_ROUTER=hash.
const Router = env.ROUTER === 'hash' ? HashRouter : BrowserRouter;

export function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<RoleSelect />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/team" element={<TeamLayout />}>
          <Route index element={<Navigate to="desk" replace />} />
          <Route path="intro" element={<IntroPage />} />
          <Route path="desk" element={<DeskPage />} />
          <Route path="case/:caseId" element={<CasePage />} />
          <Route path="case/:caseId/level/:levelId" element={<LevelPage />} />
          <Route path="phone" element={<PhonePage />} />
          <Route path="market" element={<ShopPage />} />
          <Route path="black-market" element={<MarketPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="inbox/:messageId" element={<InboxPage />} />
          {/* unknown team paths: TeamLayout renders a fallback with a way back */}
          <Route path="*" element={null} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}
