import { Navigate, Route, Routes } from "react-router-dom";
import { getAccessToken, isDemoMode } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { MonitorPage } from "./pages/MonitorPage";
import { MapPage } from "./pages/MapPage";
import { StatisticsPage } from "./pages/StatisticsPage";
import { LookupPage } from "./pages/LookupPage";
import { AccessPage } from "./pages/AccessPage";
import { ManagementPage } from "./pages/ManagementPage";
import { canVisit } from "./components";
import { useLocation } from "react-router-dom";

function Protected({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!isDemoMode() && !getAccessToken()) return <Navigate to="/login" replace />;
  return canVisit(location.pathname) ? children : <Navigate to="/monitor" replace />;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/monitor" element={<Protected><MonitorPage /></Protected>} />
    <Route path="/map" element={<Protected><MapPage /></Protected>} />
    <Route path="/configuration" element={<Navigate to="/map" replace />} />
    <Route path="/statistics" element={<Protected><StatisticsPage /></Protected>} />
    <Route path="/lookup" element={<LookupPage />} />
    <Route path="/access" element={<Protected><AccessPage /></Protected>} />
    <Route path="/management" element={<Protected><ManagementPage /></Protected>} />
    <Route path="*" element={<Navigate to={isDemoMode() || getAccessToken() ? "/monitor" : "/login"} replace />} />
  </Routes>;
}
