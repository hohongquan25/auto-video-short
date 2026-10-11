import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Clapperboard, FolderOpen, LayoutList, Plus } from "lucide-react";
import { JobsPage } from "./pages/JobsPage";
import { NewJobPage } from "./pages/NewJobPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ToastProvider } from "./components/Toast";
import { SystemStatusPanel } from "./components/SystemStatus";
import { LibraryProvider } from "./useLibrary";
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
          <NavLink to="/library"><FolderOpen size={17} /> <span>Thư viện</span></NavLink>
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
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <LibraryProvider>
          <App />
        </LibraryProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
