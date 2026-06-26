import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './providers/AuthProvider';
import { ThemeProvider } from './providers/ThemeProvider';

// Example Layouts & Pages (To be built next)
import MainLayout from './layouts/MainLayout';
import DashboardPage from './pages/Dashboard';
import PosConsole from './pages/PosConsole';
import LoginPage from './pages/LoginPage';

// Route Guard to enforce authentication rules
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

export const App = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Route */}
            <Route path="/login" element={<LoginPage />} />
            
            {/* Protected Application Routes */}
            <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="pos" element={<PosConsole />} />
              {/* Other routes like /inventory, /customers, /billing go here */}
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;