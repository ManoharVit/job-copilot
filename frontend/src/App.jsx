import { useState } from 'react';
import DashboardTab from './components/DashboardTab';
import ProfileTab from './components/ProfileTab';
import ApplicationsTab from './components/ApplicationsTab';
import AiWriterTab from './components/AiWriterTab';
import { ToastContext } from './ToastContext';

function App() {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [toast, setToast] = useState(null);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000); // simplify toast fade out
    };

    return (
        <ToastContext.Provider value={showToast}>
            <div className="sidebar">
                <div className="logo">Job Copilot</div>
                <div className="nav-links">
                    <div 
                        className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('dashboard')}
                    >Dashboard</div>
                    <div 
                        className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('profile')}
                    >Profile</div>
                    <div 
                        className={`nav-item ${activeTab === 'applications' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('applications')}
                    >Applications</div>
                    <div 
                        className={`nav-item ${activeTab === 'aiwriter' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('aiwriter')}
                    >✍️ AI Writer</div>
                </div>
            </div>

            <div className="main-content">
                {activeTab === 'dashboard' && <DashboardTab />}
                {activeTab === 'profile' && <ProfileTab />}
                {activeTab === 'applications' && <ApplicationsTab />}
                {activeTab === 'aiwriter' && <AiWriterTab />}
            </div>

            {toast && (
                <div className={`toast ${toast.type}`}>
                    {toast.message}
                </div>
            )}
        </ToastContext.Provider>
    );
}

export default App;
