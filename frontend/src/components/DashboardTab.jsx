import { useState, useEffect } from 'react';

function DashboardTab() {
    const [stats, setStats] = useState({ today: '-', total: '-', by_status: { interview: '-', offer: '-' } });
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadDashboard = async () => {
            try {
                const [statsRes, appsRes] = await Promise.all([
                    fetch('/api/stats'),
                    fetch('/api/applications?limit=10')
                ]);
                const statsData = await statsRes.json();
                const appsData = await appsRes.json();
                setStats(statsData);
                setApps(appsData);
            } catch (err) {
                console.error("Error loading dashboard", err);
            } finally {
                setLoading(false);
            }
        };
        loadDashboard();
    }, []);

    return (
        <div>
            <h2>Dashboard</h2>
            <div className="stats-grid">
                <div className="stat-card">
                    <h3>Applied Today</h3>
                    <div className="value">{stats.today || 0}</div>
                </div>
                <div className="stat-card">
                    <h3>Total Applications</h3>
                    <div className="value">{stats.total || 0}</div>
                </div>
                <div className="stat-card">
                    <h3>Interviews</h3>
                    <div className="value">{stats.by_status?.interview || 0}</div>
                </div>
                <div className="stat-card">
                    <h3>Offers</h3>
                    <div className="value">{stats.by_status?.offer || 0}</div>
                </div>
            </div>

            <h3>Recent Applications</h3>
            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Company</th>
                            <th>Role</th>
                            <th>Platform</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="5" className="loading-spinner">Loading...</td></tr>
                        ) : apps.length === 0 ? (
                            <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No applications yet</td></tr>
                        ) : (
                            apps.map(app => (
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
                                        <span className={`status-badge status-${app.status}`}>
                                            {app.status}
                                        </span>
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

export default DashboardTab;
