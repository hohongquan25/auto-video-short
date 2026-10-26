import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Clapperboard, FolderOpen, LayoutList, Plus, Scissors, SlidersHorizontal } from "lucide-react";
import { JobsPage } from "./pages/JobsPage";
import { NewJobPage } from "./pages/NewJobPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { LibraryPage } from "./pages/LibraryPage";
import { NewSummaryPage } from "./pages/NewSummaryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SummariesPage } from "./pages/SummariesPage";
import { SummaryDetailPage } from "./pages/SummaryDetailPage";
import { ToastProvider } from "./components/Toast";
import { SystemStatusPanel } from "./components/SystemStatus";
import { LicenseGate } from "./components/LicenseGate";
import { LibraryProvider } from "./useLibrary";
import { RETAIL } from "./edition";
import "./styles.css";

function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark"><Clapperboard size={18} /></span>
          <span>Story Studio</span>
        </NavLink>
        <NavLink to="/new" className="btn primary new-btn"><Plus size={16} /> <span>Tạo video mới</span></NavLink>
        <nav className="side-nav">
          <NavLink to="/" end><LayoutList size={17} /> <span>Danh sách video</span></NavLink>
          <NavLink to="/summaries"><Scissors size={17} /> <span>Tóm tắt video</span></NavLink>
          <NavLink to="/library"><FolderOpen size={17} /> <span>Thư viện</span></NavLink>
          <NavLink to="/settings"><SlidersHorizontal size={17} /> <span>Cài đặt</span></NavLink>
        </nav>
        <span className="spacer" />
        <SystemStatusPanel />
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<JobsPage />} />
          <Route path="/new" element={<NewJobPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/summaries" element={<SummariesPage />} />
          <Route path="/summaries/new" element={<NewSummaryPage />} />
          <Route path="/summaries/:id" element={<SummaryDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}

const app = (
  <LibraryProvider>
    <App />
  </LibraryProvider>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        {RETAIL ? <LicenseGate>{app}</LicenseGate> : app}
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
