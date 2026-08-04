import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import NewJob from './pages/NewJob';
import MyJobs from './pages/MyJobs';
import Dashboard from './pages/Dashboard';
import JobDetail from './pages/JobDetail';
import Export from './pages/Export';
import AdminUsers from './pages/admin/Users';
import AdminServices from './pages/admin/Services';
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
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<RoleHome />} />
            <Route path="/new" element={<ProtectedRoute roles={['worker']}><NewJob /></ProtectedRoute>} />
            <Route path="/mine" element={<ProtectedRoute roles={['worker']}><MyJobs /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute roles={['manager', 'admin']}><Dashboard /></ProtectedRoute>} />
            <Route path="/jobs/:id" element={<ProtectedRoute roles={['manager', 'admin']}><JobDetail /></ProtectedRoute>} />
            <Route path="/export" element={<ProtectedRoute roles={['manager', 'admin']}><Export /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute roles={['admin']}><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/services" element={<ProtectedRoute roles={['admin']}><AdminServices /></ProtectedRoute>} />
            <Route path="/admin/sites" element={<ProtectedRoute roles={['admin']}><AdminSites /></ProtectedRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
