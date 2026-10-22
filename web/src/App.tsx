import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Welcome from './pages/Welcome';
import Profile from './pages/Profile';
import More from './pages/More';
// Dev-only visual harness; import.meta.env.DEV strips it from production builds.
import PhotoCaptureHarness from './dev/PhotoCaptureHarness';
import NewJob from './pages/NewJob';
import MyJobs from './pages/MyJobs';
import MyStats from './pages/MyStats';
import VehicleLookup from './pages/VehicleLookup';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import Analytics from './pages/Analytics';
import JobDetail from './pages/JobDetail';
import Export from './pages/Export';
import Team from './pages/Team';
import Services from './pages/Services';
import AdminUsers from './pages/admin/Users';
import AdminSites from './pages/admin/Sites';
import AdminSettings from './pages/admin/Settings';
import { ROUTE_ROLES, landingPathFor } from './lib/nav';

function RoleHome() {
  const { appUser } = useAuth();
  if (!appUser) return null;
  return <Navigate to={landingPathFor(appUser.role)} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {import.meta.env.DEV && <Route path="/dev/photo" element={<PhotoCaptureHarness />} />}
          <Route path="/login" element={<Login />} />
          <Route path="/welcome" element={<Welcome />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<RoleHome />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/more" element={<More />} />
            <Route path="/new" element={<ProtectedRoute roles={ROUTE_ROLES.newJob}><NewJob /></ProtectedRoute>} />
            <Route path="/mine" element={<ProtectedRoute roles={ROUTE_ROLES.workerScreens}><MyJobs /></ProtectedRoute>} />
            <Route path="/stats" element={<ProtectedRoute roles={ROUTE_ROLES.workerScreens}><MyStats /></ProtectedRoute>} />
            <Route path="/lookup" element={<ProtectedRoute roles={ROUTE_ROLES.workerScreens}><VehicleLookup /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute roles={ROUTE_ROLES.dashboard}><Dashboard /></ProtectedRoute>} />
            <Route path="/jobs" element={<ProtectedRoute roles={ROUTE_ROLES.jobs}><Jobs /></ProtectedRoute>} />
            <Route path="/jobs/:id" element={<ProtectedRoute roles={ROUTE_ROLES.jobs}><JobDetail /></ProtectedRoute>} />
            <Route path="/export" element={<ProtectedRoute roles={ROUTE_ROLES.export}><Export /></ProtectedRoute>} />
            <Route path="/analytics" element={<ProtectedRoute roles={ROUTE_ROLES.analytics}><Analytics /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute roles={ROUTE_ROLES.team}><Team /></ProtectedRoute>} />
            <Route path="/services" element={<ProtectedRoute roles={ROUTE_ROLES.services}><Services /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute roles={ROUTE_ROLES.admin}><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/sites" element={<ProtectedRoute roles={ROUTE_ROLES.admin}><AdminSites /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute roles={ROUTE_ROLES.admin}><AdminSettings /></ProtectedRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
