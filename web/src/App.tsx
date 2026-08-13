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
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import Analytics from './pages/Analytics';
import JobDetail from './pages/JobDetail';
import Export from './pages/Export';
import Team from './pages/Team';
import Services from './pages/Services';
import AdminUsers from './pages/admin/Users';
import AdminSites from './pages/admin/Sites';

function RoleHome() {
  const { appUser } = useAuth();
  if (!appUser) return null;
  if (appUser.role === 'worker') return <Navigate to="/new" replace />;
  return <Navigate to="/dashboard" replace />;
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
            <Route path="/new" element={<ProtectedRoute roles={['worker']}><NewJob /></ProtectedRoute>} />
            <Route path="/mine" element={<ProtectedRoute roles={['worker']}><MyJobs /></ProtectedRoute>} />
            <Route path="/stats" element={<ProtectedRoute roles={['worker']}><MyStats /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute roles={['manager', 'admin']}><Dashboard /></ProtectedRoute>} />
            <Route path="/jobs" element={<ProtectedRoute roles={['manager', 'admin']}><Jobs /></ProtectedRoute>} />
            <Route path="/jobs/:id" element={<ProtectedRoute roles={['manager', 'admin']}><JobDetail /></ProtectedRoute>} />
            <Route path="/export" element={<ProtectedRoute roles={['manager', 'admin']}><Export /></ProtectedRoute>} />
            <Route path="/analytics" element={<ProtectedRoute roles={['manager', 'admin']}><Analytics /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute roles={['manager']}><Team /></ProtectedRoute>} />
            <Route path="/services" element={<ProtectedRoute roles={['manager', 'admin']}><Services /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute roles={['admin']}><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/sites" element={<ProtectedRoute roles={['admin']}><AdminSites /></ProtectedRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
