import { useState, useEffect, useContext } from 'react';
import { ToastContext } from '../ToastContext';

function ApplicationsTab() {
    const showToast = useContext(ToastContext);
    const [allApps, setAllApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        loadApplications();
    }, []);

    const loadApplications = async () => {
        try {
            const res = await fetch('/api/applications?limit=1000');
            const data = await res.json();
            setAllApps(data);
        } catch (err) {
            console.error("Error loading applications", err);
        } finally {
            setLoading(false);
        }
    };

    const updateStatus = async (appId, newStatus) => {
        try {
            await fetch(`/api/applications/${appId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            setAllApps(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
        } catch (err) {
            console.error("Error updating status", err);
            showToast("Failed to update status", 'error');
        }
    };

    const updateNotes = async (appId, notes) => {
        try {
            await fetch(`/api/applications/${appId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes })
            });
            setAllApps(prev => prev.map(a => a.id === appId ? { ...a, notes } : a));
        } catch (err) {
            console.error("Error updating notes", err);
        }
    };

    const deleteApplication = async (appId) => {
        if (!window.confirm('Delete this application?')) return;
        try {
            const res = await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
            if (res.ok) {
                setAllApps(prev => prev.filter(a => a.id !== appId));
                showToast('Application deleted');
            }
        } catch (err) {
            showToast('Failed to delete', 'error');
        }
    };

    const exportCSV = async () => {
        try {
            const res = await fetch(`/api/export`);
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `job-applications-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('📥 CSV downloaded!');
        } catch (err) {
            showToast('Export failed', 'error');
        }
    };

    const filteredApps = allApps.filter(app => 
        app.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div>
            <div className="toolbar">
                <h2>All Applications</h2>
                <div className="toolbar-actions">
                    <input 
                        type="text" 
                        className="search-box" 
                        placeholder="Search company or role..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    <button className="btn-sm btn-success" onClick={exportCSV}>📥 Export CSV</button>
                </div>
            </div>

            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Company</th>
                            <th>Role</th>
                            <th>Platform</th>
                            <th>Status</th>
                            <th>Notes</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="7" className="loading-spinner">Loading...</td></tr>
                        ) : filteredApps.length === 0 ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No applications found</td></tr>
                        ) : (
                            filteredApps.map(app => (
                                <tr key={app.id}>
                                    <td>{new Date(app.applied_at).toLocaleDateString()}</td>
                                    <td><strong>{app.company}</strong></td>
                                    <td>
                                        {app.url ? (
                                            <a href={app.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-main)' }}>
                                                {app.title}
                                            </a>
                                        ) : app.title}
                                    </td>
                                    <td>{app.platform}</td>
                                    <td>
                                        <select 
                                            className="status-select" 
                                            value={app.status} 
                                            onChange={e => updateStatus(app.id, e.target.value)}
                                        >
                                            {['applied', 'interview', 'rejected', 'offer'].map(s => (
                                                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="notes-cell">
                                        <textarea 
                                            className="notes-input" 
                                            rows="1" 
                                            placeholder="Add notes..."
                                            defaultValue={app.notes || ''}
                                            onBlur={e => updateNotes(app.id, e.target.value)}
                                        ></textarea>
                                    </td>
                                    <td>
                                        <button className="btn-delete" title="Delete application" onClick={() => deleteApplication(app.id)}>
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default ApplicationsTab;
